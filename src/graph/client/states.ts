// src/graph/client/states.ts
// The canvas when there is no graph to draw (#280): a failed `/graph` load
// says what failed and offers Retry; an empty Vault gives the `hafez create`
// line that starts one. fetchGraph never throws: every failure becomes a
// message on the canvas, never an uncaught error in the console.
import type { Graph } from '../../types.js'
import { el } from './shell.js'

export type Loaded = { graph: Graph } | { problem: string; line?: string }

/** How much of an error body the message quotes. */
const QUOTED = 200

/** `GET /graph`, checked: an answer that is not a Graph is a problem to show. */
export async function fetchGraph(): Promise<Loaded> {
  let res: Response
  try {
    res = await fetch('/graph')
  } catch {
    return { problem: 'Could not reach the graph server. Start it again, then Retry:', line: 'hafez graph' }
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).trim().slice(0, QUOTED)
    return { problem: `The graph server answered ${res.status}${text ? `: ${text}` : '.'}` }
  }
  try {
    const graph = await res.json() as Graph
    if (Array.isArray(graph?.nodes) && Array.isArray(graph?.edges)) return { graph }
  } catch { /* not JSON: the same problem */ }
  return { problem: 'The graph server sent something that is not a Graph.' }
}

/** A Vault with no Entity and no Knowledge note: Sessions alone draw nothing. */
function isEmpty(graph: Graph): boolean {
  return !graph.nodes.some(n => n.kind === 'entity' || n.kind === 'knowledge')
}

/** The message over the canvas in `host`: set from each load, gone once a load draws notes. */
export function mountStates(host: HTMLElement, retry: () => void): (loaded: Loaded) => void {
  const box = el('div', { id: 'state', class: 'popover', hidden: '' })
  host.append(box)
  return loaded => {
    if ('graph' in loaded && !isEmpty(loaded.graph)) {
      box.hidden = true
      box.replaceChildren()
      return
    }
    box.hidden = false
    if ('graph' in loaded) {
      box.setAttribute('role', 'status')
      box.replaceChildren(
        el('h2', { class: 'label' }, 'The Vault is empty'),
        el('p', {}, 'Create the first note, or ask an agent to:'),
        el('code', { class: 'code' }, 'hafez create entity "<name>" --type project'),
        el('p', { class: 'hint' }, 'It shows here as soon as it is committed.'))
      return
    }
    box.setAttribute('role', 'alert')
    const again = el('button', { class: 'btn', type: 'button' }, 'Retry')
    again.addEventListener('click', retry)
    box.replaceChildren(
      el('h2', { class: 'label' }, 'The graph did not load'),
      el('p', {}, loaded.problem),
      ...(loaded.line ? [el('code', { class: 'code' }, loaded.line)] : []),
      again)
  }
}
