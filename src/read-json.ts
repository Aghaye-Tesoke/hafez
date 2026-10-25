// src/read-json.ts
// `read --json`'s object, outside the CLI: what `hafez read --json` prints
// and what the graph server's `/note/:slug` serves, with the two pieces the
// text render shares with it (the Footer and an entity's pointers).
import type { Hafez, ParsedFile, ReadDepth, UnifiedResult } from './types.js'
import { detectAgent } from './harness.js'
import { getActionItems, parseSessionLogHeading } from './document.js'
import { agedActions } from './stale.js'
import { workstreams, type Workstream } from './workstream.js'
import { CHILDREN_SHOWN, footerOp, type ChildLine, type FooterInput } from './surfaces/items.js'

/** `read --json`'s object for a note read at `depth`: what the CLI prints and
 * what the graph server's `/note/:slug` serves. `whole`, its full-depth read
 * when the caller holds one, saves reading it again. */
export async function readJsonOf(os: Hafez, slug: string, depth: ReadDepth, result: ParsedFile, whole?: ParsedFile): Promise<object> {
  // A session note is read, never written: no Footer (#35).
  if (result.kind === 'session') return result
  // The Footer and the pointers are the same at every depth: they read the
  // whole file, not the body this depth shows.
  const full = (whole ?? (depth === 'full' ? result : await os.read(slug, 'full'))) as typeof result
  const writes = footerOp(footerFor(slug, full))
  const pointers = full.kind === 'entity' ? await pointersFor(os, slug, full.body) : null
  const json = pointers && { ...pointers, children: pointers.children.slice(0, CHILDREN_SHOWN), children_total: pointers.children.length }
  // A frontmatter-depth read carries no body, so it has no actions to list.
  if (result.kind !== 'entity' || depth === 'frontmatter') return { ...result, ...json, writes }
  return { ...result, actions: agedActions(result.body, result.frontmatter), ...json, writes }
}

/** What hangs off an entity elsewhere: the sessions that touched it (the
 * look back, #35), its archived log entries (#34), its children (#230) and
 * the prefix families its own Next Actions carry unsplit against the
 * entities whose `parent` or `related` names it (#230). Counted at read
 * time, nothing written. */
export async function pointersFor(os: Hafez, slug: string, body: string): Promise<{ sessions: { count: number; latest: string | null }; archive_entries: number; children: ChildLine[]; workstreams: Workstream[] }> {
  const relatedTo = (await os.related_to(slug)).items
  const sessions = relatedTo.filter((i): i is UnifiedResult & { kind: 'session' } => i.kind === 'session')
  const latest = sessions.reduce<string | null>((max, s) => (max === null || s.session_date > max ? s.session_date : max), null)
  const archive = await os.archive(slug)
  const entries = archive ? archive.split('\n').filter(line => parseSessionLogHeading(line)).length : 0
  // The children block (#230): the index's children query, last-touched
  // descending then slug for a stable order; the renders cap what is shown.
  const childItems = (await os.children(slug)).items
  const children = [...childItems]
    .sort((a, b) => b.last_touched.localeCompare(a.last_touched) || a.slug.localeCompare(b.slug))
    .map(c => ({ slug: c.slug, description: c.description, open_actions: c.next_action_count, last_touched: c.last_touched }))
  const naming = [...childItems, ...relatedTo.filter(i => i.kind === 'entity')]
  return { sessions: { count: sessions.length, latest }, archive_entries: entries, children, workstreams: workstreams(body, naming) }
}

/** The Footer for a file read at full depth: its Handle comes from the
 * whole file. A session note has none: it is never written to. */
export function footerFor(slug: string, result: Exclude<ParsedFile, { kind: 'session' }>): FooterInput {
  return { slug, agent: detectAgent(), ...(result.kind === 'entity'
    ? {
      target: { kind: 'entity', type: result.frontmatter.type },
      handle: getActionItems(result.body).find(a => a.handle)?.handle,
    }
    : { target: { kind: 'knowledge', subtype: result.frontmatter.subtype } }) }
}
