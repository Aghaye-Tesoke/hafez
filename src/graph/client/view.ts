// src/graph/client/view.ts
// The page's view state (#279, spec #270 stories 76-79), pure so it runs in
// node: what the URL's query holds and how Esc steps back.
// - `focus`: the selected note; `scope`: `all` for Everything, absent for
//   Live. The default view writes no params.
// - Esc steps back one level: the selection (the panel closes and the camera
//   returns to the overview), then the overview, which Esc frames again.

export type Scope = 'live' | 'all'

export interface ViewParams {
  focus: string | null
  scope: Scope
}

/** The view a query (`location.search`) holds; a value the page cannot hold is dropped. */
export function parseView(search: string): ViewParams {
  const params = new URLSearchParams(search)
  return {
    focus: params.get('focus') || null,
    scope: params.get('scope') === 'all' ? 'all' : 'live',
  }
}

/** The query with `changes` written over `search`: a default value drops its
 * param, any other param stays. */
export function viewSearch(search: string, changes: Partial<ViewParams>): string {
  const params = new URLSearchParams(search)
  const put = (name: string, value: string | null) => value === null ? params.delete(name) : params.set(name, value)
  if ('focus' in changes) put('focus', changes.focus ?? null)
  if ('scope' in changes) put('scope', changes.scope === 'all' ? 'all' : null)
  // Commas and colons are legal in a query: keep a list or a `tag:x` readable.
  const query = params.toString().replace(/%2C/gi, ',').replace(/%3A/gi, ':')
  return query ? `?${query}` : ''
}

/** What one Esc undoes: the selection, or nothing but the camera (the overview, framed again). */
export type EscStep = 'selection' | 'overview'

export function escStep(view: { selected: boolean }): EscStep {
  return view.selected ? 'selection' : 'overview'
}
