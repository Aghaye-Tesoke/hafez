// src/near-match.ts
// The Near-match rule (decision #60): how closely a new knowledge note's name
// resembles existing ones. Names only, never bodies, so the verdict is
// deterministic and explainable. Tokens are the name's words, lowercased,
// with the search stopwords dropped.

import { tokenize } from './stopwords.js'

/** A near-match shares at least this many tokens, whatever the name lengths. */
const NEAR_MIN_SHARED = 3
/** A weaker resemblance shares at least this many. */
const WEAK_MIN_SHARED = 2
/** Each list holds at most this many notes. */
const MAX_LISTED = 3

function tokens(name: string): Set<string> {
  return new Set(tokenize(name))
}

/** The notes whose names near-match `name` — all but one of the shorter
 * name's tokens shared, at least three — and those that only resemble it (two
 * shared or more). Up to three of each, most tokens shared first. */
export function resemblances<T extends { name: string }>(name: string, notes: readonly T[]): { near: T[]; weak: T[] } {
  const mine = tokens(name)
  const near: { note: T; shared: number }[] = []
  const weak: { note: T; shared: number }[] = []
  for (const note of notes) {
    const theirs = tokens(note.name)
    const shared = [...mine].filter(t => theirs.has(t)).length
    const shorter = Math.min(mine.size, theirs.size)
    if (shared >= Math.max(NEAR_MIN_SHARED, shorter - 1)) near.push({ note, shared })
    else if (shared >= WEAK_MIN_SHARED) weak.push({ note, shared })
  }
  const top = (xs: { note: T; shared: number }[]) =>
    xs.sort((a, b) => b.shared - a.shared).slice(0, MAX_LISTED).map(x => x.note)
  return { near: top(near), weak: top(weak) }
}
