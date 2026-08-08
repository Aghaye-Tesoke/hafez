import Database from 'better-sqlite3'
import { createHash } from 'crypto'
import { readFileSync, statSync, existsSync, unlinkSync } from 'fs'
import { join, basename } from 'path'
import { parseFilePath, scanVaultDir, kindDir, INDEXED_KINDS } from './vault.js'
import { ensureLocalExclude, type VaultIndexRow } from './knowledge-index.js'
import { WIKI_LINK_RE, documentForFile } from './document.js'
import { ENTITY_STATUSES, ENTITY_TYPES, CONFIDENCE_LEVELS, VALID_SUBTYPES, DEFAULT_KNOWLEDGE_SUBTYPE } from './contracts.js'
import type { SearchResult, VaultStats, EntityStatus, EntityType, QueryResult, KnowledgeQueryResult, UnifiedResult, EntityQueryOpts, KnowledgeQueryOpts, UnifiedQueryOpts } from './types.js'
import { HafezError } from './types.js'

// Bump this when indexing logic changes to force a full rebuild.
// v5: wiki link harvesting (mention relations), parent link indexing, relation filter on queries.
// v6: description column on items.
// v7: resource column on items (entities only).
// v8: per-kind structural section binding (documentFor) changes how brief,
//     next-action, and session-log columns are derived from bodies.
// v9: Document binds the kind-level section union (no type/subtype
//     narrowing), changing section boundaries body columns derive from.
// v10: re-indexing an externally changed file is delete-then-insert instead of
//     INSERT OR REPLACE. Indexes written by v9 and earlier may hold ghost FTS
//     rows (REPLACE never fired the delete trigger) and must be rebuilt, not reused.
// Existing instances will fully rebuild the index on first access after upgrade.
export const SCHEMA_VERSION = '10'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS items (
  slug               TEXT PRIMARY KEY,
  kind               TEXT NOT NULL,
  name               TEXT NOT NULL,
  type               TEXT,
  status             TEXT,
  parent             TEXT,
  next_action        TEXT,
  next_action_count  INTEGER DEFAULT 0,
  staleness_days     INTEGER,
  confidence         TEXT,
  reinforcement_count INTEGER,
  last_reinforced    TEXT,
  created            TEXT NOT NULL,
  last_touched       TEXT,
  body               TEXT NOT NULL,
  file_hash          TEXT NOT NULL,
  subtype            TEXT,
  description        TEXT,
  resource           TEXT,
  brief              TEXT,
  session_log_count  INTEGER DEFAULT 0,
  last_session_date  TEXT,
  last_session_type  TEXT,
  last_session_summary TEXT
);

CREATE TABLE IF NOT EXISTS links (
  source   TEXT NOT NULL,
  target   TEXT NOT NULL,
  relation TEXT NOT NULL,
  PRIMARY KEY (source, target, relation)
);

CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
  name, body,
  content=items,
  content_rowid=rowid
);

CREATE TRIGGER IF NOT EXISTS items_ai AFTER INSERT ON items BEGIN
  INSERT INTO items_fts(rowid, name, body) VALUES (new.rowid, new.name, new.body);
END;

CREATE TRIGGER IF NOT EXISTS items_ad AFTER DELETE ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, name, body) VALUES ('delete', old.rowid, old.name, old.body);
END;

CREATE TRIGGER IF NOT EXISTS items_au AFTER UPDATE ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, name, body) VALUES ('delete', old.rowid, old.name, old.body);
  INSERT INTO items_fts(rowid, name, body) VALUES (new.rowid, new.name, new.body);
END;

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of',
  'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
  'may', 'might', 'can', 'shall', 'not', 'no', 'nor', 'so', 'if', 'then', 'than',
  'that', 'this', 'these', 'those', 'it', 'its', 'my', 'your', 'his', 'her',
  'our', 'their', 'what', 'which', 'who', 'whom', 'how', 'when', 'where', 'why',
  'all', 'each', 'every', 'both', 'few', 'more', 'most', 'some', 'any', 'such',
  'about', 'into', 'over', 'after', 'before',
  'work', 'works', 'working', 'use', 'using', 'used', 'get', 'got', 'make', 'made',
  'need', 'want', 'like', 'just', 'also', 'still', 'already', 'very', 'much',
])

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

interface IndexItem {
  slug: string
  kind: 'entity' | 'knowledge'
  name: string
  type: string | null
  status: string | null
  parent: string | null
  next_action: string | null
  next_action_count: number
  staleness_days: number | null
  confidence: string | null
  reinforcement_count: number | null
  last_reinforced: string | null
  created: string
  last_touched: string | null
  body: string
  file_hash: string
  subtype: string | null
  description: string | null
  resource: string | null
  brief: string | null
  session_log_count: number
  last_session_date: string | null
  last_session_type: string | null
  last_session_summary: string | null
}

export interface IndexQueryResult {
  items: IndexItem[]
  total: number
}

export interface HafezIndex {
  rebuild(): void
  syncIfStale(): void
  upsertFromFile(slug: string, kind: 'entity' | 'knowledge'): void
  removeItem(slug: string): void
  queryItems(opts: QueryOpts): IndexQueryResult
  search(query: string, kind?: 'entity' | 'knowledge' | 'all'): SearchResult[]
  getStats(): VaultStats
  /** Every indexed document, in the shape index.md is rendered from. */
  indexEntries(): VaultIndexRow[]
  close(): void
  // The public read surface (S5): the index's interface IS the query
  // interface — staleness sync, opts mapping, and row shaping live behind
  // these instead of in a pass-through module.
  queryEntities(opts?: EntityQueryOpts): { items: QueryResult[]; total: number }
  queryChildren(parentSlug: string): { items: QueryResult[]; total: number }
  queryRelatedTo(slug: string, relation?: string): { items: UnifiedResult[]; total: number }
  queryKnowledge(opts?: KnowledgeQueryOpts): { items: KnowledgeQueryResult[]; total: number }
  queryUnified(opts?: UnifiedQueryOpts): { items: UnifiedResult[]; total: number }
}

export interface QueryOpts {
  kind?: 'entity' | 'knowledge' | 'all'
  status?: string
  type?: string
  subtype?: string
  parent?: string
  relatedTo?: string
  relation?: string
  domain?: string
  confidence?: string
  filter?: string
  since?: string
  before?: string
  createdSince?: string
  createdBefore?: string
  tags?: string[]
  sort_by?: 'last_touched' | 'created' | 'name' | 'staleness' | 'last_reinforced' | 'reinforcement_count'
  sort_order?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

// --- Query input validation ---
//
// Every enum-ish query opt is checked before it can influence (or fail to
// influence) SQL. The mappers below only forward values they recognise, so an
// unchecked typo used to be *dropped*: `--filter actvie` ran unfiltered and
// exited 0. Validating here covers the CLI and library callers at once.

const SORT_COL_MAP: Record<string, string> = {
  name: 'i.name',
  created: 'i.created',
  last_touched: 'i.last_touched',
  staleness: 'i.staleness_days',
  reinforcement_count: 'i.reinforcement_count',
  last_reinforced: 'i.last_reinforced',
}
const KNOWLEDGE_ONLY_SORTS = new Set(['reinforcement_count', 'last_reinforced'])
const SORT_FIELDS = Object.keys(SORT_COL_MAP)
const SORT_ORDERS = ['asc', 'desc'] as const
const QUERY_FILTERS = [...ENTITY_STATUSES, 'all', 'stale', 'capture'] as const

function assertEnum(value: unknown, valid: readonly string[], label: string): void {
  if (value === undefined || value === null) return
  if (typeof value !== 'string' || !valid.includes(value)) {
    throw new HafezError('VALIDATION_FAILED', `Invalid ${label}: "${String(value)}". Valid values: ${valid.join(', ')}.`)
  }
}

function assertSortOrder(value: unknown): void {
  if (value === undefined || value === null) return
  if (typeof value !== 'string' || !SORT_ORDERS.includes(value.toLowerCase() as 'asc' | 'desc')) {
    throw new HafezError('VALIDATION_FAILED', `Invalid sort_order: "${String(value)}". Valid values: asc, desc.`)
  }
}

function assertCount(value: unknown, label: 'limit' | 'offset'): void {
  if (value === undefined || value === null) return
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new HafezError('VALIDATION_FAILED', `Invalid ${label}: "${String(value)}". Must be a non-negative integer.`)
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
type TimeOpts = Pick<EntityQueryOpts, 'since' | 'before' | 'createdSince' | 'createdBefore'>

function validateTimeOpts(opts?: TimeOpts): void {
  const fields = ['since', 'before', 'createdSince', 'createdBefore'] as const
  for (const f of fields) {
    if (opts?.[f] !== undefined && !ISO_DATE.test(opts[f]!)) {
      throw new HafezError('VALIDATION_FAILED', `Invalid date format for ${f}: "${opts[f]}". Must be YYYY-MM-DD.`)
    }
  }
}

function validateListOpts(opts?: ListOpts): void {
  assertEnum(opts?.sort_by, SORT_FIELDS, 'sort_by')
  assertSortOrder(opts?.sort_order)
  assertCount(opts?.limit, 'limit')
  assertCount(opts?.offset, 'offset')
}

// --- Shared query functions (used by both write and readonly paths) ---

function sanitizeFtsQuery(raw: string): { fts: string; terms: string[] } {
  // Unicode-aware: keep letters/digits/underscore in ANY script, strip
  // punctuation. `[^\w\s]` was ASCII-only, so it erased whole non-Latin
  // queries (日本語 → '') and the vault's non-Latin notes were unfindable.
  // For ASCII input this class is identical to the old one.
  const cleaned = raw.replace(/[^\p{L}\p{N}_\s]/gu, ' ')
  const tokens = cleaned.split(/\s+/).filter(t => t.length > 0)
  const filtered = tokens.filter(t => !STOPWORDS.has(t.toLowerCase()))
  // All-stopword queries fall back to the raw tokens — which is how bare
  // AND/OR/NOT reach fts5. Quoting makes every term a literal string, never
  // an operator, and a trailing `*` still gives prefix matching.
  const terms = filtered.length === 0 ? tokens : filtered
  return { fts: terms.map(t => `"${t.replace(/"/g, '""')}"*`).join(' OR '), terms }
}

function queryItemsFn(db: InstanceType<typeof Database>, opts: QueryOpts): IndexQueryResult {
  const conditions: string[] = []
  const params: Record<string, any> = {}

  if (opts.kind && opts.kind !== 'all') {
    conditions.push('i.kind = @kind')
    params.kind = opts.kind
  }
  if (opts.status) {
    // Status is an entity attribute — knowledge rows are indexed with a NULL
    // status. In a kind-unset (unified) query the status filter narrows the
    // entity side only; applying it to every row is what made `query --kind
    // all` (filter defaults to active) return entities and nothing else.
    conditions.push(opts.kind === 'entity' ? 'i.status = @status' : "(i.kind = 'knowledge' OR i.status = @status)")
    params.status = opts.status
  }
  if (opts.type) {
    conditions.push('i.type = @type')
    params.type = opts.type
  }
  if (opts.subtype) {
    conditions.push('i.subtype = @subtype')
    params.subtype = opts.subtype
  }
  if (opts.parent) {
    conditions.push('i.parent = @parent')
    params.parent = opts.parent
  }
  if (opts.confidence) {
    conditions.push('i.confidence = @confidence')
    params.confidence = opts.confidence
  }

  if (opts.domain) {
    conditions.push("EXISTS (SELECT 1 FROM links l WHERE l.source = i.slug AND l.relation = 'domain' AND l.target = @domain)")
    params.domain = opts.domain
  }
  if (opts.relatedTo) {
    const effectiveRelation = opts.relation ?? 'related' // backward compat default
    if (effectiveRelation === 'all') {
      conditions.push("EXISTS (SELECT 1 FROM links l WHERE l.source = i.slug AND l.target = @relatedTo)")
      params.relatedTo = opts.relatedTo
    } else {
      conditions.push("EXISTS (SELECT 1 FROM links l WHERE l.source = i.slug AND l.target = @relatedTo AND l.relation = @relation)")
      params.relatedTo = opts.relatedTo
      params.relation = effectiveRelation
    }
  }

  if (opts.filter === 'stale') {
    conditions.push("i.kind = 'entity'")
    conditions.push("i.status = 'active'")
    conditions.push(`(
      julianday('now') - julianday(i.last_touched) >
      CASE
        WHEN i.staleness_days IS NOT NULL THEN i.staleness_days
        ELSE 14
      END
    )`)
  }
  if (opts.filter === 'capture') {
    conditions.push("i.type = 'capture'")
  }

  if (opts.since) {
    conditions.push('i.last_touched >= @since')
    params.since = opts.since
  }
  if (opts.before) {
    conditions.push('i.last_touched <= @before')
    params.before = opts.before
  }
  if (opts.createdSince) {
    conditions.push('i.created >= @createdSince')
    params.createdSince = opts.createdSince
  }
  if (opts.createdBefore) {
    conditions.push('i.created <= @createdBefore')
    params.createdBefore = opts.createdBefore
  }

  if (opts.tags?.length) {
    for (let i = 0; i < opts.tags.length; i++) {
      const paramKey = `tag${i}`
      conditions.push(`EXISTS (SELECT 1 FROM links WHERE source = i.slug AND relation = 'tag' AND target = @${paramKey})`)
      params[paramKey] = opts.tags[i]
    }
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : ''

  // sort_order / limit / offset are the three opts that reach SQL as text
  // rather than bound params — check them at the interpolation site, so a
  // caller that skips the read surface can't hand raw SQL to prepare().
  assertSortOrder(opts.sort_order)
  assertCount(opts.limit, 'limit')
  assertCount(opts.offset, 'offset')

  let sortCol = 'i.last_touched'
  if (opts.sort_by) {
    const isKnowledgeOnly = KNOWLEDGE_ONLY_SORTS.has(opts.sort_by)
    const isEntityQuery = opts.kind === 'entity'
    if (isKnowledgeOnly && isEntityQuery) {
      sortCol = 'i.last_touched'
    } else if (SORT_COL_MAP[opts.sort_by]) {
      sortCol = SORT_COL_MAP[opts.sort_by]
    }
  }

  let sortOrder: 'ASC' | 'DESC'
  if (opts.sort_order) {
    sortOrder = opts.sort_order.toUpperCase() as 'ASC' | 'DESC'
  } else if (opts.sort_by === 'name' || opts.sort_by === 'staleness') {
    sortOrder = 'ASC'
  } else {
    sortOrder = 'DESC'
  }

  const countSql = `SELECT COUNT(*) as cnt FROM items i ${where}`
  const totalRow = db.prepare(countSql).get(params) as { cnt: number }
  const total = totalRow.cnt

  let limitClause = ''
  if (opts.limit != null) {
    limitClause = ` LIMIT ${opts.limit}`
    if (opts.offset != null) {
      limitClause += ` OFFSET ${opts.offset}`
    }
  } else if (opts.offset != null) {
    limitClause = ` LIMIT -1 OFFSET ${opts.offset}`
  }

  const sql = `SELECT i.slug, i.kind, i.name, i.type, i.status, i.parent,
                      i.next_action, i.next_action_count, i.staleness_days,
                      i.confidence, i.reinforcement_count, i.last_reinforced,
                      i.created, i.last_touched, i.subtype,
                      i.description, i.resource, i.brief, i.session_log_count, i.last_session_date,
                      i.last_session_type, i.last_session_summary
               FROM items i ${where}
               ORDER BY ${sortCol} ${sortOrder}${limitClause}`

  const rows = db.prepare(sql).all(params) as IndexItem[]

  const getRelated = db.prepare("SELECT target FROM links WHERE source = ? AND relation = 'related'")
  const getDomains = db.prepare("SELECT target FROM links WHERE source = ? AND relation = 'domain'")
  const getTags = db.prepare("SELECT target FROM links WHERE source = ? AND relation = 'tag'")
  for (const row of rows) {
    (row as any).related = (getRelated.all(row.slug) as Array<{ target: string }>).map(r => r.target)
    ;(row as any).domain = (getDomains.all(row.slug) as Array<{ target: string }>).map(r => r.target)
    ;(row as any).tags = (getTags.all(row.slug) as Array<{ target: string }>).map(r => r.target)
  }

  return { items: rows, total }
}

/** Every indexed document, in the shape index.md renders from. The vault-root
 * index needs name/status/type/confidence/description/domain and the body (for
 * the derived summary) — all of it already indexed, so regenerating index.md
 * after a mutation costs one query instead of a second full-vault parse. */
function indexEntriesFn(db: InstanceType<typeof Database>): VaultIndexRow[] {
  const rows = db.prepare(
    'SELECT slug, kind, name, type, status, confidence, description, body FROM items'
  ).all() as Array<Omit<VaultIndexRow, 'domain'>>
  const getDomains = db.prepare("SELECT target FROM links WHERE source = ? AND relation = 'domain'")
  return rows.map(row => ({
    ...row,
    domain: (getDomains.all(row.slug) as Array<{ target: string }>).map(d => d.target),
  }))
}

function searchFn(db: InstanceType<typeof Database>, query: string, kind?: 'entity' | 'knowledge' | 'all'): SearchResult[] {
  const { fts: ftsQuery, terms } = sanitizeFtsQuery(query)
  if (!ftsQuery) return []

  let kindFilter = ''
  const params: Record<string, any> = { query: ftsQuery }
  if (kind && kind !== 'all') {
    kindFilter = 'AND i.kind = @kind'
    params.kind = kind
  }

  const nameExact = query.replace(/'/g, "''")
  const nameLike = terms.map(t => `i.name LIKE '%${t.replace(/'/g, "''")}%'`).join(' AND ')
  const nameTermCount = terms.length > 1
    ? '0 - (' + terms.map(t => `(CASE WHEN LOWER(i.name) LIKE '%${t.replace(/'/g, "''").toLowerCase()}%' THEN 1 ELSE 0 END)`).join(' + ') + ')'
    : 'NULL'
  const termCoverageExpr = terms.length > 1
    ? '0 - (' + terms.map(t => {
        const escaped = t.replace(/'/g, "''").toLowerCase()
        return `(CASE WHEN LOWER(i.name) || ' ' || LOWER(i.body) LIKE '%${escaped}%' THEN 1 ELSE 0 END)`
      }).join(' + ') + ')'
    : 'NULL'
  const tfExpr = terms.length > 0
    ? '0 - (' + terms.map(t => {
        const escaped = t.replace(/'/g, "''").toLowerCase()
        return `(LENGTH(LOWER(i.body)) - LENGTH(REPLACE(LOWER(i.body), '${escaped}', ''))) / MAX(LENGTH('${escaped}'), 1)`
      }).join(' + ') + ')'
    : 'NULL'

  const sql = `
    SELECT i.slug, i.kind, i.name, i.type, i.status, i.confidence,
           snippet(items_fts, 1, '**', '**', '...', 30) as snippet
    FROM items_fts f
    JOIN items i ON i.rowid = f.rowid
    WHERE items_fts MATCH @query ${kindFilter}
    ORDER BY
      CASE
        WHEN LOWER(i.name) = LOWER('${nameExact}') THEN 0
        WHEN (${nameLike}) THEN 1
        ELSE 2
      END,
      ${nameTermCount},
      ${termCoverageExpr},
      ${tfExpr}
    LIMIT 20
  `

  return db.prepare(sql).all(params) as SearchResult[]
}

function getStatsFn(db: InstanceType<typeof Database>): VaultStats {
  const counts: Record<string, number> = { active: 0, paused: 0, done: 0 }
  const statusRows = db.prepare("SELECT status, COUNT(*) as cnt FROM items WHERE kind = 'entity' GROUP BY status").all() as Array<{ status: string; cnt: number }>
  for (const row of statusRows) {
    if (row.status in counts) counts[row.status] = row.cnt
  }

  const by_type: Record<string, number> = { capture: 0, entity: 0, project: 0 }
  const typeRows = db.prepare("SELECT type, COUNT(*) as cnt FROM items WHERE kind = 'entity' GROUP BY type").all() as Array<{ type: string; cnt: number }>
  for (const row of typeRows) {
    if (row.type in by_type) by_type[row.type] = row.cnt
  }

  const stale = db.prepare(`
    SELECT slug, name, type, CAST(julianday('now') - julianday(last_touched) AS INTEGER) as days_since_touched
    FROM items
    WHERE kind = 'entity' AND status = 'active'
      AND julianday('now') - julianday(last_touched) >
        CASE
          WHEN staleness_days IS NOT NULL THEN staleness_days
          ELSE 14
        END
    ORDER BY days_since_touched DESC
  `).all() as Array<{ slug: string; name: string; type: EntityType; days_since_touched: number }>

  const no_next_action = db.prepare(`
    SELECT slug, name, type FROM items
    WHERE kind = 'entity' AND status = 'active' AND next_action_count = 0
    ORDER BY last_touched DESC
  `).all() as Array<{ slug: string; name: string; type: EntityType }>

  // Full lists, not top-5: day-granularity timestamps tie massively (a
  // new vault ties on everything), so the caller resolves ties (git commit
  // time, then name) and caps. Name tiebreak here keeps the base order
  // deterministic instead of leaking SQLite row order.
  const recently_touched = db.prepare(`
    SELECT slug, name, last_touched FROM items
    WHERE kind = 'entity'
    ORDER BY last_touched DESC, name COLLATE NOCASE ASC
  `).all() as Array<{ slug: string; name: string; last_touched: string }>

  const recently_created = db.prepare(`
    SELECT slug, name, created FROM items
    WHERE kind = 'entity'
    ORDER BY created DESC, name COLLATE NOCASE ASC
  `).all() as Array<{ slug: string; name: string; created: string }>

  const knowledgeCount = (db.prepare("SELECT COUNT(*) as cnt FROM items WHERE kind = 'knowledge'").get() as { cnt: number }).cnt

  return {
    counts: counts as VaultStats['counts'],
    by_type: by_type as VaultStats['by_type'],
    knowledge_count: knowledgeCount,
    stale,
    no_next_action,
    recently_touched,
    recently_created,
  }
}

// Internal test seam — NOT public API (createHafez never exposes it). Fires
// inside syncIfStale after the scan has read the vault and before the new
// watermark is recorded, so the mid-scan-write race can be injected
// deterministically instead of raced against the clock.
// Recorded sync watermarks sit this far behind the scan-start instant: FS
// timestamps and Date.now() are read from the same kernel clock but round
// differently, and a write landing in that rounding gap must stay dirty.
const WATERMARK_SLACK_MS = 10

let afterScanHook: (() => void) | null = null
/** @internal */
export function __setAfterScanHook(fn: (() => void) | null): void { afterScanHook = fn }

// --- createIndex: overloaded for write and readonly modes ---

export function createIndex(vaultPath: string): HafezIndex
export function createIndex(vaultPath: string, opts: { readonly: true }): HafezIndex | null
export function createIndex(vaultPath: string, opts?: { readonly?: boolean }): HafezIndex | null {
  const dbPath = join(vaultPath, '.hafez.db')
  const isReadOnly = opts?.readonly ?? false

  if (isReadOnly) {
    if (!existsSync(dbPath)) return null

    let db = new Database(dbPath, { readonly: true })
    db.pragma('busy_timeout = 5000')
    let dbMtime = statSync(dbPath).mtimeMs

    // A stale schema is unusable, not merely stale: queries SELECT columns that
    // older schemas lack (e.g. description/resource) and would throw SqliteError.
    // Treat a version mismatch like a missing DB — warn and return null so
    // callers degrade to empty results until a write-capable command rebuilds.
    let storedVersion: string | undefined
    try {
      const vr = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string } | undefined
      storedVersion = vr?.value
    } catch { /* meta table may not exist */ }
    if (storedVersion !== SCHEMA_VERSION) {
      process.stderr.write(`Warning: .hafez.db schema v${storedVersion ?? 'unknown'} != expected v${SCHEMA_VERSION}. Ignoring index until a write command (e.g. hafez index rebuild) rebuilds it.\n`)
      try { db.close() } catch {}
      return null
    }

    function syncIfStale(): void {
      try {
        const currentMtime = statSync(dbPath).mtimeMs
        if (currentMtime !== dbMtime) {
          try { db.close() } catch {}
          db = new Database(dbPath, { readonly: true })
          db.pragma('busy_timeout = 5000')
          dbMtime = currentMtime
        }
      } catch { /* DB may have been temporarily deleted during rebuild */ }
    }

    return withReadSurface({
      rebuild: () => { throw new Error('Index is read-only') },
      syncIfStale,
      upsertFromFile: () => { throw new Error('Index is read-only') },
      removeItem: () => { throw new Error('Index is read-only') },
      queryItems: (qopts) => queryItemsFn(db, qopts),
      search: (q, k) => searchFn(db, q, k),
      getStats: () => getStatsFn(db),
      indexEntries: () => indexEntriesFn(db),
      close: () => { try { db.close() } catch {} },
    })
  }

  // --- Write-capable path ---
  // The db files are a disposable local cache — keep them out of the user's
  // `git status` without dirtying their vault with a tracked .gitignore.
  ensureLocalExclude(vaultPath)

  function removeDbFiles(): void {
    // The -wal/-shm siblings must go too: a fresh db next to a stale WAL is
    // itself corrupt.
    for (const suffix of ['', '-wal', '-shm']) {
      try { unlinkSync(dbPath + suffix) } catch { /* may not exist */ }
    }
  }

  function openDb(): InstanceType<typeof Database> {
    const fresh = new Database(dbPath)
    try {
      fresh.pragma('journal_mode = WAL')
      fresh.pragma('busy_timeout = 5000')
      fresh.pragma('foreign_keys = ON')
      fresh.exec(SCHEMA)
      return fresh
    } catch (err) {
      // Close before the caller unlinks — on filesystems without POSIX
      // delete-while-open semantics, unlinking an open db fails silently and
      // recovery would just reopen the same corrupt file.
      try { fresh.close() } catch { /* already unusable */ }
      throw err
    }
  }

  let db: InstanceType<typeof Database>
  try {
    db = openDb()
  } catch {
    // Corrupted DB (garbage bytes, truncated WAL checkpoint). better-sqlite3
    // doesn't touch the file until the first statement, so corruption surfaces
    // at the pragma/exec inside openDb, not at the constructor — the whole
    // open sequence must be inside this catch. The index is a disposable
    // cache: delete and rebuild.
    removeDbFiles()
    db = openDb()
  }

  // Schema migration: if next_action_count column missing, delete DB and recreate
  try {
    db.prepare('SELECT next_action_count FROM items LIMIT 0').run()
  } catch {
    db.close()
    removeDbFiles()
    db = openDb()
  }

  // Schema migration: if domain_entity column exists, delete DB and recreate
  try {
    db.prepare('SELECT domain_entity FROM items LIMIT 0').run()
    // Column exists — old schema, needs rebuild
    db.close()
    removeDbFiles()
    db = openDb()
  } catch {
    // Column doesn't exist — correct schema, continue
  }

  // Schema version check — forces full rebuild when indexing logic changes
  const versionRow = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string } | undefined
  if (!versionRow || versionRow.value !== SCHEMA_VERSION) {
    db.close()
    removeDbFiles()
    db = openDb()
    db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?)").run(SCHEMA_VERSION)
  }

  // Prepared statements
  // Plain INSERT, never INSERT OR REPLACE: REPLACE's implicit delete does not
  // fire the AFTER DELETE trigger (recursive_triggers is off), so the replaced
  // row's terms would linger in the external-content FTS index as ghosts.
  // Callers delete the row first — see indexFile.
  const insertStmt = db.prepare(`
    INSERT INTO items
      (slug, kind, name, type, status, parent, next_action, next_action_count, staleness_days,
       confidence, reinforcement_count, last_reinforced, created, last_touched, body, file_hash, subtype,
       description, resource, brief, session_log_count, last_session_date, last_session_type, last_session_summary)
    VALUES
      (@slug, @kind, @name, @type, @status, @parent, @next_action, @next_action_count, @staleness_days,
       @confidence, @reinforcement_count, @last_reinforced, @created, @last_touched, @body, @file_hash, @subtype,
       @description, @resource, @brief, @session_log_count, @last_session_date, @last_session_type, @last_session_summary)
  `)
  const deleteItemStmt = db.prepare('DELETE FROM items WHERE slug = ?')
  const deleteLinksStmt = db.prepare('DELETE FROM links WHERE source = ?')
  const insertLinkStmt = db.prepare('INSERT OR IGNORE INTO links (source, target, relation) VALUES (?, ?, ?)')
  const getHashStmt = db.prepare('SELECT file_hash FROM items WHERE slug = ?')

  function indexFile(filePath: string, kind: 'entity' | 'knowledge', knownSlugs?: Set<string>): void {
    const content = readFileSync(filePath, 'utf-8')
    const slug = basename(filePath, '.md')
    const hash = hashContent(content)

    // Skip if unchanged
    const existing = getHashStmt.get(slug) as { file_hash: string } | undefined
    if (existing && existing.file_hash === hash) return

    let fm: Record<string, any>, body: string
    try {
      const parsed = parseFilePath(filePath)
      fm = parsed.frontmatter as Record<string, any>
      body = parsed.body
    } catch (err) {
      process.stderr.write(`Warning: skipping ${kind}/${slug}.md: failed to parse (${(err as Error).message})\n`)
      return
    }

    // Validate required fields — skip malformed files instead of crashing
    if (!fm.name || !fm.created) {
      const missing = [!fm.name && 'name', !fm.created && 'created'].filter(Boolean).join(', ')
      process.stderr.write(`Warning: skipping ${kind}/${slug}.md: missing required field(s): ${missing}\n`)
      return
    }

    const doc = documentForFile({ kind })
    const bodyActions = doc.getNextActions(body)
    const nextAction = bodyActions.length > 0 ? bodyActions[0] : null
    const nextActionCount = bodyActions.length

    const brief = doc.getBrief(body)?.slice(0, 300) ?? null
    const logs = doc.parseSessionLog(body)
    const lastLog = logs[0] ?? null

    const item: IndexItem = {
      slug,
      kind,
      name: fm.name,
      type: kind === 'entity' ? (fm.type ?? null) : null,
      status: kind === 'entity' ? (fm.status ?? null) : null,
      parent: fm.parent ?? null,
      next_action: nextAction,
      next_action_count: nextActionCount,
      staleness_days: fm['staleness-days'] ?? null,
      confidence: kind === 'knowledge' ? (fm.confidence ?? null) : null,
      reinforcement_count: fm['reinforcement-count'] ?? null,
      last_reinforced: fm['last-reinforced'] ?? null,
      created: fm.created,
      last_touched: fm['last-touched'] ?? null,
      body,
      file_hash: hash,
      subtype: kind === 'knowledge' ? (fm.subtype ?? DEFAULT_KNOWLEDGE_SUBTYPE) : null,
      description: fm.description ?? null,
      resource: kind === 'entity' ? (fm.resource ?? null) : null,
      brief,
      session_log_count: logs.length,
      last_session_date: lastLog?.date ?? null,
      last_session_type: lastLog?.type ?? null,
      last_session_summary: lastLog?.summary?.slice(0, 300) ?? null,
    }

    // Replace item and rebuild links. Delete-then-insert keeps the FTS index
    // trigger-consistent for externally changed files (hand edit, git pull),
    // the same path hafez's own mutations take via upsertFromFile.
    deleteItemStmt.run(slug)
    deleteLinksStmt.run(slug)
    insertStmt.run(item)

    // Index related links
    if (fm.related && Array.isArray(fm.related)) {
      for (const target of fm.related) insertLinkStmt.run(slug, target, 'related')
    }
    // Index tags
    if (fm.tags && Array.isArray(fm.tags)) {
      for (const tag of fm.tags) insertLinkStmt.run(slug, tag, 'tag')
    }
    // Index domains for ALL item types (both entity and knowledge)
    if (fm.domain && Array.isArray(fm.domain)) {
      for (const d of fm.domain) insertLinkStmt.run(slug, d, 'domain')
    }

    // Index parent link
    if (fm.parent) {
      insertLinkStmt.run(slug, fm.parent, 'parent')
    }

    // Harvest [[wiki links]] from body (excluding ## Related section)
    // Strip the Related section to avoid double-counting generated links
    let authoredBody = body
    const relatedSection = doc.findSection(body, 'Related')
    if (relatedSection) {
      authoredBody = body.slice(0, relatedSection.start) + body.slice(relatedSection.end)
    }
    let wikiMatch: RegExpExecArray | null
    const linkRe = new RegExp(WIKI_LINK_RE.source, 'g')
    while ((wikiMatch = linkRe.exec(authoredBody)) !== null) {
      const targetSlug = wikiMatch[1]
      // Check if target file exists on disk (not in index — target may not be indexed yet)
      const targetEntityPath = join(vaultPath, kindDir('entity'), `${targetSlug}.md`)
      const targetKnowledgePath = join(vaultPath, kindDir('knowledge'), `${targetSlug}.md`)
      const targetExists = knownSlugs
        ? knownSlugs.has(targetSlug)
        : existsSync(targetEntityPath) || existsSync(targetKnowledgePath)
      if (targetExists) {
        insertLinkStmt.run(slug, targetSlug, 'mention')
      }
    }
  }

  const rebuildTransaction = db.transaction(() => {
    // Watermark the scan by when it STARTED (see syncIfStale).
    const scanStart = Date.now() - WATERMARK_SLACK_MS
    db.exec('DELETE FROM items')
    db.exec('DELETE FROM links')

    // Collect all vault slugs for wiki link target validation
    const allVaultSlugs = new Set<string>()
    for (const file of scanVaultDir(join(vaultPath, kindDir('entity')))) {
      allVaultSlugs.add(basename(file, '.md'))
    }
    for (const file of scanVaultDir(join(vaultPath, kindDir('knowledge')))) {
      allVaultSlugs.add(basename(file, '.md'))
    }

    for (const file of scanVaultDir(join(vaultPath, kindDir('entity')))) {
      indexFile(file, 'entity', allVaultSlugs)
    }
    for (const file of scanVaultDir(join(vaultPath, kindDir('knowledge')))) {
      indexFile(file, 'knowledge', allVaultSlugs)
    }

    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('last_sync', ?)")
      .run(scanStart.toString())
  })

  function rebuild(): void {
    rebuildTransaction()
  }

  function syncIfStale(): void {
    const lastSync = db.prepare("SELECT value FROM meta WHERE key = 'last_sync'").get() as { value: string } | undefined
    if (!lastSync) { rebuild(); return }

    const lastSyncTime = parseInt(lastSync.value, 10)
    let changed = false

    // Watermark the scan by when it STARTED, not when it finished. A file
    // written while the scan is in flight — after its read, before the record —
    // would otherwise be stamped as already-indexed and skipped by every later
    // sync, leaving it permanently stale. `>=` covers the same-millisecond
    // case; a re-read of an unchanged file is a cheap hash compare. The slack
    // absorbs FS-vs-Date.now clock rounding at the boundary — a file whose
    // mtime rounds just below the instant the scan started must still read as
    // dirty; the only cost is re-hashing files touched inside the window.
    const scanStart = Date.now() - WATERMARK_SLACK_MS

    const dirs = INDEXED_KINDS.map(kind => ({ dir: kindDir(kind), kind }))

    for (const { dir, kind } of dirs) {
      for (const file of scanVaultDir(join(vaultPath, dir))) {
        if (statSync(file).mtimeMs >= lastSyncTime) {
          indexFile(file, kind)
          changed = true
        }
      }
    }

    // Detect deleted files — remove orphaned DB entries
    const dbSlugs = (db.prepare('SELECT slug FROM items').all() as Array<{ slug: string }>).map(r => r.slug)
    const fileSlugs = new Set<string>()
    for (const { dir } of dirs) {
      for (const file of scanVaultDir(join(vaultPath, dir))) {
        fileSlugs.add(basename(file, '.md'))
      }
    }
    for (const slug of dbSlugs) {
      if (!fileSlugs.has(slug)) {
        removeItem(slug)
        changed = true
      }
    }

    afterScanHook?.()

    if (changed) {
      db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('last_sync', ?)")
        .run(scanStart.toString())
    }
  }

  function upsertFromFile(slug: string, kind: 'entity' | 'knowledge'): void {
    const filePath = join(vaultPath, kindDir(kind), `${slug}.md`)
    if (existsSync(filePath)) {
      // Force re-index by clearing cached hash
      deleteItemStmt.run(slug)
      deleteLinksStmt.run(slug)
      indexFile(filePath, kind)
    }
  }

  function removeItem(slug: string): void {
    deleteItemStmt.run(slug)
    deleteLinksStmt.run(slug)
  }

  // Auto-rebuild on first creation if empty
  const count = (db.prepare('SELECT COUNT(*) as c FROM items').get() as any).c
  if (count === 0) rebuild()

  return withReadSurface({
    rebuild, syncIfStale, upsertFromFile, removeItem,
    queryItems: (qopts) => queryItemsFn(db, qopts),
    search: (q, k) => searchFn(db, q, k),
    getStats: () => getStatsFn(db),
    indexEntries: () => indexEntriesFn(db),
    close: () => db.close(),
  })
}

// --- The read surface: opts mapping + row shaping over queryItemsFn ---

/** The five read-surface methods exist in exactly one place: attached here
 * over any core index (write-capable or read-only). */
type IndexCore = Omit<HafezIndex, 'queryEntities' | 'queryChildren' | 'queryRelatedTo' | 'queryKnowledge' | 'queryUnified'>

function withReadSurface(core: IndexCore): HafezIndex {
  const index: HafezIndex = {
    ...core,
    queryEntities: (opts) => queryEntitiesFn(index, opts),
    queryChildren: (parentSlug) => queryEntitiesFn(index, { parent: parentSlug }),
    queryRelatedTo: (slug, relation) => queryRelatedToFn(index, slug, relation),
    queryKnowledge: (opts) => queryKnowledgeFn(index, opts),
    queryUnified: (opts) => queryUnifiedFn(index, opts),
  }
  return index
}

function toQueryResult(slug: string, row: Record<string, any>): QueryResult {
  return {
    slug,
    name: row.name,
    type: row.type,
    status: row.status,
    description: row.description ?? null,
    resource: row.resource ?? null,
    domain: row.domain ?? [],
    last_touched: row.last_touched,
    next_action: row.next_action ?? null,
    next_action_count: row.next_action_count ?? 0,
    parent: row.parent ?? null,
    related: row.related ?? [],
    staleness_days: row.staleness_days ?? null,
    tags: row.tags ?? [],
    brief: row.brief ?? null,
    session_log_count: row.session_log_count ?? 0,
    last_session_date: row.last_session_date ?? null,
    last_session_type: row.last_session_type ?? null,
    last_session_summary: row.last_session_summary ?? null,
  }
}

function toKnowledgeResult(slug: string, row: Record<string, any>): KnowledgeQueryResult {
  return {
    slug,
    name: row.name,
    description: row.description ?? null,
    domain: row.domain ?? [],
    confidence: row.confidence ?? 'observation',
    related: row.related ?? [],
    reinforcement_count: row.reinforcement_count ?? 0,
    last_reinforced: row.last_reinforced ?? null,
    last_touched: row.last_touched ?? null,
  }
}

const STATUS_FILTERS = new Set<string>(ENTITY_STATUSES)

// One mapper per opts family: the entity filter set (entities + unified), the
// knowledge filter set (knowledge + unified), the time window (every kind
// carries created/last_touched), and the tags/sort/paging tail every list
// query shares. Each opt maps in exactly one place, so the filtered and
// unified views can't silently diverge. Domain appears in both filter mappers
// (both kinds carry it) — mapping it twice is idempotent.
type ListOpts = Pick<EntityQueryOpts, 'tags' | 'sort_by' | 'sort_order' | 'limit' | 'offset'>

function mapEntityFilterOpts(qopts: QueryOpts, opts?: EntityQueryOpts): void {
  if (opts?.filter && STATUS_FILTERS.has(opts.filter)) qopts.status = opts.filter
  if (opts?.filter === 'stale') qopts.filter = 'stale'
  if (opts?.filter === 'capture') qopts.filter = 'capture'
  if (opts?.type) qopts.type = opts.type
  if (opts?.parent) qopts.parent = opts.parent
  if (opts?.domain) qopts.domain = opts.domain
}

function mapTimeOpts(qopts: QueryOpts, opts?: TimeOpts): void {
  if (opts?.since) qopts.since = opts.since
  if (opts?.before) qopts.before = opts.before
  if (opts?.createdSince) qopts.createdSince = opts.createdSince
  if (opts?.createdBefore) qopts.createdBefore = opts.createdBefore
}

function mapListOpts(qopts: QueryOpts, opts?: ListOpts): void {
  if (opts?.tags) qopts.tags = opts.tags
  if (opts?.sort_by) qopts.sort_by = opts.sort_by
  if (opts?.sort_order) qopts.sort_order = opts.sort_order
  if (opts?.limit != null) qopts.limit = opts.limit
  if (opts?.offset != null) qopts.offset = opts.offset
}

function mapKnowledgeFilterOpts(qopts: QueryOpts, opts?: { domain?: string; confidence?: string; subtype?: string }): void {
  if (opts?.domain) qopts.domain = opts.domain
  if (opts?.confidence) qopts.confidence = opts.confidence
  if (opts?.subtype) qopts.subtype = opts.subtype
}

function validateEntityFilterOpts(opts?: EntityQueryOpts): void {
  assertEnum(opts?.filter, QUERY_FILTERS, 'filter')
  assertEnum(opts?.type, ENTITY_TYPES, 'type')
}

function validateKnowledgeFilterOpts(opts?: { confidence?: string; subtype?: string }): void {
  assertEnum(opts?.confidence, CONFIDENCE_LEVELS, 'confidence')
  assertEnum(opts?.subtype, VALID_SUBTYPES, 'subtype')
}

function queryEntitiesFn(index: HafezIndex, opts?: EntityQueryOpts): { items: QueryResult[], total: number } {
  index.syncIfStale()
  validateEntityFilterOpts(opts)
  validateKnowledgeFilterOpts(opts)
  validateTimeOpts(opts)
  validateListOpts(opts)
  const qopts: QueryOpts = { kind: 'entity' }
  mapEntityFilterOpts(qopts, opts)
  mapTimeOpts(qopts, opts)
  mapListOpts(qopts, opts)
  const { items, total } = index.queryItems(qopts)
  return { items: items.map(i => toQueryResult(i.slug, i)), total }
}

function queryRelatedToFn(index: HafezIndex, slug: string, relation?: string): { items: UnifiedResult[], total: number } {
  index.syncIfStale()
  const { items, total } = index.queryItems({ relatedTo: slug, relation })
  return {
    items: items.map(i =>
      i.kind === 'entity'
        ? { ...toQueryResult(i.slug, i), kind: 'entity' as const }
        : { ...toKnowledgeResult(i.slug, i), kind: 'knowledge' as const }
    ),
    total,
  }
}

function queryKnowledgeFn(index: HafezIndex, opts?: KnowledgeQueryOpts): { items: KnowledgeQueryResult[], total: number } {
  index.syncIfStale()
  validateKnowledgeFilterOpts(opts)
  validateTimeOpts(opts)
  validateListOpts(opts)
  const qopts: QueryOpts = { kind: 'knowledge' }
  mapKnowledgeFilterOpts(qopts, opts)
  mapTimeOpts(qopts, opts)
  mapListOpts(qopts, opts)
  const { items, total } = index.queryItems(qopts)
  return { items: items.map(i => toKnowledgeResult(i.slug, i)), total }
}

function queryUnifiedFn(
  index: HafezIndex,
  opts?: UnifiedQueryOpts,
): { items: UnifiedResult[], total: number } {
  index.syncIfStale()
  assertEnum(opts?.kind, ['entity', 'knowledge', 'all'], 'kind')
  validateEntityFilterOpts(opts)
  validateKnowledgeFilterOpts(opts)
  validateTimeOpts(opts)
  validateListOpts(opts)
  const qopts: QueryOpts = {}
  if (opts?.kind && opts.kind !== 'all') qopts.kind = opts.kind
  // When kind is 'all' or unset, no kind filter — both entities and knowledge are returned
  mapEntityFilterOpts(qopts, opts)
  mapKnowledgeFilterOpts(qopts, opts)
  mapTimeOpts(qopts, opts)
  mapListOpts(qopts, opts)

  const result = index.queryItems(qopts)
  const items: UnifiedResult[] = result.items.map(i => {
    if (i.kind === 'entity') {
      return { ...toQueryResult(i.slug, i), kind: 'entity' as const }
    } else {
      return { ...toKnowledgeResult(i.slug, i), kind: 'knowledge' as const }
    }
  })
  return { items, total: result.total }
}
