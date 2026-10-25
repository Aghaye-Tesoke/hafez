// tests/read-children.test.ts
// The children block in an entity's header (#230, #241): a Hub's read shows
// its children as `hafez read` lines so the agent routes a write to the Child
// that owns the work from one read. Five by last-touched, overflow to the
// `query --parent` line; a flat entity and a Child show nothing new.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createHafez, removeTemp } from './helpers/hafez.js'
import type { Hafez } from '../src/types.js'
import { serializeFile } from '../src/vault.js'
import { cmdRead } from '../src/cli/commands.js'
import { createMemoryJournal } from './helpers/memory-journal.js'
import { ITEMS } from '../src/surfaces/items.js'

const TMP = join(tmpdir(), 'hafez-test-read-children-' + Date.now())
const VAULT = join(TMP, 'vault')

let os: Hafez

beforeAll(async () => {
  mkdirSync(join(VAULT, 'entities'), { recursive: true })
  mkdirSync(join(VAULT, 'knowledge'), { recursive: true })
  const entity = (slug: string, name: string, extra: Record<string, unknown> = {}, actions = '') => writeFileSync(
    join(VAULT, 'entities', `${slug}.md`),
    serializeFile(
      { name, type: 'project', status: 'active', created: '2026-01-01', 'last-touched': '2026-10-01', ...extra },
      `## Purpose\n\n## Next Actions\n\n${actions}\n## Session Log\n`,
    ),
  )
  entity('hub', 'Hub', { resource: 'https://example.com/hub' })
  entity('concierge', 'Concierge', { parent: 'hub', description: 'The review queue', 'last-touched': '2026-10-19' }, '- [ ] triage (added 2026-10-19)\n- [ ] reply (added 2026-10-19)\n- [x] done\n')
  entity('pdf-export', 'PDF export', { parent: 'hub', 'last-touched': '2026-10-02' }, '- [ ] ship (added 2026-10-02)\n')
  entity('flat', 'Flat')
  entity('big', 'Big')
  for (const [i, day] of ['2026-10-07', '2026-10-06', '2026-10-05', '2026-10-05', '2026-10-03', '2026-10-02', '2026-10-01'].entries()) {
    entity(`kid-${i}`, `Kid ${i}`, { parent: 'big', 'last-touched': day })
  }
  os = createHafez({ vaultPath: VAULT, persistence: createMemoryJournal() })
})
afterAll(() => removeTemp(TMP))

describe('the children block in the entity header', () => {
  it('a parent with two children: the count line, then a read line per child', async () => {
    const out = await cmdRead(os, ['hub'])
    expect(out).toContain([
      'resource: https://example.com/hub',
      'children: 2 · 3 open actions',
      '  hafez read concierge   The review queue · 2 open · 2026-10-19',
      '  hafez read pdf-export  1 open · 2026-10-02',
      '',
    ].join('\n'))
    expect(out).not.toContain('more · hafez query')
  })

  it('seven children: five by last-touched then slug, and the overflow line', async () => {
    const out = await cmdRead(os, ['big'])
    expect(out).toContain([
      'children: 7 · 0 open actions',
      '  hafez read kid-0  0 open · 2026-10-07',
      '  hafez read kid-1  0 open · 2026-10-06',
      '  hafez read kid-2  0 open · 2026-10-05',
      '  hafez read kid-3  0 open · 2026-10-05',
      '  hafez read kid-4  0 open · 2026-10-03',
      '  … and 2 more · hafez query --parent big',
    ].join('\n'))
    expect(out).not.toContain('kid-5')
  })

  it('a flat entity shows nothing new; a Child shows no siblings', async () => {
    expect(await cmdRead(os, ['flat'])).not.toContain('children:')
    const child = await cmdRead(os, ['concierge'])
    expect(child).toContain('parent: hub')
    expect(child).not.toContain('children:')
    expect(child).not.toContain('pdf-export')
  })

  it('--json carries children and children_total', async () => {
    const json = JSON.parse(await cmdRead(os, ['hub'], { json: true }))
    expect(json.children_total).toBe(2)
    expect(json.children).toEqual([
      { slug: 'concierge', description: 'The review queue', open_actions: 2, last_touched: '2026-10-19' },
      { slug: 'pdf-export', description: null, open_actions: 1, last_touched: '2026-10-02' },
    ])
    const big = JSON.parse(await cmdRead(os, ['big'], { json: true }))
    expect(big.children_total).toBe(7)
    expect(big.children.map((c: { slug: string }) => c.slug)).toEqual(['kid-0', 'kid-1', 'kid-2', 'kid-3', 'kid-4'])
    expect(JSON.parse(await cmdRead(os, ['flat'], { json: true }))).toMatchObject({ children: [], children_total: 0 })
  })

  it('an entity created with --parent appears on the parent\'s next read', async () => {
    await os.create('entity', 'Billing', { type: 'project', parent: 'hub', description: 'Invoices' })
    const out = await cmdRead(os, ['hub'])
    expect(out).toContain('children: 3 ·')
    expect(out).toContain('hafez read billing')
    expect(out).toContain('Invoices')
  })
})

describe('the children block render', () => {
  it('is empty with no children', () => {
    expect(ITEMS.childrenBlock.render({ slug: 'x', children: [] })).toBe('')
  })
})
