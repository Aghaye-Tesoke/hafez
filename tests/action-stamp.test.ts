// tests/action-stamp.test.ts
// Added-date stamp on next actions (#86): every add path stamps the line
// `(added YYYY-MM-DD)` with the local day, never twice; every reader of
// action text strips it; existing unstamped lines are left alone.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createHafez, removeTemp } from './helpers/hafez.js'
import { createMemoryJournal } from './helpers/memory-journal.js'
import { stampAction, stripActionStamp, getNextActions, documentFor } from '../src/document.js'
import { localDay } from '../src/dates.js'
import { exportOkf } from '../src/export-okf.js'
import { mergeVaultContent } from '../src/merge.js'

const TMP = join(tmpdir(), 'hafez-test-action-stamp-' + Date.now())
const VAULT = join(TMP, 'vault')
const TODAY = localDay()
const stamped = (text: string) => `- [ ] ${text} (added ${TODAY})`

beforeAll(() => {
  mkdirSync(join(VAULT, 'entities'), { recursive: true })
  mkdirSync(join(VAULT, 'knowledge'), { recursive: true })
})
afterAll(() => removeTemp(TMP))

function makeOS() {
  return createHafez({ vaultPath: VAULT, persistence: createMemoryJournal() })
}
const fileOf = (slug: string) => readFileSync(join(VAULT, 'entities', `${slug}.md`), 'utf-8')

describe('stampAction / stripActionStamp', () => {
  it('appends the local-day stamp', () => {
    expect(stampAction('Ship it', '2026-10-08')).toBe('Ship it (added 2026-10-08)')
  })
  it('never double-stamps', () => {
    expect(stampAction('Ship it (added 2026-01-02)', '2026-10-08')).toBe('Ship it (added 2026-01-02)')
  })
  it('strips a trailing stamp and nothing else', () => {
    expect(stripActionStamp('Ship it (added 2026-01-02)')).toBe('Ship it')
    expect(stripActionStamp('Ship it')).toBe('Ship it')
    expect(stripActionStamp('Mention (added 2026-01-02) mid-text')).toBe('Mention (added 2026-01-02) mid-text')
  })
})

describe('every add path stamps', () => {
  it('update add_action and add_actions', async () => {
    const os = makeOS()
    await os.create('entity', 'Stamp Update', { type: 'entity' })
    await os.update('stamp-update', { add_action: 'One' })
    await os.update('stamp-update', { add_actions: ['Two', 'Three'] })
    const file = fileOf('stamp-update')
    for (const t of ['One', 'Two', 'Three']) expect(file).toContain(stamped(t))
  })

  it('create add_action and add_actions', async () => {
    const os = makeOS()
    await os.create('entity', 'Stamp Create', { type: 'project', add_action: 'First' })
    await os.create('entity', 'Stamp Create Many', { type: 'project', add_actions: ['A1', 'A2'] })
    expect(fileOf('stamp-create')).toContain(stamped('First'))
    expect(fileOf('stamp-create-many')).toContain(stamped('A1'))
    expect(fileOf('stamp-create-many')).toContain(stamped('A2'))
  })

  it('batch create and update (the path digest output feeds)', async () => {
    const os = makeOS()
    await os.batch([
      { op: 'create', kind: 'entity', name: 'Stamp Batch', fields: { type: 'entity', add_action: 'B1' } },
      { op: 'update', slug: 'stamp-batch', fields: { add_actions: ['B2'] } },
    ])
    expect(fileOf('stamp-batch')).toContain(stamped('B1'))
    expect(fileOf('stamp-batch')).toContain(stamped('B2'))
  })

  it('an action already ending in a stamp is not stamped again', async () => {
    const os = makeOS()
    await os.create('entity', 'Stamp Twice', { type: 'entity' })
    await os.update('stamp-twice', { add_action: 'Carry over (added 2026-01-02)' })
    const file = fileOf('stamp-twice')
    expect(file).toContain('- [ ] Carry over (added 2026-01-02)\n')
    expect(file).not.toContain(`(added 2026-01-02) (added`)
  })
})

describe('readers strip the stamp', () => {
  it('getNextActions returns unstamped text', () => {
    const body = `## Next Actions\n\n${stamped('Alpha')}\n- [ ] Beta\n`
    expect(getNextActions(body)).toEqual(['Alpha', 'Beta'])
  })

  it('query next_action shows the text without the stamp', async () => {
    const os = makeOS()
    await os.create('entity', 'Stamp Query', { type: 'entity', add_actions: ['Query me', 'Second'] })
    const { items } = await os.query({ filter: 'all' })
    const row = items.find(r => r.slug === 'stamp-query')!
    expect(row.next_action).toBe('Query me')
    expect(row.next_action_count).toBe(2)
  })

  it('the search index stores the unstamped text', async () => {
    const os = makeOS()
    await os.create('entity', 'Stamp Search', { type: 'entity', add_action: 'Zyzzyva rollout' })
    const hits = await os.search('Zyzzyva')
    expect(hits.some(h => h.slug === 'stamp-search')).toBe(true)
    const stampHits = await os.search(`added ${TODAY}`)
    expect(stampHits.some(h => h.slug === 'stamp-search')).toBe(false)
  })

  it('complete_action matches a stamped line by its unstamped text and reports it unstamped', async () => {
    const os = makeOS()
    await os.create('entity', 'Stamp Complete', { type: 'entity', add_actions: ['Deploy fix', 'Write docs'] })
    const result = await os.update('stamp-complete', { complete_action: 'Deploy fix' })
    expect(result.completed_action).toBe('Deploy fix')
    expect(fileOf('stamp-complete')).toContain(`- [x] Deploy fix (added ${TODAY})`)
  })

  it('remove_action matches by unstamped text; a quoted stamp in the query still matches', async () => {
    const os = makeOS()
    await os.create('entity', 'Stamp Remove', { type: 'entity', add_actions: ['Drop me', 'Keep me'] })
    const result = await os.update('stamp-remove', { remove_action: `Drop me (added ${TODAY})` })
    expect(result.removed_action).toBe('Drop me')
    expect(fileOf('stamp-remove')).not.toContain('Drop me')
    expect(fileOf('stamp-remove')).toContain(stamped('Keep me'))
  })

  it('a query naming only the stamp does not match the stamp', async () => {
    const os = makeOS()
    await os.create('entity', 'Stamp Date Query', { type: 'entity', add_actions: ['Solo'] })
    await expect(os.update('stamp-date-query', { complete_action: TODAY })).rejects.toThrow(/No matching action/)
  })

  it('stripNextActionStamps strips open and ticked lines in Next Actions only', () => {
    const doc = documentFor({ kind: 'entity' })
    const body = `## Brief\n\nQuoted - [ ] x (added 2026-01-02)\n\n## Next Actions\n\n- [ ] Open (added 2026-01-02)\n- [x] Done (added 2026-01-01)\n- [ ] Plain`
    expect(doc.stripNextActionStamps(body)).toBe(
      `## Brief\n\nQuoted - [ ] x (added 2026-01-02)\n\n## Next Actions\n\n- [ ] Open\n- [x] Done\n- [ ] Plain`,
    )
  })

  it('OKF export stores the unstamped text', () => {
    const vault = join(TMP, 'okf-vault')
    const out = join(TMP, 'okf-out')
    mkdirSync(join(vault, 'entities'), { recursive: true })
    writeFileSync(join(vault, 'entities', 'okf-stamp.md'),
      `---\nname: OKF Stamp\ntype: entity\nstatus: active\ncreated: '2026-01-01'\nlast-touched: '2026-01-01'\n---\n\n## Next Actions\n\n- [ ] Export me (added 2026-01-02)\n- [x] Done (added 2026-01-01)\n`)
    exportOkf(vault, out)
    const exported = readFileSync(join(out, 'entities', 'okf-stamp.md'), 'utf-8')
    expect(exported).toContain('- [ ] Export me\n')
    expect(exported).toContain('- [x] Done')
    expect(exported).not.toContain('(added')
  })

  it('merge treats one action stamped on two days as one line', () => {
    const fm = `---\nname: A\ntype: project\nstatus: active\ncreated: '2026-01-01'\nlast-touched: '2026-03-23'\n---\n`
    const remote = `${fm}\n## Next Actions\n\n- [x] Deploy fix (added 2026-10-07)\n`
    const local = `${fm}\n## Next Actions\n\n- [ ] Deploy fix (added 2026-10-08)\n- [ ] Write docs (added 2026-10-08)\n`
    const merged = mergeVaultContent(remote, local, 'entity')
    expect((merged.match(/Deploy fix/g) ?? []).length).toBe(1)
    expect(merged).toContain('- [x] Deploy fix (added 2026-10-08)')
  })
})

describe('existing unstamped actions are untouched', () => {
  it('a read and an unrelated write leave unstamped lines as they were', async () => {
    const os = makeOS()
    await os.create('entity', 'Stamp Legacy', { type: 'entity' })
    const path = join(VAULT, 'entities', 'stamp-legacy.md')
    writeFileSync(path, fileOf('stamp-legacy').replace(/\n*$/, '\n\n## Next Actions\n\n- [ ] Legacy one\n- [x] Legacy done\n'))
    await os.read('stamp-legacy', 'full')
    await os.update('stamp-legacy', { brief: 'Unrelated' })
    await os.update('stamp-legacy', { add_action: 'Fresh' })
    const file = fileOf('stamp-legacy')
    expect(file).toContain('- [ ] Legacy one\n')
    expect(file).toContain('- [x] Legacy done')
    expect(file).toContain(stamped('Fresh'))
  })
})
