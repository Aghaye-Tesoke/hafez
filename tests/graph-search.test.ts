// tests/graph-search.test.ts
// What search finds (#279, spec #270 stories 70-74, critique S1/S3, Testing
// seam 3): a pure client module over plain Graph data, run in node. It
// matches name, slug and description across every note, hidden ones
// included; each result carries its cues; tags and domains are suggested;
// the total counts what the cap leaves out.
import { describe, expect, it } from 'vitest'
import type { GraphNode } from '../src/types.js'
import { find, foundSummary } from '../src/graph/client/find.js'
import type { Facet } from '../src/graph/client/sidebar.js'

const entity = (id: string, fields: Partial<GraphNode> = {}): GraphNode =>
  ({ id, kind: 'entity', name: id, type: 'entity', status: 'active', last_touched: '2026-10-20', staleness_days: 14, open_actions: 0, stale: false, stale_actions: 0, ...fields })
const knowledge = (id: string, fields: Partial<GraphNode> = {}): GraphNode => ({ id, kind: 'knowledge', name: id, subtype: 'insight', ...fields })

const everything = (): boolean => true
const ids = (r: ReturnType<typeof find>): string[] => r.notes.map(h => h.node.id)

describe('find: notes', () => {
  it('matches name, slug and description', () => {
    const nodes = [
      entity('atlas', { name: 'Atlas' }),
      entity('ledger-v2', { name: 'Books' }),
      knowledge('pricing', { name: 'Pricing', description: 'How the ledger rounds money' }),
      entity('unrelated', { name: 'Unrelated' }),
    ]
    expect(ids(find('ledger', nodes, [], everything)).sort()).toEqual(['ledger-v2', 'pricing'])
    expect(ids(find('atlas', nodes, [], everything))).toEqual(['atlas'])
  })

  it('ranks a name or slug match above a description match', () => {
    const nodes = [
      knowledge('note', { name: 'A note', description: 'All about the vault' }),
      entity('vault', { name: 'Vault' }),
    ]
    expect(ids(find('vault', nodes, [], everything))).toEqual(['vault', 'note'])
  })

  it('matches initials and runs, never letters scattered mid-word', () => {
    const nodes = [entity('royston-smartflows', { name: 'Royston SmartFlows' }), entity('a-big-entity', { name: 'A big entity' })]
    expect(ids(find('rsm', nodes, [], everything))).toEqual(['royston-smartflows'])
    expect(ids(find('agent', nodes, [], everything))).toEqual([])
  })

  it('needs every word of a description query', () => {
    const nodes = [knowledge('n', { name: 'N', description: 'Panel latency on drvfs' })]
    expect(ids(find('drvfs latency', nodes, [], everything))).toEqual(['n'])
    expect(ids(find('drvfs speed', nodes, [], everything))).toEqual([])
  })

  it('finds notes the view hides and marks them hidden', () => {
    const nodes = [entity('shipped', { name: 'Shipped', status: 'done' }), entity('ship-it', { name: 'Ship it' })]
    const shows = (n: GraphNode) => n.status !== 'done'
    const hits = find('ship', nodes, [], shows).notes
    expect(hits.map(h => [h.node.id, h.hidden]).sort()).toEqual([['ship-it', false], ['shipped', true]])
  })

  it('carries the kind shape, status and Stale cues', () => {
    const nodes = [
      entity('w-live', { stale: true }),
      entity('w-paused', { status: 'paused' }),
      entity('w-done', { status: 'done' }),
      entity('w-capture', { type: 'capture', status: undefined }),
      knowledge('w-insight'),
      knowledge('w-plan', { subtype: 'plan' }),
    ]
    const cues = Object.fromEntries(find('w-', nodes, [], everything).notes.map(h => [h.node.id, [h.shape, h.status, h.stale]]))
    expect(cues).toEqual({
      'w-live': ['disc', 'active', true],
      'w-paused': ['disc', 'paused', false],
      'w-done': ['disc', 'done', false],
      'w-capture': ['disc', 'active', false],
      'w-insight': ['diamond', 'knowledge', false],
      'w-plan': ['hollow', 'plan', false],
    })
  })

  it('a paused note with the stale flag is not Stale: the ring is live work only', () => {
    const hits = find('p', [entity('p', { status: 'paused', stale: true })], [], everything).notes
    expect(hits[0].stale).toBe(false)
  })

  it('caps the list and counts every match', () => {
    const nodes = Array.from({ length: 20 }, (_, i) => entity(`note-${String(i).padStart(2, '0')}`))
    const r = find('note', nodes, [], everything)
    expect(r.notes).toHaveLength(8)
    expect(r.noteTotal).toBe(20)
  })

  it('breaks a tie by liveness: live work before done work', () => {
    const nodes = [entity('alpha-b', { status: 'done' }), entity('alpha-a', { status: 'paused' }), entity('alpha-c')]
    expect(ids(find('alpha', nodes, [], everything))).toEqual(['alpha-c', 'alpha-a', 'alpha-b'])
  })

  it('ignores tag, domain and Session nodes, and an empty query', () => {
    const nodes = [{ id: 'tag:infra', kind: 'tag', name: 'infra' }, { id: 's', kind: 'session', name: 'infra session' }, entity('infra')] as GraphNode[]
    expect(ids(find('infra', nodes, [], everything))).toEqual(['infra'])
    expect(find('  ', nodes, [], everything)).toEqual({ notes: [], noteTotal: 0, facets: [], facetTotal: 0 })
  })
})

describe('find: tags and domains', () => {
  const facets: Facet[] = [
    { id: 'domain:infra', kind: 'domain', name: 'infra', count: 3 },
    { id: 'tag:infra-cost', kind: 'tag', name: 'infra-cost', count: 9 },
    { id: 'tag:ui', kind: 'tag', name: 'ui', count: 2 },
  ]

  it('suggests the tags and domains whose name matches, best match first', () => {
    const r = find('infra', [], facets, everything)
    expect(r.facets.map(f => f.id)).toEqual(['domain:infra', 'tag:infra-cost'])
    expect(r.facetTotal).toBe(2)
  })

  it('caps the suggestions and counts every match', () => {
    const many: Facet[] = Array.from({ length: 9 }, (_, i) => ({ id: `tag:t${i}`, kind: 'tag', name: `t${i}`, count: 1 }))
    const r = find('t', [], many, everything)
    expect(r.facets).toHaveLength(4)
    expect(r.facetTotal).toBe(9)
  })
})

describe('foundSummary', () => {
  const note = (i: number) => entity(`n-${String(i).padStart(2, '0')}`)
  const facet = (i: number): Facet => ({ id: `tag:n${i}`, kind: 'tag', name: `n${i}`, count: 1 })

  it('says how many matched beyond the cap', () => {
    const nodes = Array.from({ length: 23 }, (_, i) => note(i))
    expect(foundSummary(find('n', nodes, [facet(1), facet(2)], everything))).toBe('8 of 23 notes · 2 tags and domains: type more to narrow')
  })

  it('gives the plain count when everything is shown', () => {
    expect(foundSummary(find('n-01', [note(1)], [], everything))).toBe('1 note')
    expect(foundSummary(find('n', [], [facet(1)], everything))).toBe('1 tag or domain')
  })

  it('says when nothing matched', () => {
    expect(foundSummary(find('zzz', [note(1)], [], everything))).toBe('No note, tag or domain matches.')
  })
})
