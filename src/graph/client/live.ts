// src/graph/client/live.ts
// Live activity on the page (#258): every `commit` event from `/events`
// reloads the Graph (merged by id, so the layout stays) and pulses the notes
// it touched in the colour of the operation. Pulses are drawn after the frame
// by drawPulses, over the nodes, so drawNode knows nothing about them.
// The stream's state is live, reconnecting or offline (#278): a reconnect
// reloads the Graph, and the browser's Last-Event-ID has the server replay
// the commits made while the page was away.
import type { ChangeOp, CommitEvent, NoteChange } from '../../types.js'
import type { DrawNode } from './state.js'
import { TONE } from './tokens.js'
import { reducedMotion } from './motion.js'

/** How long a pulse lasts, in ms. */
export const PULSE_MS = 1600

export interface Pulse {
  op: ChangeOp
  color: string
  /** performance.now() when it started. */
  start: number
  /** The pulsed node; for a delete, the object last drawn, frozen where it was. */
  node: DrawNode
}

/** The pulses in flight, by node id. drawPulses drops each once it has run. */
export const pulses = new Map<string, Pulse>()

type CommitListener = (changes: NoteChange[]) => void
const listeners: CommitListener[] = []

/** Run `listener` after each commit has been reloaded and pulsed. */
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
    const before = byId(drawn())
    await reload()
    const after = byId(drawn())
    const start = performance.now()
    for (const { slug, op } of changes) {
      // A promote deletes the note under one kind and creates it under
      // another: the node lives on, and the create is its pulse.
      const node = op === 'delete' ? (after.has(slug) ? undefined : before.get(slug)) : after.get(slug)
      if (node) pulses.set(slug, { op, color: TONE[op], start, node })
    }
    for (const listener of listeners) listener(changes)
  }
}

function byId(nodes: DrawNode[]): Map<string, DrawNode> {
  return new Map(nodes.map(n => [n.id, n]))
}

const TAU = Math.PI * 2

/** onRenderFramePost: a fading disc on the node and a ring spreading from it
 * (held at its start under reduced motion). */
export function drawPulses(ctx: CanvasRenderingContext2D, scale: number): void {
  if (pulses.size === 0) return
  const now = performance.now()
  ctx.save()
  for (const [id, { color, start, node }] of pulses) {
    const t = (now - start) / PULSE_MS
    if (t >= 1) {
      pulses.delete(id)
      continue
    }
    const x = node.x ?? 0
    const y = node.y ?? 0
    const radius = node.style.radius
    ctx.globalAlpha = 1 - t
    ctx.fillStyle = color
    ctx.strokeStyle = color
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, TAU)
    ctx.fill()
    ctx.lineWidth = 2 / scale
    ctx.beginPath()
    ctx.arc(x, y, radius + (2 + (reducedMotion() ? 4 : 16 * t)) / scale, 0, TAU)
    ctx.stroke()
  }
  ctx.restore()
}
