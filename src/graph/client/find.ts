// src/graph/client/find.ts
// What the `/` search finds (#279, spec #270 stories 70-74, critique S1/S3),
// pure over plain Graph data so it runs in node; search.ts draws it.
// - Every note, hidden ones included: an Entity or Knowledge node matched on
//   its name and slug (the query whole, or as initials and runs) or its
//   description (every word of the query in it). A name or slug that holds
//   the query ranks first, then a description, then initials and runs; ties
//   go by liveness, then name.
// - Each note carries its cues: kind shape, status, Stale (the amber ring's
//   rule) and whether the view hides it.
// - The list is capped; the total counts every match.
import type { GraphNode } from '../../types.js'
import { compareLiveness, isStale } from './signals.js'

/** How many notes the list shows. */
export const NOTES_SHOWN = 8

/** A note found, with its cues. */
export interface NoteHit<N extends GraphNode = GraphNode> {
  node: N
  /** The canvas's mark: a gold disc (an Entity), a blue diamond, hollow for a plan. */
  shape: 'disc' | 'diamond' | 'hollow'
  /** An Entity's status (a capture reads active), else `knowledge` or `plan`. */
  status: string
  stale: boolean
  /** The scope or the Knowledge toggle hides it: picking it reveals it. */
  hidden: boolean
}

export interface Found<N extends GraphNode = GraphNode> {
  notes: Array<NoteHit<N>>
  noteTotal: number
}

/** Score tiers: a name or slug holding the query, a description holding
 * every word, a looser name match. */
const TIER = { contains: 3000, description: 2000, fuzzy: 0 } as const
const BOUNDARY = /[\s\-_:]/

const startsWord = (text: string, i: number): boolean => i === 0 || BOUNDARY.test(text[i - 1])

/** `query` in `text`: held whole, scored higher the earlier it starts and the
 * less else the text holds; else as initials and runs (each letter continues
 * the last one's run or starts a word, so `rsm` finds Royston SmartFlows),
 * scored higher for longer runs and smaller gaps. Null when neither: letters
 * scattered mid-word are noise. Both are lower case. */
function fuzzyScore(query: string, text: string): number | null {
  const at = text.indexOf(query)
  if (at >= 0) return TIER.contains - at * 2 - (text.length - query.length) + (startsWord(text, at) ? 200 : 0)
  let score = 0
  let last = -1
  for (const ch of query) {
    let i = last >= 0 && text[last + 1] === ch ? last + 1 : -1
    if (i < 0) {
      for (let j = last + 1; j < text.length && i < 0; j++) if (text[j] === ch && startsWord(text, j)) i = j
      if (i < 0) return null
      score += 8 - Math.min(i - last - 1, 10)
    } else score += 10
    last = i
  }
  return TIER.fuzzy + score
}

function noteScore(q: string, words: string[], node: GraphNode): number | null {
  const name = fuzzyScore(q, node.name.toLowerCase())
  const slug = fuzzyScore(q, node.id.toLowerCase())
  const text = node.description?.toLowerCase()
  const description = text && words.every(w => text.includes(w)) ? TIER.description : null
  const best = Math.max(name ?? -Infinity, slug ?? -Infinity, description ?? -Infinity)
  return best > -Infinity ? best : null
}

function hit<N extends GraphNode>(node: N, hidden: boolean): NoteHit<N> {
  const plan = node.kind === 'knowledge' && node.subtype === 'plan'
  return {
    node,
    shape: node.kind === 'entity' ? 'disc' : plan ? 'hollow' : 'diamond',
    status: node.kind === 'entity' ? node.status ?? 'active' : plan ? 'plan' : 'knowledge',
    stale: isStale(node),
    hidden,
  }
}

/** The notes matching `query`; `shows` says whether the view draws a note. */
export function find<N extends GraphNode>(query: string, nodes: N[], shows: (node: N) => boolean): Found<N> {
  const q = query.trim().toLowerCase()
  if (!q) return { notes: [], noteTotal: 0 }
  const words = q.split(/\s+/)

  const notes: Array<[N, number]> = []
  for (const n of nodes) {
    if (n.kind !== 'entity' && n.kind !== 'knowledge') continue
    const score = noteScore(q, words, n)
    if (score !== null) notes.push([n, score])
  }
  notes.sort((a, b) => b[1] - a[1] || compareLiveness(a[0], b[0]) || a[0].name.localeCompare(b[0].name))

  return {
    notes: notes.slice(0, NOTES_SHOWN).map(([n]) => hit(n, !shows(n))),
    noteTotal: notes.length,
  }
}

/** The count under the list: every match, and how many the cap leaves out. */
export function foundSummary(found: Found): string {
  const { notes, noteTotal } = found
  if (noteTotal === 0) return 'No note matches.'
  if (notes.length < noteTotal) return `${notes.length} of ${noteTotal} notes: type more to narrow`
  return `${noteTotal} ${noteTotal === 1 ? 'note' : 'notes'}`
}
