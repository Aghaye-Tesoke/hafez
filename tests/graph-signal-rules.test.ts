// tests/graph-signal-rules.test.ts
// The graph page's signal rules (#274, spec #270 "The signal rules", Testing
// seam 3): a pure client module over plain Graph nodes, run in node. Status
// decides who carries a signal: an active Entity every one, a paused Entity
// recency only, a done Entity and Knowledge none.
import { describe, expect, it } from 'vitest'
import { compareLiveness, isStale, liveScope, recency, size } from '../src/graph/client/signals.js'
import type { GraphEdge, GraphNode } from '../src/types.js'

const TODAY = '2026-10-24'

const entity = (fields: Partial<GraphNode> = {}): GraphNode =>
  ({ id: 'e', kind: 'entity', name: 'E', status: 'active', staleness_days: 14, ...fields })

describe('recency', () => {
  it('glows within 3 days, is plain up to staleness-days, and fades past it', () => {
    expect(recency(entity({ last_touched: '2026-10-24' }), TODAY)).toBe('glow')
    expect(recency(entity({ last_touched: '2026-10-21' }), TODAY)).toBe('glow')
    expect(recency(entity({ last_touched: '2026-10-20' }), TODAY)).toBe('plain')
    expect(recency(entity({ last_touched: '2026-10-10' }), TODAY)).toBe('plain')
    expect(recency(entity({ last_touched: '2026-10-09' }), TODAY)).toBe('faded')
  })

  it("fades past the Entity's own staleness-days", () => {
    expect(recency(entity({ last_touched: '2026-10-19', staleness_days: 5 }), TODAY)).toBe('plain')
    expect(recency(entity({ last_touched: '2026-10-18', staleness_days: 5 }), TODAY)).toBe('faded')
  })

  it('is carried by active and paused Entities, never by done ones or Knowledge', () => {
    const touched = { last_touched: '2026-10-23' }
    expect(recency(entity({ ...touched, type: 'capture' }), TODAY)).toBe('glow')
    expect(recency(entity({ ...touched, status: 'paused' }), TODAY)).toBe('glow')
    expect(recency(entity({ ...touched, status: 'done' }), TODAY)).toBeNull()
    expect(recency({ id: 'k', kind: 'knowledge', name: 'K', ...touched }, TODAY)).toBeNull()
    expect(recency({ id: 'p', kind: 'knowledge', name: 'P', subtype: 'plan', ...touched }, TODAY)).toBeNull()
  })
})

describe('the Stale ring', () => {
  it('marks an active Entity past its staleness-days, and only that', () => {
    expect(isStale(entity({ stale: true }))).toBe(true)
    expect(isStale(entity({ type: 'capture', stale: true }))).toBe(true)
    expect(isStale(entity({ stale: false }))).toBe(false)
    expect(isStale(entity({ status: 'paused', stale: true }))).toBe(false)
    expect(isStale(entity({ status: 'done', stale: true }))).toBe(false)
  })

  it('never marks stale actions: they are a count, not the ring', () => {
    expect(isStale(entity({ stale: false, open_actions: 4, stale_actions: 4 }))).toBe(false)
  })
})

describe('size', () => {
  const live = (open_actions: number) => size(entity({ open_actions }))

  it('grows with the square root of open actions', () => {
    const floor = live(0)
    expect(live(4) - floor).toBeCloseTo(2 * (live(1) - floor))
    expect(live(9) - floor).toBeCloseTo(3 * (live(1) - floor))
  })

  it('is clamped at 12 open actions', () => {
    expect(live(12)).toBeGreaterThan(live(11))
    expect(live(40)).toBe(live(12))
  })

  it('keeps an active Entity with no open actions above every unsized node', () => {
    for (const other of [
      entity({ status: 'paused' }),
      entity({ status: 'done' }),
      { id: 'k', kind: 'knowledge', name: 'K' } as GraphNode,
      { id: 'p', kind: 'knowledge', name: 'P', subtype: 'plan' } as GraphNode,
    ]) expect(live(0), other.status ?? other.subtype ?? other.kind).toBeGreaterThan(size(other))
  })

  it('takes nothing from open actions on a paused or done Entity', () => {
    expect(size(entity({ status: 'paused', open_actions: 9 }))).toBe(size(entity({ status: 'paused' })))
    expect(size(entity({ status: 'done', open_actions: 9 }))).toBe(size(entity({ status: 'done' })))
  })
})

describe('liveness order', () => {
  const order = (nodes: GraphNode[]) => [...nodes].sort(compareLiveness).map(n => n.id)

  it('puts live before paused before done', () => {
    expect(order([
      entity({ id: 'done', status: 'done' }),
      entity({ id: 'paused', status: 'paused' }),
      entity({ id: 'live' }),
    ])).toEqual(['live', 'paused', 'done'])
  })

  it('then Stale, then open actions, then the most recently touched', () => {
    expect(order([
      entity({ id: 'old', open_actions: 2, last_touched: '2026-10-01' }),
      entity({ id: 'busy', open_actions: 5, last_touched: '2026-10-01' }),
      entity({ id: 'stale', stale: true, open_actions: 0, last_touched: '2026-09-01' }),
      entity({ id: 'recent', open_actions: 2, last_touched: '2026-10-20' }),
    ])).toEqual(['stale', 'busy', 'recent', 'old'])
  })

  it('puts Knowledge after every Entity, done ones included', () => {
    expect(order([
      { id: 'k', kind: 'knowledge', name: 'K' } as GraphNode,
      entity({ id: 'done', status: 'done' }),
    ])).toEqual(['done', 'k'])
  })

  it('orders paused work by recency', () => {
    expect(order([
      entity({ id: 'a', status: 'paused', last_touched: '2026-08-01' }),
      entity({ id: 'b', status: 'paused', last_touched: '2026-10-01' }),
    ])).toEqual(['b', 'a'])
  })
})

describe('the Live scope', () => {
  const parent = (child: string, of: string): GraphEdge => ({ source: child, target: of, relation: 'parent' })

  it('hides done work only: paused work and Knowledge stay', () => {
    const nodes = [
      entity({ id: 'live' }),
      entity({ id: 'paused', status: 'paused' }),
      entity({ id: 'done', status: 'done' }),
      { id: 'k', kind: 'knowledge', name: 'K' } as GraphNode,
      { id: 'p', kind: 'knowledge', name: 'P', subtype: 'plan' } as GraphNode,
    ]
    const shows = liveScope(nodes, [])
    expect(nodes.filter(shows).map(n => n.id)).toEqual(['live', 'paused', 'k', 'p'])
  })

  it('keeps a done parent anchoring live children, up its whole chain', () => {
    const nodes = [
      entity({ id: 'root', status: 'done' }),
      entity({ id: 'mid', status: 'done' }),
      entity({ id: 'leaf', status: 'paused' }),
      entity({ id: 'finished', status: 'done' }),
      entity({ id: 'old-child', status: 'done' }),
    ]
    const edges = [parent('mid', 'root'), parent('leaf', 'mid'), parent('old-child', 'finished')]
    const shows = liveScope(nodes, edges)
    expect(nodes.filter(shows).map(n => n.id)).toEqual(['root', 'mid', 'leaf'])
  })

  it('ignores edges that are not parent edges, and survives a parent cycle', () => {
    const nodes = [entity({ id: 'a', status: 'done' }), entity({ id: 'b', status: 'done' }), entity({ id: 'c' })]
    const edges: GraphEdge[] = [{ source: 'c', target: 'a', relation: 'related' }, parent('a', 'b'), parent('b', 'a')]
    expect(nodes.filter(liveScope(nodes, edges)).map(n => n.id)).toEqual(['c'])
  })
})
