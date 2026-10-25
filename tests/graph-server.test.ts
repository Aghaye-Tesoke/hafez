// tests/graph-server.test.ts
// The graph server's HTTP surface (#254): started on port 0 against a
// real-git temp Vault and driven over HTTP, as a browser would drive it.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { request } from 'http'
import { createServer as createNetServer, type AddressInfo } from 'net'
import { spawn, spawnSync, type ChildProcess } from 'child_process'
import { simpleGit } from 'simple-git'
import { createInternalHafez, removeTemp } from './helpers/hafez.js'
import { startGraphServer, type GraphServer } from '../src/graph/server.js'
import { stylesheet } from '../src/graph/client/stylesheet.js'
import type { ChangelogEntry, GraphOpts } from '../src/types.js'
import type { InternalHafez } from '../src/internal.js'
import { localDay } from '../src/dates.js'

const TMP = join(tmpdir(), 'hafez-test-graph-server-' + Date.now())
const VAULT = join(TMP, 'vault')

let os: InternalHafez
let server: GraphServer

interface Reply { status: number; type: string | undefined; body: string }

/** A request through node:http on a fresh connection, so the Host header is ours to set. */
function get(url: string, host?: string, method = 'GET'): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method, agent: false, headers: host ? { Host: host } : {} }, res => {
      let body = ''
      res.setEncoding('utf-8')
      res.on('data', chunk => { body += chunk })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, type: res.headers['content-type'], body }))
    })
    req.on('error', reject)
    req.end()
  })
}

beforeAll(async () => {
  mkdirSync(join(VAULT, 'entities'), { recursive: true })
  mkdirSync(join(VAULT, 'knowledge'), { recursive: true })
  const git = simpleGit(VAULT)
  await git.init()
  writeFileSync(join(VAULT, '.gitkeep'), '')
  await git.add('.gitkeep')
  await git.commit('init')
  os = createInternalHafez({ vaultPath: VAULT, git: { push: false } })
  await os.create('entity', 'Hub', { type: 'project', tags: ['infra'], domain: ['engineering'], brief: 'Where the hub stands', add_action: 'Ship the panel' })
  await os.create('entity', 'Worker', { type: 'entity', parent: 'hub' })
  await os.create('knowledge', 'An Insight', { related: ['hub'] })
  await os.batch([{ op: 'create', kind: 'session', name: 'Standup', fields: { related: ['worker'] } }])
  server = await startGraphServer({ os, port: 0, heat: false })
})
afterAll(async () => {
  await server?.close()
  removeTemp(TMP)
})

const ALL_LAYERS: GraphOpts = { layers: ['tag', 'domain', 'session'] }

describe('GET /graph', () => {
  it('serves the Graph with every layer as JSON: the page toggles them itself (#257)', async () => {
    const res = await get(`${server.url}/graph`)
    expect(res.status).toBe(200)
    expect(res.type).toMatch(/^application\/json/)
    const graph = JSON.parse(res.body)
    expect(graph.nodes).toEqual(expect.arrayContaining([
      { id: 'tag:infra', kind: 'tag', name: 'infra' },
      { id: 'domain:engineering', kind: 'domain', name: 'engineering' },
      expect.objectContaining({ id: 'standup', kind: 'session', name: 'Standup' }),
    ]))
    expect(graph.edges).toEqual(expect.arrayContaining([
      { source: 'hub', target: 'tag:infra', relation: 'tag' },
      { source: 'hub', target: 'domain:engineering', relation: 'domain' },
      { source: 'standup', target: 'worker', relation: 'related' },
    ]))
  })
})

describe('GET /', () => {
  it('serves the page, which loads the client bundle', async () => {
    const res = await get(`${server.url}/`)
    expect(res.status).toBe(200)
    expect(res.type).toMatch(/^text\/html/)
    expect(res.body).toContain('<script src="/client.js"></script>')
  })

  it('the client bundle is in the build output and served as JavaScript', async () => {
    const res = await get(`${server.url}/client.js`)
    expect(res.status).toBe(200)
    expect(res.type).toMatch(/^text\/javascript/)
    expect(res.body.length).toBeGreaterThan(1000)
  })
})

describe('GET /note/:slug', () => {
  const CLI = join(process.cwd(), 'dist', 'cli.js')
  /** What `hafez read <slug> --json` prints: the shape the panel is fed. */
  const readJson = (slug: string) =>
    JSON.parse(spawnSync('node', [CLI, '--vault', VAULT, 'read', slug, '--json'], { encoding: 'utf-8' }).stdout)

  it('serves an entity as read --json gives it at summary depth, plus its log', async () => {
    const res = await get(`${server.url}/note/hub`)
    expect(res.status).toBe(200)
    expect(res.type).toMatch(/^application\/json/)
    const { log, ...note } = JSON.parse(res.body)
    expect(note).toEqual(readJson('hub'))
    expect(log).toEqual([])
    expect(note).toMatchObject({ kind: 'entity', frontmatter: { name: 'Hub', type: 'project' }, children: [{ slug: 'worker' }] })
    expect(note.body).toContain('Where the hub stands')
    expect(note.actions).toMatchObject([{ text: 'Ship the panel', stale: false }])
  })

  it('reads the entity whole once for the note and its log', async () => {
    const reads: string[] = []
    const counting: InternalHafez = { ...os, read: (slug, depth) => { reads.push(`${slug} ${depth ?? 'full'}`); return os.read(slug, depth) } }
    const own = await startGraphServer({ os: counting, port: 0, heat: false })
    try {
      expect((await get(`${own.url}/note/hub`)).status).toBe(200)
    } finally {
      await own.close()
    }
    expect(reads.filter(r => r === 'hub full')).toHaveLength(1)
  })

  it("an entity's log is its Session Log's last 5 entries, newest first: date, agent, type, summary", async () => {
    await os.create('entity', 'Logged', { type: 'entity' })
    for (let step = 1; step <= 6; step++) {
      await os.update('logged', { session_log: { type: step === 6 ? 'decision' : 'progress', summary: `Step ${step}`, agent: 'tester', body: 'detail' } })
    }
    const { log } = JSON.parse((await get(`${server.url}/note/logged`)).body)
    expect(log).toEqual([6, 5, 4, 3, 2].map(step => ({
      date: localDay(), agent: 'tester', type: step === 6 ? 'decision' : 'progress', summary: `Step ${step}`,
    })))
  })

  it('follows the poll, not the files: a hand-made child shows once its commit is seen, as read --json then gives it', async () => {
    // A server on an instance whose reads trust the index, as `hafez graph` runs it.
    const watcher = createInternalHafez({ vaultPath: VAULT, git: { push: false }, indexSync: 'manual' })
    const live = await startGraphServer({ os: watcher, port: 0, heat: false, pollMs: 25 })
    const events = subscribe(`${live.url}/events`)
    const childrenOf = (note: { children: Array<{ slug: string }> }) => note.children.map(c => c.slug)
    try {
      await events.ready
      // Written outside hafez: no hafez process has indexed it.
      writeFileSync(join(VAULT, 'entities', 'outsider.md'),
        `---\nname: Outsider\ntype: entity\nstatus: active\ncreated: ${localDay()}\nlast-touched: ${localDay()}\nparent: hub\n---\n`)
      // The panel is as fresh as the Graph it is drawn on.
      expect(childrenOf(JSON.parse((await get(`${live.url}/note/hub`)).body))).not.toContain('outsider')
      expect(JSON.parse((await get(`${live.url}/graph`)).body).nodes.map((n: { id: string }) => n.id)).not.toContain('outsider')

      const git = simpleGit(VAULT)
      await git.add('entities/outsider.md')
      await git.commit('outsider, by hand')
      expect(await events.next()).toEqual({ type: 'commit', changes: [{ slug: 'outsider', kind: 'entity', op: 'create' }] })
      const { log, ...note } = JSON.parse((await get(`${live.url}/note/hub`)).body)
      expect(childrenOf(note)).toContain('outsider')
      expect(note).toEqual(readJson('hub'))
      expect(log).toEqual([])
    } finally {
      events.close()
      await live.close()
    }
  })

  it('serves a knowledge note as read --json gives it, with no log', async () => {
    const res = await get(`${server.url}/note/an-insight`)
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual(readJson('an-insight'))
  })

  it('a slug with no note is 404 with the closest slugs, as read --json misses', async () => {
    const res = await get(`${server.url}/note/hub-notes`)
    expect(res.status).toBe(404)
    expect(res.type).toMatch(/^application\/json/)
    expect(JSON.parse(res.body)).toMatchObject({ slug: 'hub-notes', closest: expect.arrayContaining(['hub']) })
  })

  it('a slug that cannot name a note is 404 too', async () => {
    expect((await get(`${server.url}/note/tag:infra`)).status).toBe(404)
    expect((await get(`${server.url}/note/..%2Fsecret`)).status).toBe(404)
  })
})

describe('GET /activity (#278)', () => {
  it('lists the newest note changes first by name, consecutive writes to one note as one row with a count, and the agent its Session Log records that day', async () => {
    // Written by hand: its newest Session Log entry is from another day.
    writeFileSync(join(VAULT, 'entities', 'old-logger.md'),
      `---\nname: Old Logger\ntype: entity\nstatus: active\ncreated: ${localDay()}\nlast-touched: ${localDay()}\n---\n\n## Session Log\n\n### 2020-01-01 — old-agent [progress]\nSummary: long ago\n`)
    // An archive log is no note: it is never a row.
    mkdirSync(join(VAULT, 'entities', 'archive'), { recursive: true })
    writeFileSync(join(VAULT, 'entities', 'archive', 'old-logger-log.md'), '### 2019-12-31 — old-agent [progress]\nSummary: longer ago\n')
    const git = simpleGit(VAULT)
    await git.add(['entities/old-logger.md', 'entities/archive/old-logger-log.md'])
    await git.commit('old-logger, by hand')
    await os.create('entity', 'Busy Bee', { type: 'entity' })
    await os.update('busy-bee', { session_log: { type: 'progress', summary: 'Started', agent: 'bee-agent' } })
    await os.update('busy-bee', { brief: 'Buzzing', agent: 'bee-agent' })
    await os.create('knowledge', 'Fresh Insight', {})

    const watcher = createInternalHafez({ vaultPath: VAULT, git: { push: false }, indexSync: 'manual' })
    const live = await startGraphServer({ os: watcher, port: 0, heat: false })
    try {
      const res = await get(`${live.url}/activity`)
      expect(res.status).toBe(200)
      expect(res.type).toMatch(/^application\/json/)
      const rows = JSON.parse(res.body)
      expect(rows.slice(0, 3)).toEqual([
        { slug: 'fresh-insight', kind: 'knowledge', op: 'create', name: 'Fresh Insight', count: 1, timestamp: expect.any(String) },
        { slug: 'busy-bee', kind: 'entity', op: 'update', name: 'Busy Bee', count: 3, agent: 'bee-agent', timestamp: expect.any(String) },
        { slug: 'old-logger', kind: 'entity', op: 'create', name: 'Old Logger', count: 1, timestamp: expect.any(String) },
      ])
      expect(rows[2]).not.toHaveProperty('agent')
      const times = rows.slice(0, 3).map((r: { timestamp: string }) => Date.parse(r.timestamp))
      expect(times.every((t: number) => Math.abs(Date.now() - t) < 120000)).toBe(true)
      expect([...times].sort((a, b) => b - a)).toEqual(times)
    } finally {
      await live.close()
    }
  })

  it('lists the last 20 rows', async () => {
    await os.batch(Array.from({ length: 25 }, (_, i) => ({ op: 'create' as const, kind: 'knowledge' as const, name: `Batch Note ${i}` })))
    const live = await startGraphServer({ os: createInternalHafez({ vaultPath: VAULT, git: { push: false } }), port: 0, heat: false })
    try {
      const rows = JSON.parse((await get(`${live.url}/activity`)).body)
      expect(rows).toHaveLength(20)
      expect(rows.every((r: { slug: string; op: string }) => r.slug.startsWith('batch-note-') && r.op === 'create')).toBe(true)
    } finally {
      await live.close()
    }
  })

  it('reads further back while the newest commits collapse into fewer than 20 rows (A2)', async () => {
    // History, newest first: 60 commits each updating one note, then 25 creates.
    const day = '2026-10-01T12:00:00+00:00'
    const commits: ChangelogEntry[][] = [
      ...Array.from({ length: 60 }, (_, i) => [{ slug: 'busy', kind: 'knowledge' as const, operation: 'updated' as const, timestamp: day, commit_message: `update ${i}`, commit: `u${i}` }]),
      ...Array.from({ length: 25 }, (_, i) => [{ slug: `older-${i}`, kind: 'knowledge' as const, operation: 'created' as const, timestamp: day, commit_message: `create ${i}`, commit: `c${i}` }]),
    ]
    const own = createInternalHafez({ vaultPath: VAULT, git: { push: false } })
    const history: InternalHafez = { ...own, changelog: async (_since, limit) => commits.slice(0, limit).flat() }
    const live = await startGraphServer({ os: history, port: 0, heat: false })
    try {
      const rows = JSON.parse((await get(`${live.url}/activity`)).body) as Array<{ slug: string; count: number }>
      expect(rows.map(r => r.slug)).toEqual(['busy', ...Array.from({ length: 19 }, (_, i) => `older-${i}`)])
      expect(rows[0].count).toBe(60)
    } finally {
      await live.close()
    }
  })

  it('stops at the history\'s end with fewer than 20 rows, in one read: fewer commits came back than were asked for', async () => {
    const day = '2026-10-01T12:00:00+00:00'
    const commits = Array.from({ length: 3 }, (_, i) => [{ slug: `only-${i}`, kind: 'knowledge' as const, operation: 'created' as const, timestamp: day, commit_message: `create ${i}`, commit: `c${i}` }])
    const own = createInternalHafez({ vaultPath: VAULT, git: { push: false } })
    const reads: number[] = []
    const history: InternalHafez = { ...own, changelog: async (_since, limit) => { reads.push(limit!); return commits.slice(0, limit).flat() } }
    const live = await startGraphServer({ os: history, port: 0, heat: false })
    try {
      const rows = JSON.parse((await get(`${live.url}/activity`)).body) as Array<{ slug: string }>
      expect(rows.map(r => r.slug)).toEqual(['only-0', 'only-1', 'only-2'])
      expect(reads).toEqual([50])
    } finally {
      await live.close()
    }
  })

  it('tells a promote (a delete and a create in one commit) from a delete and a create in two commits of one second and message', async () => {
    const day = '2026-10-01T12:00:00+00:00'
    const entry = (operation: 'created' | 'deleted', kind: 'entity' | 'knowledge', commit: string): ChangelogEntry =>
      ({ slug: 'twice', kind, operation, timestamp: day, commit_message: 'batch', commit })
    // Newest first: a promote in commit `p`, then, older, a create and a delete in two commits.
    const commits: ChangelogEntry[][] = [[entry('created', 'knowledge', 'p'), entry('deleted', 'entity', 'p')], [entry('created', 'entity', 'b')], [entry('deleted', 'entity', 'a')]]
    const own = createInternalHafez({ vaultPath: VAULT, git: { push: false } })
    const history: InternalHafez = { ...own, changelog: async (_since, limit) => commits.slice(0, limit).flat() }
    const live = await startGraphServer({ os: history, port: 0, heat: false })
    try {
      const rows = JSON.parse((await get(`${live.url}/activity`)).body) as Array<{ slug: string; kind: string; op: string; count: number }>
      expect(rows.map(r => [r.op, r.kind, r.count])).toEqual([['create', 'knowledge', 3]])
    } finally {
      await live.close()
    }
  })
})

describe('GET /fonts/:file (#272)', () => {
  /** The font files the page's one stylesheet asks for. */
  const asked = [...stylesheet().matchAll(/url\(\/fonts\/([^)]+)\)/g)].map(m => m[1])

  it('serves every font the page stylesheet names, as woff2', async () => {
    expect(asked.length).toBeGreaterThanOrEqual(3)
    for (const file of asked) {
      const res = await get(`${server.url}/fonts/${file}`)
      expect(res.status, file).toBe(200)
      expect(res.type, file).toMatch(/^font\/woff2/)
      expect(res.body.startsWith('wOF2'), file).toBe(true)
    }
  })

  it('serves each font family its OFL licence beside it', async () => {
    for (const family of ['geist', 'geist-mono', 'outfit']) {
      const res = await get(`${server.url}/fonts/${family}-OFL.txt`)
      expect(res.status, family).toBe(200)
      expect(res.type, family).toMatch(/^text\/plain/)
      expect(res.body, family).toContain('SIL Open Font License')
    }
  })

  it('serves nothing outside its allowlist: an unknown file is 404', async () => {
    for (const path of ['/fonts/', '/fonts/evil.woff2', '/fonts/geist.woff', '/fonts/%2e%2e%2fclient.js', '/fonts/..%2F..%2Fpackage.json', '/fonts/geist.woff2/x']) {
      expect((await get(`${server.url}${path}`)).status, path).toBe(404)
    }
  })
})

describe('no other routes', () => {
  it('an unknown path is 404', async () => {
    expect((await get(`${server.url}/note`)).status).toBe(404)
    expect((await get(`${server.url}/graph/extra`)).status).toBe(404)
  })

  it('there are no write routes: anything but GET is 405', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect((await get(`${server.url}/graph`, undefined, method)).status, method).toBe(405)
    }
  })
})

describe('close()', () => {
  it('a start that fails building the Graph stops the poll it had started, so nothing reopens the index afterwards', async () => {
    const own = createInternalHafez({ vaultPath: VAULT, git: { push: false } })
    let syncs = 0
    const broken: InternalHafez = {
      ...own,
      syncIndex: async () => { syncs++; await own.syncIndex() },
      graph: async () => { throw new Error('index broken') },
    }
    await expect(startGraphServer({ os: broken, port: 0, heat: false, pollMs: 25 })).rejects.toThrow('index broken')
    const synced = syncs
    await os.update('worker', { brief: 'After the failed start' })
    await new Promise(resolve => setTimeout(resolve, 200))
    expect(syncs).toBe(synced)
    own.close()
  })

  it('frees the port and closes the index', async () => {
    const own = createInternalHafez({ vaultPath: VAULT, git: { push: false } })
    const closeIndex = vi.spyOn(own, 'close')
    const started = await startGraphServer({ os: own, port: 0, heat: false })
    const port = Number(new URL(started.url).port)
    await (await fetch(`${started.url}/graph`)).text() // fetch keeps the connection alive: it must not hold the port
    await started.close()
    expect(closeIndex).toHaveBeenCalled()
    await expect(get(`${started.url}/graph`)).rejects.toMatchObject({ code: 'ECONNREFUSED' })
    const again = await startGraphServer({ os: own, port, heat: false })
    expect(again.url).toBe(started.url)
    await again.close()
  })
})

/** An SSE subscription: `ready` once the stream is open, `next()` the next
 * event's data, `lastId()` the last event id seen, as a browser keeps it. */
function subscribe(url: string, headers: Record<string, string> = {}): { ready: Promise<void>; next(): Promise<unknown>; lastId(): string | undefined; close(): void } {
  const queued: unknown[] = []
  const waiting: Array<(event: unknown) => void> = []
  let buffer = ''
  let id: string | undefined
  let opened!: () => void
  const ready = new Promise<void>(resolve => { opened = resolve })
  const req = request(url, { agent: false, headers }, res => {
    opened()
    res.setEncoding('utf-8')
    res.on('data', chunk => {
      buffer += chunk
      let end: number
      while ((end = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        for (const line of frame.split('\n')) if (line.startsWith('id: ')) id = line.slice(4)
        const data = frame.split('\n').filter(l => l.startsWith('data: ')).map(l => l.slice(6)).join('\n')
        if (!data) continue
        const event = JSON.parse(data)
        const waiter = waiting.shift()
        if (waiter) waiter(event)
        else queued.push(event)
      }
    })
  })
  req.on('error', () => {})
  req.end()
  return {
    ready,
    next: () => queued.length ? Promise.resolve(queued.shift()) : new Promise(resolve => waiting.push(resolve)),
    lastId: () => id,
    close: () => req.destroy(),
  }
}

describe('GET /events', () => {
  it('pushes one commit event per write from another Hafez instance, with the Graph rebuilt', async () => {
    const watcher = createInternalHafez({ vaultPath: VAULT, git: { push: false } })
    const live = await startGraphServer({ os: watcher, port: 0, heat: false, pollMs: 25 })
    const events = subscribe(`${live.url}/events`)
    try {
      await events.ready
      await os.update('worker', { brief: 'Busy' })
      expect(await events.next()).toEqual({ type: 'commit', changes: [{ slug: 'worker', kind: 'entity', op: 'update' }] })

      await os.create('entity', 'Newcomer', { type: 'entity', parent: 'hub' })
      expect(await events.next()).toEqual({ type: 'commit', changes: [{ slug: 'newcomer', kind: 'entity', op: 'create' }] })
      const graph = JSON.parse((await get(`${live.url}/graph`)).body)
      expect(graph).toEqual(await os.graph(ALL_LAYERS))
      expect(graph.nodes.map((n: { id: string }) => n.id)).toContain('newcomer')
    } finally {
      events.close()
      await live.close()
    }
  })

  it('a Graph rebuild that fails loses no change: the next poll pushes it', async () => {
    const watcher = createInternalHafez({ vaultPath: VAULT, git: { push: false } })
    let failNext = false
    const flaky: InternalHafez = {
      ...watcher,
      graph: async opts => {
        if (failNext) {
          failNext = false
          throw new Error('index busy')
        }
        return watcher.graph(opts)
      },
    }
    const live = await startGraphServer({ os: flaky, port: 0, heat: false, pollMs: 25 })
    const events = subscribe(`${live.url}/events`)
    try {
      await events.ready
      failNext = true
      await os.update('worker', { brief: 'Busier' })
      const event = await Promise.race([events.next(), new Promise(resolve => setTimeout(() => resolve('no event'), 3000))])
      expect(event).toEqual({ type: 'commit', changes: [{ slug: 'worker', kind: 'entity', op: 'update' }] })
      expect(failNext).toBe(false)
    } finally {
      events.close()
      await live.close()
    }
  })

  it('a cursor history no longer knows loses no write: the poll follows from where history is, rebuilds, and pushes a commit naming no note', async () => {
    const watcher = createInternalHafez({ vaultPath: VAULT, git: { push: false } })
    let unknown: string | undefined
    const rewritten: InternalHafez = {
      ...watcher,
      changesSince: async cursor => {
        if (cursor !== undefined && cursor === unknown) throw new Error('unknown revision')
        return watcher.changesSince(cursor)
      },
    }
    const live = await startGraphServer({ os: rewritten, port: 0, heat: false, pollMs: 25 })
    const events = subscribe(`${live.url}/events`)
    try {
      await events.ready
      await vi.waitFor(() => expect(events.lastId()).toMatch(/^[0-9a-f]{40}$/))
      unknown = events.lastId() // from now on history does not know the poll's cursor
      await os.update('worker', { brief: 'Past the rewrite' })
      expect(await events.next()).toEqual({ type: 'commit', changes: [] })
      expect(events.lastId()).not.toBe(unknown)
      const graph = JSON.parse((await get(`${live.url}/graph`)).body)
      expect(graph).toEqual(await os.graph(ALL_LAYERS))
      // Back on known ground: the next write arrives named.
      await os.update('worker', { brief: 'Known again' })
      expect(await events.next()).toEqual({ type: 'commit', changes: [{ slug: 'worker', kind: 'entity', op: 'update' }] })
    } finally {
      events.close()
      await live.close()
    }
  })

  it('a reconnect sending Last-Event-ID is replayed the changes made while it was away (#278)', async () => {
    const watcher = createInternalHafez({ vaultPath: VAULT, git: { push: false } })
    const live = await startGraphServer({ os: watcher, port: 0, heat: false, pollMs: 25 })
    const first = subscribe(`${live.url}/events`)
    try {
      await first.ready
      await os.update('worker', { brief: 'Before the drop' })
      expect(await first.next()).toEqual({ type: 'commit', changes: [{ slug: 'worker', kind: 'entity', op: 'update' }] })
      const lastId = first.lastId()
      expect(lastId).toMatch(/^[0-9a-f]{40}$/)
      first.close()

      // Away: the server sees these writes with no stream open.
      await os.update('worker', { brief: 'While away' })
      await os.create('knowledge', 'Missed Insight', {})
      await new Promise(resolve => setTimeout(resolve, 300))

      const back = subscribe(`${live.url}/events`, { 'Last-Event-ID': lastId! })
      try {
        expect(await back.next()).toEqual({ type: 'commit', changes: expect.arrayContaining([
          { slug: 'worker', kind: 'entity', op: 'update' },
          { slug: 'missed-insight', kind: 'knowledge', op: 'create' },
        ]) })
        expect(back.lastId()).not.toBe(lastId)
      } finally {
        back.close()
      }
    } finally {
      first.close()
      await live.close()
    }
  })

  it('a stream opens with its cursor as the event id, so a reconnect with nothing missed is replayed nothing (#278)', async () => {
    const watcher = createInternalHafez({ vaultPath: VAULT, git: { push: false } })
    const live = await startGraphServer({ os: watcher, port: 0, heat: false, pollMs: 25 })
    const first = subscribe(`${live.url}/events`)
    try {
      await first.ready
      await vi.waitFor(() => expect(first.lastId()).toMatch(/^[0-9a-f]{40}$/))
      first.close()
      const back = subscribe(`${live.url}/events`, { 'Last-Event-ID': first.lastId()! })
      await os.update('worker', { brief: 'After the return' })
      expect(await back.next()).toEqual({ type: 'commit', changes: [{ slug: 'worker', kind: 'entity', op: 'update' }] })
      back.close()
    } finally {
      await live.close()
    }
  })

  it('serves an event stream', async () => {
    const res = await new Promise<{ status?: number; type?: string }>((resolve, reject) => {
      const req = request(`${server.url}/events`, { agent: false }, r => {
        resolve({ status: r.statusCode, type: r.headers['content-type'] })
        req.destroy()
      })
      req.on('error', reject)
      req.end()
    })
    expect(res.status).toBe(200)
    expect(res.type).toMatch(/^text\/event-stream/)
  })
})

describe('heat (#galaxy)', () => {
  const started: GraphServer[] = []
  const root = join(TMP, 'transcripts')
  const cwd = join(TMP, 'hub-work')
  const stamp = (time: string) => `${localDay()}T${time}`

  /** A server of its own on the shared Vault, so the file's server is untouched. */
  async function start(heat: Parameters<typeof startGraphServer>[0]['heat']): Promise<GraphServer> {
    const live = await startGraphServer({ os: createInternalHafez({ vaultPath: VAULT, git: { push: false } }), port: 0, heat })
    started.push(live)
    return live
  }
  const nodeOf = async (live: GraphServer, id: string) =>
    (JSON.parse((await get(`${live.url}/graph`)).body).nodes as Array<Record<string, unknown>>).find(n => n.id === id)!

  beforeAll(async () => {
    mkdirSync(join(root, 'proj'), { recursive: true })
    writeFileSync(join(root, 'proj', 'a.jsonl'), [
      JSON.stringify({ type: 'user', timestamp: stamp('09:00:00'), cwd }),
      JSON.stringify({ type: 'user', timestamp: stamp('09:10:00') }),
    ].join('\n') + '\n')
    await os.update('hub', { resource: cwd })
  })
  afterAll(async () => {
    for (const live of started) await live.close()
  })

  it('collect() puts hours-based heat on the project and none on a plain entity', async () => {
    const live = await start({ transcriptRoot: root, sidecarPath: join(TMP, 'hours.json') })
    await live.collect()
    const hub = await nodeOf(live, 'hub')
    expect(hub.heat_source).toBe('hours')
    expect(typeof hub.last_active).toBe('string')
    expect(hub.heat).toBeGreaterThan(0)
    expect(await nodeOf(live, 'worker')).not.toHaveProperty('heat')
  })

  it('with heat: false nodes carry no heat fields and collect() does nothing', async () => {
    const live = await start(false)
    await live.collect()
    const hub = await nodeOf(live, 'hub')
    for (const key of ['heat', 'last_active', 'heat_source']) expect(hub).not.toHaveProperty(key)
  })

  it('collect() tells an open page with a commit event naming no note', async () => {
    const live = await start({ transcriptRoot: root, sidecarPath: join(TMP, 'hours-events.json') })
    const events = subscribe(`${live.url}/events`)
    try {
      await events.ready
      await live.collect()
      expect(await events.next()).toEqual({ type: 'commit', changes: [] })
    } finally {
      events.close()
    }
  })

  it('a collector failure does not crash the server: collect() resolves and the Graph still serves', async () => {
    const blocked = join(TMP, 'blocked')
    writeFileSync(blocked, 'a file, not a directory')
    const live = await start({ transcriptRoot: root, sidecarPath: join(blocked, 'hours.json') })
    await expect(live.collect()).resolves.toBeUndefined()
    expect((await get(`${live.url}/graph`)).status).toBe(200)
  })

  it('a Graph rebuild that fails during collect() leaves the server live: collect() resolves, later commits still push, close() resolves', async () => {
    const watcher = createInternalHafez({ vaultPath: VAULT, git: { push: false } })
    let failNext = false
    const flaky: InternalHafez = {
      ...watcher,
      graph: async opts => {
        if (failNext) {
          failNext = false
          throw new Error('boom')
        }
        return watcher.graph(opts)
      },
    }
    const live = await startGraphServer({ os: flaky, port: 0, pollMs: 25, heat: { transcriptRoot: root, sidecarPath: join(TMP, 'hours-flaky.json') } })
    const events = subscribe(`${live.url}/events`)
    try {
      await events.ready
      await live.collect() // the start-up run settles first; its frames carry no change
      failNext = true
      await expect(live.collect()).resolves.toBeUndefined()
      expect(failNext).toBe(false) // the failing rebuild did run
      await os.update('worker', { brief: 'Still live' })
      let frame = await events.next() as { changes: unknown[] }
      while (frame.changes.length === 0) frame = await events.next() as { changes: unknown[] }
      expect(frame).toEqual({ type: 'commit', changes: [{ slug: 'worker', kind: 'entity', op: 'update' }] })
    } finally {
      events.close()
    }
    await expect(live.close()).resolves.toBeUndefined()
  })
})

describe('the port', () => {
  it('without one, the first free port from 4747 is used', async () => {
    const first = await startGraphServer({ os, heat: false })
    const second = await startGraphServer({ os, heat: false })
    try {
      const a = Number(new URL(first.url).port)
      const b = Number(new URL(second.url).port)
      expect(a).toBeGreaterThanOrEqual(4747)
      expect(b).toBeGreaterThan(a)
    } finally {
      await Promise.all([first, second].map(s => s.close()))
    }
  })
})

describe('the Host check', () => {
  const port = () => new URL(server.url).port

  it('a foreign Host gets 403', async () => {
    expect((await get(`${server.url}/graph`, 'evil.example.com')).status).toBe(403)
    expect((await get(`${server.url}/`, `evil.example.com:${port()}`)).status).toBe(403)
    expect((await get(`${server.url}/graph`, '127.0.0.1:1')).status).toBe(403)
  })

  it('127.0.0.1:<port> and localhost:<port> are served', async () => {
    expect((await get(`${server.url}/graph`, `127.0.0.1:${port()}`)).status).toBe(200)
    expect((await get(`${server.url}/graph`, `localhost:${port()}`)).status).toBe(200)
  })
})

describe('hafez graph', () => {
  const CLI = join(process.cwd(), 'dist', 'cli.js')

  function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const probe = createNetServer().listen(0, '127.0.0.1', () => {
        const { port } = probe.address() as AddressInfo
        probe.close(() => resolve(port))
      }).on('error', reject)
    })
  }

  /** Spawn the CLI and resolve with the child once its first stdout line is out. */
  function startCli(...args: string[]): Promise<{ child: ChildProcess; line: string }> {
    // A temp home: the child's default transcript root and sidecar are then empty and under TMP, never the developer's.
    const child = spawn('node', [CLI, '--vault', VAULT, 'graph', ...args], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, HOME: join(TMP, 'home'), USERPROFILE: join(TMP, 'home'), XDG_CONFIG_HOME: join(TMP, 'config') } })
    return new Promise((resolve, reject) => {
      let out = ''
      let err = ''
      child.stdout!.setEncoding('utf-8').on('data', chunk => {
        out += chunk
        if (out.includes('\n')) resolve({ child, line: out.split('\n')[0] })
      })
      child.stderr!.setEncoding('utf-8').on('data', chunk => { err += chunk })
      child.on('exit', code => reject(new Error(`exited ${code} before printing: ${err}`)))
    })
  }

  it('--port N is honoured, the URL is printed, and Ctrl-C stops it', async () => {
    const port = await freePort()
    const { child, line } = await startCli('--no-open', '--port', String(port))
    const exited = new Promise<number | null>(resolve => child.on('exit', code => resolve(code)))
    try {
      expect(line).toContain(`http://127.0.0.1:${port}`)
      // The CLI's server draws heat on project nodes (from vault touches here: the temp home has no transcripts), which os.graph does not; the rest is the index's.
      const served = JSON.parse((await get(`http://127.0.0.1:${port}/graph`)).body)
      for (const node of served.nodes) { delete node.heat; delete node.last_active; delete node.heat_source }
      expect(served).toEqual(await os.graph(ALL_LAYERS))
    } finally {
      child.kill('SIGINT')
    }
    const code = await exited
    // Windows has no SIGINT to deliver: kill() terminates the child outright.
    if (process.platform !== 'win32') expect(code).toBe(0)
    await expect(get(`http://127.0.0.1:${port}/graph`)).rejects.toMatchObject({ code: 'ECONNREFUSED' })
  })

  // Windows has no SIGTERM to deliver: kill() terminates the child outright.
  it.skipIf(process.platform === 'win32')('SIGTERM stops it as Ctrl-C does: exit 0, the port freed, the Vault left free to write (#280)', async () => {
    // A Vault of its own, so the write after the stop touches nothing shared.
    const vault = join(TMP, 'sigterm-vault')
    mkdirSync(join(vault, 'entities'), { recursive: true })
    await simpleGit(vault).init()
    const own = createInternalHafez({ vaultPath: vault, git: { push: false } })
    await own.create('entity', 'Alpha', { type: 'entity' })
    own.close()
    const port = await freePort()
    const child = spawn('node', [CLI, '--vault', vault, 'graph', '--no-open', '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout!.setEncoding('utf-8').on('data', chunk => { out += chunk })
    const exited = new Promise<number | null>(resolve => child.on('exit', code => resolve(code)))
    await vi.waitFor(() => expect(out).toContain(`http://127.0.0.1:${port}`), { timeout: 15_000 })
    expect((await get(`http://127.0.0.1:${port}/graph`)).status).toBe(200)
    child.kill('SIGTERM')
    expect(await exited).toBe(0)
    expect(out).toContain('Graph server stopped.')
    await expect(get(`http://127.0.0.1:${port}/graph`)).rejects.toMatchObject({ code: 'ECONNREFUSED' })
    // Released: right after the exit, another instance writes the Vault and
    // reads the write back through the index.
    const after = createInternalHafez({ vaultPath: vault, git: { push: false } })
    await after.create('entity', 'Beta', { type: 'entity' })
    expect((await after.query({ filter: 'all' })).items.map(i => i.slug).sort()).toEqual(['alpha', 'beta'])
  })

  it('a --port that is not a port number is a usage error', () => {
    for (const bad of ['abc', '-1', '65536', '47.5']) {
      const result = spawnSync('node', [CLI, '--vault', VAULT, 'graph', '--no-open', '--port', bad], { encoding: 'utf-8' })
      expect(result.status, bad).toBe(2)
      expect(result.stderr, bad).toContain('--port')
    }
  })

  it('a --port in use is a usage error naming --port, exit 2', async () => {
    const busy = createNetServer()
    const port = await new Promise<number>((resolve, reject) => {
      busy.listen(0, '127.0.0.1', () => resolve((busy.address() as AddressInfo).port)).on('error', reject)
    })
    try {
      const result = spawnSync('node', [CLI, '--vault', VAULT, 'graph', '--no-open', '--port', String(port)], { encoding: 'utf-8', timeout: 15_000 })
      expect(result.status).toBe(2)
      expect(result.stderr).toContain(`port ${port} is in use`)
      expect(result.stderr).toContain('--port')
    } finally {
      await new Promise<void>(resolve => busy.close(() => resolve()))
    }
  })

  it('<slug> opens the page focused on that note at depth 2 (#256)', async () => {
    const port = await freePort()
    const { child, line } = await startCli('worker', '--no-open', '--port', String(port))
    const exited = new Promise<void>(resolve => child.on('exit', () => resolve()))
    try {
      const url = new URL(line.match(/http:\/\/\S+/)![0])
      expect(url.origin).toBe(`http://127.0.0.1:${port}`)
      expect(url.searchParams.get('focus')).toBe('worker')
      expect(url.searchParams.get('depth')).toBe('2')
      expect((await get(url.href)).status).toBe(200)
    } finally {
      child.kill('SIGINT')
    }
    await exited
  })

  it('an unknown <slug> fails as a read miss does: closest slugs on stderr, exit 1, no server (#256)', () => {
    // A server that started would never exit: the timeout turns that into a failure, not a hang.
    const graph = spawnSync('node', [CLI, '--vault', VAULT, 'graph', 'worker-node', '--no-open'], { encoding: 'utf-8', timeout: 15_000 })
    const read = spawnSync('node', [CLI, '--vault', VAULT, 'read', 'worker-node'], { encoding: 'utf-8' })
    expect(graph.status).toBe(1)
    expect(graph.stdout).toBe('')
    expect(graph.stderr).toContain('hafez read worker')
    expect(graph.stderr).toBe(read.stderr)
  })

  it('<slug> does not combine with --json, and takes one slug', () => {
    for (const args of [['worker', '--json'], ['worker', 'hub', '--no-open']]) {
      const result = spawnSync('node', [CLI, '--vault', VAULT, 'graph', ...args], { encoding: 'utf-8', timeout: 15_000 })
      expect(result.status, args.join(' ')).toBe(2)
    }
  })

  it('--port and --no-open do not combine with --json', () => {
    for (const flags of [['--port', '4747'], ['--no-open']]) {
      const result = spawnSync('node', [CLI, '--vault', VAULT, 'graph', '--json', ...flags], { encoding: 'utf-8' })
      expect(result.status, flags[0]).toBe(2)
    }
  })
})
