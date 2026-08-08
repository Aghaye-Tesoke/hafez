// tests/search-input.test.ts
//
// Regression coverage for two classes of search input the sanitizer used to
// mangle:
//
//   1. Non-Latin text — the sanitizer stripped every non-ASCII character with a
//      non-Unicode-aware class (`[^\w\s]`), so `search('日本語')` produced an
//      empty FTS query and always returned nothing, even though the vault
//      happily stores non-Latin notes.
//   2. Bare FTS5 operator words — `NOT` / `OR` / `AND` are all stopwords, so the
//      all-stopword fallback reinjected the raw token, which reached fts5 as an
//      *operator* (`NOT*`) and raised an unhandled syntax error.
//
// The ASCII-behaviour block guards the fix: ranking tiers, stopword filtering,
// and prefix matching must be untouched.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'child_process'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import simpleGit from 'simple-git'
import { createIndex } from '../src/db.js'
import { serializeFile } from '../src/vault.js'

const TMP = join(tmpdir(), 'hafez-search-input-test-' + Date.now())
const VAULT = join(TMP, 'vault')
const CLI = join(process.cwd(), 'dist', 'cli.js')
const today = new Date().toISOString().slice(0, 10)

function runCli(...args: string[]): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnSync('node', [CLI, '--vault', VAULT, ...args], { encoding: 'utf-8' })
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.status ?? 1,
  }
}

beforeAll(async () => {
  mkdirSync(join(VAULT, 'entities'), { recursive: true })
  mkdirSync(join(VAULT, 'knowledge'), { recursive: true })

  // Non-Latin note: name and body are both Japanese.
  writeFileSync(
    join(VAULT, 'entities', 'japanese-note.md'),
    serializeFile(
      { name: '日本語のメモ', type: 'project', status: 'active', created: today, 'last-touched': today },
      '## Purpose\n\n日本語のメモ を検索できるようにする\n\n## Session Log\n',
    ),
  )
  // A second non-Latin script, to prove the fix is not CJK-specific.
  writeFileSync(
    join(VAULT, 'knowledge', 'russian-note.md'),
    serializeFile(
      { name: 'Заметка', confidence: 'observation', 'reinforcement-count': 0, created: today, domain: ['testing'] },
      '## Synthesis\n\nЗаметка про поиск\n\n## Evidence\n',
    ),
  )
  // ASCII fixtures for the behaviour-preservation block.
  writeFileSync(
    join(VAULT, 'entities', 'auth-service.md'),
    serializeFile(
      { name: 'Auth Service', type: 'project', status: 'active', created: today, 'last-touched': today },
      '## Purpose\n\nThe authentication service handles tokens\n\n## Session Log\n',
    ),
  )
  writeFileSync(
    join(VAULT, 'entities', 'billing-service.md'),
    serializeFile(
      { name: 'Billing Service', type: 'project', status: 'active', created: today, 'last-touched': today },
      '## Purpose\n\nBilling mentions the Auth Service once\n\n## Session Log\n',
    ),
  )
  // Body contains "notable" / "nothing" so a literal `NOT` prefix search has
  // something to match rather than trivially returning empty.
  writeFileSync(
    join(VAULT, 'entities', 'notes-entity.md'),
    serializeFile(
      { name: 'Notation Notes', type: 'entity', status: 'active', created: today, 'last-touched': today },
      '## Purpose\n\nNothing notable here\n\n## Session Log\n',
    ),
  )

  const git = simpleGit(VAULT)
  await git.init()
  await git.addConfig('user.email', 'test@test.com')
  await git.addConfig('user.name', 'Test')
  await git.add(['entities', 'knowledge'])
  await git.commit('init')
})

afterAll(() => rmSync(TMP, { recursive: true, force: true }))

describe('search: non-Latin input', () => {
  it('finds a Japanese note by a Japanese query', () => {
    const db = createIndex(VAULT)
    const results = db.search('日本語')
    expect(results.some(r => r.slug === 'japanese-note')).toBe(true)
    db.close()
  })

  it('finds a Cyrillic note by a Cyrillic query', () => {
    const db = createIndex(VAULT)
    const results = db.search('Заметка')
    expect(results.some(r => r.slug === 'russian-note')).toBe(true)
    db.close()
  })

  it('finds non-Latin content through the CLI', () => {
    const { stdout, exitCode } = runCli('search', '日本語')
    expect(exitCode).toBe(0)
    expect(stdout).toContain('japanese-note')
  })

  it('still strips punctuation around non-Latin terms', () => {
    const db = createIndex(VAULT)
    const results = db.search('「日本語」!')
    expect(results.some(r => r.slug === 'japanese-note')).toBe(true)
    db.close()
  })
})

describe('search: FTS5 operator words', () => {
  for (const op of ['NOT', 'OR', 'AND', 'NEAR']) {
    it(`treats a bare "${op}" as a literal, not an operator`, () => {
      const db = createIndex(VAULT)
      expect(() => db.search(op)).not.toThrow()
      db.close()
    })
  }

  it('handles a query made only of operator words', () => {
    const db = createIndex(VAULT)
    expect(() => db.search('AND OR')).not.toThrow()
    expect(() => db.search('NOT AND NOT')).not.toThrow()
    db.close()
  })

  it('matches operator words as literal text', () => {
    const db = createIndex(VAULT)
    // "NOT" as a literal prefix should reach "Notation Notes" / "Nothing notable".
    const results = db.search('NOT')
    expect(results.some(r => r.slug === 'notes-entity')).toBe(true)
    db.close()
  })

  it('exits 0 for `search NOT` through the CLI', () => {
    const { stderr, exitCode } = runCli('search', 'NOT')
    expect(stderr).not.toContain('syntax error')
    expect(exitCode).toBe(0)
  })

  it('exits 0 for `search OR` and `search AND` through the CLI', () => {
    for (const op of ['OR', 'AND']) {
      const { stderr, exitCode } = runCli('search', op)
      expect(stderr).not.toContain('syntax error')
      expect(exitCode).toBe(0)
    }
  })
})

describe('search: ASCII behaviour preserved', () => {
  it('keeps prefix matching (partial term matches longer word)', () => {
    const db = createIndex(VAULT)
    const results = db.search('authentic')
    expect(results.some(r => r.slug === 'auth-service')).toBe(true)
    db.close()
  })

  it('keeps stopword filtering (stopword does not narrow the query)', () => {
    const db = createIndex(VAULT)
    const results = db.search('the Auth Service')
    expect(results.some(r => r.slug === 'auth-service')).toBe(true)
    db.close()
  })

  it('keeps exact-name-match ranking ahead of body-only matches', () => {
    const db = createIndex(VAULT)
    const results = db.search('Auth Service')
    expect(results.length).toBeGreaterThan(1)
    expect(results[0].slug).toBe('auth-service')
    db.close()
  })

  it('keeps returning empty for genuinely absent terms', () => {
    const db = createIndex(VAULT)
    expect(db.search('xyznonexistent')).toEqual([])
    db.close()
  })
})
