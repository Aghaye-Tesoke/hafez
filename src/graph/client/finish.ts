// src/graph/client/finish.ts
// The pure half of the panel's Mark finished control: who may be finished, what
// the warning says, when the typed slug counts and where the POST goes. The
// control itself (the steps and the fetch) is panel.ts's.
import type { GraphNode } from '../../types.js'

/** Where the control is: a button, the warning, the typed slug, the POST in flight, the POST failed. */
export type FinishStep = 'idle' | 'confirm' | 'type' | 'sending' | 'failed'

/** Only an unfinished project can be finished. */
export function canFinish(node: GraphNode): boolean {
  return node.kind === 'entity' && node.type === 'project' && node.status !== 'done'
}

/** The two lines shown before the typed step: what finishing does, then what is still open. */
export function finishWarning(node: GraphNode): string {
  const n = node.open_actions ?? 0
  const open = n === 0 ? 'has no open actions.' : `has ${n} open action${n === 1 ? '' : 's'}.`
  return `This star will go supernova. It cannot un-explode.\n"${node.name}" ${open}`
}

/** The typed text names the slug, spaces around it forgiven. */
export function typedMatches(input: string, slug: string): boolean {
  return input.trim() === slug
}

/** The route that finishes a note, same origin as the page. */
export function finishUrl(slug: string): string {
  return `/note/${encodeURIComponent(slug)}/finish`
}
