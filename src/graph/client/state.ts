// src/graph/client/state.ts
// The page's one mutable store. Draw callbacks are registered once and read
// from here, so changing what is drawn means changing this state (and calling
// the instance's refresh), never handing force-graph a new callback.
import type { GraphEdge, GraphNode } from '../../types.js'
import { localDay } from '../../dates.js'
import { edgeStyle, nodeStyle, type EdgeStyle, type NodeStyle } from './style.js'
import { isDone, liveScope } from './signals.js'
import { reuse } from './merge.js'
import { CANVAS } from './tokens.js'
import { labelPx } from './labels.js'
import type { Frame } from './layout.js'

/** A Graph node as drawn: force-graph adds the position, apply adds the style. */
export interface DrawNode extends GraphNode {
  style: NodeStyle
  x?: number
  y?: number
  /** A pinned position: force-graph's simulation leaves the node there. */
  fx?: number
  fy?: number
}

/** A Graph edge as drawn: force-graph swaps the slugs for the node objects. */
export interface DrawLink extends Omit<GraphEdge, 'source' | 'target'> {
  source: string | DrawNode
  target: string | DrawNode
  style: EdgeStyle
}

export const state = {
  nodes: [] as DrawNode[],
  links: [] as DrawLink[],
  /** The label font for the frame being drawn, set once per frame. */
  font: CANVAS.font(labelPx(1)),
  /** Each child's parent, by id, over every edge held: seeding and territories read it. */
  parentOf: new Map<string, string>(),
  /** Where the drawn Unlinked notes are pinned (layout.ts); null when none is drawn. */
  frame: null as Frame | null,
  /** The node under the pointer; with it, the nodes and links that stay lit (focus.ts). */
  hovered: null as DrawNode | null,
  focusNodes: new Set<DrawNode>(),
  focusLinks: new Set<DrawLink>(),
  /** The node whose panel is open (panel.ts), and the ids of its drawn neighbours (focus.ts). */
  selected: null as DrawNode | null,
  selectedNear: new Set<string>(),
  /** The Live scope's predicate over the Graph loaded (signals.ts). */
  live: (() => true) as (node: GraphNode) => boolean,
  /** A highlight (highlight.ts): the nodes it lights; null when none is on. */
  lit: null as Set<DrawNode> | null,
  /** A hovered family (highlight.ts): the nodes it lights; null when none is. */
  family: null as Set<DrawNode> | null,
  /** The local graph is on (local.ts): every drawn note's label competes for
   * room at any zoom, the no-overlap rule still deciding which show. */
  local: false,
}

/** Turn a Graph from the server into the drawable nodes and links, styles
 * resolved: every channel comes from the data, never from what is drawn. A
 * node already held keeps its object (merge by id), so a refresh keeps the
 * layout. */
export function applyGraph(graph: { nodes: GraphNode[]; edges: GraphEdge[] }): void {
  const held = new Map(state.nodes.map(n => [n.id, n]))
  const today = localDay()
  const parents = new Set(graph.edges.filter(e => e.relation === 'parent').map(e => e.target))
  const done = new Set(graph.nodes.filter(isDone).map(n => n.id))
  state.nodes = graph.nodes.map(n => reuse(held, { ...n, style: nodeStyle(n, today, parents.has(n.id)) }))
  state.links = graph.edges.map(e => ({ ...e, style: edgeStyle(e, done.has(e.source) || done.has(e.target)) }))
  state.live = liveScope(graph.nodes, graph.edges)
  state.parentOf = new Map(graph.edges.filter(e => e.relation === 'parent').map(e => [e.source, e.target]))
}

/** A link end's node id, whether force-graph has swapped in the node object yet or not. */
export const endId = (end: string | DrawNode): string => typeof end === 'string' ? end : end.id
