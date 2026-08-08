// tests/operations-git.test.ts
// Adapter/e2e coverage of mutation persistence on a REAL git repo: commit-
// stage vs push-stage failure handling, rollback consistency (files + git
// index + SQLite), and batch commits carrying archival writes. The pure
// operation logic lives in operations.test.ts against the in-memory Journal.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createHafez } from '../src/index.js'
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import simpleGit from 'simple-git'
import Database from 'better-sqlite3'

const TMP = join(tmpdir(), 'hafez-test-ops-git-' + Date.now())
const BARE = join(TMP, 'remote.git')
const VAULT = join(TMP, 'vault')

beforeAll(async () => {
  mkdirSync(TMP, { recursive: true })
  mkdirSync(BARE, { recursive: true })
  await simpleGit(BARE).init(true)
  await simpleGit().clone(BARE, VAULT)
  mkdirSync(join(VAULT, 'entities'), { recursive: true })
  mkdirSync(join(VAULT, 'knowledge'), { recursive: true })
  // Initial commit
  writeFileSync(join(VAULT, '.gitkeep'), '')
  const git = simpleGit(VAULT)
  await git.add('.gitkeep')
  await git.commit('init')
  const branch = (await git.branchLocal()).current
  await git.push('origin', branch)
})

afterAll(() => rmSync(TMP, { recursive: true, force: true }))

function makeOS() {
  return createHafez({ vaultPath: VAULT, git: { push: false } })
}

describe('batch commit-stage vs push-stage failure (COR-5 / TST-1)', () => {
  it('rolls back file writes when the commit stage fails', async () => {
    const os = makeOS()
    await os.create('entity', 'Rollback Probe', { type: 'project' })
    const filePath = join(VAULT, 'entities', 'rollback-probe.md')
    const before = readFileSync(filePath, 'utf-8')

    // Simulate a raced git process holding the index lock — add/commit will fail
    const indexLock = join(VAULT, '.git', 'index.lock')
    writeFileSync(indexLock, '')
    try {
      await expect(
        os.batch([{ op: 'update', slug: 'rollback-probe', fields: { brief: 'should not survive' } }])
      ).rejects.toThrow()
    } finally {
      rmSync(indexLock, { force: true })
    }

    // The half-applied write must be rolled back...
    expect(readFileSync(filePath, 'utf-8')).toBe(before)
    expect(readFileSync(filePath, 'utf-8')).not.toContain('should not survive')
    // ...including the git index: nothing staged, or the next commit would
    // publish the rolled-back content under the wrong message
    const status = await simpleGit(VAULT).status()
    expect(status.staged).toHaveLength(0)
  })

  it('rolls back and unstages when the commit itself fails after staging', async () => {
    const os = makeOS()
    await os.create('entity', 'Hook Probe', { type: 'project' })
    // A failing pre-commit hook makes `git add` succeed but `git commit` fail —
    // the case where content is left staged without a commit
    const hookPath = join(VAULT, '.git', 'hooks', 'pre-commit')
    writeFileSync(hookPath, '#!/bin/sh\nexit 1\n', { mode: 0o755 })
    try {
      await expect(
        os.batch([{ op: 'update', slug: 'hook-probe', fields: { brief: 'staged then failed' } }])
      ).rejects.toThrow()
    } finally {
      rmSync(hookPath, { force: true })
    }
    const status = await simpleGit(VAULT).status()
    expect(status.staged).toHaveLength(0)
    expect(readFileSync(join(VAULT, 'entities', 'hook-probe.md'), 'utf-8')).not.toContain('staged then failed')
  })

  it('keeps the local commit when only the push stage fails', async () => {
    const os = createHafez({ vaultPath: VAULT })
    await os.create('entity', 'Push Fail Probe', { type: 'project' })

    // Point origin at a nonexistent path so push (and pull) fail without conflict
    const git = simpleGit(VAULT)
    const originUrl = (await git.getRemotes(true)).find(r => r.name === 'origin')!.refs.push
    await git.raw(['remote', 'set-url', 'origin', join(TMP, 'no-such-remote.git')])
    try {
      await expect(
        os.batch([{ op: 'update', slug: 'push-fail-probe', fields: { brief: 'survives push failure' } }])
      ).rejects.toMatchObject({ code: 'GIT_PUSH_FAILED' })
    } finally {
      await git.raw(['remote', 'set-url', 'origin', originUrl])
    }

    // The write is committed locally — file keeps the new content
    const content = readFileSync(join(VAULT, 'entities', 'push-fail-probe.md'), 'utf-8')
    expect(content).toContain('survives push failure')
    const log = await git.log()
    expect(log.latest?.message).toContain('batch: 1 operations')

    // Heal: push the stranded commit so later tests see a clean state
    const branch = (await git.branchLocal()).current
    await git.push('origin', branch)
  }, 30_000)
})

describe('index consistency when the commit stage fails', () => {
  function indexSlugs(): string[] {
    const db = new Database(join(VAULT, '.hafez.db'), { readonly: true })
    try {
      return (db.prepare('SELECT slug FROM items').all() as Array<{ slug: string }>).map(r => r.slug)
    } finally {
      db.close()
    }
  }

  it('failed batch containing a promote leaves the SQLite index consistent', async () => {
    const os = makeOS()
    await os.capture('Batch Promote Probe')
    expect(indexSlugs()).toContain('batch-promote-probe')

    const indexLock = join(VAULT, '.git', 'index.lock')
    writeFileSync(indexLock, '')
    try {
      await expect(
        os.batch([{ op: 'promote', slug: 'batch-promote-probe', target: 'knowledge' }])
      ).rejects.toThrow()
    } finally {
      rmSync(indexLock, { force: true })
    }

    // Files rolled back: entity restored, knowledge file gone
    expect(existsSync(join(VAULT, 'entities', 'batch-promote-probe.md'))).toBe(true)
    expect(existsSync(join(VAULT, 'knowledge', 'batch-promote-probe.md'))).toBe(false)
    // Index untouched: the entity row must survive (pre-collapse, promote
    // removed its row mid-apply and rollback restored files only)
    expect(indexSlugs()).toContain('batch-promote-probe')
  })

  it('failed single-op promote leaves the SQLite index consistent', async () => {
    const os = makeOS()
    await os.capture('Solo Promote Probe')
    expect(indexSlugs()).toContain('solo-promote-probe')

    const indexLock = join(VAULT, '.git', 'index.lock')
    writeFileSync(indexLock, '')
    try {
      await expect(os.promote('solo-promote-probe', 'knowledge')).rejects.toThrow()
    } finally {
      rmSync(indexLock, { force: true })
    }

    expect(existsSync(join(VAULT, 'entities', 'solo-promote-probe.md'))).toBe(true)
    expect(existsSync(join(VAULT, 'knowledge', 'solo-promote-probe.md'))).toBe(false)
    expect(indexSlugs()).toContain('solo-promote-probe')
  })
})

describe('single-op promote when only the push stage fails', () => {
  it('keeps the promoted files and index — never rolls back a landed commit', async () => {
    const os = createHafez({ vaultPath: VAULT })
    await os.capture('Push Fail Promote Probe')

    const git = simpleGit(VAULT)
    const originUrl = (await git.getRemotes(true)).find(r => r.name === 'origin')!.refs.push
    await git.raw(['remote', 'set-url', 'origin', join(TMP, 'no-such-remote.git')])
    try {
      await expect(
        os.promote('push-fail-promote-probe', 'knowledge')
      ).rejects.toMatchObject({ code: 'GIT_PUSH_FAILED' })
    } finally {
      await git.raw(['remote', 'set-url', 'origin', originUrl])
    }

    // The promote commit exists locally — the worktree must match it, not the
    // pre-promote state (rolling back here left disk contradicting HEAD)
    expect(existsSync(join(VAULT, 'entities', 'push-fail-promote-probe.md'))).toBe(false)
    expect(existsSync(join(VAULT, 'knowledge', 'push-fail-promote-probe.md'))).toBe(true)
    expect((await git.log()).latest?.message).toContain('promote: push-fail-promote-probe')
    expect((await git.status()).isClean()).toBe(true)

    // Index follows the commit: the row flipped from entity to knowledge
    const db = new Database(join(VAULT, '.hafez.db'), { readonly: true })
    try {
      const rows = db.prepare("SELECT kind FROM items WHERE slug = 'push-fail-promote-probe'").all() as Array<{ kind: string }>
      expect(rows.map(r => r.kind)).toEqual(['knowledge'])
    } finally {
      db.close()
    }

    // Heal: push the stranded commit so later tests see a clean state
    const branch = (await git.branchLocal()).current
    await git.push('origin', branch)
  }, 30_000)
})

describe('batch session log archival rides the batch commit', () => {
  it('the archive file lands tracked in the same commit', async () => {
    const os = makeOS()
    await os.create('entity', 'Batch Archive Test', { type: 'project' })
    const ops = Array.from({ length: 10 }, (_, i) => ({
      op: 'update' as const,
      slug: 'batch-archive-test',
      fields: { session_log: { type: 'progress' as const, summary: `Batch entry ${i}`, agent: 'Test' } },
    }))
    await os.batch(ops)

    const git = simpleGit(VAULT)
    expect((await git.log()).latest?.message).toContain('batch: 10 operations')
    const tracked = await git.raw(['ls-files', 'entities/archive/batch-archive-test-log.md'])
    expect(tracked.trim()).toBe('entities/archive/batch-archive-test-log.md')
  })
})

describe('a commit carries only the files its mutation wrote', () => {
  // An update used to hand the Journal the entity's archive log whenever that
  // file merely EXISTED, not when the update actually archived into it. Any
  // hand-edit sitting in entities/archive/ was therefore swept into the next
  // unrelated commit — someone else's dirty content published under a
  // "update: <slug>" message.
  const SLUG = 'archive-scope-test'
  const ARCHIVE_REL = `entities/archive/${SLUG}-log.md`

  it('leaves an externally dirtied archive file out of an unrelated update', async () => {
    const os = makeOS()
    await os.create('entity', 'Archive Scope Test', { type: 'project' })
    // Ten logs trigger archival, so the archive file exists and is tracked.
    for (let i = 0; i < 10; i++) {
      await os.update(SLUG, { session_log: { type: 'progress', summary: `Entry ${i}`, agent: 'Test' } })
    }
    const archiveAbs = join(VAULT, ARCHIVE_REL)
    expect(existsSync(archiveAbs)).toBe(true)

    // Someone hand-edits the archive outside hafez.
    const clean = readFileSync(archiveAbs, 'utf-8')
    const dirty = clean + '\n### 1999-01-01 — Human [progress]\nSummary: hand edit\n'
    writeFileSync(archiveAbs, dirty)

    const git = simpleGit(VAULT)
    try {
      // An unrelated update — no session log, so nothing is archived.
      await os.update(SLUG, { brief: 'Unrelated handoff note' })

      const touched = (await git.raw(['show', '--name-only', '--pretty=format:', 'HEAD']))
        .split('\n').map(s => s.trim()).filter(Boolean)
      expect(touched).toEqual([`entities/${SLUG}.md`])

      // And the hand edit is still sitting uncommitted in the worktree.
      expect(readFileSync(archiveAbs, 'utf-8')).toBe(dirty)
      expect((await git.status()).modified).toContain(ARCHIVE_REL)
    } finally {
      // Later tests share this vault and assert on a clean worktree.
      writeFileSync(archiveAbs, clean)
    }
  })

  it('still commits the archive file on the update that archives into it', async () => {
    const os = makeOS()
    await os.create('entity', 'Archive Ride Test', { type: 'project' })
    for (let i = 0; i < 10; i++) {
      await os.update('archive-ride-test', { session_log: { type: 'progress', summary: `Entry ${i}`, agent: 'Test' } })
    }

    const git = simpleGit(VAULT)
    const touched = (await git.raw(['show', '--name-only', '--pretty=format:', 'HEAD']))
      .split('\n').map(s => s.trim()).filter(Boolean)
    expect(touched).toContain('entities/archive/archive-ride-test-log.md')
    expect(touched).toContain('entities/archive-ride-test.md')
  })
})

describe('single-op commit-stage vs push-stage failure (uniform Spine policy)', () => {
  it('update rolls back the file write when the commit stage fails', async () => {
    const os = makeOS()
    await os.create('entity', 'Single Rollback Probe', { type: 'project' })
    const filePath = join(VAULT, 'entities', 'single-rollback-probe.md')
    const before = readFileSync(filePath, 'utf-8')

    const indexLock = join(VAULT, '.git', 'index.lock')
    writeFileSync(indexLock, '')
    try {
      await expect(
        os.update('single-rollback-probe', { brief: 'should not survive' })
      ).rejects.toThrow()
    } finally {
      rmSync(indexLock, { force: true })
    }

    expect(readFileSync(filePath, 'utf-8')).toBe(before)
    const status = await simpleGit(VAULT).status()
    expect(status.staged).toHaveLength(0)
  })

  it('update keeps the local commit under its own message when only the push fails', async () => {
    const os = createHafez({ vaultPath: VAULT })
    await os.create('entity', 'Single Push Probe', { type: 'project' })

    const git = simpleGit(VAULT)
    const originUrl = (await git.getRemotes(true)).find(r => r.name === 'origin')!.refs.push
    await git.raw(['remote', 'set-url', 'origin', join(TMP, 'no-such-remote.git')])
    try {
      await expect(
        os.update('single-push-probe', { brief: 'survives push failure' })
      ).rejects.toMatchObject({ code: 'GIT_PUSH_FAILED' })
    } finally {
      await git.raw(['remote', 'set-url', 'origin', originUrl])
    }

    const content = readFileSync(join(VAULT, 'entities', 'single-push-probe.md'), 'utf-8')
    expect(content).toContain('survives push failure')
    // Per-op commit message — never 'batch: 1 operations'
    const log = await git.log()
    expect(log.latest?.message).toContain('update: single-push-probe')

    // Heal: push the stranded commit so later tests see a clean state
    const branch = (await git.branchLocal()).current
    await git.push('origin', branch)
  }, 30_000)
})

describe('batch creates and promotes the same slug in one commit', () => {
  it('capture + cross-kind promote of the same slug commits cleanly', async () => {
    const os = makeOS()
    const git = simpleGit(VAULT)
    const before = (await git.log()).latest!.hash

    const results = await os.batch([
      { op: 'capture', name: 'Quick Idea' },
      { op: 'promote', slug: 'quick-idea', target: 'knowledge' },
    ])

    expect(results.map(r => r.status)).toEqual(['ok', 'ok'])
    // Only the promoted file survives — the never-tracked capture is gone
    expect(existsSync(join(VAULT, 'entities', 'quick-idea.md'))).toBe(false)
    expect(existsSync(join(VAULT, 'knowledge', 'quick-idea.md'))).toBe(true)
    // Exactly one commit, and the worktree matches it
    const log = await git.log({ from: before, to: 'HEAD' })
    expect(log.all).toHaveLength(1)
    expect(log.latest?.message).toBe('batch: 2 operations')
    expect((await git.status()).isClean()).toBe(true)
    // git tracks the knowledge file and never learned about the entity file
    const tracked = (await git.raw(['ls-files'])).split('\n')
    expect(tracked).toContain('knowledge/quick-idea.md')
    expect(tracked).not.toContain('entities/quick-idea.md')
  })

  it('batched and sequential execution of the same op pair agree on vault state', async () => {
    const os = makeOS()
    await os.batch([
      { op: 'capture', name: 'Parity Batched' },
      { op: 'promote', slug: 'parity-batched', target: 'knowledge' },
    ])
    await os.capture('Parity Sequential')
    await os.promote('parity-sequential', 'knowledge')

    const normalize = (slug: string, name: string) =>
      readFileSync(join(VAULT, 'knowledge', `${slug}.md`), 'utf-8').replaceAll(name, 'NAME').replaceAll(slug, 'SLUG')

    expect(normalize('parity-batched', 'Parity Batched')).toBe(normalize('parity-sequential', 'Parity Sequential'))
    expect(existsSync(join(VAULT, 'entities', 'parity-batched.md'))).toBe(false)
    expect(existsSync(join(VAULT, 'entities', 'parity-sequential.md'))).toBe(false)

    // The read index agrees too: one knowledge row each, no entity leftovers
    const db = new Database(join(VAULT, '.hafez.db'), { readonly: true })
    try {
      const rows = db.prepare("SELECT slug, kind FROM items WHERE slug IN ('parity-batched','parity-sequential') ORDER BY slug").all() as Array<{ slug: string; kind: string }>
      expect(rows).toEqual([
        { slug: 'parity-batched', kind: 'knowledge' },
        { slug: 'parity-sequential', kind: 'knowledge' },
      ])
    } finally {
      db.close()
    }
  })
})
