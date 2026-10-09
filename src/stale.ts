// src/stale.ts
// Stale (see CONTEXT.md): past the entity's `staleness-days` without
// movement. An open next action is stale when unticked that long since its
// added day; an undated one is stale. Ages count local days (src/dates.ts).

import { localDay } from './dates.js'
import { getActionItems } from './document.js'

/** The threshold an entity without `staleness-days` gets. */
export const DEFAULT_STALENESS_DAYS = 14

/** An open action's added day, its age in days, and whether it is stale;
 * undated gives null for both. */
export interface ActionAge {
  added: string | null
  age_days: number | null
  stale: boolean
}

/** A YYYY-MM-DD day as a whole day count, so differences ignore DST. */
const dayNumber = (day: string): number => {
  const [y, m, d] = day.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / 86_400_000
}

/** The entity side of the rule, as SQL over an index row `i` with `@today`
 * bound to localDay(): whole days from its last-touched day to today.
 * julianday of two bare YYYY-MM-DD days differs by exactly `dayNumber`'s
 * difference, so entities and their actions count the same days. */
export const ENTITY_AGE_DAYS_SQL = 'CAST(julianday(@today) - julianday(i.last_touched) AS INTEGER)'

/** An entity row is stale when its age is past its threshold, not equal to
 * it — `actionAge`'s rule. */
export const ENTITY_STALE_SQL = `${ENTITY_AGE_DAYS_SQL} > COALESCE(i.staleness_days, ${DEFAULT_STALENESS_DAYS})`

/** How old an action added on `added` is today, and whether that is past
 * `stalenessDays`: older than the threshold, not equal to it. */
export function actionAge(added: string | null, stalenessDays: number, today: string = localDay()): ActionAge {
  if (added === null) return { added, age_days: null, stale: true }
  const age_days = dayNumber(today) - dayNumber(added)
  return { added, age_days, stale: age_days > stalenessDays }
}

/** An entity's threshold: its `staleness-days`, else the default. */
export function stalenessDaysOf(frontmatter: { 'staleness-days'?: number }): number {
  return frontmatter['staleness-days'] ?? DEFAULT_STALENESS_DAYS
}

/** One line of Next Actions as `read --json` gives it: an open line with its
 * Handle and age, a ticked line as text alone. */
export type AgedAction = ({ handle: string; text: string } & ActionAge) | { text: string }

/** An entity body's Next Actions in file order, each open line aged against
 * the entity's threshold. */
export function agedActions(body: string, frontmatter: { 'staleness-days'?: number }): AgedAction[] {
  const days = stalenessDaysOf(frontmatter)
  return getActionItems(body).map(item =>
    item.handle === undefined ? { text: item.text } : { handle: item.handle, text: item.text, ...actionAge(item.added, days) })
}

/** The Handles of an entity body's Stale lines, in file order. */
export function staleHandles(body: string, frontmatter: { 'staleness-days'?: number }): string[] {
  return agedActions(body, frontmatter).flatMap(a => 'handle' in a && a.stale ? [a.handle] : [])
}
