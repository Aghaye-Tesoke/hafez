// src/cli/commands.ts
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { parseArgs, splitList, str, UsageError, type FlagSpec } from './args.js'
import type { Hafez, ReadDepth, EntityType, QueryFilter, ConfidenceLevel, KnowledgeSubtype, CreateEntityFields, CreateKnowledgeFields, BatchOperation, KnowledgeQueryOpts, QueryResult, KnowledgeQueryResult } from '../types.js'
import { HafezError } from '../types.js'
import { BatchOperationSchema, normalizeAliases, opErrorLine, batchInvalidHeader } from '../batch-ops.js'
import { formatBatchError } from './batch-errors.js'
import { parseDigestInput, digest } from '../digest.js'
import { formatEntityHeader, formatKnowledgeHeader, formatQueryTable, formatKnowledgeTable, formatSearchResults, formatValidation, formatStats, formatChangelog } from './format.js'

export interface CommandOpts {
  json?: boolean
  /** Resolved vault path — for handlers that read the vault directly
   * (export) rather than through the Hafez instance. */
  vaultPath?: string
}

function jsonOut(data: unknown): string {
  return JSON.stringify(data, null, 2)
}

const READ_USAGE = 'Usage: hafez read <slug> [--depth frontmatter|summary|full]'
const READ_FLAGS: FlagSpec = { depth: 'string' }

export async function cmdRead(os: Hafez, args: string[], opts: CommandOpts = {}): Promise<string> {
  const { flags, positionals } = parseArgs(args, READ_FLAGS, READ_USAGE)
  const slug = positionals[0]
  if (!slug) throw new UsageError(READ_USAGE)
  const depth = (str(flags.depth) ?? 'summary') as ReadDepth
  const result = await os.read(slug, depth)
  if (opts.json) return jsonOut(result)
  const fm = result.frontmatter as Record<string, any>
  if (result.kind === 'entity') return formatEntityHeader(fm, result.body)
  return formatKnowledgeHeader(fm, result.body)
}

const QUERY_USAGE = `Usage: hafez query [--kind entity|knowledge|all] [--filter ...] [--type t] [--parent slug] [--related-to slug] [--domain d] [--confidence c] [--subtype s] [--tag t] [--since d] [--before d] [--created-since d] [--created-before d] [--sort-by f] [--sort-order asc|desc] [--limit n] [--offset n]

  --filter active|paused|done matches entity status; knowledge notes carry no
  status, so under --kind all they are always included alongside the matching
  entities. --filter stale|capture are entity-only views and return no
  knowledge. --filter/--type/--parent are rejected with --kind knowledge, and
  --confidence/--subtype are rejected with --kind entity, rather than being
  silently dropped. --related-to takes no other query flags.`
const QUERY_FLAGS: FlagSpec = {
  kind: 'string', filter: 'string', type: 'string', parent: 'string', 'related-to': 'string',
  domain: 'string', confidence: 'string', subtype: 'string', tag: 'string',
  since: 'string', before: 'string', 'created-since': 'string', 'created-before': 'string',
  'sort-by': 'string', 'sort-order': 'string', limit: 'string', offset: 'string',
}

/** Every flag the query parser accepts, for the branch-support matrix. */
export const QUERY_FLAG_NAMES = Object.keys(QUERY_FLAGS)

export type QueryBranch = 'entity' | 'knowledge' | 'all' | 'related-to'

/** Which flags each kind branch actually applies. A branch that cannot honour
 * a flag rejects it (below) instead of dropping it: `--kind knowledge --filter
 * stale` used to return every knowledge note with exit 0, and `--confidence`
 * never reached an entity query at all. */
export const QUERY_FLAG_SUPPORT: Record<QueryBranch, readonly string[]> = {
  entity: ['kind', 'filter', 'type', 'parent', 'domain', 'tag', 'since', 'before', 'created-since', 'created-before', 'sort-by', 'sort-order', 'limit', 'offset'],
  knowledge: ['kind', 'domain', 'confidence', 'subtype', 'tag', 'since', 'before', 'created-since', 'created-before', 'sort-by', 'sort-order', 'limit', 'offset'],
  all: ['kind', 'filter', 'type', 'parent', 'domain', 'confidence', 'subtype', 'tag', 'since', 'before', 'created-since', 'created-before', 'sort-by', 'sort-order', 'limit', 'offset'],
  'related-to': ['related-to'],
}

const FLAG_SCOPE_REASON: Record<string, string> = {
  filter: 'it selects entity status (or the entity-only stale/capture views); knowledge notes carry no status',
  type: 'entity types only',
  parent: 'entity hierarchy only',
  confidence: 'knowledge notes only',
  subtype: 'knowledge notes only',
}

const QUERY_KINDS = ['entity', 'knowledge', 'all'] as const

function rejectUnsupportedFlags(branch: QueryBranch, flags: Record<string, string | boolean | undefined>): void {
  const supported = new Set(QUERY_FLAG_SUPPORT[branch])
  for (const [name, value] of Object.entries(flags)) {
    if (value === undefined || supported.has(name)) continue
    const where = branch === 'related-to'
      ? 'with --related-to (it returns every entity and knowledge note linked to the slug)'
      : `with --kind ${branch}`
    const reason = FLAG_SCOPE_REASON[name] ? ` — ${FLAG_SCOPE_REASON[name]}` : ''
    throw new UsageError(`--${name} is not supported ${where}${reason}\n${QUERY_USAGE}`)
  }
}

/** Paging flags reach SQL as text — parse them strictly here so `--limit abc`
 * is a usage error rather than a prepare-time SqliteError. */
function intFlag(raw: string | undefined, name: string): number | undefined {
  if (raw === undefined) return undefined
  if (!/^\d+$/.test(raw)) throw new UsageError(`--${name} must be a non-negative integer (got "${raw}")\n${QUERY_USAGE}`)
  return Number(raw)
}

export async function cmdQuery(os: Hafez, args: string[], opts: CommandOpts = {}): Promise<string> {
  const { flags } = parseArgs(args, QUERY_FLAGS, QUERY_USAGE)
  const relatedTo = str(flags['related-to'])
  const branch: QueryBranch = relatedTo !== undefined ? 'related-to' : (str(flags.kind) ?? 'entity') as QueryBranch
  if (branch !== 'related-to' && !QUERY_KINDS.includes(branch as any)) {
    throw new UsageError(`--kind must be one of ${QUERY_KINDS.join(', ')} (got "${branch}")\n${QUERY_USAGE}`)
  }
  rejectUnsupportedFlags(branch, flags)

  const filter = (str(flags.filter) ?? 'active') as QueryFilter
  const type = str(flags.type) as EntityType | undefined
  const parent = str(flags.parent)
  const domain = str(flags.domain)
  const confidence = str(flags.confidence) as ConfidenceLevel | undefined
  const subtype = str(flags.subtype) as KnowledgeSubtype | undefined
  const since = str(flags.since)
  const before = str(flags.before)
  const createdSince = str(flags['created-since'])
  const createdBefore = str(flags['created-before'])
  const tagRaw = str(flags.tag)
  const tags = tagRaw ? tagRaw.split(',').map(t => t.trim()).filter(Boolean) : undefined
  const sortBy = str(flags['sort-by']) as any
  const sortOrder = str(flags['sort-order']) as 'asc' | 'desc' | undefined
  const limit = intFlag(str(flags.limit), 'limit')
  const offset = intFlag(str(flags.offset), 'offset')

  const sortOpts = { sort_by: sortBy, sort_order: sortOrder, limit, offset }
  const timeOpts = { since, before, createdSince, createdBefore }

  // --related-to: always returns both entities and knowledge
  if (relatedTo) {
    const result = await os.related_to(relatedTo)
    if (opts.json) return jsonOut(result)
    const { items: results, total } = result
    const entities = results.filter(r => r.kind === 'entity')
    const knowledge = results.filter(r => r.kind === 'knowledge')
    const sections: string[] = []
    if (entities.length > 0) sections.push('## Entities\n\n' + formatQueryTable(entities as any, total))
    if (knowledge.length > 0) sections.push('## Knowledge\n\n' + formatKnowledgeTable(knowledge as any, total))
    return sections.length > 0 ? sections.join('\n\n') : 'No results.'
  }

  const queryOpts = { filter, type, parent, domain, ...timeOpts, tags, ...sortOpts }

  // --kind knowledge: query knowledge only. The time window applies here too —
  // knowledge rows carry created (and last-touched for the plan subtype).
  if (branch === 'knowledge') {
    const kOpts: KnowledgeQueryOpts = { domain: domain ?? undefined, confidence, subtype, ...timeOpts, tags, ...sortOpts }
    const result = await os.query_knowledge(kOpts)
    if (opts.json) return jsonOut(result)
    return formatKnowledgeTable(result.items, result.total)
  }

  // --kind all: query both entities and knowledge via unified query
  if (branch === 'all') {
    const result = await os.queryUnified({ ...queryOpts, kind: 'all', confidence, subtype })
    if (opts.json) return jsonOut(result)
    const { items, total } = result
    const entities = items.filter(i => i.kind === 'entity')
    const knowledge = items.filter(i => i.kind === 'knowledge')
    const sections: string[] = []
    if (entities.length > 0) sections.push('## Entities\n\n' + formatQueryTable(entities as QueryResult[]))
    if (knowledge.length > 0) sections.push('## Knowledge\n\n' + formatKnowledgeTable(knowledge as KnowledgeQueryResult[]))
    if (items.length < total) sections.push(`\nShowing ${items.length} of ${total}`)
    return sections.length > 0 ? sections.join('\n\n') : 'No results.'
  }

  // --kind entity (default): query entities
  const result = await os.query(queryOpts)
  if (opts.json) return jsonOut(result)
  return formatQueryTable(result.items, result.total)
}

const SEARCH_USAGE = 'Usage: hafez search <terms> [--kind entity|knowledge|all]'
const SEARCH_FLAGS: FlagSpec = { kind: 'string' }

export async function cmdSearch(os: Hafez, args: string[], opts: CommandOpts = {}): Promise<string> {
  const { flags, positionals } = parseArgs(args, SEARCH_FLAGS, SEARCH_USAGE)
  const terms = positionals.join(' ')
  if (!terms) throw new UsageError(SEARCH_USAGE)
  const kind = (str(flags.kind) ?? 'all') as 'entity' | 'knowledge' | 'all'
  const results = await os.search(terms, kind)
  if (opts.json) return jsonOut(results)
  return formatSearchResults(results)
}

// --status is knowledge/plan only, and --purpose needs --type project: a field
// whose section the chosen template lacks is rejected, never silently dropped.
const CREATE_USAGE = 'Usage: hafez create <entity|knowledge> <name> [options]\n  entity:    --type capture|entity|project [--purpose text (project only)] [--brief text] [--add-action text] …\n  knowledge: [--subtype insight|plan] [--status active|done (plan only)] [--synthesis text (insight only)] …'
/** Exported so tests can assert the flag × kind matrix is exhaustive. */
export const CREATE_FLAGS: FlagSpec = {
  type: 'string', purpose: 'string', description: 'string', resource: 'string',
  domain: 'string', parent: 'string', related: 'string', tags: 'string',
  brief: 'string', 'add-action': 'string',
  subtype: 'string', synthesis: 'string', insight: 'string',
  // knowledge, plan subtype only — insights have no lifecycle
  status: 'string',
}

/** Flags whose value is a comma list. Everything else is a plain string. */
const CREATE_LIST_FLAGS = new Set(['domain', 'related', 'tags'])

/** Every provided create flag → its field name (dashes become underscores),
 * kind-agnostic on purpose. Which fields a kind accepts is the Op Spec's
 * call, not the CLI's: the per-kind hand-filter this replaces discarded
 * whatever its branch didn't name (--brief on knowledge, --subtype on
 * entity) and still exited 0 with the value nowhere on disk. Only provided
 * flags are included — a present-but-undefined key would trip the same
 * strict shape that does the rejecting. */
function createFields(flags: Record<string, string | boolean | undefined>): Record<string, unknown> {
  const fields: Record<string, unknown> = {}
  for (const flag of Object.keys(CREATE_FLAGS)) {
    if (flags[flag] === undefined) continue
    fields[flag.replace(/-/g, '_')] = CREATE_LIST_FLAGS.has(flag)
      ? splitList(flags[flag])
      : str(flags[flag])
  }
  return fields
}

export async function cmdCreate(os: Hafez, args: string[], opts: CommandOpts = {}): Promise<string> {
  const { flags, positionals } = parseArgs(args, CREATE_FLAGS, CREATE_USAGE)
  const kind = positionals[0]
  if (!kind) throw new UsageError(CREATE_USAGE)

  const name = positionals.slice(1).join(' ')
  if (!name) throw new UsageError(`Usage: hafez create ${kind} <name> [options]`)

  const fields = createFields(flags)

  if (kind === 'entity') {
    // The only per-kind rule the CLI still owns: --type is required, and a
    // missing one deserves better than a shape error naming a JSON field.
    if (fields.type === undefined) throw new UsageError('--type is required for entity creation')
    const slug = await os.create('entity', name, fields as unknown as CreateEntityFields)
    return opts.json ? jsonOut({ slug }) : slug
  }

  if (kind === 'knowledge') {
    // --insight passes through untouched: the Op Spec normalizes the alias
    // (and drops it when --synthesis is also given). On entity it stays
    // `insight` and the kind gate rejects it. --status flows through the
    // same way; the subtype-aware gate accepts it on plans only.
    const slug = await os.create('knowledge', name, fields as unknown as CreateKnowledgeFields)
    return opts.json ? jsonOut({ slug }) : slug
  }

  throw new UsageError(`Unknown kind: ${kind}. Use entity or knowledge.`)
}

const UPDATE_USAGE = 'Usage: hafez update <slug> [--brief text] [--description text] [--resource uri] [--add-action text] [--complete-action text] [--remove-action text] [--clear-actions] [--status s] [--log "type: summary"]'
/** Exported so tests can assert the table covers the update schema. */
export const UPDATE_FLAGS: FlagSpec = {
  status: 'string', 'current-state': 'string', brief: 'string',
  'add-action': 'string', 'complete-action': 'string', 'remove-action': 'string',
  'clear-actions': 'boolean',
  description: 'string', resource: 'string', domain: 'string', confidence: 'string',
  tags: 'string', related: 'string', insight: 'string', synthesis: 'string',
  'add-evidence': 'string', 'add-source': 'string',
  // Composed, not mapped: --log "type: summary" plus --agent build session_log.
  log: 'string', agent: 'string',
  // Removed flag, declared so it fails with guidance instead of a generic
  // unknown-flag error: older installed skills/scripts still pass it, and
  // "Updated <slug>" with the action discarded is a false success.
  'next-action': 'string',
}

/** Flags whose value is a comma list. Everything else is a plain string. */
const UPDATE_LIST_FLAGS = new Set(['domain', 'tags', 'related'])

/** Flags where an empty string is the clear signal — exactly the nullable
 * fields of the update shape. Every other flag passes its value through
 * untouched, so `--status ""` reaches the enum and is rejected by name
 * instead of silently no-opping (which is how it read before: the guard
 * each flag got was an accident of which one was typed). */
const UPDATE_CLEARABLE_FLAGS = new Set(['brief', 'description', 'resource'])

/** Flags the generic loop skips because they are not a field of the update
 * shape — each is hand-handled in cmdUpdate. */
export const UPDATE_SPECIAL_FLAGS = new Set(['log', 'agent', 'next-action'])

/** Update-shape fields with no flag of their own, and why. The exhaustiveness
 * test consults this, so a gap here is a stated decision rather than the
 * silent hole `add_actions` was. */
export const UPDATE_FIELDS_WITHOUT_FLAGS: Record<string, string> = {
  session_log: 'composed by --log "type: summary" (+ --agent), never passed raw',
  add_actions: 'array-valued: comma-splitting would mangle action text (actions carry commas), and the parser takes no repeated flags — batch payloads are the interface for multi-action writes',
}

/** Every provided update flag → its field name (dashes become underscores).
 * Which fields the target accepts is the Op Spec's call, not the CLI's — the
 * strict shape does all accepting and rejecting, exactly as on create. Only
 * provided flags are included: a present-but-undefined key would trip that
 * same strict shape. */
function updateFields(flags: Record<string, string | boolean | undefined>): Record<string, unknown> {
  const fields: Record<string, unknown> = {}
  for (const [flag, type] of Object.entries(UPDATE_FLAGS)) {
    const raw = flags[flag]
    if (raw === undefined || UPDATE_SPECIAL_FLAGS.has(flag)) continue
    const field = flag.replace(/-/g, '_')
    if (type === 'boolean') { fields[field] = true; continue }
    if (UPDATE_LIST_FLAGS.has(flag)) { fields[field] = splitList(raw); continue }
    const value = str(raw)
    fields[field] = value === '' && UPDATE_CLEARABLE_FLAGS.has(flag) ? null : value
  }
  return fields
}

export async function cmdUpdate(os: Hafez, args: string[], opts: CommandOpts = {}): Promise<string> {
  const { flags, positionals } = parseArgs(args, UPDATE_FLAGS, UPDATE_USAGE)
  const slug = positionals[0]
  if (!slug) throw new UsageError(UPDATE_USAGE)

  if (flags['next-action'] !== undefined) {
    throw new UsageError('--next-action was removed in v1.0.2. Use --add-action (and --clear-actions) instead.')
  }

  // --insight is the declared alias; the Op Spec normalizes it (and drops it
  // when --synthesis is also given).
  const fields = updateFields(flags)

  // The one genuinely CLI-owned convenience: session_log is a nested object,
  // so the flag pair composes it rather than naming a field.
  const log = str(flags.log)
  if (log !== undefined) {
    const colonIdx = log.indexOf(':')
    if (colonIdx === -1) throw new UsageError('--log format: "type: summary". Types: progress, decision, blocker, research')
    fields.session_log = {
      type: log.slice(0, colonIdx).trim(),
      summary: log.slice(colonIdx + 1).trim(),
      agent: str(flags.agent) ?? 'claude',
    }
  }

  const result = await os.update(slug, fields)
  if (opts.json) return jsonOut({ slug, ...result })
  const lines = [`Updated ${slug}`]
  if (result.matched_action) {
    lines.push(`matched action: ${result.matched_action}`)
  }
  return lines.join('\n')
}

const LINK_FLAGS: FlagSpec = { relation: 'string' }

function parseLinkArgs(args: string[], verb: 'link' | 'unlink'): { slug: string; target: string; relation: string } {
  const usage = `Usage: hafez ${verb} <slug> <target> --relation <parent|related>`
  const { flags, positionals } = parseArgs(args, LINK_FLAGS, usage)
  const relation = str(flags.relation)
  const [slug, target] = positionals
  if (!slug || !target || !relation) {
    throw new UsageError(usage)
  }
  if (!['parent', 'related'].includes(relation)) {
    throw new UsageError(`Invalid relation: ${relation}. Must be parent or related.`)
  }
  return { slug, target, relation }
}

export async function cmdLink(os: Hafez, args: string[], opts: CommandOpts = {}): Promise<string> {
  const { slug, target, relation } = parseLinkArgs(args, 'link')
  await os.link(slug, target, relation as any)
  return opts.json ? jsonOut({ slug, target, relation }) : `Linked ${slug} → ${target} (${relation})`
}

export async function cmdUnlink(os: Hafez, args: string[], opts: CommandOpts = {}): Promise<string> {
  const { slug, target, relation } = parseLinkArgs(args, 'unlink')
  await os.unlink(slug, target, relation as any)
  return opts.json ? jsonOut({ slug, target, relation }) : `Unlinked ${slug} — ${target} (${relation})`
}

/** Top-level capture command — aligns the CLI verb with the batch op name. */
const CAPTURE_USAGE = 'Usage: hafez capture <name> [--notes "text"]'
const CAPTURE_FLAGS: FlagSpec = { notes: 'string' }

export async function cmdCapture(os: Hafez, args: string[], opts: CommandOpts = {}): Promise<string> {
  const { flags, positionals } = parseArgs(args, CAPTURE_FLAGS, CAPTURE_USAGE)
  const name = positionals.join(' ')
  if (!name) throw new UsageError(CAPTURE_USAGE)
  const notes = str(flags.notes)
  const slug = await os.capture(name, notes)
  return opts.json ? jsonOut({ slug }) : slug
}

const PROMOTE_USAGE = 'Usage: hafez promote <slug> <entity|project|knowledge>'

export async function cmdPromote(os: Hafez, args: string[], opts: CommandOpts = {}): Promise<string> {
  const { positionals } = parseArgs(args, {}, PROMOTE_USAGE)
  const [slug, target] = positionals
  if (!slug || !target) throw new UsageError(PROMOTE_USAGE)
  // Target validity is core's rule (contract canPromoteTo) — no CLI re-check.
  await os.promote(slug, target as any)
  if (opts.json) return jsonOut({ slug, target })
  return `Promoted ${slug} → ${target}`
}

export async function cmdValidate(os: Hafez, _args: string[], opts: CommandOpts = {}): Promise<string> {
  const report = await os.validate()
  if (opts.json) return jsonOut(report)
  return formatValidation(report)
}

export async function cmdIndexRebuild(os: Hafez): Promise<string> {
  await os.rebuildIndex()
  return 'Index rebuilt.'
}

export async function cmdSync(os: Hafez, _args: string[]): Promise<string> {
  const result = await os.sync()
  if (!result.remote) return 'No remote configured — vault is local-only. Every write is already committed to git.'
  if (result.pulled && result.pushed) return 'Synced: pulled remote changes and pushed local commits.'
  if (result.pulled) return 'Synced: pulled remote changes.'
  if (result.pushed) return 'Synced: pushed local commits.'
  return 'Already up to date.'
}

export async function cmdStats(os: Hafez, _args: string[], opts: CommandOpts = {}): Promise<string> {
  const stats = await os.stats()
  if (opts.json) return jsonOut(stats)
  return formatStats(stats)
}

const CHANGELOG_USAGE = 'Usage: hafez changelog --since <date|relative>\nExamples: --since 2026-03-20, --since 7.days.ago, --since 1.week.ago'
const CHANGELOG_FLAGS: FlagSpec = { since: 'string' }

export async function cmdChangelog(os: Hafez, args: string[], opts: CommandOpts = {}): Promise<string> {
  const { flags } = parseArgs(args, CHANGELOG_FLAGS, CHANGELOG_USAGE)
  const since = str(flags.since)
  if (!since) throw new UsageError(CHANGELOG_USAGE)
  const entries = await os.changelog(since)
  if (opts.json) return jsonOut(entries)
  return formatChangelog(entries)
}

// --- Batch ---

// All enums are built from contracts.ts tuples so help-renderer, file validators,
// and CLI-input validator share a single source of truth — drift is structurally
// impossible (the Op Spec table in batch-ops.ts is the only consumer).
// Every z.object(...) is .strict() — unknown keys become `unrecognized_keys` issues
// (not silently dropped), which is load-bearing for the error-formatter's did-you-mean
// hints and for catching typos like `{"kind": "parent"}` on a link op.

export function parseBatchInput(json: string): BatchOperation[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new HafezError('VALIDATION_FAILED', 'Invalid JSON input for batch')
  }

  if (!Array.isArray(parsed)) {
    throw new HafezError('VALIDATION_FAILED', 'Batch input must be a JSON array')
  }

  if (parsed.length === 0) {
    throw new HafezError('VALIDATION_FAILED', 'Batch input must not be empty')
  }

  // Multi-error collect: iterate every op, accumulate formatted failure blocks,
  // throw once at the end with all N errors. Zero ops apply if any fail.
  const operations: BatchOperation[] = []
  const failureBlocks: string[] = []

  for (let i = 0; i < parsed.length; i++) {
    const raw = parsed[i] as Record<string, unknown>

    // Deprecated op: synthesize a failure block so it joins the multi-error
    // array rather than short-circuiting.
    if (raw?.op === 'reinforce') {
      const slugPart = raw.slug ? String(raw.slug) : '...'
      failureBlocks.push(
        [
          `[index ${i}] op=reinforce`,
          `  field: op`,
          `  issue: "reinforce" is deprecated`,
          `  use:   {"op": "update", "slug": "${slugPart}", "fields": {"add_evidence": "your evidence"}}`,
          `  tip: run \`hafez schema update\` for the full field list`,
        ].join('\n'),
      )
      continue
    }

    const result = BatchOperationSchema.safeParse(raw)
    if (!result.success) {
      failureBlocks.push(formatBatchError(result.error.issues, i, raw))
      continue
    }
    const op = result.data as Record<string, unknown> & { fields?: Record<string, unknown> }
    // Alias normalization is the Op Spec's (normalizeAliases) — the CLI just
    // hands back canonical ops so `batch --dry-run` output names real fields.
    operations.push(normalizeAliases(op) as BatchOperation)
  }

  if (failureBlocks.length > 0) {
    throw new HafezError('VALIDATION_FAILED', batchInvalidHeader(failureBlocks.length, parsed.length), failureBlocks)
  }

  return operations
}

// --file payload reader. Exists because Windows PowerShell 5.1 cannot pipe
// stdin to native executables — the documented pipe idiom fails there, so a
// file is the portable session-end path. PowerShell's own redirection writes
// UTF-16LE (and other tools write BOM'd UTF-8), so decode both rather than
// trading the pipe footgun for an encoding one.
function readPayloadFile(path: string): string {
  let buf: Buffer
  try {
    buf = readFileSync(path)
  } catch {
    throw new HafezError('VALIDATION_FAILED', `Cannot read --file: ${path}`)
  }
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le').replace(/^\uFEFF/, '')
  return buf.toString('utf-8').replace(/^\uFEFF/, '')
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    process.stdin.setEncoding('utf-8')
    process.stdin.on('data', chunk => { data += chunk })
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', reject)
  })
}

const BATCH_USAGE = "Usage: hafez batch [--dry-run] [--file payload.json]  (or pipe JSON to stdin)"
const BATCH_FLAGS: FlagSpec = { 'dry-run': 'boolean', file: 'string' }

export async function cmdBatch(os: Hafez, args: string[], opts: CommandOpts = {}): Promise<string> {
  const { flags } = parseArgs(args, BATCH_FLAGS, BATCH_USAGE)
  const dryRun = flags['dry-run'] === true
  const file = str(flags.file)
  const input = file ? readPayloadFile(file) : await readStdin()
  if (!input.trim()) {
    throw new HafezError('VALIDATION_FAILED', 'No input received. Pipe JSON array to stdin (echo \'[...]\' | hafez batch) or pass --file payload.json')
  }
  const operations = parseBatchInput(input)
  if (dryRun) {
    // Same validate phase as apply — dry-run can never green-light a payload
    // apply rejects. Reports derived slugs so agents can predict create slugs.
    const report = await os.validateBatch(operations)
    if (opts.json) return jsonOut(report)
    if (!report.valid) {
      const invalidCount = report.operations.filter(o => o.errors.length > 0).length
      const lines = report.operations.flatMap(o => o.errors.map(e => opErrorLine(o.index, o.op, o.slug, e)))
      // Dry-run's own header: it reports a hypothetical, so it says "would be
      // applied" rather than the refusal wording batchInvalidHeader carries.
      throw new HafezError(
        'VALIDATION_FAILED',
        `Batch invalid: ${invalidCount} of ${operations.length} operation${operations.length === 1 ? '' : 's'} failed validation (0 would be applied)`,
        lines,
      )
    }
    const out = [`Batch valid: ${operations.length} operations would be applied`]
    const creates = report.operations.filter(o => o.created)
    if (creates.length > 0) {
      out.push('Derived slugs:')
      for (const c of creates) out.push(`  op[${c.index}] ${c.op} → ${c.slug}`)
    }
    for (const o of report.operations) {
      if (o.warning) out.push(`Warning: op[${o.index}] ${o.warning}`)
    }
    return out.join('\n')
  }
  const results = await os.batch(operations)
  if (opts.json) return jsonOut(results)
  const created = results.filter(r => r.created).map(r => r.slug)
  let output = `Batch complete: ${operations.length} operations`
  if (created.length > 0) output += ` (created: ${created.join(', ')})`
  // Skipped ops carry the same warning line dry-run printed for them.
  const lines = [output]
  results.forEach((r, i) => {
    if (r.status === 'skipped' && r.warning) lines.push(`Warning: op[${i}] ${r.warning}`)
  })
  return lines.join('\n')
}

const DIGEST_USAGE = 'Usage: hafez digest [--file summary.json]  (or pipe JSON to stdin)'
const DIGEST_FLAGS: FlagSpec = { file: 'string' }

export async function cmdDigest(os: Hafez, args: string[], _opts: CommandOpts = {}): Promise<string> {
  const { flags } = parseArgs(args, DIGEST_FLAGS, DIGEST_USAGE)
  const file = str(flags.file)
  const raw = file ? readPayloadFile(file) : await readStdin()
  if (!raw.trim()) {
    throw new UsageError('No input received. Pipe JSON object to stdin (echo \'{"entities_touched":...}\' | hafez digest) or pass --file summary.json')
  }

  // Parse JSON
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new HafezError('VALIDATION_FAILED', 'Invalid JSON on stdin: ' + (raw.slice(0, 80)))
  }

  const result = parseDigestInput(parsed)
  if (!result.success) {
    const fields = result.error.issues.map(i => i.path.join('.')).join(', ')
    throw new HafezError('VALIDATION_FAILED', `Invalid digest input — missing or invalid fields: ${fields}`)
  }

  // Warn about unknown fields
  if (result.unknownFields.length > 0) {
    process.stderr.write(`Warning: digest input contains unknown fields (may indicate Zod safeParse silent-strip): ${result.unknownFields.join(', ')}\n`)
  }

  // Resolve existing entity slugs — digest only generates update ops for entities
  const { items: entityItems } = await os.query({ filter: 'all', limit: 9999 })
  const existingSlugs = new Set(entityItems.map(i => i.slug))

  // Warn about unknown entity slugs
  const unknownSlugs = result.data.entities_touched.filter(s => !existingSlugs.has(s))
  for (const slug of unknownSlugs) {
    process.stderr.write(`Warning: entity slug '${slug}' not found in vault — skipping session log update\n`)
  }

  const ops = digest(result.data, existingSlugs)
  return JSON.stringify(ops, null, 2)
}


export async function cmdExport(_os: Hafez, args: string[], opts: CommandOpts = {}): Promise<string> {
  const EXPORT_USAGE = 'Usage: hafez export --okf [--out <dir>]'
  const { flags } = parseArgs(args, { okf: 'boolean', out: 'string' }, EXPORT_USAGE)
  if (flags.okf !== true) throw new UsageError(EXPORT_USAGE)
  const outDir = typeof flags.out === 'string' ? resolve(flags.out) : resolve(process.cwd(), 'okf-export')
  if (!opts.vaultPath) throw new HafezError('VALIDATION_FAILED', 'export requires a resolved vault path (CommandOpts.vaultPath)')
  const { exportOkf } = await import('../export-okf.js')
  const exportReport = exportOkf(opts.vaultPath, outDir)
  if (opts.json) return JSON.stringify(exportReport, null, 2)
  const lines = [`Exported ${exportReport.entities} entities, ${exportReport.knowledge} knowledge, ${exportReport.sessions} sessions to ${exportReport.outDir}`]
  for (const s of exportReport.skipped) lines.push(`  skipped ${s.file}: ${s.reason}`)
  if (exportReport.unresolvedLinks > 0) lines.push(`  unresolved links: ${exportReport.unresolvedLinks}`)
  return lines.join('\n')
}
