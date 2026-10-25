// The note panel's content (#276, spec #270 "Note panel", Testing seam 3):
// a pure client module, run in node on plain Graph data. The panel's badges,
// facts, children rows and placing line are what the panel draws, before any
// DOM; the liveness order the children rows sort by is tested with the signal
// rules (tests/graph-signal-rules.test.ts).
import { describe, expect, it } from 'vitest'
import type { GraphEdge, GraphNode } from '../src/types.js'
import { ageText, badges, childRows, linkCounts, noteFacts, placingLine } from '../src/graph/client/note-view.js'

const TODAY = '2026-10-24'

const entity = (id: string, fields: Partial<GraphNode> = {}): GraphNode =>
  ({ id, kind: 'entity', name: id, type: 'entity', status: 'active', last_touched: TODAY, ...fields })

describe('ageText', () => {
  it('names an age in local days, then weeks, months and years', () => {
    expect(ageText('2026-10-24', TODAY)).toBe('today')
    expect(ageText('2026-10-23', TODAY)).toBe('1d')
    expect(ageText('2026-10-11', TODAY)).toBe('13d')
    expect(ageText('2026-10-10', TODAY)).toBe('2w')
    expect(ageText('2026-07-28', TODAY)).toBe('3mo')
    expect(ageText('2024-09-01', TODAY)).toBe('2y')
  })
})

describe('badges', () => {
  it('gives a Stale active Entity its kind, status, Stale with its age, and the stale-action count', () => {
    const simorgh = entity('simorgh', { type: 'project', last_touched: '2026-07-28', open_actions: 17, stale: true, stale_actions: 17, staleness_days: 14 })
    expect(badges(simorgh, TODAY).map(b => b.text)).toEqual(['project', 'active', 'Stale · 88d', '17 stale actions'])
  })

  it('counts one stale action in the singular, and leaves a fresh Entity unmarked', () => {
    expect(badges(entity('a', { stale_actions: 1 }), TODAY).map(b => b.text)).toEqual(['entity', 'active', '1 stale action'])
  })

  it('marks an Unlinked capture', () => {
    expect(badges(entity('c', { type: 'capture', unlinked: true }), TODAY).map(b => b.text)).toEqual(['capture', 'active', 'Unlinked'])
  })

  it('gives a done Entity its kind and status only', () => {
    expect(badges(entity('d', { status: 'done', stale_actions: 3 }), TODAY).map(b => b.text)).toEqual(['entity', 'done'])
  })

  it('gives Knowledge its subtype (an insight by default) and confidence, a plan its status', () => {
    expect(badges({ id: 'k', kind: 'knowledge', name: 'K', confidence: 'pattern' }, TODAY).map(b => b.text)).toEqual(['insight', 'pattern'])
    expect(badges({ id: 'p', kind: 'knowledge', name: 'P', subtype: 'plan', status: 'active' }, TODAY).map(b => b.text)).toEqual(['plan', 'active'])
  })
})

/** A family: `hub` parents five children, `k` is related to it, and `lone`
 * has no edge. The tag and Session layers are on, as the page's Graph has
 * them: a tag edge, and a Session that touched `hub` (a `related` edge from
 * the Session, as graph() carries it). */
const family = (): { nodes: GraphNode[]; edges: GraphEdge[] } => {
  const nodes: GraphNode[] = [
    entity('hub', { type: 'project', open_actions: 3, last_touched: '2026-10-21' }),
    entity('c-done', { status: 'done' }),
    entity('c-paused', { status: 'paused', last_touched: '2026-09-01' }),
    entity('c-busy', { open_actions: 6, last_touched: '2026-10-01' }),
    entity('c-stale', { open_actions: 1, stale: true, last_touched: '2026-06-01' }),
    entity('c-idle', { open_actions: 0 }),
    { id: 'k', kind: 'knowledge', name: 'K' },
    entity('lone'),
    { id: 'standup', kind: 'session', name: 'Standup' },
  ]
  const edges: GraphEdge[] = [
    ...['c-done', 'c-paused', 'c-busy', 'c-stale', 'c-idle'].map(c => ({ source: c, target: 'hub', relation: 'parent' as const })),
    { source: 'hub', target: 'k', relation: 'related' },
    { source: 'k', target: 'hub', relation: 'related' },
    { source: 'hub', target: 'tag:x', relation: 'tag' },
    { source: 'standup', target: 'hub', relation: 'related' },
  ]
  return { nodes, edges }
}

describe('childRows', () => {
  it('lists a parent\'s children by liveness, capped, with the rest counted', () => {
    const { nodes, edges } = family()
    const { rows, more } = childRows(nodes[0], nodes, edges, 3)
    expect(rows.map(n => n.id)).toEqual(['c-stale', 'c-busy', 'c-idle'])
    expect(more).toBe(2)
  })

  it('takes link ends that are already node objects, and gives a childless note none', () => {
    const { nodes, edges } = family()
    const byId = new Map(nodes.map(n => [n.id, n]))
    const drawn = edges.map(e => ({ ...e, source: byId.get(e.source) ?? e.source, target: byId.get(e.target) ?? e.target }))
    expect(childRows(nodes[0], nodes, drawn, 10).rows).toHaveLength(5)
    expect(childRows(nodes[1], nodes, drawn, 10)).toEqual({ rows: [], more: 0 })
  })
})

describe('linkCounts', () => {
  it('counts every note\'s Parent, Related and Wiki-link edges; a tag edge and a Session\'s `related` edge count for nothing', () => {
    const { nodes, edges } = family()
    expect(Object.fromEntries(linkCounts(nodes, edges))).toEqual({
      hub: 7, 'c-done': 1, 'c-paused': 1, 'c-busy': 1, 'c-stale': 1, 'c-idle': 1, k: 2,
    })
  })
})

describe('noteFacts', () => {
  it('gives a parent its age, open actions, child count and most-linked count', () => {
    const { nodes, edges } = family()
    expect(noteFacts(nodes[0], nodes, edges, TODAY, linkCounts(nodes, edges))).toEqual({
      touched: '3d', open_actions: 3, parent: null, children: 5, most_linked: 7,
    })
  })

  it('names a child\'s parent, and leaves Knowledge without actions', () => {
    const { nodes, edges } = family()
    expect(noteFacts(nodes[3], nodes, edges, TODAY, linkCounts(nodes, edges))).toMatchObject({ parent: 'hub', children: 0, most_linked: 1, open_actions: 6 })
    expect(noteFacts(nodes[6], nodes, edges, TODAY, linkCounts(nodes, edges))).toMatchObject({ touched: null, open_actions: null, most_linked: 2 })
  })

  it('gives every note its link count, one with no edge 0 (story 53)', () => {
    const { nodes, edges } = family()
    expect(noteFacts(nodes[7], nodes, edges, TODAY, linkCounts(nodes, edges)).most_linked).toBe(0)
  })
})

describe('placingLine', () => {
  it('places an Unlinked note against its best match, or the <slug> placeholder', () => {
    expect(placingLine(entity('fix-graph', { unlinked: true, best: 'life-os' }))).toBe('hafez link fix-graph life-os related')
    expect(placingLine(entity('wayfinder', { unlinked: true }))).toBe('hafez link wayfinder <slug> related')
  })

  it('gives a linked note none', () => {
    expect(placingLine(entity('hub'))).toBeNull()
  })
})
