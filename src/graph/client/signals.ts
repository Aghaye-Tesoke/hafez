// src/graph/client/signals.ts
// The signal rules (#274, spec #270 "The signal rules"): which Hafez state a
// node carries, from plain Graph data. Status decides, type does not: an
// active Entity (a capture included) carries every signal, a paused Entity
// recency only, a done Entity and Knowledge none. Pure: no DOM, no colour;
// style.ts turns what these return into what the canvas draws.
import type { GraphEdge, GraphNode } from '../../types.js'
import { daysBetween } from '../../dates.js'

/** Glow: an Entity touched this many local days ago or fewer. */
export const GLOW_DAYS = 3

/** The threshold an Entity without `staleness_days` gets (src/stale.ts's
 * default; the Graph gives every Entity its own, so this is a guard). */
const DEFAULT_STALENESS_DAYS = 14

/** Recency, from `last_touched` in local days: glowing within GLOW_DAYS,
 * plain up to `staleness_days`, faded past it. */
export type Recency = 'glow' | 'plain' | 'faded'

/** An active Entity, captures included (no status reads as active): it
 * carries every signal. */
export const isLive = (node: GraphNode): boolean => node.kind === 'entity' && (node.status ?? 'active') === 'active'

/** The amber ring: a live Entity untouched past its staleness-days (the
 * index's stale-entity rule). Stale actions are a count, never the ring. */
export const isStale = (node: GraphNode): boolean => isLive(node) && node.stale === true

/** A done Entity: every channel muted to base. */
export const isDone = (node: GraphNode): boolean => node.kind === 'entity' && node.status === 'done'

/** An Entity's recency today (YYYY-MM-DD, the local day); null for a node
 * that carries none: a done Entity, Knowledge, or one never touched. */
export function recency(node: GraphNode, today: string): Recency | null {
  if (node.kind !== 'entity' || isDone(node) || node.last_touched === undefined) return null
  const age = daysBetween(node.last_touched.slice(0, 10), today)
  if (age <= GLOW_DAYS) return 'glow'
  return age <= (node.staleness_days ?? DEFAULT_STALENESS_DAYS) ? 'plain' : 'faded'
}

/** Size, in graph units: an active Entity's radius grows with sqrt(open
 * actions) from a floor, so idle live work stays visible; past SIZE_CLAMP
 * actions it grows no more. Every other node keeps its kind's base. */
export const SIZE_CLAMP = 12
const SIZE = { floor: 4, step: 1.8, entity: 3, knowledge: 2.6, plan: 3.2 }

export function size(node: GraphNode): number {
  if (node.kind === 'knowledge') return node.subtype === 'plan' ? SIZE.plan : SIZE.knowledge
  if (!isLive(node)) return SIZE.entity
  return SIZE.floor + SIZE.step * Math.sqrt(Math.min(node.open_actions ?? 0, SIZE_CLAMP))
}

/** Liveness tiers: live, then paused, then done, then Knowledge. */
function tier(node: GraphNode): number {
  if (node.kind !== 'entity') return 3
  return isLive(node) ? 0 : node.status === 'paused' ? 1 : 2
}

/** Liveness order, for Array.sort (most live first): live before paused
 * before done, then Stale, then more open actions, then the most recently
 * touched. Sidebar rows and children rows sort by it. */
export function compareLiveness(a: GraphNode, b: GraphNode): number {
  return tier(a) - tier(b)
    || Number(isStale(b)) - Number(isStale(a))
    || (b.open_actions ?? 0) - (a.open_actions ?? 0)
    || (b.last_touched ?? '').localeCompare(a.last_touched ?? '')
}

/** The Live scope's predicate over a Graph: it hides done work only, and a
 * done parent stays while it anchors a child that is not done, however many
 * done generations sit between them. Knowledge and paused work stay. */
export function liveScope(nodes: GraphNode[], edges: GraphEdge[]): (node: GraphNode) => boolean {
  const parentOf = new Map<string, string>()
  for (const e of edges) if (e.relation === 'parent') parentOf.set(e.source, e.target)
  const anchors = new Set<string>()
  for (const n of nodes) {
    if (n.kind !== 'entity' || isDone(n)) continue
    for (let p = parentOf.get(n.id); p !== undefined && !anchors.has(p); p = parentOf.get(p)) anchors.add(p)
  }
  return node => !isDone(node) || anchors.has(node.id)
}
