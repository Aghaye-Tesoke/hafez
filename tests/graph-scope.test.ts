// tests/graph-scope.test.ts
// What the page draws of the Graph it holds (scope.ts) and what applyGraph
// (state.ts) puts on each node: its body, its host and its look.
import { describe, expect, it, vi } from 'vitest'
import type { GraphEdge, GraphNode } from '../src/types.js'

/** scope.ts reads its scope from the URL at import time: load it under `search`. */
async function load(search: string) {
  vi.resetModules()
  vi.stubGlobal('location', { search, href: `http://localhost/${search}` })
  vi.stubGlobal('history', { state: null, replaceState: () => {} })
  const scope = await import('../src/graph/client/scope.js')
  const store = await import('../src/graph/client/state.js')
  return { ...scope, ...store }
}

const project = (id: string, fields: Partial<GraphNode> = {}): GraphNode =>
  ({ id, kind: 'entity', name: id, type: 'project', status: 'active', ...fields }) as GraphNode
const knowledge = (id: string, fields: Partial<GraphNode> = {}): GraphNode =>
  ({ id, kind: 'knowledge', name: id, ...fields }) as GraphNode
const edge = (source: string, target: string, relation: GraphEdge['relation']): GraphEdge => ({ source, target, relation })

describe('scopeShows', () => {
  const nodes = [project('done', { status: 'done' }), project('done-core', { status: 'done' }), project('kid'), project('task', { type: 'entity', status: 'done' })]
  const edges = [edge('kid', 'done-core', 'parent')]

  it('keeps a finished project in the Live scope, with or without children; hides other done work', async () => {
    const { applyGraph, scopeShows, state } = await load('')
    applyGraph({ nodes, edges })
    const byId = new Map(state.nodes.map(n => [n.id, n]))
    expect(scopeShows(byId.get('done')!)).toBe(true)
    expect(scopeShows(byId.get('done-core')!)).toBe(true)
    expect(scopeShows(byId.get('kid')!)).toBe(true)
    expect(scopeShows(byId.get('task')!)).toBe(false)
  })

  it('shows a finished project, and all done work, in Everything', async () => {
    const { applyGraph, scopeShows, state } = await load('?scope=all')
    applyGraph({ nodes, edges })
    for (const n of state.nodes) expect(scopeShows(n), n.id).toBe(true)
  })
})

describe('applyGraph', () => {
  it('sets body, host and bodyStyle: a star in a galaxy, a rogue star, a planet, a belt note, a done core', async () => {
    const { applyGraph, state } = await load('')
    applyGraph({
      nodes: [
        project('core'),
        project('star'),
        project('rogue', { unlinked: true }),
        knowledge('planet', { confidence: 'principle' }),
        knowledge('loose', { unlinked: true }),
        project('finished', { status: 'done' }),
        project('moon-of-finished', { type: 'entity' }),
      ],
      edges: [
        edge('star', 'core', 'parent'),
        edge('planet', 'star', 'related'),
        edge('moon-of-finished', 'finished', 'parent'),
      ],
    })
    const byId = new Map(state.nodes.map(n => [n.id, n]))
    const pick = (id: string) => {
      const n = byId.get(id)!
      return { body: n.body, host: n.host, styled: n.bodyStyle.body, nebula: n.bodyStyle.nebula }
    }
    expect(pick('core')).toEqual({ body: 'core', host: undefined, styled: 'core', nebula: false })
    expect(pick('star')).toEqual({ body: 'star', host: 'core', styled: 'star', nebula: false })
    expect(pick('rogue')).toEqual({ body: 'star', host: undefined, styled: 'star', nebula: false })
    expect(pick('planet')).toEqual({ body: 'planet-ringed', host: 'star', styled: 'planet-ringed', nebula: false })
    expect(pick('loose')).toEqual({ body: 'belt', host: undefined, styled: 'belt', nebula: false })
    // A done core is drawn as a nebula and still hosts its satellites.
    expect(pick('finished')).toEqual({ body: 'core', host: undefined, styled: 'core', nebula: true })
    expect(pick('moon-of-finished').host).toBe('finished')
  })

  it('a node that no longer orbits anything loses its host on the next load', async () => {
    const { applyGraph, state } = await load('')
    applyGraph({ nodes: [project('core'), project('star')], edges: [edge('star', 'core', 'parent')] })
    const star = state.nodes.find(n => n.id === 'star')!
    expect(star.host).toBe('core')
    applyGraph({ nodes: [project('core'), project('star')], edges: [] })
    expect(state.nodes.find(n => n.id === 'star')).toBe(star)
    expect(star.host).toBeUndefined()
  })
})
