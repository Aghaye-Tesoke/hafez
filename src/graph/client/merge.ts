// src/graph/client/merge.ts
// Merge by id (#258): a refetched Graph is drawn on the node objects already
// held, because force-graph keeps a node's position and velocity on the
// object itself and show() pins drawn nodes by object. Reusing them is what
// keeps a data refresh from moving the layout.
import { GRAPH_NODE_FIELDS } from '../fields.js'
import type { DrawNode } from './state.js'

/** `next` on the object held under its id before, when there was one. */
export function reuse(held: Map<string, DrawNode>, next: DrawNode): DrawNode {
  const prev = held.get(next.id)
  if (!prev) return next
  // A refreshed node that no longer carries an optional field must lose it.
  for (const field of GRAPH_NODE_FIELDS) if (!(field in next)) delete prev[field]
  return Object.assign(prev, next)
}
