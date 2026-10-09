// tests/date-convention.test.ts
//
// One calendar-day convention: the vault stamps and compares the LOCAL day.
// Everything here runs through a spawned CLI with TZ set in the child env —
// Node caches the timezone per process, so the parent vitest process can't
// change it after start.
//
// The TZ is picked so the local day and the UTC day are guaranteed to differ
// *right now* (a fixed TZ only diverges during part of the UTC day, which
// would make this pass by accident for most of the clock). Both directions
// of skew are covered across runs: UTC-12 puts local a day behind for the
// first half of the UTC day, UTC+14 puts it a day ahead for the second half.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'child_process'
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { simpleGit } from 'simple-git'
import { serializeFile } from '../src/vault.js'

const TZ = new Date().getUTCHours() < 12 ? 'Etc/GMT+12' : 'Etc/GMT-14'

const TMP = join(tmpdir(), 'hafez-date-convention-test-' + Date.now())
const VAULT = join(TMP, 'vault')
const CLI = join(process.cwd(), 'dist', 'cli.js')

function run(...args: string[]): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnSync('node', [CLI, '--vault', VAULT, ...args], {
    encoding: 'utf-8',
    env: { ...process.env, TZ },
  })
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', exitCode: result.status ?? 1 }
}

/** The calendar day in TZ, `deltaDays` from now. Computed independently of
 *  the code under test (Intl, not the vault's own helper). */
function dayInTz(deltaDays = 0): string {
  const d = new Date(Date.now() + deltaDays * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d)
}

const LOCAL_TODAY = dayInTz(0)
const LOCAL_YESTERDAY = dayInTz(-1)
const LOCAL_TOMORROW = dayInTz(1)
const UTC_TODAY = new Date().toISOString().slice(0, 10)

function frontmatter(slug: string): Record<string, string> {
  const raw = readFileSync(join(VAULT, 'entities', `${slug}.md`), 'utf-8')
  const fm = raw.split('---')[1] ?? ''
  const out: Record<string, string> = {}
  for (const line of fm.split('\n')) {
    const m = line.match(/^([\w-]+):\s*(.*)$/)
    if (m) out[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '')
  }
  return out
}

function querySlugs(...args: string[]): string[] {
  const { stdout, exitCode, stderr } = run('query', '--json', '--filter', 'all', ...args)
  expect(exitCode, stderr).toBe(0)
  return JSON.parse(stdout).items.map((i: { slug: string }) => i.slug)
}

function changelogSlugs(since: string): string[] {
  const { stdout, exitCode, stderr } = run('changelog', '--json', '--since', since)
  expect(exitCode, stderr).toBe(0)
  return JSON.parse(stdout).map((e: { slug: string }) => e.slug)
}

beforeAll(async () => {
  mkdirSync(join(VAULT, 'entities'), { recursive: true })
  const git = simpleGit(VAULT)
  await git.init()
  await git.addConfig('user.email', 'test@test.com')
  await git.addConfig('user.name', 'Test')
  await git.commit('init', ['--allow-empty'])
  const r = run('create', 'entity', 'Late Night Entity', '--type', 'project')
  expect(r.exitCode, r.stderr).toBe(0)
})

afterAll(() => rmSync(TMP, { recursive: true, force: true }))

describe('date convention: the local calendar day', () => {
  it('the test really is running where local and UTC days disagree', () => {
    expect(LOCAL_TODAY).not.toBe(UTC_TODAY)
  })

  it('stamps created/last-touched with the local day, not the UTC day', () => {
    const fm = frontmatter('late-night-entity')
    expect(fm.created).toBe(LOCAL_TODAY)
    expect(fm['last-touched']).toBe(LOCAL_TODAY)
  })

  it('stamps session log entries with the local day', () => {
    const r = run('update', 'late-night-entity', '--log', 'progress: worked late', '--agent', 'claude')
    expect(r.exitCode, r.stderr).toBe(0)
    const body = readFileSync(join(VAULT, 'entities', 'late-night-entity.md'), 'utf-8')
    expect(body).toContain(`### ${LOCAL_TODAY} — claude [progress]`)
  })

  it('query --since/--before bracket the entity around the local today', () => {
    expect(querySlugs('--since', LOCAL_TODAY)).toContain('late-night-entity')
    expect(querySlugs('--before', LOCAL_TODAY)).toContain('late-night-entity')
    expect(querySlugs('--since', LOCAL_TOMORROW)).not.toContain('late-night-entity')
    expect(querySlugs('--before', LOCAL_YESTERDAY)).not.toContain('late-night-entity')
  })

  it('changelog --since and query --since agree about the same mutation', () => {
    for (const date of [LOCAL_YESTERDAY, LOCAL_TODAY, LOCAL_TOMORROW]) {
      const inQuery = querySlugs('--since', date).includes('late-night-entity')
      const inChangelog = changelogSlugs(date).includes('late-night-entity')
      expect(inChangelog, `disagreement on --since ${date} (TZ=${TZ})`).toBe(inQuery)
    }
  })

  it('stale entities count local days: exactly staleness-days ago is not stale, one older is (query and stats)', () => {
    for (const [slug, delta] of [['touched-14-days-ago', -14], ['touched-15-days-ago', -15]] as const) {
      const fm = { name: slug, type: 'project', status: 'active', created: '2026-01-01', 'last-touched': dayInTz(delta) }
      writeFileSync(join(VAULT, 'entities', `${slug}.md`), serializeFile(fm, '## Purpose\n\n## Session Log\n'))
    }
    const q = run('query', '--json', '--filter', 'stale')
    expect(q.exitCode, q.stderr).toBe(0)
    const stale = JSON.parse(q.stdout).items.map((i: { slug: string }) => i.slug)
    expect(stale, `TZ=${TZ}`).toContain('touched-15-days-ago')
    expect(stale, `TZ=${TZ}`).not.toContain('touched-14-days-ago')

    const s = run('stats', '--json')
    expect(s.exitCode, s.stderr).toBe(0)
    const days = Object.fromEntries(JSON.parse(s.stdout).stale.map((e: { slug: string; days_since_touched: number }) => [e.slug, e.days_since_touched]))
    expect(days, `TZ=${TZ}`).toEqual({ 'touched-15-days-ago': 15 })
  })
})
