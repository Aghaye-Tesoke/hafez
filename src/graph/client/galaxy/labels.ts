// src/graph/client/galaxy/labels.ts
// Which bodies carry a name at which camera distance (spec "Labels"). Cores,
// stars and nebulae are named from afar; planets, moons and belt bodies only up
// close. Hover and selection always name the body. Pure: no DOM, no three.js.
import type { Body } from './bodies.js'

/** Camera distances in scene units. */
export const LABEL = { always: 900, near: 120 } as const

export function labelShows(body: Body, distance: number, hovered: boolean, selected: boolean): boolean {
  if (hovered || selected) return true
  const far = body === 'core' || body === 'star' || body === 'nebula'
  return distance <= (far ? LABEL.always : LABEL.near)
}

/** Sprite text height in scene units. */
export function labelSize(body: Body): number {
  if (body === 'core') return 6
  if (body === 'star' || body === 'nebula') return 4
  return 2.5
}
