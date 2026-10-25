// src/graph/client/local.ts
// Local-graph mode (#256, #279): only the selected node's neighbourhood,
// depth 1 or 2, is drawn. It belongs to the selection: its control (off, 1,
// 2) sits in the panel header, and with nothing selected there is no local
// mode. Both live in the URL (view.ts): `focus=<id>` is the selection,
// `depth=1|2` turns the mode on (absent: off).
import { endId, type DrawLink, type DrawNode } from './state.js'
import { readView, writeView } from './url.js'
import type { Depth } from './view.js'
import { el } from './shell.js'

const loaded = readView()
let depth: Depth | null = loaded.depth
let centre: string | null = loaded.focus

/** The node selected at load, from the URL: main.ts selects it once it is drawn. */
export const initialFocus = centre

/** The control drawn last (the panel's header): setDepth keeps it pressed right. */
let buttons: Array<[Depth | null, HTMLButtonElement]> = []

/** The local graph's centre follows the selection; the URL keeps it for a
 * reload. False when it was already the centre. */
export function setCentre(id: string | null): boolean {
  if (id === centre) return false
  centre = id
  writeView({ focus: id })
  return true
}

/** The depth on, or null when the mode is off. */
export function localDepth(): Depth | null {
  return depth
}

/** Whether the mode is on: then selecting a node re-centres the view on it. */
export function localOn(): boolean {
  return depth !== null
}

export function setDepth(next: Depth | null): void {
  depth = next
  writeView({ depth })
  for (const [d, b] of buttons) b.setAttribute('aria-pressed', String(d === depth))
}

/** Narrow the scope-filtered graph to the centre's neighbourhood. `all` is
 * every node, so a centre the scope hides is still drawn. Off, or with a
 * centre no longer in the Vault, it returns the graph unchanged. */
export function localGraph(shown: DrawNode[], all: DrawNode[], links: DrawLink[]): DrawNode[] {
  if (depth === null || centre === null) return shown
  const anchor = all.find(n => n.id === centre)
  if (!anchor) return shown
  const nodes = shown.includes(anchor) ? shown : [...shown, anchor]
  const ids = new Set(nodes.map(n => n.id))
  const near = new Set([anchor.id])
  let ring = new Set([anchor.id])
  for (let hop = 0; hop < depth; hop++) {
    const next = new Set<string>()
    for (const l of links) {
      const s = endId(l.source)
      const t = endId(l.target)
      if (!ids.has(s) || !ids.has(t)) continue
      if (ring.has(s) && !near.has(t)) { near.add(t); next.add(t) }
      if (ring.has(t) && !near.has(s)) { near.add(s); next.add(s) }
    }
    ring = next
  }
  return nodes.filter(n => near.has(n.id))
}

/** The depth control for the panel's header: Off, 1 and 2, the one on
 * pressed; `pick` asks for a depth. */
export function depthControl(pick: (depth: Depth | null) => void): HTMLElement {
  const group = el('div', { class: 'depth', role: 'group', 'aria-label': 'Local graph' },
    el('span', { class: 'label', 'aria-hidden': 'true' }, 'Local graph'))
  buttons = ([[null, 'Off', 'Show the whole graph'], [1, '1', 'Show this note and its neighbours'], [2, '2', 'Show this note and two links out']] as const)
    .map(([d, text, title]) => {
      const b = el('button', { class: 'btn', type: 'button', title, 'aria-pressed': String(d === depth), 'aria-label': d === null ? 'Local graph off' : `Local graph depth ${d}` }, text)
      b.addEventListener('click', () => pick(d))
      group.append(b)
      return [d, b]
    })
  return group
}
