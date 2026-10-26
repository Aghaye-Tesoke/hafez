// src/graph/client/galaxy/bodies.ts
// What each note is in the sky, and what it orbits (spec "Galaxies", "Stars are
// projects", "Planets are knowledge", "Captures and tasks", "The belt"). Plain
// Graph data in, a body kind and a host id out. Pure: no DOM, no three.js, no
// positions; the layout turns these into places and the renderer into meshes.
// Only entity and knowledge nodes are ever passed in; tags, domains and
// sessions are not bodies.
import type { GraphEdge, GraphNode } from '../../../types.js'

export type Body =
  | 'core'
  | 'star'
  | 'nebula'
  | 'planet-ringed'
  | 'planet-banded'
  | 'planet-rocky'
  | 'moon'
  | 'belt'

/** Parent id to child ids, in edge order. Only `parent` edges count. */
export function childrenOf(edges: GraphEdge[]): Map<string, string[]> {
  const children = new Map<string, string[]>()
  for (const edge of edges) {
    if (edge.relation !== 'parent') continue
    const list = children.get(edge.target)
    if (list) list.push(edge.source)
    else children.set(edge.target, [edge.source])
  }
  return children
}

/** A project that is done: the remnant the renderer draws when it is a core. */
export const isNebulaCore = (node: GraphNode): boolean =>
  node.kind === 'entity' && node.type === 'project' && node.status === 'done'

/** The body a node is. A project is always a core, star or nebula, linked or
 * not: an unlinked project is a rogue star, never a belt body. For the rest,
 * unlinked wins (the belt), then having children (a done project with children
 * stays a core: its satellites keep it, though it is drawn as a nebula,
 * meshes.ts), then the kind. */
export function bodyOf(node: GraphNode, hasChildren: boolean): Body {
  const project = node.kind === 'entity' && node.type === 'project'
  if (node.unlinked && !project) return 'belt'
  if (hasChildren) return 'core'
  if (node.kind === 'entity') {
    if (project) return node.status === 'done' ? 'nebula' : 'star'
    return 'moon'
  }
  if (node.confidence === 'principle') return 'planet-ringed'
  if (node.confidence === 'pattern') return 'planet-banded'
  return 'planet-rocky'
}

const HOST_RELATIONS = ['parent', 'related', 'mention'] as const

/** The id a node orbits: its first parent edge, else first related, else
 * first mention, in edge order. Undefined for anything unlinked (a belt body,
 * or a rogue star), for a root (a core, star or nebula with no parent: the
 * force layout places it) and for a planet or moon with no edge at all. */
export function hostOf(node: GraphNode, edges: GraphEdge[]): string | undefined {
  if (node.unlinked) return undefined
  const own = edges.filter((edge) => edge.source === node.id)
  const parent = own.find((edge) => edge.relation === 'parent')
  if (parent) return parent.target
  const body = bodyOf(node, childrenOf(edges).has(node.id))
  if (body === 'core' || body === 'star' || body === 'nebula') return undefined
  for (const relation of HOST_RELATIONS) {
    const found = own.find((edge) => edge.relation === relation)
    if (found) return found.target
  }
  return undefined
}
