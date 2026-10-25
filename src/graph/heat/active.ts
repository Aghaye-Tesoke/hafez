// src/graph/heat/active.ts
// Active minutes per local day, read from a session's event timestamps.
// Two events closer than GAP_MS are one stretch of work; a longer silence
// is a break and counts for nothing. Each stretch is credited to the local
// day it started on, so a session that runs past midnight is not split.
import { localDay } from '../../dates.js'

/** The longest silence that still counts as one stretch of active work. */
export const GAP_MS = 15 * 60_000

/**
 * Whole active minutes per local day (YYYY-MM-DD), summed from consecutive
 * timestamps in milliseconds. Input order does not matter; gaps longer than
 * `gapMs` contribute nothing.
 */
export function minutesByDay(timestampsMs: number[], gapMs = GAP_MS): Record<string, number> {
  const sorted = [...timestampsMs].sort((a, b) => a - b)
  const msByDay: Record<string, number> = {}
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1]
    if (gap > gapMs) continue
    const day = localDay(new Date(sorted[i - 1]))
    msByDay[day] = (msByDay[day] ?? 0) + gap
  }
  const minutes: Record<string, number> = {}
  for (const [day, ms] of Object.entries(msByDay)) minutes[day] = Math.round(ms / 60_000)
  return minutes
}
