# Hafez Galaxy, part 1: Heat and Finish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every project node in the graph payload a temperature (`last_active`, `heat`) mined from Claude Code transcripts, and give the graph server its one write route, `POST /note/:slug/finish`, with the panel's triple-confirmed Mark finished button.

**Architecture:** A collector under `src/graph/heat/` scans `~/.claude/projects/*/*.jsonl` for timestamps only, sums gaps under 15 minutes into active minutes per working folder per day, maps folders to entity slugs through the entity `resource` field, and writes an uncommitted sidecar `hours.json` in the hafez config dir. The graph server runs the collector at start and every 10 minutes, merges the sidecar into `/graph` as two optional node fields, and pushes an empty commit frame so open pages refetch. Everything that decides a number is a pure module with a vitest test; the server and the CLI only wire them.

**Tech Stack:** TypeScript 5.9, Node 22, vitest 4, the repo's existing `node:http` server, `node:fs` for the sidecar. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-25-hafez-galaxy-design.md`, sections "Where the data comes from", "Hours", "The one server write", "Interaction: Mark finished".

## Global Constraints

- Transcripts are private: the collector reads only the `timestamp` and `cwd` fields of each JSON line and persists only minutes per slug per day. No message content is ever logged, stored, or asserted in a test fixture beyond those two fields.
- The sidecar is never written into the vault and never committed. Path: `<config dir>/hours.json`, where the config dir is `getConfigDir()` from `src/cli/resolve-vault.ts` (`$XDG_CONFIG_HOME/hafez` or `~/.config/hafez`).
- Heat formula (spec): `heat = clamp(Σ_d minutes_d × 2^(−age_d / 7) / 1800, 0, 1)`. Half-life 7 days. Saturation 1800 minutes (one working week of five six-hour days). Window 35 days. Active-gap threshold 15 minutes.
- Fallback for a project with no folder mapping: `last_active` = the vault's `last_touched`; heat from vault touches, each touch day counted as 60 minutes through the same formula; `heat_source: 'touches'`.
- Only `kind: 'entity'` nodes with `type: 'project'` carry heat fields. Captures, entities, knowledge, and layer nodes never do.
- The server keeps its Host check on every route. The finish route adds an Origin check: the `Origin` header must equal `http://<allowed host>` for one of the two allowed hosts, or the request is 403.
- `src/graph/fields.ts` stays free of imports (tests/graph-bundle.test.ts enforces it).
- Every commit on branch `galaxy` of `Aghaye-Tesoke/hafez`. Commit messages end with the Claude Code attribution trailer of the model that authored the commit (`Co-Authored-By: Claude <model> <noreply@anthropic.com>`); the trailer is honest about authorship, not fixed to one model.
- Run the suite with `npm test` (its `pretest` builds and typechecks). On this Windows machine run npm scripts from Git Bash; the build script is POSIX.

## Review Focus

Inputs the spec implies but no single feature test exercises, each pinned to a task below:

1. A transcript line whose `timestamp` is malformed or missing must be skipped, never crash the scan or poison a day. (Task 5)
2. A session that straddles local midnight must attribute each gap to the day it started on, so no minute is counted twice or lost. (Task 2)
3. A `resource` that is a URL, or a path with a trailing branch note such as `C:/x/repo (branch build/v1)`, must map correctly or be ignored, never match a transcript by accident. (Task 3)
4. A corrupt or truncated `hours.json` must read as empty and be overwritten, never crash the server at start. (Task 6)
5. `POST /note/:slug/finish` from a page on another origin, with a valid Host, must be refused. (Task 9)

---

### Task 1: Heat fields on the Graph contract

**Files:**
- Modify: `src/types.ts` (the `GraphNode` interface, around line 403)
- Modify: `src/graph/fields.ts`
- Test: `tests/graph-fields.test.ts` (create)

**Interfaces:**
- Produces: `GraphNode.last_active?: string` (ISO day), `GraphNode.heat?: number` (0..1), `GraphNode.heat_source?: 'hours' | 'touches'`; `GRAPH_HEAT_FIELDS = ['last_active', 'heat', 'heat_source'] as const` exported from `fields.ts` and included in `GRAPH_NODE_FIELDS`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/graph-fields.test.ts
import { describe, expect, it } from 'vitest'
import { GRAPH_HEAT_FIELDS, GRAPH_NODE_FIELDS } from '../src/graph/fields.js'

describe('the Graph node fields', () => {
  it('list the heat fields among the optional fields a refresh may drop', () => {
    expect(GRAPH_HEAT_FIELDS).toEqual(['last_active', 'heat', 'heat_source'])
    for (const f of GRAPH_HEAT_FIELDS) expect(GRAPH_NODE_FIELDS).toContain(f)
  })
})
```

- [ ] **Step 2: Run it, expect FAIL** with `GRAPH_HEAT_FIELDS` not exported: `npx vitest run tests/graph-fields.test.ts`
- [ ] **Step 3: Add the three optional fields to `GraphNode` with one-line doc comments naming the spec; add `GRAPH_HEAT_FIELDS` to `fields.ts` and spread it into `GRAPH_NODE_FIELDS`.**
- [ ] **Step 4: Run the test and `npx vitest run tests/graph-bundle.test.ts`, expect PASS.**
- [ ] **Step 5: Commit** `feat(graph): heat fields on the Graph node contract`

---

### Task 2: Active minutes from timestamps

**Files:**
- Create: `src/graph/heat/active.ts`
- Test: `tests/heat-active.test.ts`

**Interfaces:**
- Produces: `GAP_MS = 15 * 60_000`; `minutesByDay(timestampsMs: number[], gapMs = GAP_MS): Record<string, number>` where keys are local `YYYY-MM-DD` days (use `localDay(new Date(ms))` from `src/dates.ts`) and values are whole minutes, rounded half up. Timestamps may arrive unsorted; the function sorts a copy. A gap `> gapMs` contributes nothing. Each gap is attributed to the local day of its start.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/heat-active.test.ts
import { describe, expect, it } from 'vitest'
import { GAP_MS, minutesByDay } from '../src/graph/heat/active.js'
import { localDay } from '../src/dates.js'

const T0 = new Date('2026-10-20T10:00:00').getTime()   // local time
const min = (n: number) => n * 60_000

describe('minutesByDay', () => {
  it('sums gaps at or under the threshold and drops longer ones', () => {
    const t = [T0, T0 + min(5), T0 + min(10), T0 + min(40), T0 + min(42)]
    expect(minutesByDay(t)).toEqual({ [localDay(new Date(T0))]: 12 })
  })
  it('sorts unsorted timestamps before measuring', () => {
    expect(minutesByDay([T0 + min(10), T0, T0 + min(5)])).toEqual({ [localDay(new Date(T0))]: 10 })
  })
  it('attributes a gap that crosses local midnight to the day it started', () => {
    const late = new Date('2026-10-20T23:55:00').getTime()
    expect(minutesByDay([late, late + min(10)])).toEqual({ '2026-10-20': 10 })
  })
  it('gives nothing for fewer than two timestamps', () => {
    expect(minutesByDay([])).toEqual({})
    expect(minutesByDay([T0])).toEqual({})
  })
  it('exposes the 15 minute threshold', () => { expect(GAP_MS).toBe(900_000) })
})
```

- [ ] **Step 2: Run, expect FAIL** (module missing).
- [ ] **Step 3: Implement `minutesByDay` in `src/graph/heat/active.ts`.** Accumulate milliseconds per day, convert to minutes at the end with `Math.round`.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(heat): active minutes per local day from transcript timestamps`

---

### Task 3: Folder to slug mapping

**Files:**
- Create: `src/graph/heat/paths.ts`
- Test: `tests/heat-paths.test.ts`

**Interfaces:**
- Produces: `normalizePath(p: string): string` (lowercase; `\` to `/`; `/mnt/<x>/rest` to `<x>:/rest`; strip a trailing ` (...)` note; strip trailing `/`); `isPathResource(resource: string): boolean` (false for anything containing `://` or starting with `www.`); `hostSlug(cwd: string, resources: ReadonlyArray<{ slug: string; resource: string | null }>): string | undefined` (the slug whose normalized path resource equals the normalized cwd or is a prefix of it ending at a `/` boundary; the longest such prefix wins; URLs and null are skipped).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/heat-paths.test.ts
import { describe, expect, it } from 'vitest'
import { hostSlug, isPathResource, normalizePath } from '../src/graph/heat/paths.js'

describe('normalizePath', () => {
  it('lowercases, forward-slashes, and strips a trailing slash', () => {
    expect(normalizePath('D:\\CLAUDE\\AUTOMAZON\\')).toBe('d:/claude/automazon')
  })
  it('maps a WSL mount to a drive', () => {
    expect(normalizePath('/mnt/d/Claude/amazonica')).toBe('d:/claude/amazonica')
  })
  it('drops a trailing branch note', () => {
    expect(normalizePath('C:/Users/aryan/repos/voice-checkin (branch build/v1)')).toBe('c:/users/aryan/repos/voice-checkin')
  })
})

describe('isPathResource', () => {
  it('rejects URLs', () => {
    expect(isPathResource('https://cadbase.ai')).toBe(false)
    expect(isPathResource('www.notion.so/x')).toBe(false)
    expect(isPathResource('D:/Claude/amazonica')).toBe(true)
  })
})

describe('hostSlug', () => {
  const resources = [
    { slug: 'automazon', resource: 'D:\\CLAUDE\\AUTOMAZON' },
    { slug: 'amazon-ppc-brain', resource: 'D:\\CLAUDE\\Shopify\\automazon' },
    { slug: 'cadbase-website', resource: 'https://cadbase.ai' },
    { slug: 'no-resource', resource: null },
  ]
  it('matches a cwd equal to a resource, case and separators aside', () => {
    expect(hostSlug('d:/claude/automazon', resources)).toBe('automazon')
  })
  it('matches a cwd under a resource, longest prefix first', () => {
    expect(hostSlug('D:\\CLAUDE\\Shopify\\automazon\\src', resources)).toBe('amazon-ppc-brain')
  })
  it('does not match across a name boundary', () => {
    expect(hostSlug('D:/CLAUDE/AUTOMAZON2', resources)).toBeUndefined()
  })
  it('never matches a URL or a missing resource', () => {
    expect(hostSlug('https://cadbase.ai', resources)).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement the three functions in `src/graph/heat/paths.ts`.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(heat): map a working folder to the entity whose resource holds it`

---

### Task 4: The heat formula

**Files:**
- Create: `src/graph/heat/heat.ts`
- Test: `tests/heat-formula.test.ts`

**Interfaces:**
- Produces: `HALF_LIFE_DAYS = 7`, `SATURATION_MINUTES = 1800`, `WINDOW_DAYS = 35`, `TOUCH_MINUTES = 60`; `type DayMinutes = Record<string, number>`; `heatOf(days: DayMinutes, today: string): { heat: number; last_active?: string }` (days older than `WINDOW_DAYS` ignored; `last_active` is the newest day with minutes > 0; heat rounded to 3 decimals); `touchesAsMinutes(touchDays: string[]): DayMinutes` (each distinct day gets `TOUCH_MINUTES`). Ages come from `daysBetween(day, today)` in `src/dates.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/heat-formula.test.ts
import { describe, expect, it } from 'vitest'
import { heatOf, touchesAsMinutes, SATURATION_MINUTES } from '../src/graph/heat/heat.js'

const TODAY = '2026-10-25'

describe('heatOf', () => {
  it('saturates at one working week of minutes today', () => {
    expect(heatOf({ [TODAY]: SATURATION_MINUTES }, TODAY)).toEqual({ heat: 1, last_active: TODAY })
  })
  it('halves every seven days', () => {
    expect(heatOf({ '2026-10-18': SATURATION_MINUTES }, TODAY).heat).toBeCloseTo(0.5, 3)
  })
  it('is a red dwarf below 0.07 after 28 cold days', () => {
    expect(heatOf({ '2026-09-27': SATURATION_MINUTES }, TODAY).heat).toBeLessThan(0.07)
  })
  it('names the newest day with minutes as last_active, and ignores days outside the window', () => {
    expect(heatOf({ '2026-08-01': 5000, '2026-10-01': 30 }, TODAY)).toEqual({ heat: expect.any(Number), last_active: '2026-10-01' })
    expect(heatOf({ '2026-08-01': 5000 }, TODAY)).toEqual({ heat: 0 })
  })
  it('clamps to one', () => {
    expect(heatOf({ [TODAY]: 99999 }, TODAY).heat).toBe(1)
  })
})

describe('touchesAsMinutes', () => {
  it('counts each distinct touch day as one hour', () => {
    expect(touchesAsMinutes(['2026-10-20', '2026-10-20', '2026-10-21'])).toEqual({ '2026-10-20': 60, '2026-10-21': 60 })
  })
})
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement in `src/graph/heat/heat.ts`.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(heat): the decayed, saturating heat formula and its touch fallback`

---

### Task 5: Scanning transcripts

**Files:**
- Create: `src/graph/heat/transcripts.ts`
- Test: `tests/heat-transcripts.test.ts`

**Interfaces:**
- Consumes: `minutesByDay` (Task 2).
- Produces: `interface FileEntry { mtimeMs: number; size: number; cwd: string; days: DayMinutes }`; `type FileCache = Record<string, FileEntry>` keyed by absolute file path; `scanTranscripts(root: string, cache: FileCache, now: Date): Promise<{ byCwd: Map<string, DayMinutes>; cache: FileCache }>`. Behaviour: every `<root>/<folder>/*.jsonl`; a file whose `mtimeMs` and `size` match the cache is reused without reading; a file with `mtimeMs` older than `now − WINDOW_DAYS` is dropped from the cache and skipped; otherwise it is read line by line, each line `JSON.parse`d inside try/catch, keeping only `timestamp` (parsed with `Date.parse`, skipped when `NaN` or absent) and the first string `cwd` seen; a file with no `cwd` uses its folder name as cwd. The returned cache holds only files seen this run. `byCwd` merges every file's days per cwd.

- [ ] **Step 1: Write the failing tests** with a fixture builder that writes jsonl lines of the shape `{"type":"user","timestamp":"<iso>","cwd":"<path>"}` into a temp root:

```ts
// tests/heat-transcripts.test.ts
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { scanTranscripts } from '../src/graph/heat/transcripts.js'

const ROOT = join(tmpdir(), 'hafez-test-transcripts-' + Date.now())
const NOW = new Date('2026-10-25T12:00:00')
const line = (iso: string, extra = '') => `{"type":"user","timestamp":"${iso}"${extra}}\n`

beforeAll(() => {
  mkdirSync(join(ROOT, 'D--CLAUDE-AUTOMAZON'), { recursive: true })
  writeFileSync(join(ROOT, 'D--CLAUDE-AUTOMAZON', 'a.jsonl'),
    line('2026-10-24T09:00:00', ',"cwd":"D:\\\\CLAUDE\\\\AUTOMAZON"') + line('2026-10-24T09:10:00') + 'not json\n' + line('garbage-date') + line('2026-10-24T09:12:00'))
  mkdirSync(join(ROOT, 'no-cwd'), { recursive: true })
  writeFileSync(join(ROOT, 'no-cwd', 'b.jsonl'), line('2026-10-24T10:00:00') + line('2026-10-24T10:05:00'))
})
afterAll(() => rmSync(ROOT, { recursive: true, force: true }))

describe('scanTranscripts', () => {
  it('reads timestamps and cwd only, skips bad lines, and sums per cwd and day', async () => {
    const { byCwd } = await scanTranscripts(ROOT, {}, NOW)
    expect(byCwd.get('D:\\CLAUDE\\AUTOMAZON')).toEqual({ '2026-10-24': 12 })
  })
  it('uses the folder name when no line carries a cwd', async () => {
    const { byCwd } = await scanTranscripts(ROOT, {}, NOW)
    expect(byCwd.get('no-cwd')).toEqual({ '2026-10-24': 5 })
  })
  it('reuses an unchanged file from the cache without reading it', async () => {
    const first = await scanTranscripts(ROOT, {}, NOW)
    const path = Object.keys(first.cache).find(p => p.endsWith('a.jsonl'))!
    const poisoned = { ...first.cache, [path]: { ...first.cache[path], days: { '2026-10-24': 999 } } }
    const second = await scanTranscripts(ROOT, poisoned, NOW)
    expect(second.byCwd.get('D:\\CLAUDE\\AUTOMAZON')).toEqual({ '2026-10-24': 999 })
  })
  it('drops a cached file that no longer exists', async () => {
    const { cache } = await scanTranscripts(ROOT, { '/gone.jsonl': { mtimeMs: 0, size: 0, cwd: 'x', days: {} } }, NOW)
    expect(cache['/gone.jsonl']).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement `scanTranscripts`** with `fs/promises` `readdir`, `stat`, and `readline` over a `createReadStream`, so a 100 MB file is never held whole in memory.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(heat): scan Claude Code transcripts for active minutes per folder, timestamps only`

---

### Task 6: The sidecar file

**Files:**
- Create: `src/graph/heat/sidecar.ts`
- Test: `tests/heat-sidecar.test.ts`

**Interfaces:**
- Consumes: `FileCache` (Task 5), `DayMinutes` (Task 4).
- Produces: `interface Sidecar { version: 1; generated: string; files: FileCache; days: Record<string, DayMinutes> }` (`days` keyed by slug); `emptySidecar(): Sidecar`; `readSidecar(path: string): Sidecar` (missing file, unparsable JSON, or `version !== 1` returns `emptySidecar()`); `writeSidecar(path: string, sidecar: Sidecar): void` (creates the directory, writes `<path>.tmp`, renames over `path`); `defaultSidecarPath(): string` = `join(getConfigDir(), 'hours.json')`.

- [ ] **Step 1: Write the failing tests**: round trip; missing file is empty; `writeFileSync(path, '{"version":1,"days":')` then `readSidecar` is empty; `defaultSidecarPath()` ends with `hafez/hours.json` under `process.env.XDG_CONFIG_HOME` (tests/setup.ts sets it).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(heat): the hours sidecar, read tolerant and written atomically`

---

### Task 7: The collector

**Files:**
- Create: `src/graph/heat/collect.ts`
- Test: `tests/heat-collect.test.ts`

**Interfaces:**
- Consumes: Tasks 2 to 6.
- Produces: `interface CollectOpts { transcriptRoot: string; sidecarPath: string; now?: Date }`; `collectHeat(os: Hafez, opts: CollectOpts): Promise<Sidecar>`. Behaviour: read the sidecar; `os.query({ limit: 10000 })` for every entity row (its items carry `resource: string | null`; if the query type has no `limit`, use the largest page the API allows and page until `items.length < total`); scan transcripts with the sidecar's cache; for each cwd, `hostSlug` picks a slug or the minutes are dropped; merge into `days[slug]` by adding per day; prune every day older than `WINDOW_DAYS` from `now`; set `generated` to `now.toISOString()`; write and return the sidecar.

- [ ] **Step 1: Write the failing test** using `createHafez` from `tests/helpers/hafez.ts` on a temp git vault (copy the beforeAll of `tests/graph-server.test.ts`): create entity `Mapped` with `resource` set to a fixture folder path, write a jsonl under a temp transcript root whose `cwd` is that path with two timestamps 10 minutes apart on 2026-10-24, run `collectHeat`, assert `sidecar.days.mapped` equals `{ '2026-10-24': 10 }`, that an unmapped cwd leaves no key, and that a second run with an older sidecar day 40 days back prunes it.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement `collectHeat`.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(heat): the collector, transcripts to a per-slug hours sidecar`

---

### Task 8: Heat in the Graph payload, and the server's collection schedule

**Files:**
- Create: `src/graph/heat/apply.ts`
- Modify: `src/graph/server.ts` (opts, `rebuild`, the returned `GraphServer`)
- Modify: `src/graph/live.ts` (`Live` gains `broadcast()`)
- Modify: `src/cli/commands.ts` (`serveGraph`, around line 649)
- Test: `tests/heat-apply.test.ts`; `tests/graph-server.test.ts` (add a describe)

**Interfaces:**
- Consumes: `Sidecar`, `heatOf`, `touchesAsMinutes`.
- Produces: `withHeat(graph: Graph, sidecar: Sidecar, touches: Map<string, string[]>, today: string): Graph` (pure: a new graph whose project entity nodes gain `last_active`, `heat`, `heat_source`; `touches` maps slug to the local days of its commits in the window; a project with sidecar days uses them with `heat_source: 'hours'`; else `touchesAsMinutes` with `heat_source: 'touches'` and `last_active` falling back to `last_touched`; a project with neither gets `heat: 0`, `heat_source: 'touches'` and no `last_active`). `GraphServerOpts.heat?: { transcriptRoot?: string; sidecarPath?: string; intervalMs?: number } | false` (default on; `transcriptRoot` default `join(homedir(), '.claude', 'projects')`; `sidecarPath` default `defaultSidecarPath()`; `intervalMs` default `600_000`). `GraphServer.collect(): Promise<void>` runs the collector, then `rebuild()`, then `live.broadcast()`; the server calls it once after listening (not awaited at start) and on the interval with an unref'd timer, serialised so two runs never overlap. `Live.broadcast(): void` writes `commitFrame({ cursor, changes: [] })` to every client. `rebuild()` computes `touches` from `os.changelog('', 400)` entries (entity kind, within `WINDOW_DAYS`, grouped by slug, each timestamp to `localDay`).

- [ ] **Step 1: Write the failing pure test** `tests/heat-apply.test.ts`: a graph with a project `hot` (sidecar days today 1800), a project `cold-touched` (no sidecar, touches on two days 3 days ago, `last_touched` 3 days ago), a capture, and a knowledge node; assert `hot` gets `{ heat: 1, last_active: TODAY, heat_source: 'hours' }`, `cold-touched` gets `heat_source: 'touches'`, `last_active` equal to `last_touched`, heat between 0 and 0.1, and that the capture and knowledge nodes have none of the three fields.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement `withHeat`.** Run, expect PASS. Commit `feat(heat): merge heat into the Graph payload`.
- [ ] **Step 4: Write the failing server tests** in `tests/graph-server.test.ts` under `describe('heat (#galaxy)')`: start a second server in that describe with `heat: { transcriptRoot: <temp root with one fixture jsonl whose cwd is the Hub entity's resource>, sidecarPath: <temp file> }` after updating `hub` with `resource` set to that cwd; `await server.collect()`; GET `/graph` and assert the `hub` node carries `heat_source: 'hours'` and a `last_active`; assert the `worker` node (type entity) carries no `heat`; assert a server started with `heat: false` gives `hub` no `heat` field; assert that an `/events` subscriber receives a frame with `data: {"type":"commit","changes":[]}` after `collect()` (reuse the test file's existing SSE reader).
- [ ] **Step 5: Run, expect FAIL.**
- [ ] **Step 6: Implement** the server opts, `collect()`, the schedule, `live.broadcast()`, and the `touches` computation in `rebuild`. In `serveGraph` (CLI) pass nothing: defaults apply. The existing test "there are no write routes" still passes at this task.
- [ ] **Step 7: Run `npm test`, expect PASS.**
- [ ] **Step 8: Commit** `feat(graph): the server collects heat at start and every ten minutes and tells open pages`

---

### Task 9: `POST /note/:slug/finish`

**Files:**
- Modify: `src/graph/server.ts` (the request handler, the header comment "Read-only by construction")
- Test: `tests/graph-server.test.ts` (modify the 405 test; add a describe)

**Interfaces:**
- Produces: `POST /note/<slug>/finish` → `200 {"slug":"<slug>","status":"done"}` after `os.update(slug, { status: 'done' })`; `404 {"slug","closest"}` on a `HafezError` `NOT_FOUND`, as `/note` does; `403 Forbidden` when the `Origin` header is absent or not `http://<one of allowedHosts>`; `405` with `Allow: GET, POST` for any method other than GET or POST; `405` with `Allow: GET` for a POST to any other path. Idempotent: finishing a done project is 200.

- [ ] **Step 1: Write the failing tests**: extend `get()` in the test file to take headers; `POST` with `Origin: http://127.0.0.1:<port>` finishes `worker` and a following `GET /note/worker` shows `status: 'done'` in its frontmatter; the same POST without Origin is 403; with `Origin: http://evil.example` is 403; POST to `/note/nobody/finish` is 404; POST to `/graph` is 405 with `Allow: GET`; `PUT /note/worker/finish` is 405 with `Allow: GET, POST`; and the `/events` test pattern shows a `commit` frame naming `worker` with op `update` arrives after the POST (the poll sees the commit).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** the route before the GET-only check; keep the Host check first. Rewrite the file's header comment: read-only except this one route, and why it carries an Origin check.
- [ ] **Step 4: Run `npm test`, expect PASS.**
- [ ] **Step 5: Commit** `feat(graph): POST /note/:slug/finish, the server's one write, Origin-checked`

---

### Task 10: Mark finished in the panel, three steps

**Files:**
- Create: `src/graph/client/finish.ts`
- Modify: `src/graph/client/panel.ts` (`render`, after the facts line)
- Modify: `src/graph/client/stylesheet.ts` (styles for `.finish`, `.finish .warn`, `.finish input`)
- Test: `tests/graph-finish.test.ts`

**Interfaces:**
- Produces (pure, in `finish.ts`): `type FinishStep = 'idle' | 'confirm' | 'type' | 'sending' | 'failed'`; `canFinish(node: GraphNode): boolean` (entity, type project, status not done); `finishWarning(node: GraphNode): string` returning exactly `This star will go supernova. It cannot un-explode.` on the first line and `"<name>" has <n> open action(s).` on the second (`n` from `open_actions ?? 0`, singular at 1, `has no open actions.` at 0); `typedMatches(input: string, slug: string): boolean` (trimmed exact match); `finishUrl(slug: string): string` = `/note/<encodeURIComponent(slug)>/finish`.
- Panel behaviour: a `Mark finished` button renders only when `canFinish(node)`; click 1 shows the warning with `Continue` and `Cancel`; `Continue` shows a text input labelled `Type the slug to confirm` with `Finish` disabled until `typedMatches`; `Finish` POSTs `finishUrl(slug)` with `method: 'POST'` and `credentials: 'omit'`; on `ok` the control collapses and the panel waits for the live reload; on failure the control shows `Could not finish: <status or message>` and a `Try again`; `Cancel` or Esc inside the control returns to `idle` without closing the panel.

- [ ] **Step 1: Write the failing tests** on the pure module: `canFinish` true for an active project, false for a done project, a capture, and a knowledge node; `finishWarning` exact strings for 0, 1 and 3 open actions; `typedMatches(' hafez-galaxy ', 'hafez-galaxy')` true and `typedMatches('hafez', 'hafez-galaxy')` false; `finishUrl('a b')` is `/note/a%20b/finish`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement `finish.ts`; then the control in `panel.ts` and its styles.** The control is built with `el()` from `shell.ts`; text reaches the DOM as text nodes only.
- [ ] **Step 4: Run `npm test` (includes the client typecheck via `pretest`), expect PASS.**
- [ ] **Step 5: Manual check:** `npm run build && node dist/cli.js graph --no-open --port 4800`, open `http://127.0.0.1:4800`, select an active project in a throwaway vault (`--vault` a temp copy, never the real one), walk the three steps, confirm the node mutes to done on the live reload and that Cancel at each step leaves the note untouched. Stop the server.
- [ ] **Step 6: Commit** `feat(graph): Mark finished in the panel, three steps, the one write the page makes`

---

### Task 11: Wiring, docs, and the whole suite

**Files:**
- Modify: `README.md` (the graph section: one paragraph on heat, the sidecar path, and the finish route)
- Modify: `src/cli/commands.ts` (`GRAPH_USAGE` gains nothing; confirm `serveGraph` passes no `heat` so defaults apply)

- [ ] **Step 1: Run `npm test`; expect every test green, including the unchanged 2D client tests.**
- [ ] **Step 2: Run the real thing read-only**: `node dist/cli.js graph --no-open --port 4800` against the configured vault, GET `/graph` with curl, confirm project nodes carry `heat_source`, and that `~/.config/hafez/hours.json` (on this machine `C:\Users\aryan\.config\hafez\hours.json`) exists, holds no field other than `version`, `generated`, `files`, `days`, and that no `days` value is anything but a number. Stop the server. Do not click Mark finished on the real vault.
- [ ] **Step 3: Write the README paragraph.**
- [ ] **Step 4: Commit** `docs: heat, the hours sidecar, and the finish route` and push `galaxy`.
