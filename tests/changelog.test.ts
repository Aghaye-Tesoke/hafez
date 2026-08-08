import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { gitChangelog } from '../src/git.js'
import { createHafez } from '../src/index.js'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { simpleGit } from 'simple-git'

const TMP = join(tmpdir(), 'hafez-test-changelog-' + Date.now())
// Full ISO timestamp, not a bare date: git fills a date-only --since with the
// *current* time-of-day, which excludes commits made seconds ago and made this
// test flake whenever beforeAll crossed a second boundary.
const sinceDate = new Date(Date.now() - 120000).toISOString()

beforeAll(async () => {
  mkdirSync(join(TMP, 'entities'), { recursive: true })
  mkdirSync(join(TMP, 'knowledge'), { recursive: true })

  const git = simpleGit(TMP)
  await git.init()
  await git.addConfig('user.email', 'test@test.com')
  await git.addConfig('user.name', 'Test')

  // Commit 1: create an entity
  writeFileSync(join(TMP, 'entities', 'test-entity.md'), '---\nname: Test\n---\n')
  await git.add('entities/test-entity.md')
  await git.commit('create: test-entity')

  // Commit 2: update it
  writeFileSync(join(TMP, 'entities', 'test-entity.md'), '---\nname: Test Updated\n---\n')
  await git.add('entities/test-entity.md')
  await git.commit('update: test-entity')

  // Commit 3: create knowledge
  writeFileSync(join(TMP, 'knowledge', 'test-note.md'), '---\nname: Note\n---\n')
  await git.add('knowledge/test-note.md')
  await git.commit('create: test-note')

  // Commit 4: scaffold files — must never surface as changelog rows
  writeFileSync(join(TMP, 'entities', '.gitkeep'), '')
  writeFileSync(join(TMP, 'knowledge', '.gitkeep'), '')
  await git.add(['entities/.gitkeep', 'knowledge/.gitkeep'])
  await git.commit('init vault scaffold')
})

afterAll(() => rmSync(TMP, { recursive: true, force: true }))

describe('gitChangelog', () => {
  it('returns changelog entries for recent commits', async () => {
    const entries = await gitChangelog(TMP, sinceDate)
    expect(entries.length).toBe(3)
  })

  it('includes correct operations', async () => {
    const entries = await gitChangelog(TMP, sinceDate)
    const entityEntries = entries.filter(e => e.slug === 'test-entity')
    expect(entityEntries.some(e => e.operation === 'created')).toBe(true)
    expect(entityEntries.some(e => e.operation === 'updated')).toBe(true)
  })

  it('includes knowledge entries', async () => {
    const entries = await gitChangelog(TMP, sinceDate)
    expect(entries.some(e => e.slug === 'test-note' && e.kind === 'knowledge')).toBe(true)
  })

  it('filters non-.md scaffold files like .gitkeep', async () => {
    const entries = await gitChangelog(TMP, sinceDate)
    expect(entries.some(e => e.slug.includes('.gitkeep'))).toBe(false)
    // and the scaffold commit contributes no rows at all
    expect(entries.some(e => e.commit_message === 'init vault scaffold')).toBe(false)
  })

  it('returns today\'s commits for --since <today> (bare date = local midnight)', async () => {
    // Pins the root fix for "changelog --since <today> returns nothing":
    // git approxidate fills a date-only --since with the current time of day.
    const today = new Date()
    const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    const entries = await gitChangelog(TMP, localDate)
    expect(entries.length).toBe(3)
  })

  it('returns empty for future date', async () => {
    const entries = await gitChangelog(TMP, '2099-01-01')
    expect(entries.length).toBe(0)
  })
})

describe('gitChangelog rename lines (promote crosses directories)', () => {
  // A promote moves the file entities/<slug>.md -> knowledge/<slug>.md, which
  // git reports as a rename ("R100\told\tnew") rather than A/M/D. The parser
  // used to require a tab straight after the status letter, so every rename
  // line was dropped and promotes were invisible in `hafez changelog`.
  const REPO = join(tmpdir(), 'hafez-test-changelog-rename-' + Date.now())
  const since = new Date(Date.now() - 120000).toISOString()

  beforeAll(async () => {
    mkdirSync(join(REPO, 'entities'), { recursive: true })
    mkdirSync(join(REPO, 'knowledge'), { recursive: true })
    const git = simpleGit(REPO)
    await git.init()
    await git.addConfig('user.email', 'test@test.com')
    await git.addConfig('user.name', 'Test')

    const body = '---\nname: Promoted Note\ncreated: "2026-01-01"\n---\n\nBody long enough for rename detection.\n'
    writeFileSync(join(REPO, 'entities', 'promoted-note.md'), body)
    await git.add('entities/promoted-note.md')
    await git.commit('capture: promoted-note')

    await git.raw(['mv', 'entities/promoted-note.md', 'knowledge/promoted-note.md'])
    await git.commit('promote: promoted-note -> knowledge')

    // A within-directory rename (slug rename) must be reported too.
    await git.raw(['mv', 'knowledge/promoted-note.md', 'knowledge/renamed-note.md'])
    await git.commit('rename: promoted-note -> renamed-note')
  })

  afterAll(() => rmSync(REPO, { recursive: true, force: true }))

  it('reports the promote destination as a created knowledge entry', async () => {
    const entries = await gitChangelog(REPO, since)
    expect(entries).toContainEqual(expect.objectContaining({
      slug: 'promoted-note',
      kind: 'knowledge',
      operation: 'created',
      commit_message: 'promote: promoted-note -> knowledge',
    }))
  })

  it('reports the promote source as a deleted entity entry', async () => {
    const entries = await gitChangelog(REPO, since)
    expect(entries).toContainEqual(expect.objectContaining({
      slug: 'promoted-note',
      kind: 'entity',
      operation: 'deleted',
      commit_message: 'promote: promoted-note -> knowledge',
    }))
  })

  it('reports a same-directory rename as delete + create', async () => {
    const entries = await gitChangelog(REPO, since)
    const renameCommit = entries.filter(e => e.commit_message.startsWith('rename:'))
    expect(renameCommit).toHaveLength(2)
    expect(renameCommit).toContainEqual(expect.objectContaining({ slug: 'renamed-note', operation: 'created' }))
    expect(renameCommit).toContainEqual(expect.objectContaining({ slug: 'promoted-note', operation: 'deleted' }))
  })
})

describe('changelog surfaces a real promote', () => {
  // End-to-end: the acceptance case — a promote made through the operations
  // API shows up in changelog output for its date range.
  const VAULT = join(tmpdir(), 'hafez-test-changelog-promote-' + Date.now())

  beforeAll(async () => {
    mkdirSync(join(VAULT, 'entities'), { recursive: true })
    mkdirSync(join(VAULT, 'knowledge'), { recursive: true })
    const git = simpleGit(VAULT)
    await git.init()
    await git.addConfig('user.email', 'test@test.com')
    await git.addConfig('user.name', 'Test')
    writeFileSync(join(VAULT, '.gitkeep'), '')
    await git.add('.gitkeep')
    await git.commit('init')
  })

  afterAll(() => rmSync(VAULT, { recursive: true, force: true }))

  it('lists the promoted slug under its new kind', async () => {
    const os = createHafez({ vaultPath: VAULT, git: { push: false } })
    const slug = await os.capture('Changelog Promote Probe', 'Enough body text to keep the two blobs similar.')
    await os.promote(slug, 'knowledge')

    const entries = await os.changelog(new Date(Date.now() - 120000).toISOString())
    expect(entries.some(e => e.slug === slug && e.kind === 'knowledge')).toBe(true)
  })
})
