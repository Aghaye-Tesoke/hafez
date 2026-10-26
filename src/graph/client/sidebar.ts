// src/graph/client/sidebar.ts
// What the left sidebar lists (#277, spec #270 "Left sidebar"), worked out
// from plain Graph data before any DOM: Live work's Stale / Active / Paused
// groups and their rows, and the Unlinked notes. Pure, so it runs in node;
// sections.ts draws it. Who is Stale is signals.ts's one rule, the same the canvas rings.
import type { GraphNode } from '../../types.js'
import { compareLiveness, isDone, isLive, isStale } from './signals.js'
import { daysBetween } from '../../dates.js'
import { ageText } from './note-view.js'

export interface LiveGroups<N extends GraphNode> {
  /** Live work past its staleness-days: the canvas's amber rings. */
  stale: N[]
  /** The rest of live work. */
  active: N[]
  paused: N[]
}

/** Live work in its three groups, each in liveness order. */
export function liveGroups<N extends GraphNode>(nodes: N[]): LiveGroups<N> {
  const sorted = [...nodes].sort(compareLiveness)
  return {
    stale: sorted.filter(isStale),
    active: sorted.filter(n => isLive(n) && !isStale(n)),
    paused: sorted.filter(n => n.kind === 'entity' && n.status === 'paused'),
  }
}

/** A Live work row's facts: its second line and the count on its right. */
export interface LiveRow {
  /** `stale Nd` for a Stale row, else its age (`today`, `13d ago`). */
  when: string
  stale: boolean
  /** The stale-action share: `2/5 actions stale`, `5 actions`, `no open actions`. */
  share: string
  /** Open actions. */
  open: number
}

export function liveRow(node: GraphNode, today: string): LiveRow {
  const stale = isStale(node)
  const touched = node.last_touched?.slice(0, 10)
  const age = touched === undefined ? 'untouched' : ageText(touched, today)
  const when = touched === undefined || age === 'today' ? age
    : stale ? `stale ${daysBetween(touched, today)}d`
    : `${age} ago`
  const open = node.open_actions ?? 0
  const share = open === 0 ? 'no open actions'
    : node.stale_actions ? `${node.stale_actions}/${open} actions stale`
    : `${open} action${open === 1 ? '' : 's'}`
  return { when, stale, share, open }
}

/** Every Unlinked note (`unlinked` in the Graph): work not done first,
 * Entities before Knowledge, then by name. The placing line is note-view.ts's. */
export function unlinkedNotes<N extends GraphNode>(nodes: N[]): N[] {
  return nodes.filter(n => n.unlinked).sort((a, b) =>
    Number(isDone(a)) - Number(isDone(b)) || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))
}
