// src/graph/client/style.ts
// The edges' encoding, resolved once per data load and stored on the link
// objects: the draw callbacks read finished strings and numbers, and never
// build a colour per frame. Hue and dash follow the relation; an edge with a
// done end fades with it. The bodies' look is galaxy/meshes.ts's.
import type { GraphEdge } from '../../types.js'
import { CANVAS } from './tokens.js'

export interface EdgeStyle { color: string; width: number; dash: number[] | null }

const EDGE_STYLE: Record<string, EdgeStyle> = {
  parent: { color: CANVAS.edge.parent, width: 1.6, dash: null },
  related: { color: CANVAS.edge.related, width: 0.8, dash: null },
  mention: { color: CANVAS.edge.mention, width: 0.6, dash: [3, 2] },
}
const FALLBACK_EDGE: EdgeStyle = EDGE_STYLE.related

/** An edge's style; `done` when either end is a done Entity: it fades with it. */
export function edgeStyle(edge: GraphEdge, done = false): EdgeStyle {
  const style = EDGE_STYLE[edge.relation] ?? FALLBACK_EDGE
  return done ? { ...style, color: CANVAS.edge.done } : style
}
