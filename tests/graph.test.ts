// tests/graph.test.ts
// The Graph (#252): the Vault's structure as one {nodes, edges} document.
// Nodes are Entities and Knowledge notes; edges are Parent, Related (one per
// unordered pair, ADR 0002) and Wiki-link (`mention`) among them. Sessions,
// tags, domains and the generated index.md never appear by default.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createHafez, removeTemp } from './helpers/hafez.js'
import type { Hafez, Graph, GraphLayer } from '../src/types.js'
import { serializeFile } from '../src/vault.js'
import { createMemoryJournal } from './helpers/memory-journal.js'
import { spawnSync } from 'child_process'
import { USAGE } from '../src/cli/index.js'

const TMP = join(tmpdir(), 'hafez-test-graph-' + Date.now())
const VAULT = join(TMP, 'vault')

let os: Hafez
let graph: Graph

function write(dir: string, slug: string, fm: Record<string, unknown>, body = ''): void {
  writeFileSync(join(VAULT, dir, `${slug}.md`), serializeFile(fm, body))
}

beforeAll(async () => {
  for (const dir of ['entities', 'knowledge', 'sessions']) mkdirSync(join(VAULT, dir), { recursive: true })
  write('entities', 'hub', {
    name: 'Hub', type: 'project', status: 'active', created: '2026-01-01', 'last-touched': '2026-10-01',
    description: 'The coordinating project', tags: ['infra'], domain: ['engineering'],
  }, '## Brief\n\nSee [[insight-a]], [[missing-note]] and [[standup]].\n')
  write('entities', 'worker', {
    name: 'Worker', type: 'entity', status: 'paused', created: '2026-01-02', 'last-touched': '2026-10-02',
    parent: 'hub', related: ['insight-a'],
  })
  // insight-a carries a tag named like a slug: its synthetic id must not collide.
  write('knowledge', 'insight-a', {
    name: 'Insight A', created: '2026-02-01', confidence: 'pattern', related: ['insight-b'],
    tags: ['infra', 'hub'], domain: ['engineering', 'infra'],
  })
  write('knowledge', 'insight-b', {
    name: 'Insight B', created: '2026-02-02', related: ['insight-a'],
  })
  write('knowledge', 'insight-c', {
    name: 'Insight C', created: '2026-02-03', related: ['insight-a'],
  })
  write('knowledge', 'the-plan', {
    name: 'The Plan', created: '2026-02-04', subtype: 'plan', status: 'active', 'last-touched': '2026-10-03',
  })
  write('sessions', 'standup', { name: 'Standup', created: '2026-10-01', 'session-date': '2026-10-01', related: ['hub'] })
  write('sessions', 'retro', {
    name: 'Retro', created: '2026-10-02', 'session-date': '2026-10-02', related: ['worker'], tags: ['meeting'],
  }, '## Summary\n\nRevisited [[insight-a]].\n')
  writeFileSync(join(VAULT, 'index.md'), '# Index\n\n- [[hub]]\n')
  os = createHafez({ vaultPath: VAULT, persistence: createMemoryJournal() })
  graph = await os.graph()
})
afterAll(() => removeTemp(TMP))

describe('graph(): nodes', () => {
  it('returns every Entity and Knowledge note, with the fields each one has', () => {
    expect(graph.nodes).toEqual([
      // Untouched since 2026-10-01: Stale on every day after 2026-10-15.
      {
        id: 'hub', kind: 'entity', name: 'Hub', type: 'project', status: 'active', last_touched: '2026-10-01', description: 'The coordinating project',
        open_actions: 0, stale: true, stale_actions: 0, staleness_days: 14,
      },
      { id: 'insight-a', kind: 'knowledge', name: 'Insight A', subtype: 'insight', confidence: 'pattern' },
      { id: 'insight-b', kind: 'knowledge', name: 'Insight B', subtype: 'insight' },
      { id: 'insight-c', kind: 'knowledge', name: 'Insight C', subtype: 'insight' },
      // No edge either way, and no linked note matches it.
      { id: 'the-plan', kind: 'knowledge', name: 'The Plan', subtype: 'plan', last_touched: '2026-10-03', unlinked: true },
      {
        id: 'worker', kind: 'entity', name: 'Worker', type: 'entity', status: 'paused', last_touched: '2026-10-02',
        open_actions: 0, stale_actions: 0, staleness_days: 14,
      },
    ])
  })
})

describe('graph(): edges', () => {
  it('Parent, Related once per pair, and Wiki-links among the nodes, nothing else', () => {
    expect(graph.edges).toEqual([
      { source: 'hub', target: 'insight-a', relation: 'mention' },
      // insight-a and insight-b name each other: one edge for the pair.
      { source: 'insight-a', target: 'insight-b', relation: 'related' },
      // A legacy one-way edge appears once, as written.
      { source: 'insight-c', target: 'insight-a', relation: 'related' },
      { source: 'worker', target: 'hub', relation: 'parent' },
      { source: 'worker', target: 'insight-a', relation: 'related' },
    ])
  })

  it('never reaches a session, a tag, a domain, index.md or a missing note', () => {
    const ids = new Set(graph.nodes.map(n => n.id))
    for (const e of graph.edges) {
      expect(ids.has(e.source), e.source).toBe(true)
      expect(ids.has(e.target), e.target).toBe(true)
    }
    expect(ids.has('standup')).toBe(false)
    expect(ids.has('index')).toBe(false)
    expect(ids.has('missing-note')).toBe(false)
  })
})

describe('graph(): opts', () => {
  it('an opt it cannot apply is rejected, never dropped', async () => {
    await expect(os.graph({ depth: 2 } as never)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })

  it('an unknown layer is rejected, never dropped', async () => {
    await expect(os.graph({ layers: ['tag', 'wikilink'] as never })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED', message: expect.stringContaining('wikilink'),
    })
    await expect(os.graph({ layers: 'tag' as never })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })
})

/** What a layered graph adds to the default one, sorted. */
async function added(layers: GraphLayer[]): Promise<Graph> {
  const layered = await os.graph({ layers })
  const key = (e: Graph['edges'][number]) => `${e.source} ${e.target} ${e.relation}`
  const ids = new Set(graph.nodes.map(n => n.id))
  const edgeKeys = new Set(graph.edges.map(key))
  // Every default node and edge is still there.
  expect(layered.nodes).toEqual(expect.arrayContaining(graph.nodes))
  expect(layered.edges).toEqual(expect.arrayContaining(graph.edges))
  return {
    nodes: layered.nodes.filter(n => !ids.has(n.id)).sort((a, b) => a.id.localeCompare(b.id)),
    edges: layered.edges.filter(e => !edgeKeys.has(key(e))).sort((a, b) => key(a).localeCompare(key(b))),
  }
}

describe('graph(): layers', () => {
  it('tag adds one node per tag a note carries, and an edge from each note carrying it', async () => {
    expect(await added(['tag'])).toEqual({
      nodes: [
        // A tag named like the slug `hub` is its own node: synthetic ids never collide.
        { id: 'tag:hub', kind: 'tag', name: 'hub' },
        { id: 'tag:infra', kind: 'tag', name: 'infra' },
      ],
      edges: [
        { source: 'hub', target: 'tag:infra', relation: 'tag' },
        { source: 'insight-a', target: 'tag:hub', relation: 'tag' },
        { source: 'insight-a', target: 'tag:infra', relation: 'tag' },
      ],
    })
  })

  it('domain adds one node per domain a note carries, and an edge from each note carrying it', async () => {
    expect(await added(['domain'])).toEqual({
      nodes: [
        { id: 'domain:engineering', kind: 'domain', name: 'engineering' },
        { id: 'domain:infra', kind: 'domain', name: 'infra' },
      ],
      edges: [
        { source: 'hub', target: 'domain:engineering', relation: 'domain' },
        { source: 'insight-a', target: 'domain:engineering', relation: 'domain' },
        { source: 'insight-a', target: 'domain:infra', relation: 'domain' },
      ],
    })
  })

  it('session adds the Sessions, each with its related edges to the Entities it touched, nothing else', async () => {
    expect(await added(['session'])).toEqual({
      nodes: [
        { id: 'retro', kind: 'session', name: 'Retro' },
        { id: 'standup', kind: 'session', name: 'Standup' },
      ],
      // Not hub's Wiki-link to standup, not retro's to insight-a.
      edges: [
        { source: 'retro', target: 'worker', relation: 'related' },
        { source: 'standup', target: 'hub', relation: 'related' },
      ],
    })
  })

  it('layers combine: all three add exactly what each adds alone', async () => {
    const each = await Promise.all((['tag', 'domain', 'session'] as const).map(l => added([l])))
    const all = await added(['tag', 'domain', 'session'])
    const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id)
    const key = (e: Graph['edges'][number]) => `${e.source} ${e.target} ${e.relation}`
    expect(all.nodes).toEqual(each.flatMap(g => g.nodes).sort(byId))
    expect(all.edges.map(key).sort()).toEqual(each.flatMap(g => g.edges).map(key).sort())
  })
})

describe('hafez graph', () => {
  const cli = (...args: string[]) =>
    spawnSync('node', [join(process.cwd(), 'dist', 'cli.js'), '--vault', VAULT, ...args], { encoding: 'utf-8' })

  it('--json prints the Graph and exits 0', () => {
    const result = cli('graph', '--json')
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(graph)
  })

  it('--json --layers prints the layered Graph', async () => {
    const result = cli('graph', '--json', '--layers', 'tag,domain,session')
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(await os.graph({ layers: ['tag', 'domain', 'session'] }))
  })

  it('an unknown layer is a usage error', () => {
    const result = cli('graph', '--json', '--layers', 'tag,wikilink')
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Unknown layer: wikilink')
    expect(result.stderr).toContain('tag, domain, session')
  })

  it('--layers without --json is a usage error', () => {
    const result = cli('graph', '--layers', 'tag')
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('--layers requires --json')
  })

  it('a duplicate flag is a usage error', () => {
    const result = cli('graph', '--json', '--vault', VAULT)
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('more than once')
  })

  it('a flag it does not declare is a usage error', () => {
    expect(cli('graph', '--json', '--port', '4747').status).toBe(2)
  })

  it('help lists the command', () => {
    expect(USAGE).toMatch(/^ {2}graph --json\s/m)
  })
})
