// tests/cli-digest.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync, spawnSync } from 'child_process'
import { mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { serializeFile } from '../src/vault.js'
import { simpleGit } from 'simple-git'
import { localDay } from '../src/dates.js'

const TMP = join(tmpdir(), 'hafez-cli-digest-test-' + Date.now())
const BARE = join(TMP, 'remote.git')
const VAULT = join(TMP, 'vault')
const CLI = join(process.cwd(), 'dist', 'cli.js')

function runDigest(input: unknown, extraArgs: string[] = []): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnSync(
    'node',
    [CLI, '--vault', VAULT, 'digest', ...extraArgs],
    {
      input: JSON.stringify(input),
      encoding: 'utf-8',
    },
  )
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.status ?? 1,
  }
}

beforeAll(async () => {
  mkdirSync(TMP, { recursive: true })
  mkdirSync(BARE, { recursive: true })
  await simpleGit(BARE).init(true)
  await simpleGit().clone(BARE, VAULT)
  mkdirSync(join(VAULT, 'entities'), { recursive: true })
  mkdirSync(join(VAULT, 'knowledge'), { recursive: true })

  const today = localDay()
  writeFileSync(
    join(VAULT, 'entities', 'simorgh.md'),
    serializeFile(
      { name: 'Simorgh', type: 'project', status: 'active', created: today, 'last-touched': today },
      '## Purpose\n\nTelegram assistant\n\n## Session Log\n',
    ),
  )
  writeFileSync(
    join(VAULT, 'entities', 'hafez.md'),
    serializeFile(
      { name: 'Hafez Core', type: 'project', status: 'active', created: today, 'last-touched': today },
      '## Purpose\n\nVault library\n\n## Session Log\n',
    ),
  )

  const git = simpleGit(VAULT)
  await git.add('.')
  await git.commit('init')
  const branch = (await git.branchLocal()).current
  await git.push('origin', branch)
})

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true })
})

describe('hafez digest CLI', () => {
  it('reads JSON from stdin and outputs valid JSON batch payload', () => {
    const { stdout, exitCode } = runDigest({
      entities_touched: ['simorgh', 'hafez'],
      decisions: ['Merged auth middleware'],
      narrative: 'Auth rewrite session.',
      session_date: '2026-03-29',
      agent: 'claude',
    })

    expect(exitCode).toBe(0)
    const ops = JSON.parse(stdout)
    expect(Array.isArray(ops)).toBe(true)
    expect(ops.length).toBeGreaterThan(0)
  })

  it('output is pipeable to hafez batch (all ops have valid structure)', () => {
    const { stdout, exitCode } = runDigest({
      entities_touched: ['simorgh'],
      decisions: [],
      narrative: 'Quick session.',
      session_date: '2026-03-29',
    })

    expect(exitCode).toBe(0)
    const ops = JSON.parse(stdout)
    for (const op of ops) {
      expect(op.op).toBeDefined()
    }
    const updateOp = ops.find((o: any) => o.op === 'update')
    expect(updateOp.slug).toBe('simorgh')
    expect(updateOp.fields.session_log).toBeDefined()
  })

  it('reads input from --file (the portable Windows session-end path)', () => {
    const payload = join(TMP, 'digest-input.json')
    writeFileSync(payload, JSON.stringify({
      entities_touched: ['simorgh'],
      decisions: [],
      narrative: 'File-based session.',
      session_date: '2026-03-29',
    }))
    const result = spawnSync('node', [CLI, '--vault', VAULT, 'digest', '--file', payload], { encoding: 'utf-8' })
    expect(result.status).toBe(0)
    const ops = JSON.parse(result.stdout)
    expect(ops.find((o: any) => o.op === 'update')?.slug).toBe('simorgh')
  })

  it('reads input from --data: the one-argument form a harness allow rule on hafez covers', () => {
    const summary = JSON.stringify({ entities_touched: ['simorgh'], decisions: [], narrative: 'Argument session.', session_date: '2026-03-29' })
    const result = spawnSync('node', [CLI, '--vault', VAULT, 'digest', '--data', summary], { encoding: 'utf-8' })
    expect(result.status).toBe(0)
    const ops = JSON.parse(result.stdout)
    expect(ops.find((o: any) => o.op === 'update')?.slug).toBe('simorgh')

    const dry = spawnSync('node', [CLI, '--vault', VAULT, 'batch', '--dry-run', '--data', result.stdout], { encoding: 'utf-8' })
    expect(dry.status).toBe(0)
  })

  it('exits 2 (usage error) when given both --data and --file', () => {
    const payload = join(TMP, 'digest-both.json')
    writeFileSync(payload, '{}')
    for (const cmd of ['digest', 'batch']) {
      const result = spawnSync('node', [CLI, '--vault', VAULT, cmd, '--data', '{}', '--file', payload], { encoding: 'utf-8' })
      expect(result.status).toBe(2)
      expect(result.stderr).toMatch(/--data and --file are two ways to pass one payload/)
    }
  })

  it('exits 2 (bad payload) with descriptive error when narrative is missing', () => {
    const { stderr, exitCode } = runDigest({
      entities_touched: ['simorgh'],
      decisions: [],
      session_date: '2026-03-29',
    })

    expect(exitCode).toBe(2)
    expect(stderr).toContain('narrative')
  })

  it('exits 2 (bad payload) with descriptive error when session_date is missing', () => {
    const { stderr, exitCode } = runDigest({
      entities_touched: ['simorgh'],
      decisions: [],
      narrative: 'Some work.',
    })

    expect(exitCode).toBe(2)
    expect(stderr).toContain('session_date')
  })

  it('exits 2 (bad payload) when stdin is not valid JSON', () => {
    const result = spawnSync(
      'node',
      [CLI, '--vault', VAULT, 'digest'],
      { input: 'not json', encoding: 'utf-8' },
    )
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Invalid JSON')
  })

  it('exits 2 (usage error) when stdin is empty', () => {
    const result = spawnSync(
      'node',
      [CLI, '--vault', VAULT, 'digest'],
      { input: '', encoding: 'utf-8' },
    )
    expect(result.status).toBe(2)
    expect(result.stderr).toMatch(/Invalid JSON|No input/)
  })

  it('warns to stderr for unknown fields but still exits 0', () => {
    const { stdout, stderr, exitCode } = runDigest({
      entities_touched: ['simorgh'],
      decisions: [],
      narrative: 'Some work.',
      session_date: '2026-03-29',
      unexpected_field: 'oops',
    })

    expect(exitCode).toBe(0)
    expect(stderr).toContain('unexpected_field')
    const ops = JSON.parse(stdout)
    expect(Array.isArray(ops)).toBe(true)
  })

  it('exits 1 (not found) naming an unknown entity slug, and prints no ops', () => {
    const { stdout, stderr, exitCode } = runDigest({
      entities_touched: ['simorgh', 'no-such-entity'],
      decisions: [],
      narrative: 'Some work.',
      session_date: '2026-03-29',
    })

    expect(exitCode).toBe(1)
    expect(stderr).toContain("'no-such-entity'")
    expect(stderr).not.toContain('simorgh')
    expect(stdout).toBe('')
  })

  it('digest output executes successfully through hafez batch', () => {
    const { stdout, exitCode: digestExit } = runDigest({
      entities_touched: ['simorgh'],
      decisions: ['Test decision'],
      narrative: 'Round-trip batch test.',
      session_date: '2026-03-29',
      agent: 'claude',
    })

    expect(digestExit).toBe(0)

    // Pipe digest output through batch
    const batchResult = spawnSync(
      'node',
      [CLI, '--vault', VAULT, 'batch'],
      { input: stdout, encoding: 'utf-8' },
    )
    expect(batchResult.status).toBe(0)

    // Verify entity was updated with session log
    const entityContent = readFileSync(join(VAULT, 'entities', 'simorgh.md'), 'utf-8')
    expect(entityContent).toContain('Round-trip batch test.')

    // Verify session note was created in sessions/ directory with session-date in frontmatter
    const sessionFiles = readdirSync(join(VAULT, 'sessions'))
    const sessionNote = sessionFiles.find(f => f.startsWith('session-'))
    expect(sessionNote).toBeDefined()
    const noteContent = readFileSync(join(VAULT, 'sessions', sessionNote!), 'utf-8')
    expect(noteContent).toContain("session-date: '2026-03-29'")
  })

  it('digest command does not write to the vault (read-only)', () => {
    // digest should NOT trigger auto-sync — it is not a mutating command
    const statusBefore = execFileSync('git', ['-C', VAULT, 'status', '--porcelain'], { encoding: 'utf-8' })

    const { exitCode } = runDigest({
      entities_touched: [],
      decisions: [],
      narrative: 'Read-only test.',
      session_date: '2026-03-29',
    })

    expect(exitCode).toBe(0)
    const statusAfter = execFileSync('git', ['-C', VAULT, 'status', '--porcelain'], { encoding: 'utf-8' })
    expect(statusAfter).toBe(statusBefore)
  })
})
