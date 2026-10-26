// src/graph/client/live.ts
// Live activity on the page (#258): every `commit` event from `/events`
// reloads the Graph (merged by id, so the sky stays put) and flares the
// bodies it touched: for 1.6 s each one burns brighter, every colour in its
// group lifted and eased back (tickFlares, from the page's render loop), so
// the one bloom pass makes it glow. A deleted note has no body left to flare.
// The stream's state is live, reconnecting or offline (#278): a reconnect
// reloads the Graph, and the browser's Last-Event-ID has the server replay
// the commits made while the page was away.
import type { Color, Material, Object3D } from 'three'
import type { CommitEvent, NoteChange } from '../../types.js'
import type { DrawNode } from './state.js'

/** How long a flare lasts, in ms. */
export const FLARE_MS = 1600
/** At its start a flare lifts every colour of the body by this share. */
const FLARE_BOOST = 1.5

/** The bodies flaring now: when each began, and every coloured material's own colour. */
const flares = new Map<DrawNode, { start: number; base: Map<Material & { color: Color }, Color> }>()

/** Start a flare on a node's body; a flare already running starts over. */
export function flare(node: DrawNode, now = performance.now()): void {
  const group = node.group
  if (!group) return
  const running = flares.get(node)
  if (running) restore(running.base)
  const base = new Map<Material & { color: Color }, Color>()
  group.traverse((o: Object3D) => {
    const material = (o as Object3D & { material?: Material | Material[] }).material
    for (const m of Array.isArray(material) ? material : material ? [material] : []) {
      const coloured = m as Material & { color?: Color }
      if (coloured.color && !base.has(coloured as Material & { color: Color })) base.set(coloured as Material & { color: Color }, coloured.color.clone())
    }
  })
  flares.set(node, { start: now, base })
}

/** The render loop's step: each flare eased back towards its body's own colours, and dropped once run. */
export function tickFlares(now: number): void {
  for (const [node, { start, base }] of flares) {
    const t = (now - start) / FLARE_MS
    if (t >= 1 || !node.group) {
      restore(base)
      flares.delete(node)
      continue
    }
    const k = 1 + FLARE_BOOST * (1 - t)
    for (const [m, c] of base) m.color.copy(c).multiplyScalar(k)
  }
}

function restore(base: Map<Material & { color: Color }, Color>): void {
  for (const [m, c] of base) m.color.copy(c)
}

/** A commit's changes, and the drawn nodes it flared, by id. */
type CommitListener = (changes: NoteChange[], flared: Map<string, DrawNode>) => void
const listeners: CommitListener[] = []

/** Run `listener` after each commit has been reloaded and flared. */
export function onCommit(listener: CommitListener): void {
  listeners.push(listener)
}

export type Connection = 'live' | 'reconnecting' | 'offline'
/** How long a dropped stream may stay reconnecting before the page says offline, in ms. */
const OFFLINE_MS = 5000
/** How soon a stream the browser gave up on is opened again, in ms. */
const RETRY_MS = 3000

type ConnectionListener = (state: Connection) => void
const connectionListeners: ConnectionListener[] = []

/** Run `listener` on each change of the stream's state, a reconnect's reload done. */
export function onConnection(listener: ConnectionListener): void {
  connectionListeners.push(listener)
}

/** Follow `/events`. `drawn` gives the nodes on screen now; `reload` refetches
 * the Graph and shows it. Events and reconnects are handled one at a time, in order. */
export function followCommits(drawn: () => DrawNode[], reload: () => Promise<void>): void {
  let queue = Promise.resolve()
  const then = (task: () => Promise<void>) => { queue = queue.then(task).catch(err => console.error(err)) }
  let state: Connection | null = null
  let offline: ReturnType<typeof setTimeout> | undefined
  const set = (next: Connection) => {
    state = next
    for (const listener of connectionListeners) listener(next)
  }

  function connect(): void {
    const source = new EventSource('/events')
    source.addEventListener('open', () => {
      clearTimeout(offline)
      const reconnect = state !== null
      // What changed while away is on the server now: draw it before saying live.
      then(async () => {
        if (reconnect) await reload()
        set('live')
      })
    })
    source.addEventListener('error', () => {
      // The browser retries on its own while CONNECTING; CLOSED means it gave up.
      if (source.readyState === EventSource.CLOSED) {
        clearTimeout(offline)
        set('offline')
        setTimeout(connect, RETRY_MS)
        return
      }
      if (state === 'reconnecting' || state === 'offline') return
      set('reconnecting')
      offline = setTimeout(() => set('offline'), OFFLINE_MS)
    })
    source.addEventListener('message', (e: MessageEvent<string>) => {
      const event = JSON.parse(e.data) as CommitEvent
      if (event.type !== 'commit') return
      then(() => commit(event.changes))
    })
  }
  connect()

  async function commit(changes: NoteChange[]): Promise<void> {
    await reload()
    const after = byId(drawn())
    const start = performance.now()
    const flared = new Map<string, DrawNode>()
    for (const { slug, op } of changes) {
      // A promote deletes the note under one kind and creates it under
      // another: the node lives on, and the create is its flare.
      const node = op === 'delete' ? undefined : after.get(slug)
      if (!node || flared.has(slug)) continue
      flare(node, start)
      flared.set(slug, node)
    }
    for (const listener of listeners) listener(changes, flared)
  }
}

function byId(nodes: DrawNode[]): Map<string, DrawNode> {
  return new Map(nodes.map(n => [n.id, n]))
}
