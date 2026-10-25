// src/graph/client/panel.ts
// Selection and the read-only note panel (#255, #276), in the right sidebar.
// `selectNode(id)` is the one way in: it marks the node selected, eases the
// camera to it and opens the panel, which shows the Graph's own fields at once
// (badges, facts, children, Related, the placing line) and fills in the note
// from `GET /note/:slug` (`read --json` at summary depth, plus an Entity's
// `log`). Focus moves into the panel when it opens and back when it closes;
// closed (×, or Esc through main.ts's steps back), the sidebar shows
// "Nothing selected" and a hint. The header holds the local-graph depth
// control (local.ts), which belongs to the selection. Note
// text reaches innerHTML only through renderMarkdown; everything else is text
// nodes. What the panel says of a note's state is note-view.ts's.
import { state, type DrawLink, type DrawNode } from './state.js'
import { markSelection, neighbours } from './focus.js'
import { renderMarkdown, type RenderOpts } from './markdown.js'
import { el } from './shell.js'
import { localDay } from '../../dates.js'
import { ageText, badges, childRows, linkCounts, noteFacts, placingLine } from './note-view.js'

/** What the panel needs from the graph view, handed over once by main.ts. */
export interface View {
  /** Ease the camera to a node. */
  ease(node: DrawNode): void
  /** Redraw once: the selection ring moved while the simulation may be still. */
  redraw(): void
  /** What is drawn now: selectNode reaches only visible nodes. */
  drawn(): { nodes: DrawNode[]; links: DrawLink[] }
  /** The selection changed: a node selected, or null when the panel closed. */
  selected(node: DrawNode | null): void
  /** Select any node by id, first revealing it when the view hides it (a row's click). */
  focus(id: string): void
  /** The local-graph depth control, for the header. */
  depthControl(): HTMLElement
}

/** The fields of `/note/:slug` the panel shows. */
interface Note {
  kind: string
  frontmatter: Record<string, unknown>
  body: string
  actions?: Array<{ text: string; handle?: string; added?: string | null; age_days?: number | null; stale?: boolean }>
  /** An Entity's Session Log, the last few entries, newest first. */
  log?: Array<{ date: string; agent: string; type: string; summary: string }>
  /** The Sessions that touched an Entity. */
  sessions?: { count: number; latest: string | null }
  /** Entries in the Entity's archive log; 0 when it has none. */
  archive_entries?: number
}

/** Kinds that are notes in the Vault; tag and domain nodes have no `/note`. */
const NOTE_KINDS = new Set(['entity', 'knowledge', 'session'])
/** Rows name notes, never the Session record (its `related` edges would bury the rest). */
const ROW_KINDS = new Set(['entity', 'knowledge'])
/** Children rows shown before "+N more". */
const CHILDREN_SHOWN = 8
/** Related and Wiki-link rows shown before "+N more". */
const ROWS_SHOWN = 12
/** Open actions shown before "+N more". */
const ACTIONS_SHOWN = 6
/** How long Copy's "Copied" or "Copy failed" shows before it resets, in ms. */
const COPY_RESET_MS = 1500

let view: View | null = null
/** Where focus was when the panel opened: it goes back there on close. */
let returnTo: HTMLElement | null = null
const panel = el('div', { id: 'panel', hidden: '', tabindex: '-1', 'aria-label': 'Note' })
const empty = el('div', { id: 'empty' },
  el('h2', { class: 'label' }, 'Nothing selected'),
  el('p', {}, 'Click a node on the canvas, or search with /, to read a note here.'))

/** Build the panel into `host` once. */
export function bindPanel(host: HTMLElement, v: View): void {
  view = v
  host.append(empty, panel)
  // A wiki-link in rendered note text selects the note it names.
  panel.addEventListener('click', event => {
    const link = (event.target as Element).closest<HTMLElement>('a[data-slug]')
    if (!link) return
    event.preventDefault()
    view?.focus(link.dataset.slug!)
  })
}

/** Select a drawn node by slug (or `tag:`/`domain:` id): ring it, ease the
 * camera to it, open its panel. False, and nothing changes, when no drawn node
 * has that id (unknown, or hidden by the current view). `ease: false`
 * refreshes the panel and leaves the camera where it is (a commit's reload).
 * Reselecting the node already selected is no selection change: the
 * `selected` hook stays quiet, so the view is not redrawn a second time. */
export function selectNode(id: string, ease = true): boolean {
  const node = view?.drawn().nodes.find(n => n.id === id)
  if (!node || !view) return false
  const changed = state.selected?.id !== id
  const opening = panel.hidden
  if (opening) returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
  state.selected = node
  markSelection(node, view.drawn().links)
  render(node, null)
  // Open before the camera moves.
  show(true)
  if (changed) panel.parentElement?.closest('.side')?.scrollTo(0, 0)
  if (opening) panel.focus({ preventScroll: true })
  if (ease) view.ease(node)
  view.redraw()
  if (changed) view.selected(node)
  if (!NOTE_KINDS.has(node.kind)) return true
  void fetch(`/note/${encodeURIComponent(id)}`).then(async res => {
    if (state.selected !== node) return // another node was selected meanwhile
    render(node, res.ok ? await res.json() as Note : null, res.ok ? undefined : 'Not in the Vault any more.')
  }).catch(() => {
    if (state.selected === node) render(node, null, 'Could not reach the graph server.')
  })
  return true
}

/** The panel, or the empty state in its place. */
function show(open: boolean): void {
  panel.hidden = !open
  empty.hidden = open
}

export function closePanel(): void {
  const hadFocus = panel.contains(document.activeElement)
  show(false)
  state.selected = null
  markSelection(null, [])
  view?.redraw()
  view?.selected(null)
  if (hadFocus && returnTo?.isConnected) returnTo.focus({ preventScroll: true })
  returnTo = null
}

/** The panel for a node: the Graph's own fields at once, the note's when it arrives. */
function render(node: DrawNode, note: Note | null, problem?: string): void {
  // Rebuilding drops the focused element: focus stays in the panel.
  const hadFocus = panel.contains(document.activeElement)
  const fm = note?.frontmatter ?? {}
  const text = (key: string, fallback?: string) => (typeof fm[key] === 'string' ? fm[key] as string : fallback)
  const today = localDay()
  const byId = new Map(state.nodes.map(n => [n.id, n]))
  const drawn = new Set(view?.drawn().nodes ?? [])
  const open = note?.actions?.filter(a => a.handle !== undefined) ?? []
  panel.replaceChildren()

  // The header: badges, the name, the description, the facts.
  const close = el('button', { class: 'btn icon close', type: 'button', 'aria-label': 'Close the panel', title: 'Close' }, '×')
  close.addEventListener('click', closePanel)
  const badgeRow = el('div', { class: 'badges' })
  for (const b of badges(node, today)) {
    const badge = el('span', { class: `badge tone-${b.tone}` }, b.text)
    if (b.title) badge.title = b.title
    badgeRow.append(badge)
  }
  const head = el('div', { class: 'head' })
  head.append(close, badgeRow, el('h2', {}, text('name', node.name)!))
  const description = text('description', node.description)
  if (description) head.append(el('p', { class: 'desc' }, description))
  head.append(factsLine(node, note ? open.length : undefined, today, byId))
  if (view) head.append(view.depthControl())
  if (problem) head.append(el('p', { class: 'muted' }, problem))
  panel.append(head)

  // An Unlinked note: the line that places it.
  const placing = placingLine(node)
  if (placing) {
    const best = node.best ? byId.get(node.best) : undefined
    const sec = section('Place it', 'place')
    sec.append(el('p', { class: 'muted' }, best ? `Closest linked note: ${best.name}` : 'Nothing close matched: name the note to link it to.'), lineRow(placing))
  }

  // A Knowledge note is opened to be read: its whole body. An Entity: its Brief.
  if (note?.kind === 'knowledge') section('', 'body').append(markdown(note.body))
  const brief = note?.kind === 'entity' ? markdown(note.body, { section: 'Brief' }) : null
  if (brief?.hasChildNodes()) clamped(section('Brief'), brief)

  if (open.length) {
    const list = el('ul', { class: 'actions' })
    const item = (action: typeof open[number]) => {
      const li = el('li', { class: action.stale ? 'stale' : '' })
      const what = el('span', { class: 'md' })
      what.innerHTML = renderMarkdown(action.text, { inline: true })
      const age = action.added ? `${ageText(action.added, today)}${action.stale ? ' · stale' : ''}` : 'undated'
      li.append(what, el('span', { class: 'age' }, age))
      if (action.added) li.title = `Added ${action.added}`
      return li
    }
    list.append(...open.slice(0, ACTIONS_SHOWN).map(item))
    const sec = section('Next actions', '', String(open.length))
    sec.append(list)
    moreButton(sec, open.length - ACTIONS_SHOWN, () => list.append(...open.slice(ACTIONS_SHOWN).map(item)))
  }

  if (note?.kind === 'entity') history(node, note)

  // Rows name every neighbour the Vault knows, drawn or not; a hidden one is revealed on click.
  const kids = childRows(node, state.nodes, state.links, CHILDREN_SHOWN)
  if (kids.rows.length) {
    const total = kids.rows.length + kids.more
    const list = el('ul', { class: 'rows' })
    list.append(...kids.rows.map(c => childRow(c, today, drawn)))
    const sec = section('Children', '', String(total))
    sec.append(list)
    moreButton(sec, kids.more, () => list.replaceChildren(...childRows(node, state.nodes, state.links, total).rows.map(c => childRow(c, today, drawn))))
  }
  rows('Related', neighbours(node, state.links, byId, 'related', 'both'), drawn)
  rows('Wiki-links', neighbours(node, state.links, byId, 'mention', 'both'), drawn)

  if (NOTE_KINDS.has(node.kind)) section('', 'read').append(lineRow(`hafez read ${node.id}`))
  if (hadFocus) panel.focus({ preventScroll: true })
}

/** touched · open actions · parent · N children · most-linked · N · in <parent>. */
function factsLine(node: DrawNode, openActions: number | undefined, today: string, byId: Map<string, DrawNode>): HTMLElement {
  const f = noteFacts(node, state.nodes, state.links, today, linkCounts(state.nodes, state.links), openActions)
  const line = el('div', { class: 'facts' })
  const fact = (...kids: Array<Node | string>) => line.append(el('span', {}, ...kids))
  if (f.touched) fact('touched ', el('b', {}, f.touched === 'today' ? 'today' : `${f.touched} ago`))
  if (f.open_actions !== null) fact(el('b', {}, String(f.open_actions)), ` open action${f.open_actions === 1 ? '' : 's'}`)
  if (f.children) fact('parent · ', el('b', {}, String(f.children)), f.children === 1 ? ' child' : ' children')
  fact('most-linked · ', el('b', {}, String(f.most_linked)))
  const parent = f.parent ? byId.get(f.parent) : undefined
  if (parent) {
    const link = el('a', { class: 'wiki', href: `?focus=${encodeURIComponent(parent.id)}`, 'data-slug': parent.id }, parent.name)
    fact('in ', link)
  }
  return line
}

/** An Entity's Agent history: its Session Log's last entries, the archive
 * line, and the Sessions that touched it with their query line. */
function history(node: DrawNode, note: Note): void {
  const sec = section('Agent history')
  const log = note.log ?? []
  if (log.length) {
    const list = el('ul', { class: 'log' })
    for (const entry of log) {
      const item = el('li', { class: entry.type })
      const summary = el('span', { class: 'summary' }, entry.summary)
      // A long summary is folded to its first lines; a click unfolds it.
      summary.addEventListener('click', () => summary.classList.add('open'))
      item.append(el('span', { class: 'when' }, `${entry.date} · ${entry.agent} · ${entry.type}`), summary)
      list.append(item)
    }
    sec.append(list)
  } else sec.append(el('p', { class: 'muted' }, 'No Session Log entries.'))
  if (note.archive_entries) {
    sec.append(el('p', { class: 'muted' }, `${note.archive_entries} older entr${note.archive_entries === 1 ? 'y' : 'ies'} archived`), lineRow(`hafez read ${node.id} --archive`))
  }
  const sessions = note.sessions
  if (sessions?.count) {
    const latest = sessions.latest ? ` · latest ${sessions.latest}` : ''
    sec.append(el('p', { class: 'muted' }, `${sessions.count} session${sessions.count === 1 ? '' : 's'} touched it${latest}`),
      lineRow(`hafez query --kind session --related-to ${node.id}`))
  }
}

/** A child as a compact row: name, status, open actions, age. */
function childRow(c: DrawNode, today: string, drawn: Set<DrawNode>): HTMLElement {
  const sub: string[] = [c.status ?? c.kind]
  if (c.open_actions) sub.push(`${c.open_actions} open`)
  if (c.last_touched) sub.push(ageText(c.last_touched, today))
  return row(c, sub.join(' · '), drawn)
}

function rows(title: string, nodes: DrawNode[], drawn: Set<DrawNode>): void {
  const shown = nodes.filter(n => ROW_KINDS.has(n.kind))
  if (!shown.length) return
  const list = el('ul', { class: 'rows' })
  const item = (n: DrawNode) => row(n, n.kind === 'entity' ? n.status ?? n.kind : n.subtype ?? n.kind, drawn)
  list.append(...shown.slice(0, ROWS_SHOWN).map(item))
  const sec = section(title, '', String(shown.length))
  sec.append(list)
  moreButton(sec, shown.length - ROWS_SHOWN, () => list.append(...shown.slice(ROWS_SHOWN).map(item)))
}

/** One clickable row naming a note; a note the view hides is dashed and revealed on click. */
function row(n: DrawNode, sub: string, drawn: Set<DrawNode>): HTMLElement {
  const cls = ['row', n.kind, n.kind === 'entity' ? n.status : undefined, n.stale ? 'stale' : undefined, drawn.has(n) ? undefined : 'hidden']
  const hidden = !drawn.has(n)
  const button = el('button', { class: cls.filter(Boolean).join(' '), type: 'button' },
    el('span', { class: 'dot', 'aria-hidden': 'true' }), el('span', { class: 'nm' }, n.name), el('span', { class: 'sub' }, sub))
  button.title = hidden ? `${n.id} (hidden by the current view: a click shows it)` : n.id
  button.addEventListener('click', () => view?.focus(n.id))
  return el('li', {}, button)
}

/** A titled section of the panel, appended; its body is the returned element. */
function section(title: string, cls = '', count?: string): HTMLElement {
  const sec = el('section', { class: `sec ${cls}`.trim() })
  if (title) {
    const h = el('h3', { class: 'label' }, title)
    if (count) h.append(el('span', { class: 'count' }, count))
    sec.append(h)
  }
  panel.append(sec)
  return sec
}

/** "+N more" under a capped list: a click shows the rest and the button goes. */
function moreButton(sec: HTMLElement, more: number, showAll: () => void): void {
  if (more <= 0) return
  const button = el('button', { class: 'more', type: 'button' }, `+${more} more`)
  button.addEventListener('click', () => {
    showAll()
    button.remove()
  })
  sec.append(button)
}

/** A long Brief folded to its first lines, so the actions and the Agent
 * history below it are in reach; a button unfolds it. */
function clamped(sec: HTMLElement, box: HTMLElement): void {
  box.classList.add('clamp')
  const more = el('button', { class: 'more', type: 'button' }, 'Show the whole Brief')
  more.addEventListener('click', () => {
    box.classList.remove('clamp')
    more.remove()
  })
  sec.append(box, more)
  // Measured once laid out: a short Brief is never folded.
  requestAnimationFrame(() => {
    if (box.scrollHeight <= box.clientHeight + 1) more.click()
  })
}

/** A copyable CLI line; Copy says Copied or Copy failed, then resets. The
 * Unlinked section's placing lines use it too (sections.ts). */
export function lineRow(line: string): HTMLElement {
  const copy = el('button', { class: 'btn', type: 'button', 'aria-label': `Copy ${line}` }, 'Copy')
  let timer: ReturnType<typeof setTimeout> | undefined
  const say = (word: string) => {
    copy.textContent = word
    copy.setAttribute('aria-label', word)
    clearTimeout(timer)
    timer = setTimeout(() => {
      copy.textContent = 'Copy'
      copy.setAttribute('aria-label', `Copy ${line}`)
    }, COPY_RESET_MS)
  }
  copy.addEventListener('click', () => {
    // No clipboard (an insecure context) throws before any promise exists.
    void Promise.resolve().then(() => navigator.clipboard.writeText(line))
      .then(() => say('Copied'), () => say('Copy failed'))
  })
  const box = el('div', { class: 'line' })
  box.append(el('code', { class: 'code' }, line), copy)
  return box
}

/** Note text rendered into a block. */
function markdown(text: string, opts?: RenderOpts): HTMLDivElement {
  const box = el('div', { class: 'md' })
  box.innerHTML = renderMarkdown(text, opts)
  return box
}
