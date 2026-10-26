// src/graph/client/galaxy/temperature.ts
// The star rules (spec "Stars are projects", "The alarm"): hue from the
// cooling clock (days since `last_active`), glow from recent hours (`heat`),
// and the amber alarm for a cold project with open actions. Pure: no DOM, no
// three.js; the anchor colours live in the token sheet (GALAXY.anchors).
import type { GraphNode } from '../../../types.js'
import { daysBetween } from '../../../dates.js'
import { size } from '../signals.js'
import { GALAXY } from '../tokens.js'

/** A star this many days untouched is a red dwarf. */
export const COOL_DAYS = 28

/** The five temperature anchors, a week apart. */
export const ANCHORS: ReadonlyArray<{ day: number; hex: string }> = GALAXY.anchors.map((hex, i) => ({ day: i * 7, hex }))

/** Local days since `last_active` (an ISO day); Infinity when never active; a future day is 0. */
export function daysSince(last_active: string | undefined, today: string): number {
  if (last_active === undefined) return Infinity
  return Math.max(0, daysBetween(last_active.slice(0, 10), today))
}

const channels = (hex: string): number[] => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))

/** `#rrggbb` for a star `days` cold: linear per RGB channel between anchors, clamped at day 28. */
export function temperatureColor(days: number): string {
  const last = ANCHORS[ANCHORS.length - 1]
  if (!(days < last.day)) return last.hex
  const d = Math.max(0, days)
  const i = Math.min(Math.floor(d / 7), ANCHORS.length - 2)
  const [a, b] = [ANCHORS[i], ANCHORS[i + 1]]
  const t = (d - a.day) / (b.day - a.day)
  const [ca, cb] = [channels(a.hex), channels(b.hex)]
  return '#' + ca.map((c, k) => Math.round(c + (cb[k] - c) * t).toString(16).padStart(2, '0')).join('')
}

/** Cold enough to be a red dwarf. */
export const isRedDwarf = (days: number): boolean => days >= COOL_DAYS

/** Glow from `heat` (0..1): how bright the star's halo is (its opacity) and
 * how far it reaches, in star radii. Restrained: at heat 1 the halo is half
 * opaque and reaches 2.2 radii, so a hot star reads as a crisp disc in a soft
 * halo, never a white blob over its planets. */
export function glow(heat: number | undefined): { intensity: number; reach: number } {
  const h = Math.min(1, Math.max(0, heat ?? 0))
  return { intensity: 0.1 + 0.4 * h, reach: 1.4 + 0.8 * h }
}

/** A star's radius: the existing node size. */
export const starRadius = (node: GraphNode): number => size(node)

/** The alarm: an active project, cold, with open actions. Paused never alarms; `stale` is ignored. */
export function isAlarm(node: GraphNode, today: string): boolean {
  return (
    node.kind === 'entity' &&
    node.type === 'project' &&
    (node.status ?? 'active') === 'active' &&
    isRedDwarf(daysSince(node.last_active, today)) &&
    (node.open_actions ?? 0) > 0
  )
}

/** Heat that was estimated from touches, not measured in hours. */
export const isEstimated = (node: GraphNode): boolean => node.heat_source === 'touches'
