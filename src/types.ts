// src/types.ts

// Type-only import: erased at compile time, so contracts.ts importing back
// from here stays a types-only cycle with no runtime edge.
import type {
  ENTITY_TYPES,
  ENTITY_STATUSES,
  CONFIDENCE_LEVELS,
  SESSION_LOG_TYPES,
  VALID_SUBTYPES,
  PLAN_STATUSES,
} from './contracts.js'

// --- Enums ---
// Derived from the canonical tuples in contracts.ts — contracts is the single
// source of truth for enum membership, so a value added there widens the type
// here instead of needing a matching hand-edit that can drift.

export type EntityType = typeof ENTITY_TYPES[number]
export type EntityStatus = typeof ENTITY_STATUSES[number]
export type ConfidenceLevel = typeof CONFIDENCE_LEVELS[number]
export type SessionLogType = typeof SESSION_LOG_TYPES[number]
export type ReadDepth = 'frontmatter' | 'summary' | 'full'
export type QueryFilter = EntityStatus | 'all' | 'stale' | 'capture'
export type LinkRelation = 'parent' | 'related'
export type KnowledgeSubtype = typeof VALID_SUBTYPES[number]
/** Plans are the one knowledge subtype with a lifecycle (see PLAN_STATUSES). */
export type PlanStatus = typeof PLAN_STATUSES[number]

// --- Query Options ---

/** Sort fields, and the two an entity query cannot honour — reinforcement
 * lives on knowledge notes only. Asking for one on the entity branch is a
 * validation error, not a silent fall back to recency, so the entity opts
 * type declares only what that branch can actually sort by. */
export type SortField = 'last_touched' | 'created' | 'name' | 'staleness' | 'last_reinforced' | 'reinforcement_count'
export type EntitySortField = Exclude<SortField, 'last_reinforced' | 'reinforcement_count'>

export interface EntityQueryOpts {
  filter?: QueryFilter
  type?: EntityType
  parent?: string
  domain?: string
  since?: string          // ISO date — last_touched >= since
  before?: string         // ISO date — last_touched <= before
  createdSince?: string   // ISO date — created >= createdSince
  createdBefore?: string  // ISO date — created <= createdBefore
  tags?: string[]
  sort_by?: EntitySortField
  sort_order?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

export interface KnowledgeQueryOpts {
  domain?: string
  confidence?: ConfidenceLevel
  subtype?: KnowledgeSubtype
  since?: string          // ISO date — last_touched >= since (plan subtype only carries last-touched)
  before?: string         // ISO date — last_touched <= before
  createdSince?: string   // ISO date — created >= createdSince
  createdBefore?: string  // ISO date — created <= createdBefore
  tags?: string[]
  sort_by?: SortField
  sort_order?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

/** `kind: 'all'` (or unset): reaches both sides, so it takes opts from both
 * and can honour every sort field. Status filters narrow the entity side only
 * — knowledge notes carry no status and are never excluded by one. */
export interface AllQueryOpts extends Omit<EntityQueryOpts, 'sort_by'> {
  kind?: 'all'
  confidence?: ConfidenceLevel
  subtype?: KnowledgeSubtype
  sort_by?: SortField
}

/** The unified query, discriminated on `kind`. Naming a single kind narrows
 * this query to that kind's opts, because a narrowed branch maps no more than
 * the dedicated one does: an out-of-scope condition would land on a column the
 * selected kind leaves NULL and silently exclude every row. The read surface
 * rejects those at runtime for callers without types; the union is what makes
 * them a compile error first. */
export type UnifiedQueryOpts =
  | AllQueryOpts
  | (EntityQueryOpts & { kind: 'entity' })
  | (KnowledgeQueryOpts & { kind: 'knowledge' })

// --- Frontmatter ---

export interface EntityFrontmatter {
  name: string
  type: EntityType
  status: EntityStatus
  description?: string
  resource?: string
  domain?: string[]
  parent?: string
  related?: string[]
  created: string      // YYYY-MM-DD
  'last-touched': string // YYYY-MM-DD
  'staleness-days'?: number
  tags?: string[]
}

export interface KnowledgeFrontmatter {
  name: string
  subtype?: KnowledgeSubtype
  description?: string
  domain?: string[]
  confidence?: ConfidenceLevel
  related?: string[]
  created: string
  'last-reinforced'?: string
  'reinforcement-count'?: number
  tags?: string[]
  'session-date'?: string
  status?: PlanStatus            // plan subtype only
  'last-touched'?: string         // plan subtype only
}

// --- Parsed file ---

export interface SessionFrontmatter {
  name: string
  created: string
  'session-date'?: string
  related?: string[]
}

/** What parseFilePath returns: the kind comes from Layout (the file's
 * directory), so consumers switch on `kind` instead of sniffing keys. */
export type ParsedVaultFile =
  | { kind: 'entity'; frontmatter: EntityFrontmatter; body: string }
  | { kind: 'knowledge'; frontmatter: KnowledgeFrontmatter; body: string }
  | { kind: 'session'; frontmatter: SessionFrontmatter; body: string }

/** What read() returns: the indexed arms of ParsedVaultFile (a session slug is
 * never resolvable through read()), so consumers narrow on `kind`. */
export type ParsedFile = Extract<ParsedVaultFile, { kind: 'entity' | 'knowledge' }>

// --- Session log ---

export interface SessionLogEntry {
  type: SessionLogType
  summary: string
  body?: string
  agent: string
}

export interface ParsedSessionLogEntry {
  date: string
  agent: string
  type: SessionLogType
  summary: string
  body: string
}

// --- Operation inputs ---

export interface UpdateFields {
  status?: EntityStatus
  current_state?: string
  session_log?: SessionLogEntry
  agent?: string                     // entity-only; names the agent on the entry added when session_log is absent (default: detected from the Harness)
  brief?: string | null              // string = set/replace, null = remove section
  // Next Actions fields compose within one op as prune, tick, add:
  // clear_actions → remove_action(s) → complete_action(s) → add_action(s).
  // Queries match the list as it was before the op (two queries naming one
  // line is an error); added lines land last.
  add_action?: string                // add one item to Next Actions
  add_actions?: string[]             // add multiple items to Next Actions
  complete_action?: string           // complete the item: an open line's Handle, else a substring (case-insensitive)
  complete_actions?: string[]        // complete several items, each query as complete_action
  remove_action?: string             // remove the item without completing: Handle or substring, as above
  remove_actions?: string[]          // remove several items, each query as remove_action
  clear_actions?: boolean            // remove entire Next Actions section (rejected with a query field)
  parent?: string                    // entity-only; sets the parent link (slug must exist)
  // Domain (shared) + knowledge-only metadata
  description?: string | null      // '' or null clears
  resource?: string | null         // entity-only canonical URI, '' or null clears
  domain?: string[]
  confidence?: ConfidenceLevel
  tags?: string[]
  related?: string[]
  synthesis?: string        // replaces insight — rewrites ## Synthesis section
  insight?: string          // alias for synthesis (knowledge-only); synthesis wins when both are set
  add_evidence?: string     // appends to ## Evidence section
  add_source?: string       // appends to ## Sources section
}

export interface UpdateResult {
  completed_action?: string              // text of the line complete_action matched, stamp stripped
  removed_action?: string                // text of the line remove_action matched, stamp stripped
  completed_actions?: string[]           // texts of the lines complete_actions matched, in query order
  removed_actions?: string[]             // texts of the lines remove_actions matched, in query order
  logged?: true                          // a session log entry was written: given, or mechanised by the Spine
}

export interface CreateEntityFields {
  type: EntityType
  purpose?: string
  description?: string
  resource?: string
  domain?: string[]
  parent?: string
  related?: string[]
  tags?: string[]
  brief?: string
  add_action?: string
  add_actions?: string[]
}

export interface CreateKnowledgeFields {
  subtype?: KnowledgeSubtype
  status?: PlanStatus       // plan subtype only — insights have no lifecycle
  confidence?: ConfidenceLevel  // defaults to observation
  synthesis?: string        // replaces insight
  insight?: string          // alias for synthesis; synthesis wins when both are set
  description?: string
  domain?: string[]
  related?: string[]
  tags?: string[]
  'session-date'?: string  // ISO date for session notes
}

// --- Operation results ---

export interface QueryResult {
  slug: string
  name: string
  type: EntityType
  status: EntityStatus
  description: string | null
  resource: string | null
  domain: string[]
  last_touched: string
  next_action: string | null
  next_action_count: number        // total unchecked items
  parent: string | null
  related: string[]
  staleness_days: number | null
  tags: string[]
  brief: string | null
  session_log_count: number
  last_session_date: string | null
  last_session_type: string | null
  last_session_summary: string | null
}

export interface KnowledgeQueryResult {
  slug: string
  name: string
  description: string | null
  domain: string[]
  confidence: ConfidenceLevel
  related: string[]
  reinforcement_count: number
  last_reinforced: string | null
  last_touched: string | null
}

export type UnifiedResult =
  | (QueryResult & { kind: 'entity' })
  | (KnowledgeQueryResult & { kind: 'knowledge' })

export interface ValidationIssue {
  slug: string
  field: string
  issue: string
}

export interface ValidationReport {
  broken_slugs: ValidationIssue[]
  orphaned_knowledge: string[]
  missing_fields: ValidationIssue[]
  total_entities: number
  total_knowledge: number
}

export interface SearchResult {
  slug: string
  kind: 'entity' | 'knowledge'
  name: string
  snippet: string
  type?: EntityType
  status?: EntityStatus
  confidence?: ConfidenceLevel
}

// --- Vault Stats ---

export interface VaultStats {
  counts: Record<EntityStatus, number>
  by_type: Record<EntityType, number>
  knowledge_count: number
  stale: Array<{ slug: string; name: string; type: EntityType; days_since_touched: number }>
  no_next_action: Array<{ slug: string; name: string; type: EntityType }>
  recently_touched: Array<{ slug: string; name: string; last_touched: string }>
  recently_created: Array<{ slug: string; name: string; created: string }>
}

// --- Changelog ---

export interface ChangelogEntry {
  slug: string
  kind: 'entity' | 'knowledge'
  operation: 'created' | 'updated' | 'deleted'
  timestamp: string
  commit_message: string
}

// --- Batch ---

export interface BatchResult {
  op: string
  slug: string
  /** 'skipped' = the Op Spec green-lit the op but there was nothing to do
   * (today: a duplicate session note) — no write, no error, batch continues.
   * Dry-run reports the same disposition as a warning. */
  status: 'ok' | 'error' | 'skipped'
  error?: string
  /** Why an op was skipped — same text the dry-run warning carries. */
  warning?: string
  /** Error class when the failure — or the skip — maps to a specific HafezError
   * code, so a single-op caller unwrapping this result keeps the right exit code. */
  code?: 'SLUG_EXISTS'
  created?: boolean
}

export type BatchOperation =
  | { op: 'update'; slug: string; fields: UpdateFields }
  | { op: 'create'; kind: 'entity'; name: string; fields: CreateEntityFields }
  | { op: 'create'; kind: 'knowledge'; name: string; fields?: CreateKnowledgeFields }
  | { op: 'create'; kind: 'session'; name: string; fields?: CreateKnowledgeFields }
  | { op: 'capture'; name: string; notes?: string }
  | { op: 'link'; slug: string; target: string; relation: LinkRelation }
  | { op: 'unlink'; slug: string; target: string; relation: LinkRelation }
  | { op: 'promote'; slug: string; target: 'entity' | 'project' | 'knowledge' }
  | { op: 'delete'; slug: string }

/** What `delete` may remove. An entity is never deleted: it is retired with
 * `status: done`. */
export type DeletableKind = 'knowledge' | 'session'

// Per-op result of the shared validate phase (dry-run and apply both run it).
// `slug` is the derived slug for create/capture ops — the dry-run slug oracle.
export interface BatchOpValidation {
  index: number
  op: string
  slug: string
  created?: boolean
  errors: string[]
  warning?: string
  /** Error class of the primary failure (NOT_FOUND / SLUG_EXISTS) when it
   * maps to a specific HafezError code; single-op callers surface it as that
   * code, batch-level failures stay VALIDATION_FAILED. */
  primaryCode?: 'NOT_FOUND' | 'SLUG_EXISTS'
}

export interface BatchValidationReport {
  valid: boolean
  operations: BatchOpValidation[]
}

// --- Errors ---

export type HafezErrorCode = 'NOT_FOUND' | 'SLUG_EXISTS' | 'VALIDATION_FAILED' | 'GIT_PUSH_FAILED' | 'GIT_COMMIT_FAILED' | 'VAULT_LOCKED'

export class HafezError extends Error {
  constructor(public code: HafezErrorCode, message: string, public details?: string[]) {
    super(message)
    this.name = 'HafezError'
  }
}

// --- Config ---

export interface GitConfig {
  push?: boolean  // default true
}

/**
 * The persistence seam (see CONTEXT.md: Journal) — everything core needs
 * from the history layer behind vault mutations. Git satisfies it in
 * production (src/git.ts); tests may inject an in-memory adapter.
 */
export interface Journal {
  /** Persist one logical change: stage written+deleted paths (vault-relative)
   * and commit under message. Must clean up its own partial state (e.g.
   * staged files) before rethrowing on a commit-stage failure; a push-stage
   * failure surfaces as GIT_PUSH_FAILED with the commit kept. */
  commit(written: string[], deleted: string[], message: string): Promise<void>
  /** Bidirectional sync with the remote, if any. */
  sync(): Promise<{ pulled: boolean; pushed: boolean; remote: boolean }>
  /** History-derived changelog for entities/ and knowledge/ since a date. */
  changelog(since: string): Promise<ChangelogEntry[]>
  /** Newest history timestamp per vault file (modified = any change, added = creation). */
  fileTimes(mode: 'modified' | 'added'): Promise<Map<string, string>>
}

export interface HafezConfig {
  vaultPath: string
  readOnly?: boolean
  git?: GitConfig
  /** Override the persistence layer. Defaults to the git adapter. */
  persistence?: Journal
  onWrite?: (slug: string, operation: string) => void
}

// --- Public API ---

export interface Hafez {
  read(slug: string, depth?: ReadDepth): Promise<ParsedFile>
  update(slug: string, fields: UpdateFields): Promise<UpdateResult>
  query(opts?: EntityQueryOpts): Promise<{ items: QueryResult[], total: number }>
  queryUnified(opts?: UnifiedQueryOpts): Promise<{ items: UnifiedResult[], total: number }>
  create(kind: 'entity', name: string, fields: CreateEntityFields): Promise<string>
  create(kind: 'knowledge', name: string, fields?: CreateKnowledgeFields): Promise<string>
  capture(name: string, notes?: string): Promise<string>
  link(slug: string, target: string, relation: LinkRelation): Promise<void>
  unlink(slug: string, target: string, relation: LinkRelation): Promise<void>
  promote(slug: string, target: 'entity' | 'project' | 'knowledge'): Promise<string>
  /** Delete a knowledge or session note; resolves to the kind deleted. */
  delete(slug: string): Promise<DeletableKind>
  batch(operations: BatchOperation[]): Promise<BatchResult[]>
  validateBatch(operations: BatchOperation[]): Promise<BatchValidationReport>
  sync(): Promise<{ pulled: boolean; pushed: boolean; remote: boolean }>
  children(slug: string): Promise<{ items: QueryResult[], total: number }>
  related_to(slug: string, relation?: string): Promise<{ items: UnifiedResult[], total: number }>
  query_knowledge(opts?: KnowledgeQueryOpts): Promise<{ items: KnowledgeQueryResult[], total: number }>
  validate(): Promise<ValidationReport>
  search(query: string, kind?: 'entity' | 'knowledge' | 'all'): Promise<SearchResult[]>
  rebuildIndex(): Promise<void>
  stats(): Promise<VaultStats>
  changelog(since: string): Promise<ChangelogEntry[]>
}
