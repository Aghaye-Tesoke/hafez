// src/graph/client/url.ts
// The page's state in its URL query, so a reload or a bookmark brings the same
// view back: focus and scope (view.ts says what each holds).
// Written with replaceState: a toggle is not a history step.
import { parseView, viewSearch, type ViewParams } from './view.js'

/** The view the URL holds now. */
export function readView(): ViewParams {
  return parseView(location.search)
}

/** Write `changes` into the URL; a default value drops its param. */
export function writeView(changes: Partial<ViewParams>): void {
  const url = new URL(location.href)
  url.search = viewSearch(url.search, changes)
  history.replaceState(history.state, '', url)
}
