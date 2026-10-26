import { describe, expect, it } from 'vitest'
import type { GraphEdge, GraphNode } from '../src/types.js'
import { bodyOf, childrenOf, hostOf, isNebulaCore } from '../src/graph/client/galaxy/bodies.js'

const entity = (id: string, fields: Partial<GraphNode> = {}): GraphNode =>
  ({ id, kind: 'entity', name: id, type: 'project', status: 'active', ...fields }) as GraphNode
const knowledge = (id: string, fields: Partial<GraphNode> = {}): GraphNode =>
  ({ id, kind: 'knowledge', name: id, ...fields }) as GraphNode
const edge = (source: string, target: string, relation: GraphEdge['relation']): GraphEdge => ({ source, target, relation })

describe('bodyOf', () => {
  it('unlinked is belt even for a project, even with children', () => {
    expect(bodyOf(entity('a', { unlinked: true }), false)).toBe('belt')
    expect(bodyOf(entity('a', { unlinked: true }), true)).toBe('belt')
  })
  it('project with children is core, also when done', () => {
    expect(bodyOf(entity('a'), true)).toBe('core')
    expect(bodyOf(entity('a', { status: 'done' }), true)).toBe('core')
  })
  it('done project without children is nebula; active is star', () => {
    expect(bodyOf(entity('a', { status: 'done' }), false)).toBe('nebula')
    expect(bodyOf(entity('a'), false)).toBe('star')
  })
  it('captures and plain entities are moons', () => {
    expect(bodyOf(entity('a', { type: 'capture' }), false)).toBe('moon')
    expect(bodyOf(entity('a', { type: 'entity' }), false)).toBe('moon')
  })
  it('knowledge by confidence', () => {
    expect(bodyOf(knowledge('k', { confidence: 'principle' }), false)).toBe('planet-ringed')
    expect(bodyOf(knowledge('k', { confidence: 'pattern' }), false)).toBe('planet-banded')
    expect(bodyOf(knowledge('k', { confidence: 'observation' }), false)).toBe('planet-rocky')
    expect(bodyOf(knowledge('k'), false)).toBe('planet-rocky')
  })
})

describe('isNebulaCore', () => {
  it('is true for a done project, with or without children', () => {
    expect(isNebulaCore(entity('a', { status: 'done' }))).toBe(true)
    expect(isNebulaCore(entity('a'))).toBe(false)
    expect(isNebulaCore(entity('a', { type: 'capture', status: 'done' }))).toBe(false)
    expect(isNebulaCore(knowledge('k'))).toBe(false)
  })
})

describe('childrenOf', () => {
  it('ignores non-parent edges and keeps edge order', () => {
    const m = childrenOf([
      edge('c1', 'p', 'parent'),
      edge('x', 'p', 'related'),
      edge('c2', 'p', 'parent'),
      edge('c3', 'q', 'parent'),
      edge('y', 'q', 'mention'),
    ])
    expect(m.get('p')).toEqual(['c1', 'c2'])
    expect(m.get('q')).toEqual(['c3'])
    expect(m.has('x')).toBe(false)
    expect(m.has('y')).toBe(false)
  })
})

describe('hostOf', () => {
  it('unlinked has no host', () => {
    expect(hostOf(entity('a', { unlinked: true }), [edge('a', 'b', 'parent')])).toBeUndefined()
  })
  it('active project without parent is a root star', () => {
    expect(hostOf(entity('a'), [])).toBeUndefined()
  })
  it('core without parent is a root; with a parent it hosts on the parent', () => {
    const e = [edge('k', 'a', 'parent')]
    expect(hostOf(entity('a'), e)).toBeUndefined()
    const e2 = [...e, edge('a', 'top', 'parent')]
    expect(bodyOf(entity('a'), childrenOf(e2).has('a'))).toBe('core')
    expect(hostOf(entity('a'), e2)).toBe('top')
  })
  it('done project without parent is a root nebula', () => {
    expect(hostOf(entity('a', { status: 'done' }), [])).toBeUndefined()
  })
  it('capture under a parent hosts on the parent', () => {
    expect(hostOf(entity('c', { type: 'capture' }), [edge('c', 'p', 'parent')])).toBe('p')
  })
  it('knowledge related to two stars hosts on the first related', () => {
    const e = [edge('k', 's1', 'related'), edge('k', 's2', 'related')]
    expect(hostOf(knowledge('k'), e)).toBe('s1')
  })
  it('capture with only a mention edge hosts on the mentioned node', () => {
    expect(hostOf(entity('c', { type: 'capture' }), [edge('c', 'm', 'mention')])).toBe('m')
  })
  it('parent beats related beats mention regardless of array order', () => {
    const e = [edge('k', 'm', 'mention'), edge('k', 'r', 'related'), edge('k', 'p', 'parent')]
    expect(hostOf(entity('k', { type: 'entity' }), e)).toBe('p')
    expect(hostOf(knowledge('k'), e.slice(0, 2))).toBe('r')
  })
  it("picks its own first edge, not another node's parent edge", () => {
    const e = [edge('other', 'z', 'parent'), edge('k', 'r', 'related')]
    expect(hostOf(knowledge('k'), e)).toBe('r')
  })
  it('a planet with no edge at all has no host', () => {
    expect(hostOf(knowledge('k'), [])).toBeUndefined()
  })
})
