// tests/query-surface.test.ts
// The query surface contract (issue 04): every flag the query parser accepts
// is either applied or loudly rejected in every kind branch, every enum value
// is validated, and sort/limit/offset never reach raw SQL unchecked.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createHafez } from '../src/index.js'
import { createIndex, type HafezIndex } from '../src/db.js'
import { serializeFile } from '../src/vault.js'
import { cmdQuery, QUERY_FLAG_NAMES, QUERY_FLAG_SUPPORT, type QueryBranch } from '../src/cli/commands.js'
import { UsageError } from '../src/cli/args.js'
import { createMemoryJournal } from './helpers/memory-journal.js'

const TMP = join(tmpdir(), 'hafez-test-query-surface-' + Date.now())
const VAULT = join(TMP, 'vault')
const CLI = join(process.cwd(), 'dist', 'cli.js')

const today = new Date().toISOString().slice(0, 10)

function writeEntity(slug: string, fm: Record<string, any>) {
  writeFileSync(join(VAULT, 'entities', `${slug}.md`), serializeFile(fm, '## Purpose\n\n## Session Log\n'))
}
function writeKnowledge(slug: string, fm: Record<string, any>) {
  writeFileSync(join(VAULT, 'knowledge', `${slug}.md`), serializeFile(fm, '## Synthesis\n\nA note\n\n## Evidence\n'))
}

beforeAll(() => {
  mkdirSync(join(VAULT, 'entities'), { recursive: true })
  mkdirSync(join(VAULT, 'knowledge'), { recursive: true })

  writeEntity('active-proj', { name: 'Active Proj', type: 'project', status: 'active', created: '2026-01-01', 'last-touched': today, tags: ['infra'], domain: ['engineering'] })
  writeEntity('paused-thing', { name: 'Paused Thing', type: 'entity', status: 'paused', created: '2026-01-02', 'last-touched': today })
  writeEntity('child-proj', { name: 'Child Proj', type: 'project', status: 'active', created: '2026-01-03', 'last-touched': today, parent: 'active-proj' })

  writeKnowledge('kn-pattern', { name: 'Kn Pattern', created: '2026-01-01', domain: ['engineering'], confidence: 'pattern', subtype: 'insight', tags: ['infra'] })
  writeKnowledge('kn-obs', { name: 'Kn Obs', created: '2026-06-01', domain: ['ai'], confidence: 'observation', subtype: 'insight' })
})

afterAll(() => rmSync(TMP, { recursive: true, force: true }))

function makeOS() {
  return createHafez({ vaultPath: VAULT, persistence: createMemoryJournal() })
}

async function queryJson(args: string[]): Promise<any> {
  return JSON.parse(await cmdQuery(makeOS(), args, { json: true }))
}

function runCli(...args: string[]): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync('node', [CLI, '--vault', VAULT, ...args], { encoding: 'utf-8' }) as string
    return { stdout, stderr: '', exitCode: 0 }
  } catch (err: any) {
    return { stdout: (err.stdout ?? '') as string, stderr: (err.stderr ?? '') as string, exitCode: err.status ?? 1 }
  }
}

// --- (a) --kind all must return knowledge, not just entities ---

describe('--kind all includes knowledge', () => {
  it('returns both kinds with the default filter', async () => {
    const out = await queryJson(['--kind', 'all'])
    expect(out.items.some((i: any) => i.kind === 'entity')).toBe(true)
    expect(out.items.some((i: any) => i.kind === 'knowledge')).toBe(true)
  })

  it('an explicit --filter active still returns knowledge (status is an entity attribute)', async () => {
    const out = await queryJson(['--kind', 'all', '--filter', 'active'])
    const entities = out.items.filter((i: any) => i.kind === 'entity')
    expect(entities.length).toBeGreaterThan(0)
    expect(entities.every((i: any) => i.status === 'active')).toBe(true)
    expect(out.items.some((i: any) => i.slug === 'kn-pattern')).toBe(true)
  })

  it('the markdown view renders a Knowledge section for --kind all', async () => {
    const out = await cmdQuery(makeOS(), ['--kind', 'all'], {})
    expect(out).toContain('## Entities')
    expect(out).toContain('## Knowledge')
  })

  it('status filters narrow the entity side only, at the index level', () => {
    const index: HafezIndex = createIndex(VAULT)
    try {
      const active = index.queryUnified({ kind: 'all', filter: 'active' })
      expect(active.items.some(i => i.kind === 'knowledge')).toBe(true)
      expect(active.items.filter(i => i.kind === 'entity').every(i => (i as any).status === 'active')).toBe(true)
      // The entity-only views stay entity-only.
      const capture = index.queryUnified({ kind: 'all', filter: 'capture' })
      expect(capture.items.every(i => i.kind === 'entity')).toBe(true)
    } finally {
      index.close()
    }
  })
})

// --- (b) no kind branch silently drops a flag ---

describe('--kind knowledge honours or rejects every flag', () => {
  it('applies --created-since / --created-before', async () => {
    const since = await queryJson(['--kind', 'knowledge', '--created-since', '2026-03-01'])
    expect(since.items.map((i: any) => i.slug)).toEqual(['kn-obs'])
    const before = await queryJson(['--kind', 'knowledge', '--created-before', '2026-03-01'])
    expect(before.items.map((i: any) => i.slug)).toEqual(['kn-pattern'])
  })

  it('applies --since / --before', async () => {
    // Knowledge notes carry no last-touched, so a since window excludes them.
    const since = await queryJson(['--kind', 'knowledge', '--since', '2026-01-01'])
    expect(since.items).toEqual([])
  })

  it('rejects --filter instead of silently ignoring it (the shipped skill lint)', async () => {
    await expect(cmdQuery(makeOS(), ['--kind', 'knowledge', '--filter', 'stale'], { json: true })).rejects.toThrow(/--filter/)
    await expect(cmdQuery(makeOS(), ['--kind', 'knowledge', '--filter', 'active'], { json: true })).rejects.toThrow(UsageError)
  })

  it('rejects the entity-only --type and --parent', async () => {
    await expect(cmdQuery(makeOS(), ['--kind', 'knowledge', '--type', 'project'], { json: true })).rejects.toThrow(/--type/)
    await expect(cmdQuery(makeOS(), ['--kind', 'knowledge', '--parent', 'active-proj'], { json: true })).rejects.toThrow(/--parent/)
  })
})

describe('--kind entity rejects the knowledge-only flags', () => {
  it('rejects --confidence rather than dropping it', async () => {
    await expect(cmdQuery(makeOS(), ['--confidence', 'pattern'], { json: true })).rejects.toThrow(/--confidence/)
  })

  it('rejects --subtype rather than dropping it', async () => {
    await expect(cmdQuery(makeOS(), ['--subtype', 'insight'], { json: true })).rejects.toThrow(/--subtype/)
  })
})

describe('--related-to rejects the flags it cannot apply', () => {
  it('still returns linked items on its own', async () => {
    const out = await queryJson(['--related-to', 'active-proj'])
    expect(out).toHaveProperty('items')
  })

  it('rejects --limit / --filter / --kind instead of dropping them', async () => {
    await expect(cmdQuery(makeOS(), ['--related-to', 'active-proj', '--limit', '1'], { json: true })).rejects.toThrow(/--limit/)
    await expect(cmdQuery(makeOS(), ['--related-to', 'active-proj', '--filter', 'active'], { json: true })).rejects.toThrow(/--filter/)
    await expect(cmdQuery(makeOS(), ['--related-to', 'active-proj', '--kind', 'all'], { json: true })).rejects.toThrow(/--kind/)
  })
})

// --- (c) unknown enum values are rejected, never ignored ---

describe('unknown flag values are rejected', () => {
  it("a typo'd --filter names the valid values", async () => {
    await expect(cmdQuery(makeOS(), ['--filter', 'actvie'], { json: true })).rejects.toThrow(/actvie/)
    await expect(cmdQuery(makeOS(), ['--filter', 'actvie'], { json: true })).rejects.toThrow(/active.*paused.*done.*all.*stale.*capture/s)
  })

  it('rejects an unknown --kind instead of falling through to the entity branch', async () => {
    await expect(cmdQuery(makeOS(), ['--kind', 'bogus'], { json: true })).rejects.toThrow(/--kind/)
  })

  it('rejects unknown --type / --confidence / --subtype / --sort-by values', async () => {
    await expect(cmdQuery(makeOS(), ['--type', 'projekt'], { json: true })).rejects.toThrow(/projekt/)
    await expect(cmdQuery(makeOS(), ['--kind', 'knowledge', '--confidence', 'strong'], { json: true })).rejects.toThrow(/strong/)
    await expect(cmdQuery(makeOS(), ['--kind', 'knowledge', '--subtype', 'note'], { json: true })).rejects.toThrow(/note/)
    await expect(cmdQuery(makeOS(), ['--sort-by', 'nmae'], { json: true })).rejects.toThrow(/nmae/)
  })

  it('rejects unknown filter values at the index level too', () => {
    const index: HafezIndex = createIndex(VAULT)
    try {
      expect(() => index.queryEntities({ filter: 'actvie' as any })).toThrow(/actvie/)
      expect(() => index.queryUnified({ kind: 'all', filter: 'actvie' as any })).toThrow(/actvie/)
    } finally {
      index.close()
    }
  })
})

// --- (d) sort_order / limit / offset never reach raw SQL unvalidated ---

describe('sort/paging inputs are validated', () => {
  it('rejects a bogus --sort-order with a message naming asc/desc', async () => {
    await expect(cmdQuery(makeOS(), ['--sort-order', 'bogus'], { json: true })).rejects.toThrow(/asc.*desc/s)
  })

  it('rejects non-integer --limit / --offset', async () => {
    await expect(cmdQuery(makeOS(), ['--limit', 'abc'], { json: true })).rejects.toThrow(/--limit/)
    await expect(cmdQuery(makeOS(), ['--offset', 'abc'], { json: true })).rejects.toThrow(/--offset/)
    await expect(cmdQuery(makeOS(), ['--limit', '1.5'], { json: true })).rejects.toThrow(/--limit/)
    await expect(cmdQuery(makeOS(), ['--limit', '-1'], { json: true })).rejects.toThrow(/--limit/)
  })

  it('guards the interpolation site itself, not just the CLI', () => {
    const index: HafezIndex = createIndex(VAULT)
    try {
      expect(() => index.queryItems({ limit: NaN })).toThrow(/limit/)
      expect(() => index.queryItems({ offset: 1.5 })).toThrow(/offset/)
      expect(() => index.queryItems({ sort_order: 'bogus' as any })).toThrow(/sort_order|sort-order/)
      // Valid paging still works.
      expect(index.queryItems({ limit: 2, offset: 1 }).items.length).toBeLessThanOrEqual(2)
    } finally {
      index.close()
    }
  })
})

// --- (e) the matrix: every flag, every branch ---

describe('query flag × kind branch matrix', () => {
  const SAMPLE: Record<string, string> = {
    kind: '', // branch selector, supplied per row
    filter: 'active',
    type: 'project',
    parent: 'active-proj',
    'related-to': 'active-proj',
    domain: 'engineering',
    confidence: 'pattern',
    subtype: 'insight',
    tag: 'infra',
    since: '2026-01-01',
    before: '2026-12-31',
    'created-since': '2026-01-01',
    'created-before': '2026-12-31',
    'sort-by': 'name',
    'sort-order': 'asc',
    limit: '5',
    offset: '0',
  }

  it('the support table covers every declared query flag in every branch', () => {
    for (const branch of Object.keys(QUERY_FLAG_SUPPORT) as QueryBranch[]) {
      const declared = new Set(QUERY_FLAG_SUPPORT[branch])
      for (const flag of declared) expect(QUERY_FLAG_NAMES).toContain(flag)
    }
    // Every declared flag is supported by at least one branch — no flag the
    // parser accepts is dead everywhere.
    for (const flag of QUERY_FLAG_NAMES) {
      const supported = (Object.keys(QUERY_FLAG_SUPPORT) as QueryBranch[]).some(b => QUERY_FLAG_SUPPORT[b].includes(flag))
      expect(supported, `${flag} is accepted by the parser but applied by no branch`).toBe(true)
    }
  })

  const branches: Array<{ branch: QueryBranch; base: string[] }> = [
    { branch: 'entity', base: [] },
    { branch: 'knowledge', base: ['--kind', 'knowledge'] },
    { branch: 'all', base: ['--kind', 'all'] },
    { branch: 'related-to', base: ['--related-to', 'active-proj'] },
  ]

  for (const { branch, base } of branches) {
    for (const flag of QUERY_FLAG_NAMES) {
      const supported = QUERY_FLAG_SUPPORT[branch].includes(flag)
      // The flags that select the branch are exercised by `base` itself:
      // --kind picks entity/knowledge/all, and --related-to always wins the
      // branch (so it is never "rejected" — it is what makes the branch).
      if (flag === 'kind' && branch !== 'related-to') continue
      if (flag === 'related-to') continue
      it(`${branch}: --${flag} is ${supported ? 'applied' : 'rejected'}`, async () => {
        const args = flag === 'kind' ? [...base, '--kind', 'all'] : [...base, `--${flag}`, SAMPLE[flag]]
        const call = cmdQuery(makeOS(), args, { json: true })
        if (supported) {
          await expect(call).resolves.toBeTypeOf('string')
        } else {
          await expect(call).rejects.toThrow(new RegExp(`--${flag}`))
        }
      })
    }
  }
})

// --- the real error reaches the user, not bindings-reinstall advice ---

describe('CLI exit behaviour', () => {
  it("a typo'd --filter exits non-zero with the real message", () => {
    const { stderr, exitCode } = runCli('query', '--filter', 'actvie')
    expect(exitCode).not.toBe(0)
    expect(stderr).toMatch(/actvie/)
    expect(stderr).not.toMatch(/better-sqlite3/)
  })

  it('--sort-order bogus / --limit abc / --offset abc surface the validation error', () => {
    for (const args of [['--sort-order', 'bogus'], ['--limit', 'abc'], ['--offset', 'abc']]) {
      const { stderr, exitCode } = runCli('query', ...args)
      expect(exitCode).not.toBe(0)
      expect(stderr).not.toMatch(/bindings/i)
      expect(stderr).not.toMatch(/allow-scripts/)
    }
  })

  it('--kind all lists knowledge end to end', () => {
    const { stdout, exitCode } = runCli('query', '--kind', 'all')
    expect(exitCode).toBe(0)
    expect(stdout).toContain('Kn Pattern')
  })
})
