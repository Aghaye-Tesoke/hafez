// tests/query-surface.test.ts
// The query surface contract (issue 04): every flag the query parser accepts
// is either applied or loudly rejected in every kind branch, every enum value
// is validated, and sort/limit/offset never reach raw SQL unchecked.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createHafez, removeTemp } from './helpers/hafez.js'
import { createIndex, ENTITY_ONLY_OPTS, KNOWLEDGE_ONLY_OPTS, SESSION_REJECTED_OPTS, type HafezIndex } from '../src/db.js'
import { serializeFile } from '../src/vault.js'
import { cmdQuery, QUERY_FLAG_NAMES, QUERY_FLAG_SUPPORT, type QueryBranch } from '../src/cli/commands.js'
import { UsageError } from '../src/cli/args.js'
import { createMemoryJournal } from './helpers/memory-journal.js'
import { localDay } from '../src/dates.js'

const TMP = join(tmpdir(), 'hafez-test-query-surface-' + Date.now())
const VAULT = join(TMP, 'vault')
const CLI = join(process.cwd(), 'dist', 'cli.js')

const today = localDay()

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

afterAll(() => removeTemp(TMP))

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

// --- (b2) the same rule below the CLI: the library path rejects too ---
//
// The matrix above stops at cmdQuery, which rejects the flag before the read
// surface ever sees it — so it never reached the branch that used to drop.
// These go through the factory, the way an MCP wrapper or an agent building
// opts as JSON does.

describe('the read surface rejects opts its branch cannot map', () => {
  it('an entity query rejects the knowledge-only opts', async () => {
    const os = makeOS()
    await expect(os.query({ filter: 'active', confidence: 'pattern' } as any)).rejects.toThrow(/confidence/)
    await expect(os.query({ subtype: 'plan' } as any)).rejects.toThrow(/subtype/)
  })

  it('a knowledge query rejects the entity-only opts', async () => {
    const os = makeOS()
    await expect(os.query_knowledge({ filter: 'active' } as any)).rejects.toThrow(/filter/)
    await expect(os.query_knowledge({ type: 'project' } as any)).rejects.toThrow(/type/)
    await expect(os.query_knowledge({ parent: 'active-proj' } as any)).rejects.toThrow(/parent/)
  })

  it('the unified query still accepts opts from both sides — it maps both', async () => {
    const out = await makeOS().queryUnified({ kind: 'all', filter: 'active', confidence: 'pattern' })
    expect(out.items.some(i => i.slug === 'kn-pattern')).toBe(true)
  })

  it('but a unified query narrowed by kind is that kind, and rejects the same opts', async () => {
    // `kind: 'all'` maps both sides; `kind: 'entity'` / `kind: 'knowledge'`
    // narrow to one, and a narrowed branch maps no more than the dedicated
    // one does — the conditions land on columns the selected kind leaves
    // NULL, so every row is excluded and the caller gets 0 results, exit 0.
    //
    // UnifiedQueryOpts is a union discriminated on `kind`, so every call below
    // is a compile error without the cast. The runtime check is what an
    // untyped caller hits — JS, or JSON opts over an MCP wrapper.
    const os = makeOS()
    await expect(os.queryUnified({ kind: 'entity', confidence: 'pattern' } as any)).rejects.toThrow(/confidence/)
    await expect(os.queryUnified({ kind: 'entity', subtype: 'insight' } as any)).rejects.toThrow(/subtype/)
    await expect(os.queryUnified({ kind: 'knowledge', filter: 'active' } as any)).rejects.toThrow(/filter/)
    await expect(os.queryUnified({ kind: 'knowledge', type: 'project' } as any)).rejects.toThrow(/type/)
    await expect(os.queryUnified({ kind: 'knowledge', parent: 'active-proj' } as any)).rejects.toThrow(/parent/)
    await expect(os.queryUnified({ kind: 'entity', sort_by: 'reinforcement_count' } as any)).rejects.toThrow(/reinforcement_count/)
  })

  it('a kind-narrowed unified query still answers when its opts are in scope', async () => {
    // These need no cast — they are what the union permits.
    const os = makeOS()
    await expect(os.queryUnified({ kind: 'entity', filter: 'active' })).resolves.toHaveProperty('items')
    await expect(os.queryUnified({ kind: 'knowledge', confidence: 'pattern' })).resolves.toHaveProperty('items')
    await expect(os.queryUnified({ kind: 'knowledge', sort_by: 'reinforcement_count' })).resolves.toHaveProperty('items')
  })

  it('an explicit undefined is not a request, so it is not a rejection', async () => {
    await expect(makeOS().query({ filter: 'active', confidence: undefined } as any)).resolves.toHaveProperty('items')
  })

  it('rejects with VALIDATION_FAILED, so the CLI exit-code table needs no change', () => {
    const index: HafezIndex = createIndex(VAULT)
    try {
      expect(() => index.queryEntities({ confidence: 'pattern' } as any)).toThrow(
        expect.objectContaining({ code: 'VALIDATION_FAILED' }),
      )
    } finally {
      index.close()
    }
  })
})

// --- (b3) knowledge-only sort fields are rejected, not substituted ---

describe('sort fields are applied or rejected, never substituted', () => {
  it('an entity query rejects a knowledge-only sort field', async () => {
    const os = makeOS()
    await expect(os.query({ sort_by: 'reinforcement_count' } as any)).rejects.toThrow(/reinforcement_count/)
    await expect(os.query({ sort_by: 'last_reinforced' } as any)).rejects.toThrow(/last_reinforced/)
  })

  it('the knowledge and unified branches still accept them', async () => {
    const os = makeOS()
    await expect(os.query_knowledge({ sort_by: 'reinforcement_count' })).resolves.toHaveProperty('items')
    await expect(os.queryUnified({ kind: 'all', sort_by: 'reinforcement_count' } as any)).resolves.toHaveProperty('items')
  })

  it('the CLI exits non-zero instead of exiting 0 in the wrong order', () => {
    const { stderr, exitCode } = runCli('query', '--sort-by', 'reinforcement_count')
    expect(exitCode).not.toBe(0)
    expect(stderr).toMatch(/reinforcement_count/)
  })
})

describe('--related-to rejects the flags it cannot apply', () => {
  it('still returns linked items on its own', async () => {
    const out = await queryJson(['--related-to', 'active-proj'])
    expect(out).toHaveProperty('items')
  })

  it('rejects --limit / --filter instead of dropping them', async () => {
    await expect(cmdQuery(makeOS(), ['--related-to', 'active-proj', '--limit', '1'], { json: true })).rejects.toThrow(/--limit/)
    await expect(cmdQuery(makeOS(), ['--related-to', 'active-proj', '--filter', 'active'], { json: true })).rejects.toThrow(/--filter/)
  })

  it('--kind narrows to one kind; an unknown kind is rejected', async () => {
    const all = JSON.parse(await cmdQuery(makeOS(), ['--related-to', 'active-proj', '--kind', 'all'], { json: true }))
    expect(all).toHaveProperty('items')
    const knowledge = JSON.parse(await cmdQuery(makeOS(), ['--related-to', 'active-proj', '--kind', 'knowledge'], { json: true }))
    expect(knowledge.items.every((i: any) => i.kind === 'knowledge')).toBe(true)
    expect(knowledge.total).toBe(knowledge.items.length)
    await expect(cmdQuery(makeOS(), ['--related-to', 'active-proj', '--kind', 'bogus'], { json: true })).rejects.toThrow(/--kind must be one of/)
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

  // Flag name → opt name. Declared, because the CLI speaks kebab-case flags
  // and the read surface speaks opts; the parity assertion below is what makes
  // the two tables one rule instead of two that can drift.
  const FLAG_TO_OPT: Record<string, string> = {
    filter: 'filter', type: 'type', parent: 'parent',
    confidence: 'confidence', subtype: 'subtype',
    domain: 'domain', tag: 'tags',
  }

  it('the CLI flag matrix and the read surface opt matrix are the same rule', () => {
    const rejected: Record<'entity' | 'knowledge' | 'session', readonly string[]> = {
      entity: KNOWLEDGE_ONLY_OPTS,
      knowledge: ENTITY_ONLY_OPTS,
      session: SESSION_REJECTED_OPTS,
    }
    for (const branch of ['entity', 'knowledge', 'session'] as const) {
      const cliRejects = Object.keys(FLAG_TO_OPT)
        .filter(f => !QUERY_FLAG_SUPPORT[branch].includes(f))
        .map(f => FLAG_TO_OPT[f])
        .sort()
      expect([...rejected[branch]].sort(), `${branch}: CLI flag scope and read-surface opt scope disagree`).toEqual(cliRejects)
    }
  })

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
    { branch: 'session', base: ['--kind', 'session'] },
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
