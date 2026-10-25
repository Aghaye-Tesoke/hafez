// src/graph/client/activity.ts
// Catching up on the agent (#259), built on live.ts's commit hook and pulses:
// - the Activity section of the left sidebar (#278): the server's `/activity`
//   rows (name, ×N, the agent, time ago, the write's tone), fetched on load,
//   after each commit and on each reconnect; a click selects the note; its
//   header says whether the page is live, reconnecting or offline, and its
//   list is a polite live region announcing new rows;
// - Follow (off by default): the camera eases to each commit's pulsed node;
// - ghosts: a deleted node's last drawn object fades out where it was.
import type { ActivityRow, ChangeOp, NoteChange } from '../../types.js'
import { onCommit, onConnection, pulses, type Connection } from './live.js'
import { state, type DrawNode } from './state.js'
import { LABEL_COLOR } from './style.js'
import { el, type Section } from './shell.js'

/** What the activity needs from the graph view, handed over once by main.ts. */
export interface ActivityView {
  /** Ease the camera to a node. */
  ease(node: DrawNode): void
  /** Select a node by id, as search does (the local graph re-centres on one it leaves out). */
  select(id: string): void
  /** Redraw once: ghosts change no data. */
  redraw(): void
}

/** How often the rows' "time ago" is brought up to date, in ms. */
const AGO_EVERY_MS = 30_000
/** How long a deleted node takes to fade out, in ms. */
const GHOST_MS = 2400
/** A ghost starts at this alpha. */
const GHOST_ALPHA = 0.7

const VERB: Record<ChangeOp, string> = { create: 'created', update: 'updated', delete: 'deleted' }

let view: ActivityView | null = null
let section: Section | null = null
let follow = false
let rows: ActivityRow[] = []
/** Each row's list item, by key: a row kept across a refresh keeps its item,
 * so the live region announces only the rows that are new. */
let items = new Map<string, HTMLLIElement>()
/** Drops a response that an earlier, slower fetch would overwrite. */
let fetched = 0
/** Deleted nodes fading out: the object last drawn and when its fade began. */
const ghosts = new Map<string, { node: DrawNode; start: number }>()
const list = document.createElement('ol')

/** Fill the Activity section, with its Follow toggle, and start listening for commits. */
export function bindActivity(into: Section, v: ActivityView): void {
  view = v
  section = into
  const toggle = el('button', { class: 'btn follow', type: 'button', 'aria-pressed': 'false', title: 'Move the camera to each change' }, 'Follow')
  toggle.addEventListener('click', () => {
    follow = !follow
    toggle.setAttribute('aria-pressed', String(follow))
  })
  into.body.append(toggle, list)
  into.show()
  void refresh().finally(() => {
    // Live from here on: the rows already listed are not news.
    list.setAttribute('aria-live', 'polite')
    list.setAttribute('aria-relevant', 'additions')
  })
  setInterval(updateAgo, AGO_EVERY_MS)

  onCommit(commit)
  onConnection(state => {
    connection(state)
    if (state === 'live') void refresh()
  })
}

const CONNECTION: Record<Connection, string> = { live: 'live', reconnecting: 'reconnecting…', offline: 'offline' }

function connection(state: Connection): void {
  section?.setCount(`● ${CONNECTION[state]}`)
  section?.root.setAttribute('data-connection', state)
}

async function refresh(): Promise<void> {
  const ticket = ++fetched
  try {
    const res = await fetch('/activity')
    if (!res.ok) return
    const next = await res.json() as ActivityRow[]
    if (ticket !== fetched) return
    rows = next
    render()
  } catch {
    // Offline: the rows stay as they were until the stream is live again.
  }
}

function commit(changes: NoteChange[]): void {
  // A promote deletes a note and creates it again under the same slug: its
  // node lives on, so the delete does not ghost it.
  const kept = new Set(changes.filter(c => c.op !== 'delete').map(c => c.slug))
  let followed: DrawNode | undefined
  for (const { slug, op } of changes) {
    const pulse = pulses.get(slug)
    if (op === 'delete') {
      if (kept.has(slug)) continue
      if (pulse?.op === 'delete') ghosts.set(slug, { node: pulse.node, start: pulse.start })
    } else {
      ghosts.delete(slug)
    }
    if (pulse) followed = pulse.node
  }

  void refresh()

  if (follow && followed) view?.ease(followed)
  view?.redraw()
}

function render(): void {
  if (!rows.length) {
    items = new Map()
    list.replaceChildren(el('li', { class: 'empty' }, 'No changes yet'))
    return
  }
  const next = new Map<string, HTMLLIElement>()
  for (const row of rows) {
    const key = `${row.slug}\0${row.op}\0${row.timestamp}\0${row.count}\0${row.agent ?? ''}`
    next.set(key, items.get(key) ?? item(row))
  }
  const kept = new Set(next.values())
  for (const child of [...list.children]) if (!kept.has(child as HTMLLIElement)) child.remove()
  // New rows come in at the top: kept items stay where they are.
  let i = 0
  for (const li of next.values()) {
    if (list.children[i] !== li) list.insertBefore(li, list.children[i] ?? null)
    i++
  }
  items = next
  updateAgo()
}

function item({ slug, kind, op, timestamp, name, count, agent }: ActivityRow): HTMLLIElement {
  const when = new Date(timestamp)
  const entry = el('button', { class: 'entry', type: 'button', title: `${VERB[op]} ${slug}${agent ? ` by ${agent}` : ''} · ${when.toLocaleString()}` },
    el('span', { class: `mark ${op}`, 'aria-hidden': 'true' }),
    el('span', { class: 'sr' }, `${VERB[op]} `),
    el('span', { class: 'what' }, name))
  if (count > 1) entry.append(el('span', { class: 'times mono', 'aria-label': `${count} times` }, `×${count}`))
  if (agent) entry.append(el('span', { class: 'agent mono' }, el('span', { class: 'sr' }, 'by '), agent))
  entry.append(el('time', { class: 'ago mono', datetime: timestamp }))
  // A deleted note is gone from the canvas, and a Session is no node to select.
  if (op === 'delete' || kind === 'session') entry.disabled = true
  else entry.addEventListener('click', () => view?.select(slug))
  return el('li', {}, entry)
}

function updateAgo(): void {
  const now = Date.now()
  for (const time of list.querySelectorAll('time')) time.textContent = ago(now - Date.parse(time.dateTime))
}

/** A compact age: now, 5m, 3h, 2d. */
function ago(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`
  return `${Math.floor(minutes / (60 * 24))}d`
}

const TAU = Math.PI * 2

/** onRenderFramePost: each deleted node fading out where it was, its name with it. */
export function drawGhosts(ctx: CanvasRenderingContext2D, scale: number): void {
  if (ghosts.size > 0) {
    const now = performance.now()
    ctx.save()
    ctx.font = state.font
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    for (const [id, { node, start }] of ghosts) {
      const t = (now - start) / GHOST_MS
      if (t >= 1) {
        ghosts.delete(id)
        continue
      }
      const x = node.x ?? 0
      const y = node.y ?? 0
      const radius = node.style.radius
      ctx.globalAlpha = GHOST_ALPHA * (1 - t)
      ctx.fillStyle = node.style.fill
      ctx.beginPath()
      ctx.arc(x, y, radius, 0, TAU)
      ctx.fill()
      ctx.fillStyle = LABEL_COLOR
      ctx.fillText(node.name, x, y + radius + 2 / scale)
    }
    ctx.restore()
  }
  // force-graph stops drawing once its simulation cools: ask for the next
  // frame while a ghost or a pulse is still running.
  if ((ghosts.size > 0 || pulses.size > 0) && view) requestAnimationFrame(view.redraw)
}
