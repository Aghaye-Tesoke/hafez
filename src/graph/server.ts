// src/graph/server.ts
// The graph server (#251): the Vault's Graph and the page that draws it,
// served on 127.0.0.1 over node:http. Read-only but for one route: every route
// is a GET except `POST /note/:slug/finish`, which sets a project's status to
// done and is the only path that reaches a write on the Hafez instance. That
// route checks the Origin header as well as the Host: a form POST from any
// other site carries a valid Host header (it is addressed to 127.0.0.1), so
// the Host check alone would let any page the user visits finish a project.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import type { AddressInfo } from 'net'
import { readFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { HafezError, type Hafez } from '../types.js'
import type { InternalHafez } from '../internal.js'
import { GRAPH_LAYERS } from '../contracts.js'
import { readJsonOf } from '../read-json.js'
import { parseSessionLog } from '../document.js'
import { DEFAULT_POLL_MS, startLive } from './live.js'
import { FONT_FILES } from './fonts.js'
import { activity } from './activity.js'
import { withHeat } from './heat/apply.js'
import { scanHeat } from './heat/collect.js'
import { WINDOW_DAYS } from './heat/heat.js'
import { defaultSidecarPath, emptySidecar, readSidecar, writeSidecar, type Sidecar } from './heat/sidecar.js'
import { daysBetween, localDay } from '../dates.js'

/** Where the port search starts when no port is asked for. */
export const DEFAULT_PORT = 4747

export interface GraphServerOpts {
  /** An instance from createInternalHafez (src/internal.ts): the server syncs its index itself. */
  os: InternalHafez
  /** The port to bind; 0 lets the OS pick. Unset: the first free port from DEFAULT_PORT. */
  port?: number
  /** How often to look for Vault changes, in ms (default DEFAULT_POLL_MS). */
  pollMs?: number
  /** Project heat from Claude Code's session transcripts. On by default; `false`
   * leaves the Graph without heat. The collector runs once at start and every
   * `intervalMs` (default 10 minutes). */
  heat?: { transcriptRoot?: string; sidecarPath?: string; intervalMs?: number } | false
}

export interface GraphServer {
  url: string
  /** Run the heat collector now, rebuild the Graph and tell open pages. Runs
   * never overlap; a collector failure is swallowed and the Graph stays as it was. */
  collect(): Promise<void>
  /** Stop the server, drop open connections and close the Hafez instance's index. */
  close(): Promise<void>
}

/** The esbuild bundle of src/graph/client/. From src/graph (tests) and from
 * dist/graph (installed) alike, `../../dist/graph` is the build output. */
const BUILD_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'graph')
const BUNDLE_PATH = join(BUILD_DIR, 'client.js')

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hafez graph</title>
<link rel="icon" href="data:,">
</head>
<body>
<script src="/client.js"></script>
</body>
</html>
`

/** How often the heat collector runs, in ms. */
const HEAT_INTERVAL_MS = 600_000

/** Each entity's commit days within the heat window, from the whole history. */
async function touchDays(os: Hafez, today: string): Promise<Map<string, string[]>> {
  const touches = new Map<string, string[]>()
  for (const e of await os.changelog('', 400)) {
    if (e.kind !== 'entity') continue
    const day = localDay(new Date(e.timestamp))
    if (daysBetween(day, today) > WINDOW_DAYS) continue
    const days = touches.get(e.slug)
    if (days) days.push(day)
    else touches.set(e.slug, [day])
  }
  return touches
}

interface Body { type: string; body: string | Buffer }

export async function startGraphServer({ os, port, pollMs = DEFAULT_POLL_MS, heat }: GraphServerOpts): Promise<GraphServer> {
  // Every layer: the page holds them all and toggles them locally (#257).
  let graphJson = ''
  /** Each node's name by id, for `/activity`'s rows. */
  let names = new Map<string, string>()
  /** `/activity`'s body, read on first request after each rebuild. */
  let activityJson: Promise<string> | undefined
  // The server trusts its poll (#264, #271): the index syncs here, at start and
  // on each commit the poll sees, never per request. On an instance whose
  // indexSync is 'manual', `/note` then reads the index as the Graph drew it.
  const heatOpts = heat === false ? undefined : heat ?? {}
  const transcriptRoot = heatOpts?.transcriptRoot ?? join(homedir(), '.claude', 'projects')
  const sidecarPath = heatOpts?.sidecarPath ?? defaultSidecarPath()
  // The last collection's hours; until this run's finishes, what the previous run left on disk.
  let sidecar: Sidecar = heatOpts ? readSidecar(sidecarPath) : emptySidecar()
  /** Refreshes the cached Graph; true when it differs from the one it replaced. */
  const rebuild = async (): Promise<boolean> => {
    await os.syncIndex()
    let graph = await os.graph({ layers: [...GRAPH_LAYERS] })
    if (heatOpts) {
      const today = localDay()
      graph = withHeat(graph, sidecar, await touchDays(os, today), today)
    }
    const next = JSON.stringify(graph)
    const changed = next !== graphJson
    graphJson = next
    names = new Map(graph.nodes.map(n => [n.id, n.name]))
    activityJson = undefined
    return changed
  }
  const live = await startLive(os, pollMs, rebuild)
  await rebuild().catch(async err => { await live.stop(); throw err })
  let bundle: string | undefined

  // One entry per fixed GET route; a route is added here and nowhere else, but
  // for the four matched before the record: the `/events` stream, `/activity`
  // (built asynchronously), and the `/note/` and `/fonts/` prefixes.
  const routes: Record<string, () => Body> = {
    '/': () => ({ type: 'text/html', body: PAGE }),
    '/client.js': () => ({ type: 'text/javascript', body: bundle ??= readFileSync(BUNDLE_PATH, 'utf-8') }),
    '/graph': () => ({ type: 'application/json', body: graphJson }),
  }

  // A page on any other origin can reach 127.0.0.1 too; checking the Host
  // header is what keeps DNS rebinding from reading the Vault through it.
  let allowedHosts = new Set<string>()
  // The one write is a POST, which a page on another origin can send as a form
  // without reading the reply; only the page this server serves may.
  let allowedOrigins = new Set<string>()
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (!allowedHosts.has(req.headers.host ?? '')) return send(res, 403, { type: 'text/plain', body: 'Forbidden' })
    const path = new URL(req.url ?? '/', 'http://localhost').pathname
    if (isFinishPath(path)) {
      // The finish path answers POST alone: Allow names the one method it takes.
      if (req.method !== 'POST') return send(res, 405, { type: 'text/plain', body: 'Method Not Allowed' }, { Allow: 'POST' })
      if (!allowedOrigins.has(req.headers.origin ?? '')) return send(res, 403, { type: 'text/plain', body: 'Forbidden' })
      return void sendFinish(os, res, path.slice(NOTE_PREFIX.length, -FINISH_SUFFIX.length))
    }
    if (req.method !== 'GET') return send(res, 405, { type: 'text/plain', body: 'Method Not Allowed' }, { Allow: 'GET' })
    if (path === '/events') return live.subscribe(req, res)
    if (path === '/activity') return void sendActivity(res)
    if (path.startsWith(NOTE_PREFIX)) return void sendNote(os, res, path.slice(NOTE_PREFIX.length))
    if (path.startsWith(FONT_PREFIX)) return sendFont(res, path.slice(FONT_PREFIX.length))
    const route = routes[path]
    if (!route) return send(res, 404, { type: 'text/plain', body: 'Not Found' })
    try {
      send(res, 200, route())
    } catch (err) {
      send(res, 500, { type: 'text/plain', body: (err as Error).message })
    }
  })

  async function sendActivity(res: ServerResponse): Promise<void> {
    const body = activityJson ??= activity(os, names).then(rows => JSON.stringify(rows))
    try {
      send(res, 200, { type: 'application/json', body: await body })
    } catch (err) {
      if (activityJson === body) activityJson = undefined // the next request tries again
      send(res, 500, { type: 'text/plain', body: (err as Error).message })
    }
  }

  const bound = await (port === undefined ? listenFirstFree(server, DEFAULT_PORT) : listen(server, port))
    .catch(async err => { await live.stop(); throw err })
  allowedHosts = new Set([`127.0.0.1:${bound}`, `localhost:${bound}`])
  allowedOrigins = new Set([...allowedHosts].map(h => `http://${h}`))

  // Collections run one at a time, in order, as live.ts runs its polls.
  let chain: Promise<void> = Promise.resolve()
  let stopped = false
  const collect = (): Promise<void> => {
    if (!heatOpts) return Promise.resolve()
    return chain = chain.then(async () => {
      if (stopped) return
      try {
        sidecar = await scanHeat(os, { transcriptRoot, sidecarPath })
        try {
          writeSidecar(sidecarPath, sidecar)
        } catch (err) {
          // The hours are in memory and the Graph uses them; only the cache is lost.
          console.error(`hafez graph: could not write hours.json (${(err as NodeJS.ErrnoException).code ?? (err as Error).message})`)
        }
        await live.rebuildAndBroadcast()
      } catch {
        // The collector or the rebuild failed: the Graph stays as it was and
        // the next run tries again.
      }
    })
  }
  let timer: NodeJS.Timeout | undefined
  if (heatOpts) {
    void collect()
    timer = setInterval(() => { void collect() }, heatOpts.intervalMs ?? HEAT_INTERVAL_MS)
    timer.unref()
  }

  return {
    url: `http://127.0.0.1:${bound}`,
    collect,
    close: async () => {
      stopped = true
      clearInterval(timer)
      await chain
      await live.stop()
      await new Promise<void>(resolve => {
        server.close(() => resolve())
        server.closeAllConnections()
      })
      os.close()
    },
  }
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => reject(err)
    server.once('error', onError)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', onError)
      resolve((server.address() as AddressInfo).port)
    })
  })
}

async function listenFirstFree(server: Server, from: number): Promise<number> {
  for (let port = from; ; port++) {
    try {
      return await listen(server, port)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE' || port >= 65535) throw err
    }
  }
}

const NOTE_PREFIX = '/note/'

/** How many Session Log entries `/note` gives an entity. */
const LOG_SHOWN = 5

/** `/note/:slug`: `read --json` at summary depth; an entity's adds `log`, its
 * Session Log's last LOG_SHOWN entries newest first (#271). A slug with no
 * note, or one that cannot name a note at all, is 404 with the closest slugs,
 * as a `read --json` miss prints them. */
async function sendNote(os: Hafez, res: ServerResponse, encoded: string): Promise<void> {
  let slug = encoded
  try {
    slug = decodeURIComponent(encoded)
    send(res, 200, { type: 'application/json', body: JSON.stringify(await noteJson(os, slug)) })
  } catch (err) {
    sendMiss(res, slug, err)
  }
}

/** A slug with no note, or one that cannot name a note at all, is 404 with the
 * closest slugs; any other failure is 500. */
function sendMiss(res: ServerResponse, slug: string, err: unknown): void {
  const miss = err instanceof URIError || (err instanceof HafezError && (err.code === 'NOT_FOUND' || err.code === 'VALIDATION_FAILED'))
  if (!miss) return send(res, 500, { type: 'text/plain', body: (err as Error).message })
  const closest = err instanceof HafezError && err.code === 'NOT_FOUND' ? err.details ?? [] : []
  send(res, 404, { type: 'application/json', body: JSON.stringify({ slug, closest }) })
}

const FINISH_SUFFIX = '/finish'

/** `/note/<slug>/finish`, and no other path: one non-empty slug segment, then
 * `/finish`. The prefix and suffix may not share their slash, so `/note/finish`
 * (the note slugged finish) is not a finish path. */
function isFinishPath(path: string): boolean {
  if (!path.startsWith(NOTE_PREFIX) || !path.endsWith(FINISH_SUFFIX)) return false
  if (path.length <= NOTE_PREFIX.length + FINISH_SUFFIX.length) return false
  return !path.slice(NOTE_PREFIX.length, -FINISH_SUFFIX.length).includes('/')
}

/** `POST /note/:slug/finish`: the project's status becomes done. Only a
 * project can finish: any other note is 409 and nothing is written. Finishing a
 * done project succeeds again and writes nothing (no commit, no log entry). A
 * miss is 404 with the closest slugs, as for `/note`; the live poll sees the
 * commit, so no rebuild here. The Session Log entry names the agent
 * `hafez-graph`. */
async function sendFinish(os: Hafez, res: ServerResponse, encoded: string): Promise<void> {
  let slug = encoded
  try {
    slug = decodeURIComponent(encoded)
    const note = await os.read(slug, 'summary')
    if (note.kind !== 'entity' || note.frontmatter.type !== 'project') {
      return send(res, 409, { type: 'application/json', body: JSON.stringify({ slug, error: 'not a project' }) })
    }
    if (note.frontmatter.status !== 'done') await os.update(slug, { status: 'done', agent: 'hafez-graph' })
    send(res, 200, { type: 'application/json', body: JSON.stringify({ slug, status: 'done' }) })
  } catch (err) {
    sendMiss(res, slug, err)
  }
}

async function noteJson(os: Hafez, slug: string): Promise<object> {
  const summary = await os.read(slug, 'summary')
  if (summary.kind !== 'entity') return readJsonOf(os, slug, 'summary', summary)
  // The whole entity, read once: readJsonOf's Footer and pointers, and the log.
  const whole = await os.read(slug, 'full')
  const log = parseSessionLog(whole.body).slice(0, LOG_SHOWN)
  return { ...await readJsonOf(os, slug, 'summary', summary, whole), log }
}

const FONT_PREFIX = '/fonts/'
/** Read once each, on first request. */
const fontCache = new Map<string, Buffer>()

/** `/fonts/:file`: a bundled font or its licence, by the fixed list in fonts.ts
 * and nothing else. The name is matched as given, never joined to a path. */
function sendFont(res: ServerResponse, file: string): void {
  if (!FONT_FILES.has(file)) return send(res, 404, { type: 'text/plain', body: 'Not Found' })
  try {
    let body = fontCache.get(file)
    if (!body) fontCache.set(file, body = readFileSync(join(BUILD_DIR, 'fonts', file)))
    const type = file.endsWith('.woff2') ? 'font/woff2' : 'text/plain'
    send(res, 200, { type, body }, { 'Cache-Control': 'max-age=86400' })
  } catch (err) {
    send(res, 500, { type: 'text/plain', body: (err as Error).message })
  }
}

function send(res: ServerResponse, status: number, { type, body }: Body, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': type.startsWith('font/') ? type : `${type}; charset=utf-8`, ...headers })
  res.end(body)
}
