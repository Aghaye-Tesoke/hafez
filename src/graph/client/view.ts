// src/graph/client/view.ts
// The page's view state (#279, spec #270 stories 76-79), pure so it runs in
// node: what the URL's query holds and how Esc steps back.
// - `focus`: the selected note; `depth` (1 or 2): the local graph around it,
//   only with a focus (no local mode with nothing selected); `scope`: `all`
//   for Everything, absent for Live; `highlight`: a `tag:<t>` or
//   `domain:<d>` (sections.ts). The default view writes no params.
// - Esc steps back one level: the local graph, then the selection, then the
//   fitted overview, which Esc fits again.

export type Depth = 1 | 2
export type Scope = 'live' | 'all'

export interface ViewParams {
  focus: string | null
  depth: Depth | null
  scope: Scope
  highlight: string | null
}

/** The view a query (`location.search`) holds; a value the page cannot hold is dropped. */
export function parseView(search: string): ViewParams {
  const params = new URLSearchParams(search)
  const focus = params.get('focus') || null
  const n = Number(params.get('depth'))
  const highlight = params.get('highlight')
  return {
    focus,
    depth: focus !== null && (n === 1 || n === 2) ? n : null,
    scope: params.get('scope') === 'all' ? 'all' : 'live',
    highlight: highlight !== null && /^(tag|domain):./.test(highlight) ? highlight : null,
  }
}

/** The query with `changes` written over `search`: a default value drops its
 * param, any other param stays. */
export function viewSearch(search: string, changes: Partial<ViewParams>): string {
  const params = new URLSearchParams(search)
  const put = (name: string, value: string | null) => value === null ? params.delete(name) : params.set(name, value)
  if ('focus' in changes) put('focus', changes.focus ?? null)
  if ('depth' in changes) put('depth', changes.depth == null ? null : String(changes.depth))
  if ('scope' in changes) put('scope', changes.scope === 'all' ? 'all' : null)
  if ('highlight' in changes) put('highlight', changes.highlight ?? null)
  // Commas and colons are legal in a query: keep a list or a `tag:x` readable.
  const query = params.toString().replace(/%2C/gi, ',').replace(/%3A/gi, ':')
  return query ? `?${query}` : ''
}

/** What one Esc undoes: the local graph, the selection, or nothing but the
 * camera (the overview, fitted again). */
export type EscStep = 'local' | 'selection' | 'overview'

export function escStep(view: { depth: Depth | null; selected: boolean }): EscStep {
  if (!view.selected) return 'overview'
  return view.depth !== null ? 'local' : 'selection'
}
