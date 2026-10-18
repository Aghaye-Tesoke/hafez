// tests/cli-sync.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync, spawnSync } from 'child_process'
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { simpleGit } from 'simple-git'

const TMP = join(tmpdir(), 'hafez-test-cli-sync-' + Date.now())
const BARE = join(TMP, 'remote.git')
const LOCAL = join(TMP, 'local')
const CLI = join(process.cwd(), 'dist', 'cli.js')

describe('CLI auto-sync', () => {
  let defaultBranch: string

  beforeAll(async () => {
    mkdirSync(TMP, { recursive: true })
    mkdirSync(BARE, { recursive: true })
    await simpleGit(BARE).init(true)
    await simpleGit().clone(BARE, LOCAL)

    // Create vault structure with initial entity
    mkdirSync(join(LOCAL, 'entities'), { recursive: true })
    writeFileSync(join(LOCAL, 'entities', 'test-entity.md'), [
      '---',
      'name: Test Entity',
      'type: project',
      'status: active',
      'created: 2026-01-01',
      'last-touched: 2026-01-01',
      '---',
      '',
    ].join('\n'))
    const git = simpleGit(LOCAL)
    await git.add('.')
    await git.commit('init vault')
    defaultBranch = (await git.branchLocal()).current
    await git.push('origin', defaultBranch)
  })

  afterAll(() => rmSync(TMP, { recursive: true, force: true }))

  it('auto-syncs after a mutating command (update)', async () => {
    const output = execFileSync('node', [CLI, '--vault', LOCAL, 'update', 'test-entity', '--status', 'paused'], {
      encoding: 'utf-8',
    })
    expect(output).toContain('Updated test-entity')

    // Verify the commit was pushed to remote
    const bareLog = await simpleGit(BARE).log()
    expect(bareLog.all.some(c => c.message.includes('update: test-entity'))).toBe(true)

    // Verify file content on local
    const content = readFileSync(join(LOCAL, 'entities', 'test-entity.md'), 'utf-8')
    expect(content).toContain('status: paused')
  })

  it('sync command reports status when already up to date', () => {
    const output = execFileSync('node', [CLI, '--vault', LOCAL, 'sync'], {
      encoding: 'utf-8',
    })
    // After the previous update test auto-synced, everything is up to date
    expect(output).toContain('up to date')
  })

  it('read-only commands do not trigger sync', async () => {
    // Reset local to behind remote, then do a read — should not pull
    const git = simpleGit(LOCAL)

    // Make a remote change via BARE clone
    const local2 = join(TMP, 'local2')
    await simpleGit().clone(BARE, local2)
    mkdirSync(join(local2, 'entities'), { recursive: true })
    writeFileSync(join(local2, 'entities', 'remote-only.md'), [
      '---', 'name: Remote Only', 'type: entity', 'status: active',
      'created: 2026-01-01', 'last-touched: 2026-01-01', '---', '',
    ].join('\n'))
    const git2 = simpleGit(local2)
    await git2.add('.')
    await git2.commit('remote addition')
    await git2.push('origin', defaultBranch)

    // Read from LOCAL — should not pull the remote change
    const output = execFileSync('node', [CLI, '--vault', LOCAL, 'read', 'test-entity'], {
      encoding: 'utf-8',
    })
    expect(output).toContain('Test Entity')

    // Verify the remote file is NOT pulled (read is not mutating)
    const localLog = await git.log()
    expect(localLog.all.some(c => c.message === 'remote addition')).toBe(false)

    // Now do a sync — should pull
    const syncOutput = execFileSync('node', [CLI, '--vault', LOCAL, 'sync'], {
      encoding: 'utf-8',
    })
    expect(syncOutput).toContain('pulled')

    // Cleanup
    rmSync(local2, { recursive: true, force: true })
  })
})

// #203: a read against unusable git must fail loudly, not print an empty changelog.
describe('CLI changelog on a vault whose git is broken (#203)', () => {
  const VAULT = join(tmpdir(), 'hafez-test-cli-readfail-' + Date.now())

  beforeAll(async () => {
    mkdirSync(join(VAULT, 'entities'), { recursive: true })
    const git = simpleGit(VAULT)
    await git.init()
    await git.addConfig('user.email', 'test@test.com')
    await git.addConfig('user.name', 'Test')
    writeFileSync(join(VAULT, 'entities', 'a.md'), '---\nname: A\n---\n')
    await git.add('entities/a.md')
    await git.commit('create: a')
    rmSync(join(VAULT, '.git', 'objects'), { recursive: true, force: true })
    mkdirSync(join(VAULT, '.git', 'objects'))
  })

  afterAll(() => rmSync(VAULT, { recursive: true, force: true }))

  it('prints the git error on stderr and exits 8', () => {
    const r = spawnSync('node', [CLI, '--vault', VAULT, 'changelog', '--since', '7.days.ago'], { encoding: 'utf-8' })
    expect(r.status, r.stdout + r.stderr).toBe(8)
    expect(r.stderr).toContain('git read failed:')
    expect(r.stdout).toBe('')
  })
})
