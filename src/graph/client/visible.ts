// src/graph/client/visible.ts
// What is drawn: the nodes the filters let through and the links between
// them. Every change of view goes through here: the scope and the Knowledge
// toggle, then the local-graph mode (#256).
import { endId, state, type DrawLink, type DrawNode } from './state.js'
import { scopeShows } from './scope.js'
import { localGraph } from './local.js'
import { relight } from './highlight.js'
import { seed } from './layout.js'

/** The visible nodes and links, with the highlight worked out again over
 * them. A node drawn for the first time starts next to a drawn neighbour,
 * unless it is a child whose parent is drawn: that one, and a node with no
 * drawn neighbour, is seeded (layout.ts), beside its parent or on the ring.
 * A first load has no drawn node, so it is seeded throughout, the same way
 * every time. */
export function visibleGraph(): { nodes: DrawNode[]; links: DrawLink[] } {
  const nodes = localGraph(state.nodes.filter(scopeShows), state.nodes, state.links)
  const byId = new Map(nodes.map(n => [n.id, n]))
  const links = state.links.filter(l => byId.has(endId(l.source)) && byId.has(endId(l.target)))
  relight()
  // A child with its parent drawn is seeded beside the parent, not any neighbour.
  const anchored = (n: DrawNode): boolean => byId.has(state.parentOf.get(n.id) ?? '')
  for (const l of links) {
    const s = byId.get(endId(l.source))!
    const t = byId.get(endId(l.target))!
    if (s.x === undefined && t.x !== undefined && !anchored(s)) place(s, t)
    else if (t.x === undefined && s.x !== undefined && !anchored(t)) place(t, s)
  }
  seed(nodes, state.parentOf)
  return { nodes, links }
}

function place(node: DrawNode, by: DrawNode): void {
  node.x = (by.x ?? 0) + (Math.random() - 0.5) * 10
  node.y = (by.y ?? 0) + (Math.random() - 0.5) * 10
}
