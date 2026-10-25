// src/graph/client/note-view.ts
// What the note panel shows of a note's Hafez state (#276), worked out from
// plain Graph data before any DOM: the header's badges, the facts line, the
// children rows and an Unlinked note's placing line. Pure, so it runs in node.
import type { GraphEdge, GraphNode } from '../../types.js'
import { daysBetween } from '../../dates.js'
import { compareLiveness } from './signals.js'

/** An age, compact: `today`, `13d`, `2w`, `3mo`, `2y`. */
export function ageText(day: string, today: string): string {
  const days = daysBetween(day, today)
  if (days <= 0) return 'today'
  if (days < 14) return `${days}d`
  if (days < 60) return `${Math.round(days / 7)}w`
  if (days < 365) return `${Math.round(days / 30)}mo`
  return `${Math.round(days / 365)}y`
}

export type Tone = 'gold' | 'wisdom' | 'amber' | 'muted'

export interface Badge { text: string; tone: Tone; title?: string }

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/** The header's badges: kind, status (or a note's confidence), Stale, the
 * stale-action count, Unlinked. Only an active Entity carries the Stale ones. */
export function badges(node: GraphNode, today: string): Badge[] {
  const out: Badge[] = []
  if (node.kind === 'entity') out.push({ text: node.type ?? 'entity', tone: 'gold' })
  else if (node.kind === 'knowledge') out.push({ text: node.subtype ?? 'insight', tone: 'wisdom' })
  else out.push({ text: node.kind, tone: 'muted' })
  if (node.status) out.push({ text: node.status, tone: node.status === 'active' ? 'gold' : 'muted' })
  if (node.confidence) out.push({ text: node.confidence, tone: 'wisdom' })
  const live = node.kind === 'entity' && node.status === 'active'
  if (live && node.stale && node.last_touched) {
    const days = daysBetween(node.last_touched, today)
    out.push({ text: `Stale · ${days}d`, tone: 'amber', title: `Untouched ${days} days, past its staleness-days (${node.staleness_days ?? 14})` })
  }
  if (live && node.stale_actions) out.push({ text: plural(node.stale_actions, 'stale action'), tone: 'amber', title: 'Open actions past staleness-days, undated ones included' })
  if (node.unlinked) out.push({ text: 'Unlinked', tone: 'muted', title: 'No Parent, Related or Wiki-link edge either way' })
  return out
}

/** A Graph edge, its ends slugs or, once force-graph has swapped them, node objects. */
export interface Link { source: string | { id: string }; target: string | { id: string }; relation: GraphEdge['relation'] }

const endId = (end: Link['source']): string => (typeof end === 'string' ? end : end.id)

/** A parent's children, liveliest first: the first `cap`, and how many more there are. */
export function childRows<N extends GraphNode>(node: GraphNode, nodes: N[], links: Link[], cap: number): { rows: N[]; more: number } {
  const ids = new Set(links.filter(l => l.relation === 'parent' && endId(l.target) === node.id).map(l => endId(l.source)))
  const children = nodes.filter(n => ids.has(n.id)).sort(compareLiveness)
  return { rows: children.slice(0, cap), more: Math.max(0, children.length - cap) }
}

/** Each note's count of Parent, Related and Wiki-link edges, by id; a note
 * with none is absent. An edge counts when both its ends are notes: a tag,
 * domain or Session layer edge ends elsewhere (a Session's `related` edge
 * is a Session touching the note, not the note linking anything). A panel
 * fact only: degree drives nothing on the canvas. */
export function linkCounts(nodes: GraphNode[], links: Link[]): Map<string, number> {
  const notes = new Set(nodes.filter(n => n.kind === 'entity' || n.kind === 'knowledge').map(n => n.id))
  const degree = new Map<string, number>()
  for (const l of links) {
    const ends = [endId(l.source), endId(l.target)]
    if (!ends.every(id => notes.has(id))) continue
    for (const id of ends) degree.set(id, (degree.get(id) ?? 0) + 1)
  }
  return degree
}

export interface Facts {
  /** How long since it was touched (ageText), or null with no last-touched day. */
  touched: string | null
  /** An Entity's open actions; null on Knowledge or when unknown. */
  open_actions: number | null
  /** Its parent's slug. */
  parent: string | null
  children: number
  /** Its link count (linkCounts), 0 with none: every note shows it. */
  most_linked: number
}

/** The facts line under the name. `openActions` is the note's own count, when
 * read: the Graph carries it on an active or paused Entity. */
export function noteFacts(node: GraphNode, nodes: GraphNode[], links: Link[], today: string, counts: Map<string, number>, openActions?: number): Facts {
  const parent = links.find(l => l.relation === 'parent' && endId(l.source) === node.id)
  const children = new Set(links.filter(l => l.relation === 'parent' && endId(l.target) === node.id).map(l => endId(l.source)))
  return {
    touched: node.last_touched ? ageText(node.last_touched, today) : null,
    open_actions: node.kind === 'entity' ? openActions ?? node.open_actions ?? null : null,
    parent: parent ? endId(parent.target) : null,
    children: nodes.filter(n => children.has(n.id)).length,
    most_linked: counts.get(node.id) ?? 0,
  }
}

/** An Unlinked note's placing line: `hafez link <slug> <best> related`, the
 * `<slug>` placeholder when nothing matched; null for a linked note. */
export function placingLine(node: GraphNode): string | null {
  return node.unlinked ? `hafez link ${node.id} ${node.best ?? '<slug>'} related` : null
}
