// src/graph/client/scope.ts
// What the page draws of the Graph it holds (#274):
// - only notes: tag, domain and Session nodes are never drawn;
// - the scope, the header's Live work / Everything switch: Live hides done
//   work only, keeping a done parent that anchors live children
//   (signals.ts's liveScope), and never a finished project: its nebula stays
//   in the sky in both scopes; it lives in the URL's `scope` param, `all`
//   for Everything, absent for Live;
// - the header's Knowledge toggle (on by default) hides Knowledge in either scope.
import type { GraphNode } from '../../types.js'
import { state } from './state.js'
import { readView, writeView } from './url.js'
import type { Scope } from './view.js'
import { el } from './shell.js'
import { isNebulaCore } from './galaxy/bodies.js'

let scope: Scope = readView().scope
let knowledge = true

/** The buttons, once drawn: reveal() presses them. */
let scopeButtons: Record<Scope, HTMLButtonElement> | null = null
let knowledgeToggle: HTMLButtonElement | null = null

/** A note: an Entity or Knowledge node, the only kinds the canvas draws. */
export const isNote = (node: GraphNode): boolean => node.kind === 'entity' || node.kind === 'knowledge'

/** Whether the scope and the Knowledge toggle let this node be drawn. */
export function scopeShows(node: GraphNode): boolean {
  if (!isNote(node)) return false
  if (node.kind === 'knowledge') return knowledge
  return scope === 'all' || isNebulaCore(node) || state.live(node)
}

/** Bring a note the view hides into it: Knowledge back on, or Everything for
 * done work the Live scope leaves out; the caller redraws. Returns what it
 * widened, so the page can say so, or null when the note was in view. */
export function reveal(node: GraphNode): 'knowledge' | 'scope' | null {
  if (!isNote(node) || scopeShows(node)) return null
  if (node.kind === 'knowledge') {
    setKnowledge(true)
    return 'knowledge'
  }
  setScope('all')
  return 'scope'
}

function setScope(next: Scope): void {
  scope = next
  if (scopeButtons) for (const s of ['live', 'all'] as const) scopeButtons[s].setAttribute('aria-pressed', String(s === scope))
  writeView({ scope })
}

function setKnowledge(on: boolean): void {
  knowledge = on
  knowledgeToggle?.setAttribute('aria-pressed', String(on))
}

/** Draw the scope switch into `host` and bind the Knowledge toggle;
 * `onChange` runs after each change. */
export function mountScope(host: HTMLElement, knowledgeButton: HTMLButtonElement, onChange: () => void): void {
  const button = (s: Scope, label: string, title: string) => {
    const b = el('button', { class: 'btn', type: 'button', title }, label)
    b.addEventListener('click', () => {
      if (scope === s) return
      setScope(s)
      onChange()
    })
    return b
  }
  scopeButtons = {
    live: button('live', 'Live work', 'Hide done work'),
    all: button('all', 'Everything', 'Show the whole Vault, done work included'),
  }
  host.append(scopeButtons.live, scopeButtons.all)
  setScope(scope)

  knowledgeToggle = knowledgeButton
  setKnowledge(knowledge)
  knowledgeButton.addEventListener('click', () => {
    setKnowledge(!knowledge)
    onChange()
  })
}
