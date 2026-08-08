// tests/plan-subtype.test.ts
//
// Issue 08 — the plan subtype's documented contract must be reachable, and no
// create field may be silently dropped because the chosen template has no
// section to hold it.
//
// Two classes are pinned here:
//   1. `status` is documented "plan only" — it must be settable at create and
//      via update (library, batch, CLI), and must stay rejected on
//      insight-subtype notes.
//   2. Content fields whose target section the chosen template lacks
//      (`synthesis` on a plan, `purpose` on `--type entity`) are REJECTED, not
//      silently dropped. The policy is reject-never-route.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'child_process'
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import simpleGit from 'simple-git'
import { createHafez } from '../src/index.js'
import { parseFilePath, serializeFile } from '../src/vault.js'
import { createMemoryJournal } from './helpers/memory-journal.js'

const TMP = join(tmpdir(), 'hafez-plan-subtype-' + Date.now())
const VAULT = join(TMP, 'vault')

beforeAll(() => {
  mkdirSync(join(VAULT, 'entities'), { recursive: true })
  mkdirSync(join(VAULT, 'knowledge'), { recursive: true })
})

afterAll(() => rmSync(TMP, { recursive: true, force: true }))

function makeOS() {
  return createHafez({ vaultPath: VAULT, persistence: createMemoryJournal() })
}

function knowledgeFile(slug: string) {
  return parseFilePath(join(VAULT, 'knowledge', `${slug}.md`))
}

// --- 1. status on plan-subtype notes ---

describe('plan status: library path', () => {
  it('sets status at create on a plan-subtype note', async () => {
    const os = makeOS()
    const slug = await os.create('knowledge', 'Plan With Status', { subtype: 'plan', status: 'active' })
    const { frontmatter } = knowledgeFile(slug)
    expect(frontmatter.subtype).toBe('plan')
    expect(frontmatter.status).toBe('active')
  })

  it('changes status via update on a plan-subtype note', async () => {
    const os = makeOS()
    const slug = await os.create('knowledge', 'Plan Update Status', { subtype: 'plan' })
    await os.update(slug, { status: 'done' })
    expect(knowledgeFile(slug).frontmatter.status).toBe('done')
  })

  it('rejects a status value outside the plan lifecycle', async () => {
    const os = makeOS()
    const slug = await os.create('knowledge', 'Plan Bad Status', { subtype: 'plan' })
    await expect(os.update(slug, { status: 'paused' })).rejects.toThrow(/active, done/)
    expect(knowledgeFile(slug).frontmatter.status).toBeUndefined()
  })

  it('keeps status rejected on an insight-subtype note (update)', async () => {
    const os = makeOS()
    const slug = await os.create('knowledge', 'Insight No Status', { subtype: 'insight' })
    await expect(os.update(slug, { status: 'done' }))
      .rejects.toThrow('Cannot set entity-only fields on knowledge note: status')
  })

  it('keeps status rejected on a note with no persisted subtype (defaults to insight)', async () => {
    const os = makeOS()
    const slug = await os.create('knowledge', 'Untyped No Status', {})
    await expect(os.update(slug, { status: 'done' }))
      .rejects.toThrow('Cannot set entity-only fields on knowledge note: status')
  })

  it('rejects status at create on an insight-subtype note', async () => {
    const os = makeOS()
    await expect(os.create('knowledge', 'Insight Create Status', { subtype: 'insight', status: 'active' } as any))
      .rejects.toThrow(/plan/)
    expect(existsSync(join(VAULT, 'knowledge', 'insight-create-status.md'))).toBe(false)
  })
})

describe('plan status: batch path', () => {
  it('creates a plan with status and updates it in the same batch', async () => {
    const os = makeOS()
    await os.batch([
      { op: 'create', kind: 'knowledge', name: 'Batch Plan', fields: { subtype: 'plan', status: 'active' } },
      { op: 'update', slug: 'batch-plan', fields: { status: 'done' } },
    ] as any)
    const { frontmatter } = knowledgeFile('batch-plan')
    expect(frontmatter.subtype).toBe('plan')
    expect(frontmatter.status).toBe('done')
  })

  it('rejects status on an insight created in the same batch', async () => {
    const os = makeOS()
    const err = await os.batch([
      { op: 'create', kind: 'knowledge', name: 'Batch Insight', fields: { subtype: 'insight' } },
      { op: 'update', slug: 'batch-insight', fields: { status: 'done' } },
    ] as any).then(() => null, (e: any) => e)
    expect(err).not.toBeNull()
    expect((err.details ?? []).join('\n')).toMatch(/entity-only fields on knowledge note: status/)
    expect(existsSync(join(VAULT, 'knowledge', 'batch-insight.md'))).toBe(false)
  })
})

describe('promote still produces insight-subtype knowledge', () => {
  it('capture → knowledge lands as an insight with no status', async () => {
    const os = makeOS()
    await os.capture('Promote Me To Knowledge', 'raw note')
    await os.promote('promote-me-to-knowledge', 'knowledge')
    const { frontmatter, body } = knowledgeFile('promote-me-to-knowledge')
    expect(frontmatter.subtype).toBe('insight')
    expect(frontmatter.status).toBeUndefined()
    expect(body).toContain('## Synthesis')
  })
})

// --- 2. content fields with no section to land in ---

describe('create fields with no target section are rejected, never dropped', () => {
  it('rejects synthesis on a plan (plan bodies have Goal/Steps/Dependencies)', async () => {
    const os = makeOS()
    await expect(os.create('knowledge', 'Plan With Synthesis', { subtype: 'plan', synthesis: 'LOST TEXT' }))
      .rejects.toThrow(/Synthesis/)
    expect(existsSync(join(VAULT, 'knowledge', 'plan-with-synthesis.md'))).toBe(false)
  })

  it('accepts synthesis on an insight', async () => {
    const os = makeOS()
    const slug = await os.create('knowledge', 'Insight With Synthesis', { subtype: 'insight', synthesis: 'KEPT TEXT' })
    expect(readFileSync(join(VAULT, 'knowledge', `${slug}.md`), 'utf-8')).toContain('KEPT TEXT')
  })

  it('rejects purpose on --type entity (only the project template has Purpose)', async () => {
    const os = makeOS()
    await expect(os.create('entity', 'Entity With Purpose', { type: 'entity', purpose: 'LOST TEXT' }))
      .rejects.toThrow(/Purpose/)
    expect(existsSync(join(VAULT, 'entities', 'entity-with-purpose.md'))).toBe(false)
  })

  it('rejects purpose on --type capture', async () => {
    const os = makeOS()
    await expect(os.create('entity', 'Capture With Purpose', { type: 'capture', purpose: 'LOST TEXT' }))
      .rejects.toThrow(/Purpose/)
  })

  it('accepts purpose on --type project', async () => {
    const os = makeOS()
    const slug = await os.create('entity', 'Project With Purpose', { type: 'project', purpose: 'KEPT TEXT' })
    expect(readFileSync(join(VAULT, 'entities', `${slug}.md`), 'utf-8')).toContain('KEPT TEXT')
  })

  it('still accepts brief and actions on a plain entity (appear-on-write sections)', async () => {
    const os = makeOS()
    const slug = await os.create('entity', 'Entity With Brief', { type: 'entity', brief: 'B', add_action: 'A' })
    const text = readFileSync(join(VAULT, 'entities', `${slug}.md`), 'utf-8')
    expect(text).toContain('## Brief')
    expect(text).toContain('- [ ] A')
  })

  it('rejects the same mismatch through batch', async () => {
    const os = makeOS()
    const err = await os.batch([
      { op: 'create', kind: 'knowledge', name: 'Batch Plan Synthesis', fields: { subtype: 'plan', synthesis: 'LOST TEXT' } },
    ] as any).then(() => null, (e: any) => e)
    expect(err).not.toBeNull()
    expect((err.details ?? []).join('\n')).toMatch(/Synthesis/)
    expect(existsSync(join(VAULT, 'knowledge', 'batch-plan-synthesis.md'))).toBe(false)
  })
})

// --- 3. CLI path ---

describe('cli: plan status and dropped-field rejection', () => {
  const CLI_TMP = join(tmpdir(), 'hafez-plan-subtype-cli-' + Date.now())
  const CLI_VAULT = join(CLI_TMP, 'vault')
  const CLI = join(process.cwd(), 'dist', 'cli.js')

  function run(...args: string[]): { stdout: string; stderr: string; exitCode: number } {
    const r = spawnSync('node', [CLI, '--vault', CLI_VAULT, ...args], { encoding: 'utf-8' })
    return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', exitCode: r.status ?? 1 }
  }

  beforeAll(async () => {
    mkdirSync(join(CLI_VAULT, 'entities'), { recursive: true })
    mkdirSync(join(CLI_VAULT, 'knowledge'), { recursive: true })
    const git = simpleGit(CLI_VAULT)
    await git.init()
    writeFileSync(
      join(CLI_VAULT, 'entities', 'seed.md'),
      serializeFile(
        { name: 'Seed', type: 'project', status: 'active', created: '2026-01-01', 'last-touched': '2026-01-01' },
        '## Purpose\n\nSeed.\n\n## Session Log\n',
      ),
    )
    await git.add(['entities/seed.md'])
    await git.commit('seed')
  })

  afterAll(() => rmSync(CLI_TMP, { recursive: true, force: true }))

  it('creates a plan with --status and updates it with --status', () => {
    const created = run('create', 'knowledge', 'CLI Plan', '--subtype', 'plan', '--status', 'active')
    expect(created.exitCode).toBe(0)
    const file = join(CLI_VAULT, 'knowledge', 'cli-plan.md')
    expect(parseFilePath(file).frontmatter.status).toBe('active')

    const updated = run('update', 'cli-plan', '--status', 'done')
    expect(updated.exitCode).toBe(0)
    expect(parseFilePath(file).frontmatter.status).toBe('done')
  })

  it('rejects --status on an insight note', () => {
    const r = run('create', 'knowledge', 'CLI Insight Status', '--status', 'active')
    expect(r.exitCode).not.toBe(0)
    expect(existsSync(join(CLI_VAULT, 'knowledge', 'cli-insight-status.md'))).toBe(false)
  })

  it('rejects --synthesis on --subtype plan instead of dropping the text', () => {
    const r = run('create', 'knowledge', 'CLI Plan Synthesis', '--subtype', 'plan', '--synthesis', 'LOST TEXT')
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toMatch(/Synthesis/)
    expect(existsSync(join(CLI_VAULT, 'knowledge', 'cli-plan-synthesis.md'))).toBe(false)
  })

  it('rejects --purpose on --type entity instead of dropping the text', () => {
    const r = run('create', 'entity', 'CLI Entity Purpose', '--type', 'entity', '--purpose', 'LOST TEXT')
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toMatch(/Purpose/)
    expect(existsSync(join(CLI_VAULT, 'entities', 'cli-entity-purpose.md'))).toBe(false)
  })
})
