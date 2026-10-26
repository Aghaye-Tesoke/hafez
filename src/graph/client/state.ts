// src/graph/client/state.ts
// The page's one mutable store. The render loop and the callbacks registered
// once on the 3D graph read from here, so changing what is drawn means
// changing this state, never handing the graph a new callback.
import type { Group } from 'three'
import type { GraphEdge, GraphNode } from '../../types.js'
import { localDay } from '../../dates.js'
import { edgeStyle, nodeStyle, type EdgeStyle, type NodeStyle } from './style.js'
import { isDone, liveScope } from './signals.js'
import { reuse } from './merge.js'
import { bodyOf, childrenOf, hostOf, type Body } from './galaxy/bodies.js'
import { bodyStyle, type BodyStyle } from './galaxy/meshes.js'

/** A Graph node as drawn: the simulation adds the position, apply adds the styles. */
export interface DrawNode extends GraphNode {
  style: NodeStyle
  /** What the node is in the sky (galaxy/bodies.ts), and its look today. */
  body: Body
  bodyStyle: BodyStyle
  /** The id it orbits over every edge held (galaxy/bodies.ts); absent for a root or the belt. */
  host?: string
  /** Its three.js group, built once (galaxy/meshes.ts) and kept across reloads. */
  group?: Group
  x?: number
  y?: number
  z?: number
  /** A pinned position: the simulation leaves the node there. */
  fx?: number
  fy?: number
  fz?: number
}

/** A Graph edge as drawn: the simulation swaps the slugs for the node objects. */
export interface DrawLink extends Omit<GraphEdge, 'source' | 'target'> {
  source: string | DrawNode
  target: string | DrawNode
  style: EdgeStyle
}

export const state = {
  nodes: [] as DrawNode[],
  links: [] as DrawLink[],
  /** The node under the pointer: its label shows, and reads strong. */
  hovered: null as DrawNode | null,
  /** The node whose panel is open (panel.ts). */
  selected: null as DrawNode | null,
  /** The Live scope's predicate over the Graph loaded (signals.ts). */
  live: (() => true) as (node: GraphNode) => boolean,
}

const isNoteKind = (node: GraphNode): boolean => node.kind === 'entity' || node.kind === 'knowledge'

/** Turn a Graph from the server into the drawable nodes and links, styles
 * and bodies resolved: every channel comes from the data, never from what is
 * drawn. A node already held keeps its object (merge by id), so a refresh
 * keeps its place and its group. */
export function applyGraph(graph: { nodes: GraphNode[]; edges: GraphEdge[] }): void {
  const held = new Map(state.nodes.map(n => [n.id, n]))
  const today = localDay()
  const children = childrenOf(graph.edges)
  const done = new Set(graph.nodes.filter(isDone).map(n => n.id))
  state.nodes = graph.nodes.map(n => {
    const body = bodyOf(n, children.has(n.id))
    const host = isNoteKind(n) ? hostOf(n, graph.edges) : undefined
    const next: DrawNode = { ...n, style: nodeStyle(n, today, children.has(n.id)), body, bodyStyle: bodyStyle(n, body, today) }
    if (host !== undefined) next.host = host
    // A node that no longer orbits anything loses the host it had.
    else delete held.get(n.id)?.host
    return reuse(held, next)
  })
  state.links = graph.edges.map(e => ({ ...e, style: edgeStyle(e, done.has(e.source) || done.has(e.target)) }))
  state.live = liveScope(graph.nodes, graph.edges)
}

/** A link end's node id, whether the simulation has swapped in the node object yet or not. */
export const endId = (end: string | DrawNode): string => typeof end === 'string' ? end : end.id
