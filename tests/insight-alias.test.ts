// tests/insight-alias.test.ts
// The `insight` → `synthesis` alias must behave identically on every path.
// These are library-level (no CLI): the alias used to be normalized only in the
// CLI's batch-input parsing, so batch/create/update via the API validated,
// reported ok, and silently dropped the text.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createHafez } from '../src/index.js'
import { mkdirSync, rmSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createMemoryJournal } from './helpers/memory-journal.js'

const TMP = join(tmpdir(), 'hafez-test-insight-alias-' + Date.now())
const VAULT = join(TMP, 'vault')

beforeAll(() => {
  mkdirSync(join(VAULT, 'entities'), { recursive: true })
  mkdirSync(join(VAULT, 'knowledge'), { recursive: true })
  mkdirSync(join(VAULT, 'sessions'), { recursive: true })
})

afterAll(() => rmSync(TMP, { recursive: true, force: true }))

function makeOS() {
  return createHafez({ vaultPath: VAULT, persistence: createMemoryJournal() })
}

function knowledgeBody(slug: string): string {
  return readFileSync(join(VAULT, 'knowledge', `${slug}.md`), 'utf-8')
}

/** Text of the ## Synthesis section, trimmed. */
function synthesisOf(slug: string): string {
  const body = knowledgeBody(slug)
  const start = body.indexOf('## Synthesis')
  if (start === -1) return ''
  const rest = body.slice(start + '## Synthesis'.length)
  const end = rest.indexOf('\n## ')
  return (end === -1 ? rest : rest.slice(0, end)).trim()
}

describe('insight alias — create', () => {
  it('batch create-knowledge with fields.insight writes the text into Synthesis', async () => {
    const os = makeOS()
    const results = await os.batch([
      { op: 'create', kind: 'knowledge', name: 'Alias Batch Create', fields: { insight: 'Batch create text' } },
    ])
    expect(results[0].status).toBe('ok')
    expect(synthesisOf('alias-batch-create')).toBe('Batch create text')
  })

  it('os.create knowledge with insight writes the text into Synthesis', async () => {
    const os = makeOS()
    await os.create('knowledge', 'Alias Direct Create', { insight: 'Direct create text' })
    expect(synthesisOf('alias-direct-create')).toBe('Direct create text')
  })

  it('batch create-session with insight populates the Summary section', async () => {
    const os = makeOS()
    const results = await os.batch([
      { op: 'create', kind: 'session', name: 'Alias Session Create', fields: { insight: 'Session summary text' } },
    ])
    expect(results[0].status).toBe('ok')
    const body = readFileSync(join(VAULT, 'sessions', 'alias-session-create.md'), 'utf-8')
    expect(body).toContain('Session summary text')
  })

  it('insight on a create-entity op is rejected, not silently dropped', async () => {
    const os = makeOS()
    await expect(
      os.create('entity', 'Alias Entity Create', { type: 'entity', insight: 'nope' } as any),
    ).rejects.toThrow(/insight/)
  })
})

describe('insight alias — update', () => {
  it('os.update on knowledge with insight rewrites Synthesis (no silent no-op)', async () => {
    const os = makeOS()
    await os.create('knowledge', 'Alias Update Target', { synthesis: 'Original' })
    await os.update('alias-update-target', { insight: 'Updated via alias' })
    expect(synthesisOf('alias-update-target')).toBe('Updated via alias')
  })

  it('batch update on knowledge with insight rewrites Synthesis', async () => {
    const os = makeOS()
    await os.create('knowledge', 'Alias Batch Update Target', { synthesis: 'Original' })
    const results = await os.batch([
      { op: 'update', slug: 'alias-batch-update-target', fields: { insight: 'Updated via batch alias' } },
    ])
    expect(results[0].status).toBe('ok')
    expect(synthesisOf('alias-batch-update-target')).toBe('Updated via batch alias')
  })

  it('insight on an entity update is kind-gated (rejected), not a silent pass', async () => {
    const os = makeOS()
    await os.create('entity', 'Alias Entity Target', { type: 'entity' })
    await expect(os.update('alias-entity-target', { insight: 'nope' }))
      .rejects.toThrow(/knowledge-only/)
  })

  it('dry-run agrees with apply: insight on an entity update reports the same error', async () => {
    const os = makeOS()
    await os.create('entity', 'Alias Dryrun Target', { type: 'entity' })
    const report = await os.validateBatch([
      { op: 'update', slug: 'alias-dryrun-target', fields: { insight: 'nope' } },
    ])
    expect(report.valid).toBe(false)
    expect(report.operations[0].errors.join(' ')).toMatch(/knowledge-only/)
  })
})

describe('insight alias — both fields present', () => {
  // Documented precedence: the canonical field wins, the alias is ignored.
  it('create: synthesis wins over insight', async () => {
    const os = makeOS()
    await os.create('knowledge', 'Alias Both Create', { synthesis: 'Canonical', insight: 'Alias' })
    expect(synthesisOf('alias-both-create')).toBe('Canonical')
  })

  it('update: synthesis wins over insight', async () => {
    const os = makeOS()
    await os.create('knowledge', 'Alias Both Update', { synthesis: 'Original' })
    await os.update('alias-both-update', { synthesis: 'Canonical', insight: 'Alias' })
    expect(synthesisOf('alias-both-update')).toBe('Canonical')
  })
})
