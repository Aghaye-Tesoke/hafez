// src/graph/client/style.ts
// The visual encoding (#274, spec #270 "Channels"), resolved once per data
// load and stored on the node and link objects: the draw callbacks read
// finished strings and numbers, and never build a colour per frame. Which
// signal a node carries is signals.ts's call; this turns it into marks:
// - size ← open actions; glow and brightness ← recency; amber ring ← Stale;
// - hue and shape ← kind: gold discs for Entities, blue diamonds for
//   Knowledge, hollow for a plan; a parent has a hollow core;
// - done mutes every channel to base, and its edges fade with it.
// Degree drives nothing.
import type { GraphEdge, GraphNode } from '../../types.js'
import { isDone, isStale, recency, size } from './signals.js'
import { alpha, CANVAS } from './tokens.js'

export const BACKGROUND = CANVAS.background
export const LABEL_COLOR = CANVAS.label
/** Outside a hover or a highlight, nodes draw at this share of their alpha, edges in this colour. */
export const DIM_ALPHA = 0.12
export const DIM_EDGE = CANVAS.dimEdge
/** The ring drawn round the selected node. */
export const SELECTED_RING = CANVAS.selectedRing
/** A glow reaches this many radii out from its node. */
export const GLOW_REACH = 3.4

export interface NodeStyle {
  radius: number
  shape: 'disc' | 'diamond'
  /** The kind's hue at the node's brightness: its fill, or a hollow node's outline. */
  fill: string
  /** A plan: outlined, not filled. */
  hollow: boolean
  /** A parent: a hollow core, the anchor of its family. */
  core: boolean
  /** Touched in the last few days. */
  glow: boolean
  /** The Stale ring's colour, or null. */
  ring: string | null
}
export interface EdgeStyle { color: string; width: number; dash: number[] | null }

/** Brightness: recency for an Entity that carries it, a fixed base for the rest. */
const BRIGHTNESS = { glow: 1, plain: 0.85, faded: 0.45, untouched: 0.85, done: 0.22, knowledge: 0.7, plan: 0.85 }

const EDGE_STYLE: Record<string, EdgeStyle> = {
  parent: { color: CANVAS.edge.parent, width: 1.6, dash: null },
  related: { color: CANVAS.edge.related, width: 0.8, dash: null },
  mention: { color: CANVAS.edge.mention, width: 0.6, dash: [3, 2] },
}
const FALLBACK_EDGE: EdgeStyle = EDGE_STYLE.related

/** A node's marks, today being the local YYYY-MM-DD day and `parent` whether
 * any Entity names it as its parent. */
export function nodeStyle(node: GraphNode, today: string, parent: boolean): NodeStyle {
  const radius = size(node)
  if (node.kind === 'knowledge') {
    const plan = node.subtype === 'plan'
    return { radius, shape: 'diamond', fill: alpha(CANVAS.knowledge, plan ? BRIGHTNESS.plan : BRIGHTNESS.knowledge), hollow: plan, core: false, glow: false, ring: null }
  }
  const done = isDone(node)
  const seen = recency(node, today)
  const brightness = done ? BRIGHTNESS.done : BRIGHTNESS[seen ?? 'untouched']
  return {
    radius,
    shape: 'disc',
    fill: alpha(CANVAS.entity, brightness),
    hollow: false,
    core: parent,
    glow: seen === 'glow',
    ring: isStale(node) ? CANVAS.stale : null,
  }
}

/** An edge's style; `done` when either end is a done Entity: it fades with it. */
export function edgeStyle(edge: GraphEdge, done = false): EdgeStyle {
  const style = EDGE_STYLE[edge.relation] ?? FALLBACK_EDGE
  return done ? { ...style, color: CANVAS.edge.done } : style
}
