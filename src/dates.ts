// src/dates.ts
// The vault's one calendar-day convention: the LOCAL day.
//
// A hafez vault is personal — "today" means the user's today, so every
// surface that names a day (created / last-touched / session-log stamping,
// the dates `query --since/--before` compare against, and the `--since` the
// changelog hands to git) resolves to the local calendar day. Deriving
// stamps from UTC while comparing against local-midnight boundaries made the
// same date mean different days: west of UTC after ~13:00 local, a fresh
// entity was stamped with tomorrow.

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** The local calendar day as YYYY-MM-DD. The single source of "today". */
export function localDay(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * Bare YYYY-MM-DD → local midnight, for git's approxidate. A date-only
 * `--since` is otherwise filled with the *current* time of day ("since right
 * now"), and any explicit instant must anchor to the same local day boundary
 * the stamps and query comparisons use. Relative forms (`7.days.ago`) are
 * already local and pass through untouched.
 */
export function normalizeSinceDate(since: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(since) ? `${since}T00:00:00` : since
}
