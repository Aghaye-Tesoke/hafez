// src/graph/heat/heat.ts
// The heat of a project: recent working minutes, each decayed by how many
// days ago it happened, summed, and saturated at one working week. A day with
// no active minutes contributes nothing; a day older than the window is
// ignored outright. Where a project has no session telemetry, a touch (a day
// it was written to) stands in for one hour of work.
import { daysBetween } from '../../dates.js'

/** Days for a day's contribution to halve. */
export const HALF_LIFE_DAYS = 7

/** Decayed minutes that make a project fully hot (heat 1). */
export const SATURATION_MINUTES = 1800

/** Days back that count at all; anything older is ignored. */
export const WINDOW_DAYS = 35

/** Minutes credited to a day on which a project was touched. */
export const TOUCH_MINUTES = 60

/** Active minutes keyed by local day (YYYY-MM-DD). */
export type DayMinutes = Record<string, number>

/**
 * Heat in [0, 1] from active minutes per day, as of `today`. `last_active` is
 * the newest day in the window with minutes > 0 and is omitted when there is
 * none. Heat is rounded to three decimals.
 */
export function heatOf(days: DayMinutes, today: string): { heat: number; last_active?: string } {
  let sum = 0
  let lastActive: string | undefined
  for (const [day, minutes] of Object.entries(days)) {
    const age = daysBetween(day, today)
    if (age > WINDOW_DAYS) continue
    if (minutes <= 0) continue
    sum += minutes * 2 ** (-Math.max(age, 0) / HALF_LIFE_DAYS)
    if (lastActive === undefined || day > lastActive) lastActive = day
  }
  const heat = Math.round(Math.min(Math.max(sum / SATURATION_MINUTES, 0), 1) * 1000) / 1000
  return lastActive === undefined ? { heat } : { heat, last_active: lastActive }
}

/** Each distinct touch day becomes `TOUCH_MINUTES` of work. */
export function touchesAsMinutes(touchDays: string[]): DayMinutes {
  const minutes: DayMinutes = {}
  for (const day of touchDays) minutes[day] = TOUCH_MINUTES
  return minutes
}
