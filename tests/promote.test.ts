// tests/promote.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createHafez } from './helpers/hafez.js'
import { HafezError } from '../src/types.js'
import { exitCodeFor } from '../src/cli/index.js'
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { execSync } from 'child_process'
import { asEntity, asKnowledge } from './helpers/vault-files.js'

function createTestVault(dirs: string[] = ['entities', 'knowledge']): string {
  const vaultPath = join(tmpdir(), `hafez-test-${randomUUID()}`)
  mkdirSync(vaultPath, { recursive: true })
  for (const d of dirs) mkdirSync(join(vaultPath, d), { recursive: true })
  execSync('git init', { cwd: vaultPath })
  execSync('git config user.email "test@test.com" && git config user.name "Test"', { cwd: vaultPath })
  return vaultPath
}

describe('promote', () => {
  let vaultPath: string
  let os: ReturnType<typeof createHafez>

  beforeEach(() => {
    vaultPath = createTestVault()
    os = createHafez({ vaultPath, git: { push: false } })
  })

  it('promotes capture to entity and preserves content', async () => {
    const slug = await os.capture('My Bug', 'Important finding about auth')
    await os.promote(slug, 'entity')
    const summary = asEntity(await os.read(slug))
    const full = await os.read(slug, 'full')
    expect(summary.frontmatter.type).toBe('entity')
    expect(summary.body).toContain('## Context')
    expect(summary.body).toContain('Important finding about auth')
    expect(full.body).toContain('## Session Log')
    expect(summary.body).not.toContain('## Notes')
  })

  it('promotes capture to project', async () => {
    const slug = await os.capture('My Feature')
    await os.promote(slug, 'project')
    const file = asEntity(await os.read(slug))
    expect(file.frontmatter.type).toBe('project')
    expect(file.body).toContain('## Purpose')
    expect(file.body).toContain('## Goals')
  })

  it('promotes capture to knowledge and strips entity fields', async () => {
    const slug = await os.capture('Interesting pattern')
    await os.promote(slug, 'knowledge')
    expect(existsSync(join(vaultPath, 'knowledge', `${slug}.md`))).toBe(true)
    expect(existsSync(join(vaultPath, 'entities', `${slug}.md`))).toBe(false)
    const file = asKnowledge(await os.read(slug))
    expect(file.body).toContain('## Synthesis')
    expect(file.frontmatter.status).toBeUndefined()
    expect(file.frontmatter['last-touched']).toBeUndefined()
    expect(file.frontmatter.subtype).toBe('insight')
  })

  it('promotes entity to project', async () => {
    await os.create('entity', 'Fix auth', { type: 'entity' })
    await os.promote('fix-auth', 'project')
    const file = asEntity(await os.read('fix-auth'))
    expect(file.frontmatter.type).toBe('project')
    expect(file.body).toContain('## Purpose')
  })

  it('rejects invalid promotion paths', async () => {
    await os.create('entity', 'Test Project', { type: 'project' })
    await expect(os.promote('test-project', 'entity')).rejects.toThrow()
  })

  it('records promotion in session log', async () => {
    const slug = await os.capture('My Bug')
    await os.promote(slug, 'entity')
    const file = await os.read(slug, 'full')
    expect(file.body).toContain('Promoted from capture')
  })

  it('commits the source-file deletion on promote to knowledge (clean tree)', async () => {
    const slug = await os.capture('Deletion must be staged')
    await os.promote(slug, 'knowledge')
    // The old entities/<slug>.md removal must be part of the promote commit —
    // otherwise the vault is left permanently dirty and later syncs break.
    const status = execSync('git status --porcelain', { cwd: vaultPath }).toString().trim()
    expect(status).toBe('')
    const show = execSync('git show --stat HEAD', { cwd: vaultPath }).toString()
    expect(show).toContain(`knowledge/${slug}.md`)
    expect(show).toContain(`entities/${slug}.md`)
  })

  it('copies description on promote to knowledge', async () => {
    const slug = await os.capture('Descriptive capture')
    await os.update(slug, { description: 'Carried over' })
    await os.promote(slug, 'knowledge')
    const file = asKnowledge(await os.read(slug))
    expect(file.frontmatter.description).toBe('Carried over')
  })

  it('drops resource on promote to knowledge', async () => {
    const slug = await os.capture('Resourced capture')
    await os.update(slug, { resource: 'https://example.com/repo' })
    await os.promote(slug, 'knowledge')
    const file = asKnowledge(await os.read(slug))
    expect(file.frontmatter).not.toHaveProperty('resource')
  })

  it('works in batch', async () => {
    const slug = await os.capture('Batch test')
    const results = await os.batch([
      { op: 'promote', slug, target: 'entity' }
    ])
    expect(results[0].status).toBe('ok')
    const file = asEntity(await os.read(slug))
    expect(file.frontmatter.type).toBe('entity')
  })
})

// Promote must behave like create AT THE TARGET: refuse to clobber an existing
// note, create the target dir if missing, and never leak a raw fs error.
describe('promote to knowledge — target hardening', () => {
  it('refuses to overwrite an existing knowledge note (SLUG_EXISTS, note untouched)', async () => {
    const vaultPath = createTestVault()
    const os = createHafez({ vaultPath, git: { push: false } })
    const slug = await os.capture('Diverged note')
    // Vault divergence: the same slug exists as both an entity and a knowledge
    // note (e.g. after a bad merge). Promote must not silently eat the note.
    const knPath = join(vaultPath, 'knowledge', `${slug}.md`)
    const existing = `---\nname: Diverged note\ncreated: 2026-01-01\n---\n\n## Synthesis\n\nPrecious pre-existing content.\n`
    writeFileSync(knPath, existing)

    const err = await os.promote(slug, 'knowledge').then(() => null, (e: unknown) => e)
    expect(err).toBeInstanceOf(HafezError)
    expect((err as HafezError).code).toBe('SLUG_EXISTS')
    expect(exitCodeFor(err)).not.toBe(0)
    // Existing note byte-identical, source entity still in place.
    expect(readFileSync(knPath, 'utf-8')).toBe(existing)
    expect(existsSync(join(vaultPath, 'entities', `${slug}.md`))).toBe(true)
  })

  it('creates the knowledge dir when the vault has none', async () => {
    const vaultPath = createTestVault(['entities'])
    const os = createHafez({ vaultPath, git: { push: false } })
    const slug = await os.capture('Entities only vault')

    await expect(os.promote(slug, 'knowledge')).resolves.toBe(slug)
    expect(existsSync(join(vaultPath, 'knowledge', `${slug}.md`))).toBe(true)
    expect(existsSync(join(vaultPath, 'entities', `${slug}.md`))).toBe(false)
    const file = asKnowledge(await os.read(slug))
    expect(file.frontmatter.subtype).toBe('insight')
  })

  it('maps filesystem failures to HafezError (no raw ENOENT/ENOTDIR escapes)', async () => {
    const vaultPath = createTestVault(['entities'])
    const os = createHafez({ vaultPath, git: { push: false } })
    const slug = await os.capture('Blocked target dir')
    // A regular file where knowledge/ should be: mkdir/write fail at the OS level.
    writeFileSync(join(vaultPath, 'knowledge'), 'not a directory')

    const err = await os.promote(slug, 'knowledge').then(() => null, (e: unknown) => e)
    expect(err).toBeInstanceOf(HafezError)
    expect((err as { code?: string }).code).not.toBe('ENOENT')
    expect((err as { code?: string }).code).not.toBe('ENOTDIR')
    // Source survives a failed promote.
    expect(existsSync(join(vaultPath, 'entities', `${slug}.md`))).toBe(true)
  })
})
