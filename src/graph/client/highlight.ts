// src/graph/client/highlight.ts
// The canvas's highlight API (#274), for the sidebar and search to light a
// set of notes; everything else dims, as under a hover:
// - highlight(predicate): a lasting highlight (a tag or domain chip, a
//   search pick); null clears it;
// - hoverFamily(id): a passing one, a note's family (itself, its parent and
//   its children), while a row naming it is hovered; null ends it. Over a
//   highlight, it wins while it lasts.
// Both are worked out into `state` once, over every node held, hidden ones
// included, and again on each view change (visible.ts calls relight), so
// the draw callbacks only test set membership.
import type { GraphNode } from '../../types.js'
import { endId, state, type DrawNode } from './state.js'

let predicate: ((node: GraphNode) => boolean) | null = null
let familyOf: string | null = null
let redraw: () => void = () => {}

/** main.ts hands over the one way to draw a frame. */
export function bindHighlight(draw: () => void): void {
  redraw = draw
}

/** Light the notes `test` holds for; null clears the highlight. */
export function highlight(test: ((node: GraphNode) => boolean) | null): void {
  predicate = test
  relight()
  redraw()
}

/** Light a note's family; null ends it. */
export function hoverFamily(id: string | null): void {
  familyOf = id
  relight()
  redraw()
}

/** Work both out again over the nodes held now. */
export function relight(): void {
  state.lit = predicate ? new Set(state.nodes.filter(predicate)) : null
  state.family = familyOf === null ? null : family(familyOf)
}

function family(id: string): Set<DrawNode> {
  const ids = new Set([id])
  for (const link of state.links) {
    if (link.relation !== 'parent') continue
    const child = endId(link.source)
    const parent = endId(link.target)
    if (child === id) ids.add(parent)
    if (parent === id) ids.add(child)
  }
  return new Set(state.nodes.filter(n => ids.has(n.id)))
}
