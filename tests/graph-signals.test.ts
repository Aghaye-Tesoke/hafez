// tests/graph-signals.test.ts
// The Graph's signal fields (#271, spec #270 "Graph contract"): what an
// Entity node carries of its Hafez state (open actions, Stale, stale actions,
// its effective staleness-days) and how an Unlinked note is marked, with the
// linked note its placing line names. Dates are relative to today, so the
// CLI process reads the same ages the library does.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { spawnSync } from 'child_process'
import { createHafez, removeTemp } from './helpers/hafez.js'
import { createMemoryJournal } from './helpers/memory-journal.js'
import { serializeFile } from '../src/vault.js'
import type { Graph, GraphNode, Hafez } from '../src/types.js'

const TMP = join(tmpdir(), 'hafez-test-graph-signals-' + Date.now())
const VAULT = join(TMP, 'vault')

/** The local day `n` days before today, YYYY-MM-DD. */
function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function write(dir: string, slug: string, fm: Record<string, unknown>, body = ''): void {
  writeFileSync(join(VAULT, dir, `${slug}.md`), serializeFile(fm, body))
}

const entity = (name: string, fm: Record<string, unknown>) =>
  ({ name, type: 'entity', status: 'active', created: '2026-01-01', ...fm })

let os: Hafez
let graph: Graph
const node = (id: string): GraphNode => {
  const found = graph.nodes.find(n => n.id === id)
  if (!found) throw new Error(`no node ${id}`)
  return found
}

beforeAll(async () => {
  for (const dir of ['entities', 'knowledge', 'sessions']) mkdirSync(join(VAULT, dir), { recursive: true })
  // An active Entity touched recently: one fresh action, one past 14 days,
  // one undated, and a ticked line that is no open action.
  write('entities', 'fresh', entity('Fresh', { 'last-touched': daysAgo(2) }), [
    '## Next Actions', '',
    `- [ ] Recent step (added ${daysAgo(3)})`,
    `- [ ] Old step (added ${daysAgo(40)})`,
    '- [ ] Undated step',
    `- [x] Finished step (added ${daysAgo(50)})`,
    '',
  ].join('\n'))
  // Untouched past the default 14 days, nothing open.
  write('entities', 'neglected', entity('Neglected', { 'last-touched': daysAgo(20) }))
  // The same age under a custom threshold of 30: neither it nor its action is Stale.
  write('entities', 'patient', entity('Patient', { 'last-touched': daysAgo(20), 'staleness-days': 30 }),
    `## Next Actions\n\n- [ ] Slow step (added ${daysAgo(20)})\n`)
  write('entities', 'sleeping', entity('Sleeping', { status: 'paused', 'last-touched': daysAgo(90) }),
    '## Next Actions\n\n- [ ] Undated step\n')
  write('entities', 'finished', entity('Finished', { status: 'done', 'last-touched': daysAgo(90) }),
    '## Next Actions\n\n- [ ] Undated step\n')
  write('knowledge', 'a-lesson', { name: 'A lesson', created: '2026-01-01' })

  // Linked notes: a parent and its child, a one-way related, and a Knowledge
  // note linked only by the Wiki-link that names it.
  write('entities', 'payments-gateway', entity('Payments Gateway', { type: 'project' }))
  write('entities', 'card-worker', entity('Card Worker', { parent: 'payments-gateway' }))
  write('entities', 'ledger-drift-monitor', entity('Ledger Drift Monitor', { related: ['payments-gateway'] }))
  write('knowledge', 'ledger-reconciliation', { name: 'Ledger Reconciliation', created: '2026-01-01' }, '## Synthesis\n\nSee [[ledger-notes]].\n')
  write('knowledge', 'ledger-notes', { name: 'Ledger Notes', created: '2026-01-01' })
  // Unlinked: a tag, a Session naming it and a related edge to a missing note
  // are no edge.
  write('entities', 'payments-retry', entity('Payments Retry', { tags: ['payments'], related: ['no-such-note'] }))
  write('sessions', 'retro', { name: 'Retro', created: '2026-01-01', related: ['payments-retry'] })
  write('entities', 'gateway-timeout', entity('Gateway timeout', { type: 'capture' }))
  // Its name matches nothing linked; its description names the Card Worker.
  write('entities', 'quiet-fix', entity('Quiet fix', { description: 'Card worker retries' }))
  // Ledger Drift Monitor matches better, but a Knowledge note prefers its own kind.
  write('knowledge', 'ledger-drift', { name: 'Ledger drift', created: '2026-01-01' })
  // Two Unlinked notes match only each other: neither is a linked note.
  write('knowledge', 'zebra-stripes', { name: 'Zebra stripes', created: '2026-01-01' })
  write('knowledge', 'zebra-patterns', { name: 'Zebra patterns', created: '2026-01-01', description: 'stripes' })
  os =createHafez({ vaultPath: VAULT, persistence: createMemoryJournal() })
  graph = await os.graph()
})
afterAll(() => removeTemp(TMP))

describe('graph(): an active Entity carries its action and Stale signals', () => {
  it('counts open actions, the stale and undated ones as stale actions, and is fresh within its staleness-days', () => {
    expect(node('fresh')).toMatchObject({ open_actions: 3, stale_actions: 2, stale: false, staleness_days: 14 })
  })

  it('is Stale once untouched past 14 days', () => {
    expect(node('neglected')).toMatchObject({ open_actions: 0, stale_actions: 0, stale: true, staleness_days: 14 })
  })

  it('a custom staleness-days moves both thresholds', () => {
    expect(node('patient')).toMatchObject({ open_actions: 1, stale_actions: 0, stale: false, staleness_days: 30 })
  })
})

describe('graph(): a paused Entity carries its action counts, a done one or Knowledge none', () => {
  const ACTION_SIGNALS = ['open_actions', 'stale', 'stale_actions'] as const

  it('a paused Entity carries its open and stale actions and its staleness-days, and is never Stale', () => {
    expect(node('sleeping')).toMatchObject({ open_actions: 1, stale_actions: 1, staleness_days: 14 })
    expect(node('sleeping')).not.toHaveProperty('stale')
  })

  it('a done Entity carries its staleness-days and no action or Stale signal, whatever its actions', () => {
    expect(node('finished')).toMatchObject({ staleness_days: 14 })
    for (const field of ACTION_SIGNALS) expect(node('finished'), field).not.toHaveProperty(field)
  })

  it('a Knowledge note carries none of the Entity fields', () => {
    for (const field of [...ACTION_SIGNALS, 'staleness_days']) expect(node('a-lesson'), field).not.toHaveProperty(field)
  })
})

describe('graph(): Unlinked notes and the linked note that places each', () => {
  it('a note with a Parent, Related or Wiki-link edge either way is not Unlinked', () => {
    for (const id of ['payments-gateway', 'card-worker', 'ledger-drift-monitor', 'ledger-reconciliation', 'ledger-notes']) {
      expect(node(id), id).not.toHaveProperty('unlinked')
      expect(node(id), id).not.toHaveProperty('best')
    }
  })

  it('an Unlinked Entity gets the closest linked Entity, tags, Sessions and missing notes counting for nothing', () => {
    expect(node('payments-retry')).toMatchObject({ unlinked: true, best: 'payments-gateway' })
  })

  it('an Unlinked capture gets the closest linked Entity', () => {
    expect(node('gateway-timeout')).toMatchObject({ unlinked: true, best: 'payments-gateway' })
  })

  it('an Unlinked note whose name matches nothing is placed by its description (story 48)', () => {
    expect(node('quiet-fix')).toMatchObject({ unlinked: true, best: 'card-worker' })
  })

  it('an Unlinked Knowledge note prefers a linked Knowledge note over a closer Entity', () => {
    expect(node('ledger-drift')).toMatchObject({ unlinked: true, best: 'ledger-notes' })
  })

  it('an Unlinked note nothing linked matches has no best', () => {
    for (const id of ['zebra-stripes', 'zebra-patterns']) {
      expect(node(id), id).toMatchObject({ unlinked: true })
      expect(node(id), id).not.toHaveProperty('best')
    }
  })

  it('layers change nothing: the Session layer\'s edges do not link a note', async () => {
    const layered = await os.graph({ layers: ['tag', 'domain', 'session'] })
    expect(layered.nodes.find(n => n.id === 'payments-retry')).toMatchObject({ unlinked: true, best: 'payments-gateway' })
    for (const n of layered.nodes.filter(n => n.kind === 'tag' || n.kind === 'session')) {
      expect(Object.keys(n).sort(), n.id).toEqual(['id', 'kind', 'name'])
    }
  })
})

describe('hafez graph --json', () => {
  it('prints the same signal fields', () => {
    const result = spawnSync('node', [join(process.cwd(), 'dist', 'cli.js'), '--vault', VAULT, 'graph', '--json'], { encoding: 'utf-8' })
    expect(result.status).toBe(0)
    const printed = JSON.parse(result.stdout) as Graph
    expect(printed).toEqual(graph)
    expect(printed.nodes.find(n => n.id === 'fresh')).toMatchObject({ open_actions: 3, stale_actions: 2, stale: false, staleness_days: 14 })
    expect(printed.nodes.find(n => n.id === 'ledger-drift')).toMatchObject({ unlinked: true, best: 'ledger-notes' })
  })
})
