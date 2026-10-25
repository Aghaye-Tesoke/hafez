// src/graph/live.ts
// The graph server's live activity (#258): poll the Vault's history with
// changesSince and, when a write landed, rebuild the cached Graph and push one
// `commit` event to every open `/events` stream. Polling, not fs.watch: watch
// events are unreliable on drvfs (a Vault under /mnt/c), and history sees
// every writer — this process, another session, a sync pull.
//
// Each event carries its cursor as its SSE id, and a stream opens with the
// cursor it starts from (#278), so a browser reconnecting sends it back as
// `Last-Event-ID` and is replayed what changed while it was away.
import type { IncomingMessage, ServerResponse } from 'http'
import type { ChangesSince, CommitEvent, Hafez } from '../types.js'

/** How often the Vault's history is checked when no interval is given, in ms. */
export const DEFAULT_POLL_MS = 2000

export interface Live {
  /** Hold `res` open as an SSE stream until the client goes away; a
   * `Last-Event-ID` on `req` is replayed the changes since it first. */
  subscribe(req: IncomingMessage, res: ServerResponse): void
  /** Rebuild the cached Graph, then push one commit event naming no note to
   * every open stream: the Graph changed for a reason history does not record
   * (a heat collection), so pages refetch it. Queued with the polls, so it
   * never overlaps their rebuilds. A rebuild failure rejects and sends nothing. */
  rebuildAndBroadcast(): Promise<void>
  /** Stop polling and wait out a poll in flight, so nothing touches the Hafez
   * instance afterwards (its index is closed next). */
  stop(): Promise<void>
}

/** Start following the Vault from its current cursor; `rebuild` refreshes the
 * cached Graph before an event goes out, so a client refetching on the event
 * reads the new one. */
export async function startLive(os: Hafez, pollMs: number, rebuild: () => Promise<void>): Promise<Live> {
  const clients = new Set<ServerResponse>()
  let cursor: string | undefined = (await os.changesSince()).cursor
  let stopped = false
  /** Polls and replays run one at a time, in order. */
  let chain: Promise<void> = Promise.resolve()
  // The chain itself never rejects, so one task's failure cannot stop the ones
  // queued after it, nor stop() awaiting it; the caller gets the task's own result.
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = chain.then(task)
    chain = run.then(() => undefined, () => undefined)
    return run
  }
  let timer: NodeJS.Timeout | undefined

  async function poll(): Promise<void> {
    let found: ChangesSince
    try {
      found = await os.changesSince(cursor)
      if (found.changes.length === 0) {
        cursor = found.cursor
        return
      }
    } catch {
      // A cursor history no longer knows (rewritten), or a transient read
      // failure. Follow from where history is now: what changed in between is
      // unknown, so a moved cursor goes out as a commit naming no note, and
      // the page refetches the Graph on it as on any commit.
      try {
        found = { ...await os.changesSince(), changes: [] }
      } catch {
        return // the cursor stays: the next poll asks again
      }
      if (found.cursor === cursor) return
    }
    if (stopped) return
    try {
      await rebuild()
    } catch {
      // The cursor stays where it was: the next poll finds these changes again.
      return
    }
    const frame = commitFrame(found)
    for (const res of clients) res.write(frame)
    cursor = found.cursor
  }

  /** What changed since `lastId`, to one stream. A cursor history no longer
   * knows replays nothing: the page refetches the Graph on reconnect anyway.
   * A change the next poll also finds reaches this stream twice, which the
   * page takes as one more refetch. */
  async function replay(res: ServerResponse, lastId: string): Promise<void> {
    let found: ChangesSince
    try {
      found = await os.changesSince(lastId)
    } catch {
      found = { cursor: cursor ?? '', changes: [] }
    }
    if (!res.writableEnded) res.write(found.changes.length > 0 ? commitFrame(found) : idFrame(found.cursor))
  }

  function schedule(): void {
    if (stopped) return
    timer = setTimeout(() => { void serial(poll).finally(schedule) }, pollMs)
    timer.unref()
  }
  schedule()

  return {
    subscribe(req, res) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
      res.write(': live\n\n')
      const lastId = req.headers['last-event-id']
      if (typeof lastId === 'string' && lastId !== cursor && !stopped) void serial(() => replay(res, lastId))
      else res.write(idFrame(cursor ?? ''))
      clients.add(res)
      res.on('close', () => clients.delete(res))
    },
    rebuildAndBroadcast: () => serial(async () => {
      if (stopped) return
      await rebuild()
      const frame = commitFrame({ cursor: cursor ?? '', changes: [] })
      for (const res of clients) res.write(frame)
    }),
    async stop() {
      stopped = true
      clearTimeout(timer)
      await chain
    },
  }
}

/** An event with an id and no data: it sets the browser's last event id and dispatches nothing. */
function idFrame(cursor: string): string {
  return `id: ${cursor}\n\n`
}

function commitFrame({ cursor, changes }: ChangesSince): string {
  const event: CommitEvent = { type: 'commit', changes }
  return `id: ${cursor}\ndata: ${JSON.stringify(event)}\n\n`
}
