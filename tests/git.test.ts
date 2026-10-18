// tests/git.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { gitCommitAndPush, gitSync, createGitJournal } from '../src/git.js'
import { HafezError } from '../src/types.js'
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { execSync } from 'child_process'
import { simpleGit } from 'simple-git'

const TMP = join(tmpdir(), 'hafez-test-git-' + Date.now())
const BARE = join(TMP, 'remote.git')
const LOCAL = join(TMP, 'local')
const LOCAL2 = join(TMP, 'local2') // second clone for conflict simulation

let defaultBranch: string

describe('gitCommitAndPush', () => {
  beforeAll(async () => {
    mkdirSync(TMP, { recursive: true })
    // Create a bare "remote" repo
    mkdirSync(BARE, { recursive: true })
    await simpleGit(BARE).init(true)
    // Clone it as local
    await simpleGit().clone(BARE, LOCAL)
    // Create initial commit
    writeFileSync(join(LOCAL, 'init.md'), 'init')
    const git = simpleGit(LOCAL)
    await git.add('init.md')
    await git.commit('init')
    defaultBranch = (await git.branchLocal()).current
    await git.push('origin', defaultBranch)
    // Clone a second copy for conflict simulation
    await simpleGit().clone(BARE, LOCAL2)
  })

  afterAll(() => rmSync(TMP, { recursive: true, force: true }))

  // Reset both clones to match remote before each test
  beforeEach(async () => {
    const git1 = simpleGit(LOCAL)
    const git2 = simpleGit(LOCAL2)
    await git1.fetch()
    await git1.reset(['--hard', `origin/${defaultBranch}`])
    await git2.fetch()
    await git2.reset(['--hard', `origin/${defaultBranch}`])
  })

  // --- Basic operations ---

  it('commits and pushes a file', async () => {
    writeFileSync(join(LOCAL, 'test.md'), 'hello')
    await gitCommitAndPush(LOCAL, ['test.md'], 'test commit')
    const log = await simpleGit(BARE).log()
    expect(log.latest?.message).toBe('test commit')
  })

  it('skips push when push: false', async () => {
    writeFileSync(join(LOCAL, 'local-only.md'), 'local')
    await gitCommitAndPush(LOCAL, ['local-only.md'], 'local only', { push: false })
    const localLog = await simpleGit(LOCAL).log()
    expect(localLog.latest?.message).toBe('local only')
  })

  it('is a no-op when file content is unchanged', async () => {
    // init.md already exists with content 'init' and is committed
    writeFileSync(join(LOCAL, 'init.md'), 'init')
    const logBefore = await simpleGit(LOCAL).log()
    await gitCommitAndPush(LOCAL, ['init.md'], 'should not commit')
    const logAfter = await simpleGit(LOCAL).log()
    expect(logAfter.latest?.hash).toBe(logBefore.latest?.hash)
  })

  // --- Rebase over non-conflicting changes ---

  it('rebases over non-conflicting remote changes', async () => {
    // LOCAL2 pushes a change to a different file
    writeFileSync(join(LOCAL2, 'other.md'), 'from local2')
    const git2 = simpleGit(LOCAL2)
    await git2.add('other.md')
    await git2.commit('local2 commit')
    await git2.push('origin', defaultBranch)

    // LOCAL pushes a change to a different file — should rebase cleanly
    writeFileSync(join(LOCAL, 'mine.md'), 'from local')
    await gitCommitAndPush(LOCAL, ['mine.md'], 'local commit')

    const log = await simpleGit(BARE).log()
    expect(log.all.map((c) => c.message)).toContain('local commit')
    expect(log.all.map((c) => c.message)).toContain('local2 commit')
  })

  // --- Conflict handling ---

  it('throws HafezError with GIT_PUSH_FAILED on conflict', async () => {
    const sharedFile = 'shared.md'

    // LOCAL2 pushes a change to a shared file
    writeFileSync(join(LOCAL2, sharedFile), 'version from local2')
    const git2 = simpleGit(LOCAL2)
    await git2.add(sharedFile)
    await git2.commit('local2 edits shared')
    await git2.push('origin', defaultBranch)

    // LOCAL edits the same file differently — conflict
    writeFileSync(join(LOCAL, sharedFile), 'version from local')
    try {
      await gitCommitAndPush(LOCAL, [sharedFile], 'local edits shared')
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(HafezError)
      const lErr = err as HafezError
      expect(lErr.code).toBe('GIT_PUSH_FAILED')
      expect(lErr.message).toContain('conflict')
      expect(lErr.message).toContain('saved locally')
      // details should carry the underlying git error
      expect(lErr.details).toBeDefined()
      expect(lErr.details!.length).toBeGreaterThan(0)
      expect(lErr.details![0].length).toBeGreaterThan(0)
    }
  })

  it('leaves repo in clean state after conflict', async () => {
    const sharedFile = 'clean-state.md'

    // Push from LOCAL2
    writeFileSync(join(LOCAL2, sharedFile), 'remote version')
    const git2 = simpleGit(LOCAL2)
    await git2.add(sharedFile)
    await git2.commit('remote edit')
    await git2.push('origin', defaultBranch)

    // Conflict from LOCAL
    writeFileSync(join(LOCAL, sharedFile), 'local version')
    try {
      await gitCommitAndPush(LOCAL, [sharedFile], 'local edit')
    } catch {
      // expected
    }

    // Repo should be in a clean state — no mid-rebase, can do normal operations
    const git1 = simpleGit(LOCAL)
    const status = await git1.status()
    expect(status.conflicted).toHaveLength(0)

    // Should be able to commit again without issues
    writeFileSync(join(LOCAL, 'after-conflict.md'), 'recovery')
    await git1.add('after-conflict.md')
    await git1.commit('post-conflict commit')
    const log = await git1.log()
    expect(log.latest?.message).toBe('post-conflict commit')
  })

  it('preserves local commit after push failure', async () => {
    const sharedFile = 'preserve-local.md'

    // Push from LOCAL2
    writeFileSync(join(LOCAL2, sharedFile), 'remote version X')
    const git2 = simpleGit(LOCAL2)
    await git2.add(sharedFile)
    await git2.commit('remote X')
    await git2.push('origin', defaultBranch)

    // LOCAL makes a conflicting commit
    writeFileSync(join(LOCAL, sharedFile), 'local version Y')
    try {
      await gitCommitAndPush(LOCAL, [sharedFile], 'local Y')
    } catch {
      // expected
    }

    // The local file should still have our content (not overwritten by remote)
    const content = readFileSync(join(LOCAL, sharedFile), 'utf-8')
    expect(content).toBe('local version Y')

    // And our commit should be in the local log
    const git1 = simpleGit(LOCAL)
    const log = await git1.log()
    expect(log.all.some((c) => c.message === 'local Y')).toBe(true)
  })

  // --- Stuck state recovery ---

  it('recovers from stuck rebase state left by a prior crash', async () => {
    const sharedFile = 'stuck-recovery.md'

    // Push from LOCAL2
    writeFileSync(join(LOCAL2, sharedFile), 'remote content')
    const git2 = simpleGit(LOCAL2)
    await git2.add(sharedFile)
    await git2.commit('remote content')
    await git2.push('origin', defaultBranch)

    // Manually create a conflicting commit and start a rebase
    // that will leave the repo mid-rebase (simulating a crash)
    writeFileSync(join(LOCAL, sharedFile), 'local content')
    const git1 = simpleGit(LOCAL)
    await git1.add(sharedFile)
    await git1.commit('will conflict')
    try {
      await git1.pull('origin', defaultBranch, { '--rebase': null })
    } catch {
      // expected: conflict leaves repo mid-rebase
    }

    // Now LOCAL is stuck mid-rebase. gitCommitAndPush should clean it up.
    writeFileSync(join(LOCAL, 'fresh.md'), 'fresh start')
    await gitCommitAndPush(LOCAL, ['fresh.md'], 'fresh commit', { push: false })
    const log = await git1.log()
    expect(log.latest?.message).toBe('fresh commit')
  })

  it('can operate normally after a stuck rebase is cleaned up', async () => {
    const sharedFile = 'stuck-ops.md'

    // Push from LOCAL2
    writeFileSync(join(LOCAL2, sharedFile), 'remote v1')
    const git2 = simpleGit(LOCAL2)
    await git2.add(sharedFile)
    await git2.commit('remote v1')
    await git2.push('origin', defaultBranch)

    // Leave LOCAL stuck mid-rebase
    writeFileSync(join(LOCAL, sharedFile), 'local v1')
    const git1 = simpleGit(LOCAL)
    await git1.add(sharedFile)
    await git1.commit('local v1')
    try {
      await git1.pull('origin', defaultBranch, { '--rebase': null })
    } catch {
      // stuck mid-rebase
    }

    // A push:false operation should work after stuck state cleanup
    writeFileSync(join(LOCAL, 'after-stuck.md'), 'new work')
    await gitCommitAndPush(LOCAL, ['after-stuck.md'], 'after stuck', { push: false })
    const log = await git1.log()
    expect(log.latest?.message).toBe('after stuck')

    // And the repo is clean enough for normal git operations
    const status = await git1.status()
    expect(status.conflicted).toHaveLength(0)
  })

  it('preserves fresh file writes when aborting a stuck rebase on a tracked file', async () => {
    // This tests CRITICAL-1: ensureCleanState must not destroy files
    // that index.ts just wrote before calling gitCommitAndPush.
    const trackedFile = 'tracked-entity.md'

    // Create the tracked file and push it
    writeFileSync(join(LOCAL, trackedFile), 'original content')
    const git1 = simpleGit(LOCAL)
    await git1.add(trackedFile)
    await git1.commit('create entity')
    await git1.push('origin', defaultBranch)

    // Sync LOCAL2
    await simpleGit(LOCAL2).pull('origin', defaultBranch)

    // LOCAL2 modifies the tracked file and pushes
    writeFileSync(join(LOCAL2, trackedFile), 'remote update')
    const git2 = simpleGit(LOCAL2)
    await git2.add(trackedFile)
    await git2.commit('remote update')
    await git2.push('origin', defaultBranch)

    // LOCAL modifies the same tracked file differently and gets stuck mid-rebase
    writeFileSync(join(LOCAL, trackedFile), 'local update A')
    await git1.add(trackedFile)
    await git1.commit('local update A')
    try {
      await git1.pull('origin', defaultBranch, { '--rebase': null })
    } catch {
      // stuck mid-rebase
    }

    // Simulate index.ts writing NEW content to the same file (Process B's fresh write)
    writeFileSync(join(LOCAL, trackedFile), 'fresh write from process B')

    // gitCommitAndPush should: save the fresh content, abort rebase, restore content
    await gitCommitAndPush(LOCAL, [trackedFile], 'process B update', { push: false })

    // Verify the committed content is the fresh write, not the pre-rebase state
    const committedContent = readFileSync(join(LOCAL, trackedFile), 'utf-8')
    expect(committedContent).toBe('fresh write from process B')
  })

  // --- Semantic merge (auto-resolve) ---

  it('auto-resolves vault file conflict via semantic merge', async () => {
    // Create initial vault file and push
    const file = 'entities/test-entity.md'
    const dir = join(LOCAL, 'entities')
    const dir2 = join(LOCAL2, 'entities')
    mkdirSync(dir, { recursive: true })

    const initial = [
      '---',
      'name: Test',
      'type: project',
      'status: active',
      'created: "2026-01-01"',
      'last-touched: "2026-03-22"',
      '---',
      '',
      '## Session Log',
      '',
      '### 2026-03-22 — Setup [progress]',
      'Summary: Initial setup',
      '',
    ].join('\n')
    writeFileSync(join(LOCAL, file), initial)
    await gitCommitAndPush(LOCAL, [file], 'create entity')

    // Sync LOCAL2
    const git2 = simpleGit(LOCAL2)
    await git2.pull('origin', defaultBranch)

    // LOCAL2 pushes a session log update
    mkdirSync(dir2, { recursive: true })
    const remoteVersion = initial.replace(
      '## Session Log\n',
      '## Session Log\n\n### 2026-03-23 — Simorgh [progress]\nSummary: Remote update\n'
    )
    writeFileSync(join(LOCAL2, file), remoteVersion)
    await git2.add(file)
    await git2.commit('remote session log')
    await git2.push('origin', defaultBranch)

    // LOCAL writes a different session log entry — this would normally conflict
    const localVersion = initial.replace(
      '## Session Log\n',
      '## Session Log\n\n### 2026-03-23 — Claude [decision]\nSummary: Local update\n'
    )
    writeFileSync(join(LOCAL, file), localVersion)

    // This should succeed via semantic merge, NOT throw
    await gitCommitAndPush(LOCAL, [file], 'local session log')

    // Verify remote has both entries
    const git1 = simpleGit(LOCAL)
    await git1.pull('origin', defaultBranch)
    const content = readFileSync(join(LOCAL, file), 'utf-8')
    expect(content).toContain('Simorgh [progress]')
    expect(content).toContain('Claude [decision]')
    expect(content).toContain('Remote update')
    expect(content).toContain('Local update')
  })

  it('still throws for non-vault file conflicts', async () => {
    const file = 'README.md'

    // Push from LOCAL2
    writeFileSync(join(LOCAL2, file), 'remote readme')
    const git2 = simpleGit(LOCAL2)
    await git2.add(file)
    await git2.commit('remote readme')
    await git2.push('origin', defaultBranch)

    // LOCAL writes different content
    writeFileSync(join(LOCAL, file), 'local readme')
    try {
      await gitCommitAndPush(LOCAL, [file], 'local readme')
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(HafezError)
      expect((err as HafezError).code).toBe('GIT_PUSH_FAILED')
    }
  })

  it('auto-resolves multiple vault files in one commit', async () => {
    const file1 = 'entities/multi-a.md'
    const file2 = 'entities/multi-b.md'
    const dir = join(LOCAL, 'entities')
    const dir2 = join(LOCAL2, 'entities')
    mkdirSync(dir, { recursive: true })

    const mkEntity = (name: string) => `---\nname: ${name}\ntype: project\nstatus: active\ncreated: "2026-01-01"\nlast-touched: "2026-03-22"\n---\n`

    writeFileSync(join(LOCAL, file1), mkEntity('A'))
    writeFileSync(join(LOCAL, file2), mkEntity('B'))
    await gitCommitAndPush(LOCAL, [file1, file2], 'create two entities')

    const git2 = simpleGit(LOCAL2)
    await git2.pull('origin', defaultBranch)
    mkdirSync(dir2, { recursive: true })

    // Remote updates both
    writeFileSync(join(LOCAL2, file1), mkEntity('A').replace('2026-03-22', '2026-03-23'))
    writeFileSync(join(LOCAL2, file2), mkEntity('B').replace('2026-03-22', '2026-03-23'))
    await git2.add([file1, file2])
    await git2.commit('remote update both')
    await git2.push('origin', defaultBranch)

    // Local updates both differently (same last-touched as remote — tie, local wins scalars)
    writeFileSync(join(LOCAL, file1), mkEntity('A').replace('active', 'paused').replace('2026-03-22', '2026-03-23'))
    writeFileSync(join(LOCAL, file2), mkEntity('B').replace('active', 'done').replace('2026-03-22', '2026-03-23'))

    // Should merge successfully
    await gitCommitAndPush(LOCAL, [file1, file2], 'local update both')

    // Verify merged state
    const git1 = simpleGit(LOCAL)
    await git1.pull('origin', defaultBranch)
    const c1 = readFileSync(join(LOCAL, file1), 'utf-8')
    const c2 = readFileSync(join(LOCAL, file2), 'utf-8')
    expect(c1).toContain('paused')     // local status wins
    expect(c1).toContain('2026-03-23') // latest date wins
    expect(c2).toContain('done')       // local status wins
  })

  it('preserves non-conflicting local commits through a semantic merge (COR-1)', async () => {
    // Regression for the production data-loss bug: the old merge path did
    // `git reset --hard origin` and re-applied only the conflicting files,
    // destroying every other unpushed local commit. Forensic patches from
    // the recovered vault live in specs/forensics/cor1-lost-commits/ (private).
    const conflictFile = 'entities/cor1-conflict.md'
    const bystanderFile = 'entities/cor1-bystander.md'
    const dir = join(LOCAL, 'entities')
    const dir2 = join(LOCAL2, 'entities')
    mkdirSync(dir, { recursive: true })

    const initial = [
      '---',
      'name: Conflict Target',
      'type: project',
      'status: active',
      'created: "2026-01-01"',
      'last-touched: "2026-03-22"',
      '---',
      '',
      '## Session Log',
      '',
      '### 2026-03-22 — Setup [progress]',
      'Summary: Initial setup',
      '',
    ].join('\n')
    writeFileSync(join(LOCAL, conflictFile), initial)
    await gitCommitAndPush(LOCAL, [conflictFile], 'create conflict target')

    // Remote (LOCAL2) adds a session log entry and pushes
    const git2 = simpleGit(LOCAL2)
    await git2.pull('origin', defaultBranch)
    mkdirSync(dir2, { recursive: true })
    writeFileSync(join(LOCAL2, conflictFile), initial.replace(
      '## Session Log\n',
      '## Session Log\n\n### 2026-03-23 — Simorgh [progress]\nSummary: Remote entry\n'
    ))
    await git2.add(conflictFile)
    await git2.commit('remote session log')
    await git2.push('origin', defaultBranch)

    // LOCAL first commits an unrelated new entity (push blocked — stays local)
    writeFileSync(join(LOCAL, bystanderFile), '---\nname: Bystander\ntype: project\nstatus: active\ncreated: "2026-01-01"\nlast-touched: "2026-03-23"\n---\n')
    await gitCommitAndPush(LOCAL, [bystanderFile], 'create bystander', { push: false })

    // ... then makes a conflicting session-log edit and pushes
    writeFileSync(join(LOCAL, conflictFile), initial.replace(
      '## Session Log\n',
      '## Session Log\n\n### 2026-03-23 — Claude [decision]\nSummary: Local entry\n'
    ))
    await gitCommitAndPush(LOCAL, [conflictFile], 'local session log')

    // The bystander commit must survive on the branch AND on the remote
    const git1 = simpleGit(LOCAL)
    const log = await git1.log()
    expect(log.all.some(c => c.message === 'create bystander')).toBe(true)
    expect(existsSync(join(LOCAL, bystanderFile))).toBe(true)

    const bareLog = await simpleGit(BARE).log()
    expect(bareLog.all.some(c => c.message === 'create bystander')).toBe(true)

    // And the conflict file has both entries
    const content = readFileSync(join(LOCAL, conflictFile), 'utf-8')
    expect(content).toContain('Remote entry')
    expect(content).toContain('Local entry')
  })

  it('resolves conflicts spanning multiple local commits (multi-step rebase)', async () => {
    // Two local commits each conflicting with the same remote commit: the
    // rebase stops twice, and `rebase --continue` exits non-zero at the second
    // stop. That must be treated as progress, not failure.
    const fileA = 'entities/multistep-a.md'
    const fileB = 'entities/multistep-b.md'
    const dir = join(LOCAL, 'entities')
    const dir2 = join(LOCAL2, 'entities')
    mkdirSync(dir, { recursive: true })

    const mk = (name: string, extra = '') => [
      '---',
      `name: ${name}`,
      'type: project',
      'status: active',
      'created: "2026-01-01"',
      'last-touched: "2026-03-22"',
      '---',
      '',
      '## Session Log',
      extra,
      '',
    ].join('\n')

    writeFileSync(join(LOCAL, fileA), mk('Multi A'))
    writeFileSync(join(LOCAL, fileB), mk('Multi B'))
    await gitCommitAndPush(LOCAL, [fileA, fileB], 'create multistep entities')

    // Remote edits BOTH files in one commit and pushes
    const git2 = simpleGit(LOCAL2)
    await git2.pull('origin', defaultBranch)
    mkdirSync(dir2, { recursive: true })
    writeFileSync(join(LOCAL2, fileA), mk('Multi A', '\n### 2026-03-23 — Simorgh [progress]\nSummary: Remote A\n'))
    writeFileSync(join(LOCAL2, fileB), mk('Multi B', '\n### 2026-03-23 — Simorgh [progress]\nSummary: Remote B\n'))
    await git2.add([fileA, fileB])
    await git2.commit('remote edits both')
    await git2.push('origin', defaultBranch)

    // Local makes TWO separate commits, one per file (push blocked)
    writeFileSync(join(LOCAL, fileA), mk('Multi A', '\n### 2026-03-23 — Claude [progress]\nSummary: Local A\n'))
    await gitCommitAndPush(LOCAL, [fileA], 'local edit A', { push: false })
    writeFileSync(join(LOCAL, fileB), mk('Multi B', '\n### 2026-03-23 — Claude [progress]\nSummary: Local B\n'))
    await gitCommitAndPush(LOCAL, [fileB], 'local edit B', { push: false })

    // Sync must resolve BOTH conflicted rebase steps, not abort at the second
    const result = await gitSync(LOCAL)
    expect(result.pushed).toBe(true)

    const a = readFileSync(join(LOCAL, fileA), 'utf-8')
    const b = readFileSync(join(LOCAL, fileB), 'utf-8')
    expect(a).toContain('Remote A')
    expect(a).toContain('Local A')
    expect(b).toContain('Remote B')
    expect(b).toContain('Local B')
  })

  it('preserves local commit when merge fails on malformed remote', async () => {
    const file = 'entities/malformed-test.md'
    const dir = join(LOCAL, 'entities')
    const dir2 = join(LOCAL2, 'entities')
    mkdirSync(dir, { recursive: true })

    // Create a valid vault file and push
    const initial = '---\nname: Valid\ntype: project\nstatus: active\ncreated: "2026-01-01"\nlast-touched: "2026-03-22"\n---\n'
    writeFileSync(join(LOCAL, file), initial)
    await gitCommitAndPush(LOCAL, [file], 'create entity')

    // Sync LOCAL2
    const git2 = simpleGit(LOCAL2)
    await git2.pull('origin', defaultBranch)
    mkdirSync(dir2, { recursive: true })

    // LOCAL2 pushes corrupted content (not valid YAML frontmatter)
    writeFileSync(join(LOCAL2, file), '---\n{{{invalid yaml\n---\n')
    await git2.add(file)
    await git2.commit('corrupt file')
    await git2.push('origin', defaultBranch)

    // LOCAL writes a valid update — merge will fail on malformed remote
    writeFileSync(join(LOCAL, file), initial.replace('active', 'paused'))
    try {
      await gitCommitAndPush(LOCAL, [file], 'local update')
    } catch (err) {
      expect(err).toBeInstanceOf(HafezError)
    }

    // CRITICAL: local file content must survive regardless of merge outcome
    const content = readFileSync(join(LOCAL, file), 'utf-8')
    expect(content).toContain('paused')
  })
})

describe('gitSync', () => {
  const TMP2 = join(tmpdir(), 'hafez-test-sync-' + Date.now())
  const BARE2 = join(TMP2, 'remote.git')
  const SYNC_LOCAL = join(TMP2, 'local')
  const SYNC_LOCAL2 = join(TMP2, 'local2')
  let syncBranch: string

  beforeAll(async () => {
    mkdirSync(TMP2, { recursive: true })
    mkdirSync(BARE2, { recursive: true })
    await simpleGit(BARE2).init(true)
    await simpleGit().clone(BARE2, SYNC_LOCAL)
    // Create initial commit with vault structure
    mkdirSync(join(SYNC_LOCAL, 'entities'), { recursive: true })
    writeFileSync(join(SYNC_LOCAL, 'entities', 'init.md'), '---\nname: Init\ntype: project\nstatus: active\ncreated: 2026-01-01\nlast-touched: 2026-01-01\n---\n')
    const git = simpleGit(SYNC_LOCAL)
    await git.add('.')
    await git.commit('init')
    syncBranch = (await git.branchLocal()).current
    await git.push('origin', syncBranch)
    await simpleGit().clone(BARE2, SYNC_LOCAL2)
  })

  afterAll(() => rmSync(TMP2, { recursive: true, force: true }))

  beforeEach(async () => {
    const git1 = simpleGit(SYNC_LOCAL)
    const git2 = simpleGit(SYNC_LOCAL2)
    await git1.fetch()
    await git1.reset(['--hard', `origin/${syncBranch}`])
    await git2.fetch()
    await git2.reset(['--hard', `origin/${syncBranch}`])
  })

  it('returns { pulled: false, pushed: false } when nothing to do', async () => {
    const result = await gitSync(SYNC_LOCAL)
    expect(result).toEqual({ pulled: false, pushed: false, remote: true })
  })

  it('pulls remote changes when nothing local to push', async () => {
    // Push from LOCAL2
    writeFileSync(join(SYNC_LOCAL2, 'entities', 'remote-file.md'), '---\nname: Remote\ntype: idea\nstatus: active\ncreated: 2026-01-01\nlast-touched: 2026-01-01\n---\n')
    const git2 = simpleGit(SYNC_LOCAL2)
    await git2.add('.')
    await git2.commit('remote commit')
    await git2.push('origin', syncBranch)

    const result = await gitSync(SYNC_LOCAL)
    expect(result.pulled).toBe(true)
    expect(result.pushed).toBe(false)
    // Verify the remote file is now in SYNC_LOCAL
    expect(readFileSync(join(SYNC_LOCAL, 'entities', 'remote-file.md'), 'utf-8')).toContain('Remote')
  })

  it('pushes local commits that were committed with push: false', async () => {
    writeFileSync(join(SYNC_LOCAL, 'entities', 'local-only.md'), '---\nname: Local\ntype: idea\nstatus: active\ncreated: 2026-01-01\nlast-touched: 2026-01-01\n---\n')
    await gitCommitAndPush(SYNC_LOCAL, ['entities/local-only.md'], 'local commit', { push: false })

    // Verify not yet on remote
    const bareLog = await simpleGit(BARE2).log()
    expect(bareLog.latest?.message).not.toBe('local commit')

    const result = await gitSync(SYNC_LOCAL)
    expect(result.pushed).toBe(true)

    // Verify now on remote
    const bareLogAfter = await simpleGit(BARE2).log()
    expect(bareLogAfter.all.some(c => c.message === 'local commit')).toBe(true)
  })

  it('pushes multiple local commits in a single sync', async () => {
    // Make 3 separate commits locally without pushing
    for (let i = 1; i <= 3; i++) {
      writeFileSync(join(SYNC_LOCAL, 'entities', `batch-${i}.md`), `---\nname: Batch ${i}\ntype: idea\nstatus: active\ncreated: 2026-01-01\nlast-touched: 2026-01-01\n---\n`)
      await gitCommitAndPush(SYNC_LOCAL, [`entities/batch-${i}.md`], `batch commit ${i}`, { push: false })
    }

    const result = await gitSync(SYNC_LOCAL)
    expect(result.pushed).toBe(true)

    // All 3 commits should be on remote
    const bareLog = await simpleGit(BARE2).log()
    expect(bareLog.all.some(c => c.message === 'batch commit 1')).toBe(true)
    expect(bareLog.all.some(c => c.message === 'batch commit 3')).toBe(true)
  })

  it('resolves vault file conflict via semantic merge during sync', async () => {
    const file = 'entities/init.md'

    // LOCAL2 pushes a change
    const git2 = simpleGit(SYNC_LOCAL2)
    const content2 = readFileSync(join(SYNC_LOCAL2, file), 'utf-8')
    writeFileSync(join(SYNC_LOCAL2, file), content2 + '\n## Session Log\n\n### 2026-01-01 — Agent [progress]\nSummary: remote work\n')
    await git2.add(file)
    await git2.commit('remote session log')
    await git2.push('origin', syncBranch)

    // LOCAL commits a different change (different section) without pushing
    const content1 = readFileSync(join(SYNC_LOCAL, file), 'utf-8')
    writeFileSync(join(SYNC_LOCAL, file), content1 + '\n## Session Log\n\n### 2026-01-02 — Agent [decision]\nSummary: local decision\n')
    await gitCommitAndPush(SYNC_LOCAL, [file], 'local session log', { push: false })

    // Sync should resolve the conflict via semantic merge
    const result = await gitSync(SYNC_LOCAL)
    expect(result.pushed).toBe(true)

    // Both entries should be present
    const merged = readFileSync(join(SYNC_LOCAL, file), 'utf-8')
    expect(merged).toContain('remote work')
    expect(merged).toContain('local decision')
  })

  it('recovers from stuck rebase state', async () => {
    const file = 'entities/init.md'
    const git = simpleGit(SYNC_LOCAL)

    // Simulate stuck rebase by creating the directory
    mkdirSync(join(SYNC_LOCAL, '.git', 'rebase-merge'), { recursive: true })
    writeFileSync(join(SYNC_LOCAL, '.git', 'rebase-merge', 'head-name'), `refs/heads/${syncBranch}`)

    // gitSync should recover and work
    const result = await gitSync(SYNC_LOCAL)
    expect(result).toBeDefined() // didn't throw
  })
})

describe('local-only vault (no remote configured)', () => {
  // The README setup produces exactly this state: git init + commit, no
  // origin. Every write must succeed silently — the commit is the whole job.
  const TMP3 = join(tmpdir(), 'hafez-test-noremote-' + Date.now())

  beforeAll(async () => {
    mkdirSync(join(TMP3, 'entities'), { recursive: true })
    const git = simpleGit(TMP3)
    await git.init()
    writeFileSync(join(TMP3, 'entities', 'init.md'), '---\nname: Init\ntype: project\nstatus: active\ncreated: 2026-01-01\nlast-touched: 2026-01-01\n---\n')
    await git.add('.')
    await git.commit('init vault')
  })

  afterAll(() => rmSync(TMP3, { recursive: true, force: true }))

  it('gitSync reports remote: false without touching the network', async () => {
    const result = await gitSync(TMP3)
    expect(result).toEqual({ pulled: false, pushed: false, remote: false })
  })

  it('gitCommitAndPush with push enabled commits cleanly and does not throw', async () => {
    writeFileSync(join(TMP3, 'entities', 'local-item.md'), '---\nname: Local Item\ntype: entity\nstatus: active\ncreated: 2026-01-01\nlast-touched: 2026-01-01\n---\n')
    await gitCommitAndPush(TMP3, ['entities/local-item.md'], 'add local item')

    const git = simpleGit(TMP3)
    const log = await git.log()
    expect(log.latest?.message).toBe('add local item')
    const status = await git.status()
    expect(status.isClean()).toBe(true)
  })

  it('commits under a shell that exports the env keys simple-git scans (PAGER, GIT_ASKPASS, …)', async () => {
    // The factory hands process.env to simple-git, which rejects these keys
    // unless each category is allowed. The user's shell carries them routinely
    // (VS Code sets GIT_ASKPASS; desktops set SSH_ASKPASS; PAGER is common).
    const scanned = {
      PAGER: 'less', VISUAL: 'vi', GIT_ASKPASS: '/usr/bin/true', SSH_ASKPASS: '/usr/bin/true', GIT_SSH_COMMAND: 'ssh',
      // conda's git activation and Git for Windows shells export this; 4.0 moved it to its own category.
      GIT_EXEC_PATH: execSync('git --exec-path').toString().trim(),
      GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'credential.helper', GIT_CONFIG_VALUE_0: 'store'
    }
    const saved = Object.fromEntries(Object.keys(scanned).map(k => [k, process.env[k]]))
    Object.assign(process.env, scanned)
    try {
      writeFileSync(join(TMP3, 'entities', 'env-item.md'), '---\nname: Env Item\ntype: entity\nstatus: active\ncreated: 2026-01-01\nlast-touched: 2026-01-01\n---\n')
      await gitCommitAndPush(TMP3, ['entities/env-item.md'], 'add env item')
      expect((await simpleGit(TMP3).log()).latest?.message).toBe('add env item')
    } finally {
      for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v)
    }
  })
})

describe('createGitJournal fileTimes (recents tiebreak source)', () => {
  // Dedicated repo: forged commit dates, entities/ paths (gitFileTimes only
  // reports entities/ and knowledge/). Covers the %x00 log protocol and
  // --diff-filter=A parsing that the in-memory Journal fake does not model.
  const REPO = join(tmpdir(), 'hafez-test-filetimes-' + Date.now())

  beforeAll(async () => {
    mkdirSync(join(REPO, 'entities'), { recursive: true })
    const git = simpleGit({ baseDir: REPO, allowEnvironment: ['GIT_AUTHOR_DATE', 'GIT_COMMITTER_DATE'] })
    await git.init()
    await git.addConfig('user.email', 'test@test.com')
    await git.addConfig('user.name', 'Test')
    const commitAt = async (file: string, content: string, date: string) => {
      writeFileSync(join(REPO, file), content)
      await git
        .env({ PATH: process.env.PATH!, HOME: process.env.HOME!, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date })
        .add(file)
        .commit(`touch: ${file} @ ${date}`)
    }
    await commitAt('entities/older.md', 'v1', '2026-01-01T10:00:00Z')
    await commitAt('entities/newer.md', 'v1', '2026-01-01T10:01:00Z')
    // Re-modify the older file later — 'modified' must move, 'added' must not
    await commitAt('entities/older.md', 'v2', '2026-01-01T12:00:00Z')
  })

  afterAll(() => rmSync(REPO, { recursive: true, force: true }))

  it('modified mode reports the newest commit per file', async () => {
    const journal = createGitJournal(REPO)
    const times = await journal.fileTimes('modified')
    const older = times.get('entities/older.md')!
    const newer = times.get('entities/newer.md')!
    expect(older > newer).toBe(true) // re-modified file is now the newest
    expect(older.startsWith('2026-01-01T12:00:00')).toBe(true)
  })

  it('added mode reports the creation commit, unmoved by later edits', async () => {
    const journal = createGitJournal(REPO)
    const times = await journal.fileTimes('added')
    expect(times.get('entities/older.md')!.startsWith('2026-01-01T10:00:00')).toBe(true)
    expect(times.get('entities/newer.md')!.startsWith('2026-01-01T10:01:00')).toBe(true)
  })
})

describe('createGitJournal commit staging (in-batch create+delete)', () => {
  // A batch that creates a file and then deletes it (capture then cross-kind
  // promote) hands the Journal a deleted path that git never tracked. `git add`
  // is fatal on a pathspec matching nothing, so the whole valid batch used to
  // die at the commit stage. Dedicated local-only repo — no remote needed.
  const REPO = join(tmpdir(), 'hafez-test-stage-' + Date.now())

  beforeEach(async () => {
    rmSync(REPO, { recursive: true, force: true })
    mkdirSync(join(REPO, 'entities'), { recursive: true })
    mkdirSync(join(REPO, 'knowledge'), { recursive: true })
    const git = simpleGit(REPO)
    await git.init()
    await git.addConfig('user.email', 'test@test.com')
    await git.addConfig('user.name', 'Test')
    writeFileSync(join(REPO, 'init.md'), 'init')
    await git.add('init.md')
    await git.commit('init')
  })

  afterAll(() => rmSync(REPO, { recursive: true, force: true }))

  it('commits when a deleted path was never git-tracked', async () => {
    writeFileSync(join(REPO, 'knowledge', 'quick-idea.md'), 'promoted')
    const journal = createGitJournal(REPO, { push: false })

    await journal.commit(['knowledge/quick-idea.md'], ['entities/quick-idea.md'], 'batch: 2 operations')

    const git = simpleGit(REPO)
    expect((await git.log()).latest?.message).toBe('batch: 2 operations')
    expect((await git.status()).isClean()).toBe(true)
    expect((await git.raw(['ls-files'])).split('\n')).toContain('knowledge/quick-idea.md')
  })

  it('still stages the removal of a deleted path that git does track', async () => {
    const git = simpleGit(REPO)
    writeFileSync(join(REPO, 'entities', 'tracked.md'), 'v1')
    await git.add('entities/tracked.md')
    await git.commit('add tracked')

    rmSync(join(REPO, 'entities', 'tracked.md'))
    writeFileSync(join(REPO, 'knowledge', 'tracked.md'), 'moved')
    const journal = createGitJournal(REPO, { push: false })
    await journal.commit(['knowledge/tracked.md'], ['entities/tracked.md'], 'promote: tracked')

    expect((await git.status()).isClean()).toBe(true)
    const files = (await git.raw(['ls-files'])).split('\n')
    expect(files).not.toContain('entities/tracked.md')
    expect(files).toContain('knowledge/tracked.md')
  })

  it('commits a move git reports as a rename', async () => {
    // Identical content on both sides, so git stages one `R100` entry instead
    // of an add + a delete. simple-git's status keeps renames out of `staged`,
    // so the "nothing to commit" guard used to fire and the promote was
    // silently dropped — left staged, never committed, absent from changelog.
    const git = simpleGit(REPO)
    const body = '---\nname: Moving\ncreated: "2026-01-01"\n---\n\nIdentical body, so git calls this a rename.\n'
    writeFileSync(join(REPO, 'entities', 'moving.md'), body)
    await git.add('entities/moving.md')
    await git.commit('capture: moving')

    rmSync(join(REPO, 'entities', 'moving.md'))
    writeFileSync(join(REPO, 'knowledge', 'moving.md'), body)
    const journal = createGitJournal(REPO, { push: false })
    await journal.commit(['knowledge/moving.md'], ['entities/moving.md'], 'promote: moving')

    expect((await git.log()).latest?.message).toBe('promote: moving')
    expect((await git.status()).isClean()).toBe(true)
  })

  it('is a no-op when every path is an untracked deletion', async () => {
    const git = simpleGit(REPO)
    const before = (await git.log()).latest?.hash
    const journal = createGitJournal(REPO, { push: false })

    await journal.commit([], ['entities/never-existed.md'], 'batch: 1 operations')

    expect((await git.log()).latest?.hash).toBe(before)
    expect((await git.status()).isClean()).toBe(true)
  })

  it('surfaces commit-stage git failures as mapped HafezErrors', async () => {
    writeFileSync(join(REPO, 'entities', 'probe.md'), 'body')
    // A raced git process holding the index lock makes `git add` fail with a
    // raw GitError — the Journal must map it, not leak it (exit-code contract).
    writeFileSync(join(REPO, '.git', 'index.lock'), '')
    const journal = createGitJournal(REPO, { push: false })
    try {
      await expect(journal.commit(['entities/probe.md'], [], 'add probe'))
        .rejects.toMatchObject({ name: 'HafezError', code: 'GIT_COMMIT_FAILED' })
    } finally {
      rmSync(join(REPO, '.git', 'index.lock'), { force: true })
    }
  })

  it('leaves push-stage HafezErrors unmapped', async () => {
    const git = simpleGit(REPO)
    await git.addRemote('origin', join(tmpdir(), 'hafez-no-such-remote-' + Date.now() + '.git'))
    writeFileSync(join(REPO, 'entities', 'pushy.md'), 'body')
    const journal = createGitJournal(REPO)
    await expect(journal.commit(['entities/pushy.md'], [], 'add pushy'))
      .rejects.toMatchObject({ code: 'GIT_PUSH_FAILED' })
    // The commit still landed locally
    expect((await git.log()).latest?.message).toBe('add pushy')
  }, 30_000)
})

describe('fresh remote bootstrap (origin added to a local-only vault)', () => {
  // `git remote add origin …` on a vault that has only ever been local leaves
  // the branch unpublished and untracked. Plain `git pull`, `git push` and
  // `@{u}` are all fatal in that state, so every mutation after the remote was
  // added died at the push stage (exit 4). Sync/push must bootstrap instead:
  // publish the branch and set its upstream on the first push.
  const ROOT = join(tmpdir(), 'hafez-test-bootstrap-' + Date.now())
  const BARE2 = join(ROOT, 'remote.git')
  const VAULT = join(ROOT, 'vault')
  let branch: string

  beforeEach(async () => {
    rmSync(ROOT, { recursive: true, force: true })
    mkdirSync(join(VAULT, 'entities'), { recursive: true })
    mkdirSync(BARE2, { recursive: true })
    await simpleGit(BARE2).init(true)

    // A purely local vault: init + commits, no remote at any point.
    const git = simpleGit(VAULT)
    await git.init()
    await git.addConfig('user.email', 'test@test.com')
    await git.addConfig('user.name', 'Test')
    writeFileSync(join(VAULT, 'entities', 'init.md'), 'local history')
    await git.add('entities/init.md')
    await git.commit('init vault')
    branch = (await git.branchLocal()).current

    // Only now does the user wire up a remote.
    await git.addRemote('origin', BARE2)
  })

  afterAll(() => rmSync(ROOT, { recursive: true, force: true }))

  it('gitSync publishes the branch and sets its upstream', async () => {
    const result = await gitSync(VAULT)
    expect(result).toEqual({ pulled: false, pushed: true, remote: true })

    const git = simpleGit(VAULT)
    const upstream = (await git.raw(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])).trim()
    expect(upstream).toBe(`origin/${branch}`)
    expect((await simpleGit(BARE2).log()).latest?.message).toBe('init vault')
  }, 30_000)

  it('a mutation right after the remote is added commits and pushes', async () => {
    writeFileSync(join(VAULT, 'entities', 'first-after-remote.md'), 'body')
    await gitCommitAndPush(VAULT, ['entities/first-after-remote.md'], 'create: first-after-remote')

    const remoteFiles = (await simpleGit(BARE2).raw(['ls-tree', '-r', '--name-only', branch])).split('\n')
    expect(remoteFiles).toContain('entities/first-after-remote.md')
  }, 30_000)

  it('subsequent mutations and syncs stay clean once bootstrapped', async () => {
    await gitSync(VAULT)

    writeFileSync(join(VAULT, 'entities', 'second.md'), 'body')
    await gitCommitAndPush(VAULT, ['entities/second.md'], 'create: second')

    const after = await gitSync(VAULT)
    expect(after).toEqual({ pulled: false, pushed: false, remote: true })
    expect((await simpleGit(BARE2).log()).latest?.message).toBe('create: second')
  }, 30_000)

  it('adopts an origin that already carries the branch', async () => {
    // Someone else published the branch first: the local vault has no upstream
    // configured but the remote ref exists, so sync must track it and rebase
    // onto it rather than dying on `git pull`.
    const seeder = join(ROOT, 'seeder')
    await simpleGit().clone(BARE2, seeder)
    const gitS = simpleGit(seeder)
    await gitS.addConfig('user.email', 'test@test.com')
    await gitS.addConfig('user.name', 'Test')
    mkdirSync(join(seeder, 'entities'), { recursive: true })
    writeFileSync(join(seeder, 'entities', 'init.md'), 'local history')
    writeFileSync(join(seeder, 'entities', 'from-remote.md'), 'remote body')
    await gitS.add(['entities/init.md', 'entities/from-remote.md'])
    await gitS.commit('seed remote')
    await gitS.push(['--set-upstream', 'origin', branch])

    const result = await gitSync(VAULT)
    expect(result.remote).toBe(true)
    expect(result.pulled).toBe(true)
    expect(existsSync(join(VAULT, 'entities', 'from-remote.md'))).toBe(true)
  }, 30_000)
})
