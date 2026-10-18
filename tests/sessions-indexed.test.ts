// tests/sessions-indexed.test.ts
// Sessions are indexed (#35): a session note reads, searches and lists
// through the one read path, is the look back from the entities it touched,
// and never crowds the working set — search and query reach entities and
// knowledge by default, every kind under `all`, sessions alone under
// `session`.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createHafez, removeTemp } from './helpers/hafez.js'
import { HafezError, type Hafez } from '../src/types.js'
import { serializeFile } from '../src/vault.js'
import { cmdQuery, cmdRead, cmdSearch, cmdUpdate } from '../src/cli/commands.js'
import { UsageError, RenderedError } from '../src/cli/args.js'
import { createMemoryJournal } from './helpers/memory-journal.js'

const TMP = join(tmpdir(), 'hafez-test-sessions-indexed-' + Date.now())
const VAULT = join(TMP, 'vault')

let os: Hafez

beforeAll(async () => {
  mkdirSync(join(VAULT, 'entities'), { recursive: true })
  mkdirSync(join(VAULT, 'knowledge'), { recursive: true })
  mkdirSync(join(VAULT, 'sessions'), { recursive: true })
  writeFileSync(join(VAULT, 'entities', 'royston-fleet.md'), serializeFile(
    { name: 'Royston Fleet', type: 'project', status: 'active', created: '2026-01-01', 'last-touched': '2026-10-01' },
    '## Purpose\n\nFleet store from the warehouse.\n\n## Session Log\n',
  ))
  writeFileSync(join(VAULT, 'entities', 'untouched.md'), serializeFile(
    { name: 'Untouched', type: 'entity', status: 'active', created: '2026-01-01', 'last-touched': '2026-10-01' },
    '## Context\n\n## Session Log\n',
  ))
  writeFileSync(join(VAULT, 'knowledge', 'warehouse-first.md'), serializeFile(
    { name: 'Warehouse first', created: '2026-09-01', confidence: 'pattern', related: ['royston-fleet'] },
    '## Synthesis\n\nBuild the fleet store from the warehouse alone.\n',
  ))
  writeFileSync(join(VAULT, 'sessions', 'session-2026-10-16-f7d05c1a.md'), serializeFile(
    { name: 'Session 2026-10-16 f7d05c1a', created: '2026-10-16', 'session-date': '2026-10-16', related: ['royston-fleet'] },
    '## Summary\n\nThe fleet store was cut from the warehouse alone.\n\n## Entities Touched\n\n## Decisions\n',
  ))
  writeFileSync(join(VAULT, 'sessions', 'session-2026-09-02-aa11bb22.md'), serializeFile(
    { name: 'Session 2026-09-02 aa11bb22', created: '2026-09-02', 'session-date': '2026-09-02', related: ['royston-fleet'] },
    '## Summary\n\nFirst warehouse pull.\n',
  ))
  writeFileSync(join(VAULT, 'sessions', 'session-2026-08-01-lone.md'), serializeFile(
    { name: 'Session 2026-08-01 lone', created: '2026-08-01' },
    '## Summary\n\nNothing touched.\n',
  ))
  os = createHafez({ vaultPath: VAULT, persistence: createMemoryJournal() })
})
afterAll(() => removeTemp(TMP))

describe('read', () => {
  it('resolves a session note, full body, kind session', async () => {
    const file = await os.read('session-2026-10-16-f7d05c1a', 'full')
    expect(file.kind).toBe('session')
    expect(file.body).toContain('cut from the warehouse alone')
  })

  it('the CLI prints the note with its day and entities and no Footer', async () => {
    const out = await cmdRead(os, ['session-2026-10-16-f7d05c1a'])
    expect(out).toContain('# Session 2026-10-16 f7d05c1a')
    expect(out).toContain('session-date: 2026-10-16')
    expect(out).toContain('related: royston-fleet')
    expect(out).not.toContain('hafez update')
    const json = JSON.parse(await cmdRead(os, ['session-2026-10-16-f7d05c1a'], { json: true }))
    expect(json.kind).toBe('session')
    expect(json.writes).toBeUndefined()
  })

  it('an entity header carries the sessions line with the look back; an untouched one does not', async () => {
    const out = await cmdRead(os, ['royston-fleet'])
    expect(out).toContain('sessions: 2 · latest 2026-10-16 · hafez query --kind session --related-to royston-fleet')
    const json = JSON.parse(await cmdRead(os, ['royston-fleet'], { json: true }))
    expect(json.sessions).toEqual({ count: 2, latest: '2026-10-16' })
    expect(await cmdRead(os, ['untouched'])).not.toContain('sessions:')
  })

  it('a miss offers a session slug among the closest', async () => {
    const err = await os.read('session 2026-10-16').catch(e => e)
    expect(err).toBeInstanceOf(HafezError)
    expect(err.details).toContain('session-2026-10-16-f7d05c1a')
  })

  it('an update of a session note says it is read-only', async () => {
    const err = await cmdUpdate(os, ['session-2026-10-16-f7d05c1a', '--brief', 'x']).catch(e => e)
    expect(err).toBeInstanceOf(RenderedError)
    expect(err.message).toContain('is a session note: written once and read, never updated')
  })
})

describe('query', () => {
  it('--kind session lists the sessions alone, newest first, with the time window', async () => {
    const all = JSON.parse(await cmdQuery(os, ['--kind', 'session'], { json: true }))
    expect(all.items.map((i: any) => i.slug)).toEqual(['session-2026-10-16-f7d05c1a', 'session-2026-09-02-aa11bb22', 'session-2026-08-01-lone'])
    expect(all.items[0]).toMatchObject({ session_date: '2026-10-16', related: ['royston-fleet'] })
    const recent = await os.query_sessions({ since: '2026-09-01' })
    expect(recent.items.map(i => i.slug)).toEqual(['session-2026-10-16-f7d05c1a', 'session-2026-09-02-aa11bb22'])
    const asc = await os.query_sessions({ sort_by: 'session_date', sort_order: 'asc', limit: 1 })
    expect(asc.items[0].slug).toBe('session-2026-08-01-lone')
    expect(asc.total).toBe(3)
    expect(await cmdQuery(os, ['--kind', 'session'])).toContain('| session-2026-10-16-f7d05c1a | Session 2026-10-16 f7d05c1a | 2026-10-16 | royston-fleet |')
  })

  it('a session with no related is listed: it is not an orphan', async () => {
    const { items } = await os.query_sessions()
    expect(items.find(i => i.slug === 'session-2026-08-01-lone')?.related).toEqual([])
  })

  it('the unified query without a kind is entities and knowledge; all is every kind', async () => {
    const working = await os.queryUnified({ filter: 'all' })
    expect(working.items.some(i => i.kind === 'session')).toBe(false)
    const all = await os.queryUnified({ kind: 'all', filter: 'all' })
    expect(all.items.filter(i => i.kind === 'session')).toHaveLength(3)
    expect(await cmdQuery(os, ['--kind', 'all'])).toContain('## Sessions')
  })

  it('a session query rejects the opts it cannot map and the sort fields other kinds carry', async () => {
    await expect(os.query_sessions({ domain: 'x' } as never)).rejects.toThrow(/domain.*session query|session query.*domain/)
    await expect(os.query_sessions({ sort_by: 'last_touched' } as never)).rejects.toThrow(/sort_by/)
    await expect(os.query({ sort_by: 'session_date' } as never)).rejects.toThrow(/session_date/)
    await expect(cmdQuery(os, ['--kind', 'session', '--filter', 'active'])).rejects.toThrow(UsageError)
    await expect(cmdQuery(os, ['--kind', 'session', '--tag', 'x'])).rejects.toThrow(/a session note carries none/)
  })

  it('--related-to an entity returns the sessions that touched it', async () => {
    const { items } = await os.related_to('royston-fleet')
    expect(items.filter(i => i.kind === 'session').map(i => i.slug).sort()).toEqual(['session-2026-09-02-aa11bb22', 'session-2026-10-16-f7d05c1a'])
    expect(items.some(i => i.kind === 'knowledge' && i.slug === 'warehouse-first')).toBe(true)
    expect(await cmdQuery(os, ['--related-to', 'royston-fleet'])).toContain('## Sessions')
  })

  it('--kind session --related-to, the line the entity header prints, is the sessions alone', async () => {
    const out = JSON.parse(await cmdQuery(os, ['--kind', 'session', '--related-to', 'royston-fleet'], { json: true }))
    expect(out.items.map((i: any) => i.slug).sort()).toEqual(['session-2026-09-02-aa11bb22', 'session-2026-10-16-f7d05c1a'])
    expect(out.items.every((i: any) => i.kind === 'session')).toBe(true)
    expect(out.total).toBe(2)
    const text = await cmdQuery(os, ['--kind', 'session', '--related-to', 'royston-fleet'])
    expect(text).toContain('## Sessions')
    expect(text).not.toContain('## Knowledge')
  })
})

describe('search', () => {
  it('reaches entities and knowledge by default, sessions under --kind session or all', async () => {
    const working = await os.search('warehouse')
    expect(working.map(r => r.kind)).not.toContain('session')
    expect(working.map(r => r.slug)).toContain('warehouse-first')
    const sessions = await os.search('warehouse', 'session')
    expect(sessions.map(r => r.slug).sort()).toEqual(['session-2026-09-02-aa11bb22', 'session-2026-10-16-f7d05c1a'])
    const all = await os.search('warehouse', 'all')
    expect(all.map(r => r.kind)).toEqual(expect.arrayContaining(['knowledge', 'session']))
    expect(await cmdSearch(os, ['warehouse', '--kind', 'session'])).toContain('## Sessions')
    expect(await cmdSearch(os, ['warehouse'])).not.toContain('## Sessions')
    await expect(cmdSearch(os, ['warehouse', '--kind', 'bogus'])).rejects.toThrow(UsageError)
  })
})

describe('write and delete keep the index true', () => {
  it('a session created by batch is readable and listed; deleted, it is gone', async () => {
    await os.batch([{ op: 'create', kind: 'session', name: 'Session 2026-10-17 new', fields: { 'session-date': '2026-10-17', related: ['royston-fleet'], synthesis: 'Indexed on write.' } }])
    expect((await os.read('session-2026-10-17-new')).kind).toBe('session')
    expect((await os.query_sessions()).items[0].slug).toBe('session-2026-10-17-new')
    expect((await os.search('indexed on write', 'session')).map(r => r.slug)).toEqual(['session-2026-10-17-new'])
    expect(await os.delete('session-2026-10-17-new')).toBe('session')
    expect((await os.query_sessions()).items.map(i => i.slug)).not.toContain('session-2026-10-17-new')
    await expect(os.read('session-2026-10-17-new')).rejects.toThrow(/not found/)
  })

  it('a create never takes a slug a session note holds: one index row per slug', async () => {
    await expect(os.create('entity', 'Session 2026-09-02 aa11bb22', { type: 'entity' })).rejects.toThrow(/already exists/)
    await expect(os.create('knowledge', 'Session 2026-09-02 aa11bb22', { synthesis: 'x' })).rejects.toThrow(/already exists/)
    expect((await os.read('session-2026-09-02-aa11bb22')).kind).toBe('session')
  })

  it('a mention of a session slug links on the incremental index path as on rebuild', async () => {
    await os.create('entity', 'Mentions a session', { type: 'entity', brief: 'See [[session-2026-09-02-aa11bb22]].' })
    const incremental = await os.related_to('session-2026-09-02-aa11bb22', 'mention')
    expect(incremental.items.map(i => i.slug)).toContain('mentions-a-session')
    await os.rebuildIndex()
    const rebuilt = await os.related_to('session-2026-09-02-aa11bb22', 'mention')
    expect(rebuilt.items.map(i => i.slug)).toContain('mentions-a-session')
  })

  it('a session relating to a knowledge note does not keep it from being deleted', async () => {
    await os.create('knowledge', 'Deletable', { synthesis: 'x' })
    await os.batch([{ op: 'create', kind: 'session', name: 'Session cites deletable', fields: { related: ['deletable'] } }])
    expect(await os.delete('deletable')).toBe('knowledge')
  })
})

describe('validate', () => {
  it('counts sessions, reports a broken related, never an orphan', async () => {
    writeFileSync(join(VAULT, 'sessions', 'session-broken.md'), serializeFile(
      { name: 'Session broken', created: '2026-08-02', related: ['no-such-entity'] }, '## Summary\n',
    ))
    writeFileSync(join(VAULT, 'sessions', 'session-cites-session.md'), serializeFile(
      { name: 'Session cites session', created: '2026-08-03', related: ['session-2026-08-01-lone'] }, '## Summary\n',
    ))
    const report = await os.validate()
    expect(report.total_sessions).toBeGreaterThanOrEqual(5)
    expect(report.broken_slugs.some(b => b.slug === 'session-cites-session')).toBe(false)
    expect(report.broken_slugs).toContainEqual({ slug: 'session-broken', field: 'related', issue: "related 'no-such-entity' does not exist" })
    expect(report.orphaned_knowledge).not.toContain('session-2026-08-01-lone')
  })
})
