// src/graph/client/focus.ts
// The hover highlight (#255): the hovered node, its 1-hop neighbours and the
// edges joining them stay lit, everything else dims. Worked out once per
// hover change into `state`; the draw callbacks only test set membership.
// Both functions take the drawn links, so a hidden layer lights nothing.
import { endId, state, type DrawLink, type DrawNode } from './state.js'

export function hoverNode(node: DrawNode | null, links: DrawLink[]): void {
  state.hovered = node
  state.focusNodes.clear()
  state.focusLinks.clear()
  if (!node) return
  state.focusNodes.add(node)
  for (const link of links) {
    if (endId(link.source) !== node.id && endId(link.target) !== node.id) continue
    state.focusLinks.add(link)
    for (const end of [link.source, link.target]) if (typeof end !== 'string') state.focusNodes.add(end)
  }
}

/** The selected node's 1-hop neighbourhood over the drawn links, by id: the
 * nodes that keep their label after a select (draw.ts). */
export function markSelection(node: DrawNode | null, links: DrawLink[]): void {
  state.selectedNear.clear()
  if (!node) return
  for (const link of links) {
    const s = endId(link.source)
    const t = endId(link.target)
    if (s === node.id) state.selectedNear.add(t)
    if (t === node.id) state.selectedNear.add(s)
  }
}

/** The nodes at the other end of a node's links of one relation, by name.
 * Matched by id: a link never drawn still holds slugs at its ends. */
export function neighbours(node: DrawNode, links: DrawLink[], byId: Map<string, DrawNode>, relation: DrawLink['relation'], direction: 'out' | 'in' | 'both'): DrawNode[] {
  const found = new Set<string>()
  for (const link of links) {
    if (link.relation !== relation) continue
    const s = endId(link.source)
    const t = endId(link.target)
    if (s === node.id && direction !== 'in') found.add(t)
    if (t === node.id && direction !== 'out') found.add(s)
  }
  found.delete(node.id)
  return [...found].flatMap(id => byId.get(id) ?? []).sort((a, b) => a.name.localeCompare(b.name))
}
