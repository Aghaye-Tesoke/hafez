// src/batch-ops.ts
// The Op Spec (see CONTEXT.md): one table defining every batch operation —
// shape (Zod), semantic check, description, and example hints — from which
// validation, error text, and schema introspection all derive. Adding an op
// means one entry here plus one arm in the Apply table (src/apply.ts), which
// the compiler enforces: the arm table is keyed by this table's names.
//
// Every semantic gate lives here and runs exactly once, in the validate phase.
// Apply assumes the payload it receives passed these checks.
import { z } from 'zod'
import type { BatchOperation, CreateEntityFields, CreateKnowledgeFields, KnowledgeSubtype, SessionLogEntry, UpdateFields } from './types.js'
import {
  ALIAS_KEYS,
  ENTITY_TYPES,
  ENTITY_STATUSES,
  SESSION_LOG_TYPES,
  CONFIDENCE_LEVELS,
  VALID_SUBTYPES,
  PLAN_STATUSES,
  getContract,
} from './contracts.js'
import { slugify } from './vault.js'
import { HafezError } from './types.js'

// --- Shapes ---
// All enums are built from contracts.ts tuples so help-renderer, file validators,
// and CLI-input validator share a single source of truth.
// Every z.object(...) is .strict() — unknown keys become `unrecognized_keys` issues
// (not silently dropped), which is load-bearing for the error-formatter's did-you-mean
// hints and for catching typos like `{"kind": "parent"}` on a link op.

export const SessionLogSchema = z.object({
  type: z.enum([...SESSION_LOG_TYPES] as [string, ...string[]]),
  summary: z.string(),
  body: z.string().optional(),
  agent: z.string(),
}).strict()

// Body-section text must have text after trimming. An empty or whitespace-only
// value (an agent expanding an unset variable) used to sail through the shape —
// on the action/evidence fields it was dropped by a truthiness guard in apply
// (exit 0, nothing on disk); on the section-setting fields below it was worse,
// because apply trusts the validate phase and `setSection(body, 'Synthesis',
// '')` wipes what was already there. Same false-success class the CLI loop
// closed for the enum flags, once silent and once destructive.
//
// The rule: every non-nullable string field that writes body-section text is
// nonEmptyText. The nullable ones (update's brief/description/resource) are
// excluded by construction — null is their documented clear signal, and the
// CLI maps `--brief ""` to it. Trimming also keeps accidental padding out of
// stored text.
const nonEmptyText = z.string().trim().min(1, 'must contain text — an empty value is rejected, never silently dropped')

export const UpdateFieldsSchema = z.object({
  status: z.enum([...ENTITY_STATUSES] as [string, ...string[]]).optional(),
  current_state: nonEmptyText.optional(),
  session_log: SessionLogSchema.optional(),
  brief: z.string().nullable().optional(),
  add_action: nonEmptyText.optional(),
  add_actions: z.array(nonEmptyText).optional(),
  complete_action: nonEmptyText.optional(),
  remove_action: nonEmptyText.optional(),
  clear_actions: z.boolean().optional(),
  // Knowledge metadata
  description: z.string().nullable().optional(),
  resource: z.string().nullable().optional(),
  domain: z.array(z.string()).optional(),
  confidence: z.enum([...CONFIDENCE_LEVELS] as [string, ...string[]]).optional(),
  tags: z.array(z.string()).optional(),
  related: z.array(z.string()).optional(),
  synthesis: nonEmptyText.optional(),
  insight: nonEmptyText.optional(),   // alias for synthesis (normalized by normalizeAliases)
  add_evidence: nonEmptyText.optional(),
  add_source: nonEmptyText.optional(),
}).strict()

export const CreateEntityFieldsSchema = z.object({
  type: z.enum([...ENTITY_TYPES] as [string, ...string[]]),
  purpose: nonEmptyText.optional(),
  description: z.string().optional(),
  resource: z.string().optional(),
  domain: z.array(z.string()).optional(),
  parent: z.string().optional(),
  related: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  brief: nonEmptyText.optional(),
  add_action: nonEmptyText.optional(),
  add_actions: z.array(nonEmptyText).optional(),
}).strict()

export const CreateKnowledgeFieldsSchema = z.object({
  subtype: z.enum([...VALID_SUBTYPES] as [string, ...string[]]).optional(),
  // Plan-only: insights have no lifecycle, so the semantic check rejects
  // status on any other subtype (the shape only pins the allowed values).
  status: z.enum([...PLAN_STATUSES] as [string, ...string[]]).optional(),
  synthesis: nonEmptyText.optional(),
  insight: nonEmptyText.optional(),
  description: z.string().optional(),
  domain: z.array(z.string()).optional(),
  related: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  'session-date': z.string().optional(),
}).strict()

export const CreateSessionFieldsSchema = z.object({
  synthesis: nonEmptyText.optional(),
  insight: nonEmptyText.optional(),
  related: z.array(z.string()).optional(),
  'session-date': z.string().optional(),
}).strict()

/** What `digest` may put in a session-create op — typechecked against the
 * schema so the two can never silently diverge again. */
export type CreateSessionFieldsInput = z.infer<typeof CreateSessionFieldsSchema>

const CreateEntityBranch = z.object({
  op: z.literal('create'),
  kind: z.literal('entity'),
  name: z.string(),
  fields: CreateEntityFieldsSchema,
}).strict()

const CreateKnowledgeBranch = z.object({
  op: z.literal('create'),
  kind: z.literal('knowledge'),
  name: z.string(),
  fields: CreateKnowledgeFieldsSchema.optional(),
}).strict()

const CreateSessionBranch = z.object({
  op: z.literal('create'),
  kind: z.literal('session'),
  name: z.string(),
  fields: CreateSessionFieldsSchema.optional(),
}).strict()

const UpdateBranch = z.object({
  op: z.literal('update'),
  slug: z.string(),
  fields: UpdateFieldsSchema,
}).strict()

const CaptureBranch = z.object({
  op: z.literal('capture'),
  name: z.string(),
  notes: z.string().optional(),
}).strict()

const LinkBranch = z.object({
  op: z.literal('link'),
  slug: z.string(),
  target: z.string(),
  relation: z.enum(['parent', 'related']),
}).strict()

const UnlinkBranch = z.object({
  op: z.literal('unlink'),
  slug: z.string(),
  target: z.string(),
  relation: z.enum(['parent', 'related']),
}).strict()

const PromoteBranch = z.object({
  op: z.literal('promote'),
  slug: z.string(),
  target: z.enum(['entity', 'project', 'knowledge']),
}).strict()

// Nested discriminated union: outer on `op`, inner on `kind` for create branch.
// A flat `discriminatedUnion('op', [...])` cannot work because three branches share
// op=create — Zod requires unique discriminator values per branch and throws at
// schema construction time if violated.
const CreateBranch = z.discriminatedUnion('kind', [
  CreateEntityBranch,
  CreateKnowledgeBranch,
  CreateSessionBranch,
])

export const BatchOperationSchema = z.discriminatedUnion('op', [
  UpdateBranch,
  // create is a nested discriminatedUnion on `kind` — see CreateBranch above.
  // discriminatedUnion accepts a ZodDiscriminatedUnion as a branch via option-flattening.
  CreateBranch as unknown as z.ZodObject<{ op: z.ZodLiteral<'create'> }>,
  CaptureBranch,
  LinkBranch,
  UnlinkBranch,
  PromoteBranch,
])

// --- Alias normalization ---
// The one place a declared alias (contracts.ts ALIAS_KEYS) becomes its canonical
// field. It runs before validation, so validate and apply both see the canonical
// op on every entry point — library create/update/batch and CLI batch input
// alike. Normalizing anywhere else is what made the alias a silent drop: the
// strict shapes accepted `insight`, nothing rewrote it, and the apply step (which
// only reads `synthesis`) wrote an empty Synthesis section and reported ok.

/** ALIAS_KEYS re-keyed by op path prefix: 'update.fields' → [[alias, canonical]]. */
const ALIASES_BY_PATH = new Map<string, [string, string][]>()
for (const [path, canonical] of Object.entries(ALIAS_KEYS)) {
  const cut = path.lastIndexOf('.')
  const prefix = path.slice(0, cut)
  const list = ALIASES_BY_PATH.get(prefix) ?? []
  list.push([path.slice(cut + 1), canonical])
  ALIASES_BY_PATH.set(prefix, list)
}

/** Canonicalize an operation's declared aliases.
 *
 * Precedence when both are present: the canonical field wins and the alias is
 * dropped. Never mutates the caller's object — an op carrying no alias is
 * returned as-is. */
export function normalizeAliases<T>(op: T): T {
  const o = op as { op?: unknown; kind?: unknown; fields?: Record<string, unknown> } | null
  if (!o || typeof o !== 'object' || !o.fields || typeof o.fields !== 'object') return op
  const prefix = `${String(o.op)}${o.kind === undefined ? '' : `.${String(o.kind)}`}.fields`
  const aliases = ALIASES_BY_PATH.get(prefix)
  if (!aliases) return op
  let fields: Record<string, unknown> | undefined
  for (const [alias, canonical] of aliases) {
    if (o.fields[alias] === undefined) continue
    fields ??= { ...o.fields }
    if (fields[canonical] === undefined) fields[canonical] = fields[alias]
    delete fields[alias]
  }
  return fields ? { ...o, fields } as T : op
}

/** normalizeAliases over a payload — the form the Spine and dry-run use. */
export function normalizeOperations(operations: BatchOperation[]): BatchOperation[] {
  return operations.map(op => normalizeAliases(op))
}

// --- Semantic checks ---

/** What a slug resolves to. `subtype` is carried for knowledge so ops that
 * gate on the plan/insight distinction see it for files already on disk AND
 * for notes created earlier in the same batch. */
export interface ResolvedTarget {
  kind: 'entity' | 'knowledge'
  type: string
  subtype?: KnowledgeSubtype
}

/** Vault context handed to each spec's semantic check by validateBatchCore.
 * Simulation-aware: creates earlier in the batch count as existing. */
export interface OpCheckContext {
  resolve(slug: string): ResolvedTarget | null
  existsAnywhere(slug: string): boolean
  sessionExists(slug: string): boolean
  simulate(slug: string, info: ResolvedTarget): void
  simulateSession(slug: string): void
  /** Kind gating is subtype-aware for knowledge: a plan carries `status`,
   * an insight does not (see contracts.SUBTYPE_STATUSES). */
  validateKindFields(kind: 'entity' | 'knowledge', fields: UpdateFields, subtype?: KnowledgeSubtype): void
  validateSessionLogEntry(entry: SessionLogEntry): string[]
  buildEntityFrontmatter(name: string, fields: CreateEntityFields): void
  buildKnowledgeFrontmatter(name: string, fields: CreateKnowledgeFields): void
}

export interface OpCheckResult {
  slug: string
  errors: string[]
  created?: boolean
  warning?: string
  /** Error class of the primary failure, when it maps to a specific
   * HafezError code. The Spine uses it so single-op callers keep NOT_FOUND /
   * SLUG_EXISTS semantics (and their exit codes) through spec validation;
   * batch-level failures stay VALIDATION_FAILED regardless. */
  primaryCode?: 'NOT_FOUND' | 'SLUG_EXISTS'
}

function pushErr(errors: string[], err: unknown): void {
  const e = err as HafezError
  errors.push(e.details?.length ? `${e.message}: ${e.details.join('; ')}` : e.message)
}

/** The one source of the missing-slug error text — specs and the Spine's
 * shape-failure precedence rule (validateBatchCore) must not drift apart. */
export function notFoundError(slug: string): string {
  return `'${slug}' not found`
}

/** The one op-error line format. Every surface that localises an error to its
 * op — the validate phase's error list, apply's execution-time failures, and
 * the CLI's dry-run report — renders it through here, so an agent parsing
 * `op[i] (op slug): …` sees one shape whichever surface produced it. */
export function opErrorLine(index: number, op: string, slug: string, message: string): string {
  return `op[${index}] (${op} ${slug}): ${message}`
}

/** The one "the batch was rejected, nothing landed" header — shared by the
 * library's validate gate and the CLI's shape-parse gate, which reject the
 * same payload at different depths and must say so identically. `batch
 * --dry-run` deliberately words its own header differently: it reports a
 * hypothetical ("would be applied"), not a refusal. */
export function batchInvalidHeader(invalidCount: number, total: number): string {
  return `Batch failed validation: ${invalidCount} invalid operation${invalidCount === 1 ? '' : 's'} (0 of ${total} applied)`
}

/** The one source of the duplicate-session disposition text. A duplicate
 * session is not an error — the op is skipped and the batch continues — and
 * dry-run (spec warning) and apply (BatchResult.warning) report it with this
 * same sentence so the two can never drift. */
export function duplicateSessionWarning(slug: string): string {
  return `session '${slug}' already exists — op skipped (batch continues)`
}

/** The create-style gate, in one place so the invariant can't be re-broken:
 * a taken slug is a SLUG_EXISTS error and must NOT be simulated (simulating
 * over an existing slug shadows the real file's kind for later ops in the
 * batch). The builder runs before the claim — it must see the pre-claim
 * world so a self-referencing parent still fails. */
function claimNew(
  ctx: OpCheckContext,
  errors: string[],
  slug: string,
  info: ResolvedTarget,
  build?: () => void,
): OpCheckResult['primaryCode'] {
  const taken = ctx.existsAnywhere(slug)
  if (taken) errors.push(`Slug '${slug}' already exists`)
  if (build) { try { build() } catch (err) { pushErr(errors, err) } }
  if (!taken) ctx.simulate(slug, info)
  return taken ? 'SLUG_EXISTS' : undefined
}

// --- The table ---

export interface OpSpec {
  /** Stable identifier used by `schema <name>` and the op catalog. */
  name: string
  op: BatchOperation['op']
  kind?: 'entity' | 'knowledge' | 'session'
  schema: z.ZodType
  description: string
  /** Optional fields force-included in the generated example payload. */
  exampleInclude: readonly string[]
  check(op: any, ctx: OpCheckContext): OpCheckResult
}

// `as const satisfies` rather than a `: OpSpec[]` annotation: it keeps each
// row's `name` a literal, which is what OpSpecName (and through it the Apply
// table's key type) is derived from. OP_SPECS below re-exports the rows under
// the interface, so consumers still read optional fields (`kind`) off them.
const OP_SPEC_ROWS = [
  {
    name: 'update',
    op: 'update',
    schema: UpdateBranch,
    description: 'Update an entity or knowledge note (status, brief, next actions, session log, synthesis, …). `insight` is an alias for `synthesis` (knowledge-only; ignored when `synthesis` is also given). On knowledge notes `status` is plan-subtype only (active|done); insights reject it.',
    exampleInclude: ['status'],
    check(op: Extract<BatchOperation, { op: 'update' }>, ctx) {
      const errors: string[] = []
      let primaryCode: OpCheckResult['primaryCode']
      const target = ctx.resolve(op.slug)
      if (!target) { errors.push(notFoundError(op.slug)); primaryCode = 'NOT_FOUND' }
      else {
        try { ctx.validateKindFields(target.kind, op.fields, target.subtype) } catch (err) { pushErr(errors, err) }
      }
      if (op.fields.session_log) {
        const logErrors = ctx.validateSessionLogEntry(op.fields.session_log)
        if (logErrors.length > 0) errors.push(`Invalid session log entry: ${logErrors.join('; ')}`)
      }
      if (op.fields.related) {
        for (const r of op.fields.related) {
          if (!ctx.existsAnywhere(r)) errors.push(`Related slug '${r}' does not exist`)
        }
      }
      return { slug: op.slug, errors, primaryCode }
    },
  },
  {
    name: 'create-entity',
    op: 'create',
    kind: 'entity',
    schema: CreateEntityBranch,
    description: 'Create a new entity (capture / entity / project). A field whose section the chosen type lacks is rejected, never dropped — `purpose` needs type project.',
    exampleInclude: ['type'],
    check(op: Extract<BatchOperation, { op: 'create'; kind: 'entity' }>, ctx) {
      const errors: string[] = []
      const slug = slugify(op.name)
      const primaryCode = claimNew(ctx, errors, slug, { kind: 'entity', type: op.fields.type },
        () => ctx.buildEntityFrontmatter(op.name, op.fields))
      return { slug, errors, created: errors.length === 0, primaryCode }
    },
  },
  {
    name: 'create-knowledge',
    op: 'create',
    kind: 'knowledge',
    schema: CreateKnowledgeBranch,
    description: 'Create a new knowledge note (insight / plan subtype). `insight` is an alias for `synthesis` (ignored when `synthesis` is also given). `status` (active|done) is plan-only; `synthesis` is insight-only — plan bodies are Goal/Steps/Dependencies, and a field whose section the subtype lacks is rejected, never dropped.',
    exampleInclude: ['subtype', 'synthesis'],
    check(op: Extract<BatchOperation, { op: 'create'; kind: 'knowledge' }>, ctx) {
      const errors: string[] = []
      const slug = slugify(op.name)
      const primaryCode = claimNew(ctx, errors, slug,
        { kind: 'knowledge', type: 'knowledge', subtype: op.fields?.subtype as KnowledgeSubtype | undefined },
        () => ctx.buildKnowledgeFrontmatter(op.name, (op.fields || {}) as CreateKnowledgeFields))
      return { slug, errors, created: errors.length === 0, primaryCode }
    },
  },
  {
    name: 'create-session',
    op: 'create',
    kind: 'session',
    schema: CreateSessionBranch,
    description: 'Create a new session note linked to an entity. `insight` is an alias for `synthesis` (ignored when `synthesis` is also given).',
    exampleInclude: ['synthesis'],
    check(op: Extract<BatchOperation, { op: 'create'; kind: 'session' }>, ctx) {
      const slug = slugify(op.name)
      if (ctx.existsAnywhere(slug) || ctx.sessionExists(slug)) {
        return { slug, errors: [], warning: duplicateSessionWarning(slug) }
      }
      ctx.simulateSession(slug)
      return { slug, errors: [], created: true }
    },
  },
  {
    name: 'capture',
    op: 'capture',
    schema: CaptureBranch,
    description: 'Quick capture — a raw inbox item with no structure required.',
    exampleInclude: ['notes'],
    check(op: Extract<BatchOperation, { op: 'capture' }>, ctx) {
      const errors: string[] = []
      const slug = slugify(op.name)
      const primaryCode = claimNew(ctx, errors, slug, { kind: 'entity', type: 'capture' })
      return { slug, errors, created: errors.length === 0, primaryCode }
    },
  },
  {
    name: 'link',
    op: 'link',
    schema: LinkBranch,
    description: 'Add a parent or related link between two entities.',
    exampleInclude: [],
    check(op: Extract<BatchOperation, { op: 'link' }>, ctx) {
      const errors: string[] = []
      let primaryCode: OpCheckResult['primaryCode']
      if (!ctx.resolve(op.slug)) { errors.push(notFoundError(op.slug)); primaryCode = 'NOT_FOUND' }
      if (!ctx.existsAnywhere(op.target)) errors.push(`Target '${op.target}' does not exist`)
      return { slug: op.slug, errors, primaryCode }
    },
  },
  {
    name: 'unlink',
    op: 'unlink',
    schema: UnlinkBranch,
    description: 'Remove a parent or related link between two entities.',
    exampleInclude: [],
    check(op: Extract<BatchOperation, { op: 'unlink' }>, ctx) {
      const errors: string[] = []
      let primaryCode: OpCheckResult['primaryCode']
      if (!ctx.resolve(op.slug)) { errors.push(notFoundError(op.slug)); primaryCode = 'NOT_FOUND' }
      return { slug: op.slug, errors, primaryCode }
    },
  },
  {
    name: 'promote',
    op: 'promote',
    schema: PromoteBranch,
    description: 'Promote a capture to entity/project/knowledge, or an entity to project.',
    exampleInclude: [],
    check(op: Extract<BatchOperation, { op: 'promote' }>, ctx) {
      const errors: string[] = []
      let primaryCode: OpCheckResult['primaryCode']
      const cur = ctx.resolve(op.slug)
      if (!cur) { errors.push(notFoundError(op.slug)); primaryCode = 'NOT_FOUND' }
      else {
        const currentType = cur.kind === 'knowledge' ? 'knowledge' : cur.type
        try {
          const contract = getContract(currentType)
          if (!contract.canPromoteTo.includes(op.target)) {
            errors.push(`Cannot promote ${currentType} to ${op.target}. Valid targets: ${contract.canPromoteTo.join(', ') || 'none (terminal type)'}`)
          } else {
            ctx.simulate(op.slug, op.target === 'knowledge' ? { kind: 'knowledge', type: 'knowledge' } : { kind: 'entity', type: op.target })
          }
        } catch (err) { pushErr(errors, err) }
      }
      return { slug: op.slug, errors, primaryCode }
    },
  },
] as const satisfies readonly OpSpec[]

/** Every op the table defines. The Apply table (src/apply.ts) is keyed by this
 * union, so a spec row added here without an apply arm fails to build. */
export type OpSpecName = (typeof OP_SPEC_ROWS)[number]['name']

export const OP_SPECS: readonly (OpSpec & { name: OpSpecName })[] = OP_SPEC_ROWS

/** Find the spec for a (shape-valid) operation. */
export function specFor(op: BatchOperation): OpSpec & { name: OpSpecName } {
  const spec = OP_SPECS.find(s => s.op === op.op && (s.kind === undefined || s.kind === (op as { kind?: string }).kind))
  if (!spec) throw new HafezError('VALIDATION_FAILED', `Unknown batch op: ${(op as { op?: string }).op}`)
  return spec
}

/** Op names for error text ("expected one of […]") — derived, never hardcoded. */
export function validOpNames(): string[] {
  return [...new Set(OP_SPECS.map(s => s.op))]
}

/** Ops whose payload addresses an existing file by `slug` — derived from the
 * Zod shapes, so a new slug-bearing op picks up slug-level rules (the
 * NOT_FOUND precedence on shape failure in validateBatchCore) without a
 * hand-kept list. */
export function slugBearingOpNames(): string[] {
  return [...new Set(OP_SPECS
    .filter(s => {
      const shape = (s.schema as { shape?: Record<string, unknown> }).shape
      return shape !== undefined && 'slug' in shape
    })
    .map(s => s.op))]
}

/** Create kinds for error text — derived from the table. */
export function validCreateKinds(): string[] {
  return OP_SPECS.filter(s => s.op === 'create' && s.kind).map(s => s.kind!)
}
