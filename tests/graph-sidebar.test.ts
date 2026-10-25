// tests/graph-sidebar.test.ts
// What the left sidebar lists (#277, spec #270 "Left sidebar", Testing seam
// 3): a pure client module over plain Graph data, run in node. Live work's
// Stale / Active / Paused groups and their rows, the Unlinked notes, and the
// tag and domain chips with the notes each one highlights.
import { describe, expect, it } from 'vitest'
import type { GraphEdge, GraphNode } from '../src/types.js'
import { isStale } from '../src/graph/client/signals.js'
import { facetTest, facets, liveGroups, liveRow, unlinkedNotes } from '../src/graph/client/sidebar.js'

const TODAY = '2026-10-24'

const entity = (id: string, fields: Partial<GraphNode> = {}): GraphNode =>
  ({ id, kind: 'entity', name: id, type: 'entity', status: 'active', last_touched: TODAY, staleness_days: 14, open_actions: 0, stale: false, stale_actions: 0, ...fields })
const knowledge = (id: string, fields: Partial<GraphNode> = {}): GraphNode => ({ id, kind: 'knowledge', name: id, subtype: 'insight', ...fields })

const ids = (nodes: GraphNode[]): string[] => nodes.map(n => n.id)

describe('liveGroups', () => {
  const nodes: GraphNode[] = [
    entity('busy', { open_actions: 5, last_touched: '2026-10-20' }),
    entity('quiet', { open_actions: 1, last_touched: '2026-10-23' }),
    entity('neglected', { stale: true, open_actions: 2, last_touched: '2026-09-01' }),
    entity('abandoned', { stale: true, open_actions: 7, last_touched: '2026-08-01' }),
    entity('idea', { type: 'capture' }),
    entity('resting', { status: 'paused', open_actions: 3, stale_actions: 3, last_touched: '2026-06-01' }),
    entity('napping', { status: 'paused', open_actions: 1, last_touched: '2026-10-01' }),
    entity('shipped', { status: 'done', open_actions: undefined, stale: undefined, stale_actions: undefined }),
    knowledge('lesson'),
    { id: 'tag:infra', kind: 'tag', name: 'infra' },
  ]

  it('puts every Stale Entity in Stale, the rest of live work in Active, paused work in Paused, each by liveness', () => {
    const groups = liveGroups(nodes)
    expect(ids(groups.stale)).toEqual(['abandoned', 'neglected'])
    expect(ids(groups.active)).toEqual(['busy', 'quiet', 'idea'])
    expect(ids(groups.paused)).toEqual(['resting', 'napping'])
  })

  it('counts in Stale exactly the nodes the canvas rings', () => {
    expect(liveGroups(nodes).stale.length).toBe(nodes.filter(isStale).length)
  })
})

describe('liveRow', () => {
  it('a Stale row says how long it has been stale, by its days untouched', () => {
    expect(liveRow(entity('neglected', { stale: true, open_actions: 2, last_touched: '2026-09-01' }), TODAY))
      .toEqual({ when: 'stale 53d', stale: true, share: '2 actions', open: 2 })
  })

  it('any other row gives its age', () => {
    expect(liveRow(entity('quiet', { open_actions: 1, last_touched: '2026-10-11' }), TODAY).when).toBe('13d ago')
    expect(liveRow(entity('busy', { last_touched: '2026-10-03' }), TODAY).when).toBe('3w ago')
    expect(liveRow(entity('fresh'), TODAY).when).toBe('today')
    expect(liveRow(entity('resting', { status: 'paused', last_touched: '2026-06-01' }), TODAY)).toMatchObject({ when: '5mo ago', stale: false })
  })

  it('gives the stale-action share, and the open-action count on its own', () => {
    expect(liveRow(entity('a', { open_actions: 5, stale_actions: 2 }), TODAY)).toMatchObject({ share: '2/5 actions stale', open: 5 })
    expect(liveRow(entity('b', { open_actions: 1 }), TODAY)).toMatchObject({ share: '1 action', open: 1 })
    expect(liveRow(entity('c'), TODAY)).toMatchObject({ share: 'no open actions', open: 0 })
  })

  it('counts a paused row\'s actions too', () => {
    expect(liveRow(entity('resting', { status: 'paused', open_actions: 3, stale_actions: 3 }), TODAY)).toMatchObject({ share: '3/3 actions stale', open: 3 })
  })
})

describe('unlinkedNotes', () => {
  it('lists every Unlinked note: work not done first, Entities before Knowledge, then by name', () => {
    const nodes = [
      knowledge('zebra', { name: 'Zebra', unlinked: true }),
      entity('old-idea', { name: 'Old idea', status: 'done', unlinked: true, best: 'hub' }),
      knowledge('drift', { name: 'Drift', unlinked: true, best: 'ledger' }),
      entity('retry', { name: 'Retry', unlinked: true, best: 'hub' }),
      entity('hub', { name: 'Hub' }),
      { id: 'tag:infra', kind: 'tag', name: 'infra' } as GraphNode,
    ]
    expect(ids(unlinkedNotes(nodes))).toEqual(['retry', 'drift', 'zebra', 'old-idea'])
  })
})

describe('facets and facetTest', () => {
  const nodes: GraphNode[] = [
    entity('hub'), entity('worker'), knowledge('lesson'), knowledge('plan', { subtype: 'plan' }),
    { id: 'tag:infra', kind: 'tag', name: 'infra' },
    { id: 'tag:meeting', kind: 'tag', name: 'meeting' },
    { id: 'tag:alpha', kind: 'tag', name: 'alpha' },
    { id: 'domain:engineering', kind: 'domain', name: 'engineering' },
  ]
  const tag = (note: string, value: string): GraphEdge => ({ source: note, target: `tag:${value}`, relation: 'tag' })
  const edges: GraphEdge[] = [
    tag('hub', 'infra'), tag('lesson', 'infra'), tag('worker', 'meeting'), tag('plan', 'alpha'),
    { source: 'hub', target: 'domain:engineering', relation: 'domain' },
    { source: 'worker', target: 'hub', relation: 'parent' },
  ]

  it('gives a chip per domain, then per tag, each with the notes carrying it, most first, then by name', () => {
    expect(facets(nodes, edges)).toEqual([
      { id: 'domain:engineering', kind: 'domain', name: 'engineering', count: 1 },
      { id: 'tag:infra', kind: 'tag', name: 'infra', count: 2 },
      { id: 'tag:alpha', kind: 'tag', name: 'alpha', count: 1 },
      { id: 'tag:meeting', kind: 'tag', name: 'meeting', count: 1 },
    ])
  })

  it('a chip lights the notes carrying it and no other, with link ends swapped for nodes or not', () => {
    const test = facetTest('tag:infra', edges)
    expect(ids(nodes.filter(test))).toEqual(['hub', 'lesson'])
    const drawn = edges.map(e => ({ ...e, source: { id: e.source } }))
    expect(ids(nodes.filter(facetTest('tag:meeting', drawn)))).toEqual(['worker'])
  })
})
