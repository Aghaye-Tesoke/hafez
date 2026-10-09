// src/closest.ts
//
// The closest slugs a `read` miss offers (#91). A miss is usually a slug
// guessed from a repo folder name, so the words of the miss are matched
// against each note's name and slug at full weight and its description at
// half. A note is close when its matched weight covers at least half the
// words of the miss.

import { tokenize } from './stopwords.js'

export interface SlugCandidate {
  slug: string
  name: string
  description: string | null
}

const LIMIT = 5

/** Lowercased words with stopwords dropped and a plural `s` stripped, so
 * `launchpads` and `launchpad` are one word. */
function words(text: string): string[] {
  return tokenize(text, { stem: true })
}

/** At most one insertion, deletion or substitution apart. */
function oneEditApart(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1)
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1)
}

/** A word of the miss matches a word of a note when equal, when the miss cut
 * it short (four letters or more), or when one typo apart (five or more). */
function matches(missWord: string, word: string): boolean {
  if (missWord === word) return true
  if (missWord.length >= 4 && word.startsWith(missWord)) return true
  return Math.min(missWord.length, word.length) >= 5 && oneEditApart(missWord, word)
}

/** Up to five slugs closest to `miss`, closest first. Ties go to the note
 * whose name the miss covers most, then to slug order. */
export function closestSlugs(miss: string, candidates: SlugCandidate[]): string[] {
  const missWords = words(miss)
  if (missWords.length === 0) return []
  const scored = candidates.map(c => {
    const nameWords = [...new Set([...words(c.name), ...words(c.slug)])]
    const descriptionWords = words(c.description ?? '')
    let weight = 0
    const covered = new Set<string>()
    for (const m of missWords) {
      const hit = nameWords.filter(w => matches(m, w))
      if (hit.length > 0) {
        weight += 1
        for (const w of hit) covered.add(w)
      } else if (descriptionWords.some(w => matches(m, w))) {
        weight += 0.5
      }
    }
    const coverage = nameWords.length > 0 ? covered.size / nameWords.length : 0
    return { slug: c.slug, score: weight / missWords.length, coverage }
  })
  return scored
    .filter(s => s.score >= 0.5)
    .sort((a, b) => b.score - a.score || b.coverage - a.coverage || a.slug.localeCompare(b.slug))
    .slice(0, LIMIT)
    .map(s => s.slug)
}
