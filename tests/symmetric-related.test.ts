// tests/symmetric-related.test.ts
// #242 (ADR 0002): a same-kind `related` edge is one edge with two ends the
// tool keeps — link, unlink, create and update touch both files in one
// commit; a cross-kind edge stays one-way; parent subsumes related.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHafez, removeTemp } from './helpers/hafez.js'
import { readEntity, readKnowledge } from './helpers/vault-files.js'
import { createMemoryJournal, type MemoryJournal } from './helpers/memory-journal.js'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { HafezError, type Hafez } from '../src/types.js'
import { serializeFile } from '../src/vault.js'

let TMP: string
let VAULT: string
let journal: MemoryJournal
let os: Hafez

beforeEach(async () => {
  TMP = mkdtempSync(join(tmpdir(), 'hafez-test-symmetric-related-'))
  VAULT = join(TMP, 'vault')
  mkdirSync(join(VAULT, 'entities'), { recursive: true })
  mkdirSync(join(VAULT, 'knowledge'), { recursive: true })
  journal = createMemoryJournal()
  os = createHafez({ vaultPath: VAULT, persistence: journal })
  await os.create('entity', 'Alpha', { type: 'entity' })
  await os.create('entity', 'Beta', { type: 'entity' })
})

afterEach(() => removeTemp(TMP))

const entityRelated = (slug: string) => readEntity(join(VAULT, `entities/${slug}.md`)).frontmatter.related
const knowledgeRelated = (slug: string) => readKnowledge(join(VAULT, `knowledge/${slug}.md`)).frontmatter.related

describe('link --relation related', () => {
  it('writes both ends in one commit', async () => {
    await os.link('alpha', 'beta', 'related')
    expect(entityRelated('alpha')).toEqual(['beta'])
    expect(entityRelated('beta')).toEqual(['alpha'])
    expect(journal.commits.at(-1)!.written.sort()).toEqual(['entities/alpha.md', 'entities/beta.md'])
  })

  it('a cross-kind edge stays one-way', async () => {
    await os.create('knowledge', 'Note', { synthesis: 'x' })
    await os.link('note', 'alpha', 'related')
    expect(knowledgeRelated('note')).toEqual(['alpha'])
    expect(entityRelated('alpha')).toBeUndefined()
    expect(journal.commits.at(-1)!.written).toEqual(['knowledge/note.md'])
  })

  it('a commit-stage failure leaves both files untouched', async () => {
    const before = [readEntity(join(VAULT, 'entities/alpha.md')), readEntity(join(VAULT, 'entities/beta.md'))]
    const failing = { ...createMemoryJournal(), async commit() { throw new HafezError('GIT_COMMIT_FAILED', 'index.lock') } }
    const failingOs = createHafez({ vaultPath: VAULT, persistence: failing })
    await expect(failingOs.link('alpha', 'beta', 'related')).rejects.toMatchObject({ code: 'GIT_COMMIT_FAILED' })
    expect([readEntity(join(VAULT, 'entities/alpha.md')), readEntity(join(VAULT, 'entities/beta.md'))]).toEqual(before)
  })
})

describe('unlink --relation related', () => {
  it('drops both ends in one commit', async () => {
    await os.link('alpha', 'beta', 'related')
    await os.unlink('alpha', 'beta', 'related')
    expect(entityRelated('alpha')).toBeUndefined()
    expect(entityRelated('beta')).toBeUndefined()
    expect(journal.commits.at(-1)!.written.sort()).toEqual(['entities/alpha.md', 'entities/beta.md'])
  })
})

describe('create --related', () => {
  it('an entity: same-kind targets point back, in one commit', async () => {
    await os.create('entity', 'Gamma', { type: 'entity', related: ['alpha', 'beta'] })
    expect(entityRelated('gamma')).toEqual(['alpha', 'beta'])
    expect(entityRelated('alpha')).toEqual(['gamma'])
    expect(entityRelated('beta')).toEqual(['gamma'])
    expect(journal.commits.at(-1)!.written.sort()).toEqual(['entities/alpha.md', 'entities/beta.md', 'entities/gamma.md'])
  })

  it('a knowledge note: a knowledge target points back, an entity target does not', async () => {
    await os.create('knowledge', 'First', { synthesis: 'x' })
    await os.create('knowledge', 'Second', { synthesis: 'y', related: ['first', 'alpha'] })
    expect(knowledgeRelated('second')).toEqual(['first', 'alpha'])
    expect(knowledgeRelated('first')).toEqual(['second'])
    expect(entityRelated('alpha')).toBeUndefined()
    expect(journal.commits.at(-1)!.written.sort()).toEqual(['knowledge/first.md', 'knowledge/second.md'])
  })
})

describe('update --related', () => {
  it('replacing the list drops the back-edge on dropped targets and writes it on added ones', async () => {
    await os.create('entity', 'Gamma', { type: 'entity' })
    await os.link('alpha', 'beta', 'related')
    await os.update('alpha', { related: ['gamma'] })
    expect(entityRelated('alpha')).toEqual(['gamma'])
    expect(entityRelated('beta')).toBeUndefined()
    expect(entityRelated('gamma')).toEqual(['alpha'])
    expect(journal.commits.at(-1)!.written.sort()).toEqual(['entities/alpha.md', 'entities/beta.md', 'entities/gamma.md'])
  })

  it('through batch: one commit for the op', async () => {
    await os.batch([{ op: 'update', slug: 'alpha', fields: { related: ['beta'] } }])
    expect(entityRelated('beta')).toEqual(['alpha'])
    expect(journal.commits.at(-1)!.written.sort()).toEqual(['entities/alpha.md', 'entities/beta.md'])
  })
})

describe('parent subsumes related', () => {
  const subsumed = { code: 'VALIDATION_FAILED', message: expect.stringContaining('parent subsumes related') }

  beforeEach(async () => {
    await os.create('entity', 'Child', { type: 'entity', parent: 'alpha' })
  })

  it('link rejects relating a Child to its parent, and a parent to its child', async () => {
    await expect(os.link('child', 'alpha', 'related')).rejects.toMatchObject(subsumed)
    await expect(os.link('alpha', 'child', 'related')).rejects.toMatchObject(subsumed)
    expect(entityRelated('child')).toBeUndefined()
    expect(entityRelated('alpha')).toBeUndefined()
  })

  it('create rejects a related naming the parent', async () => {
    await expect(os.create('entity', 'Delta', { type: 'entity', parent: 'alpha', related: ['alpha'] })).rejects.toMatchObject(subsumed)
  })

  it('update --related rejects the parent and a child', async () => {
    await expect(os.update('child', { related: ['alpha'] })).rejects.toMatchObject(subsumed)
    await expect(os.update('alpha', { related: ['child'] })).rejects.toMatchObject(subsumed)
  })

  it('update --parent rejects an entity already in related', async () => {
    await os.link('child', 'beta', 'related')
    await expect(os.update('child', { parent: 'beta' })).rejects.toMatchObject(subsumed)
    await expect(os.link('child', 'beta', 'parent')).rejects.toMatchObject(subsumed)
  })

  it('update --parent and link --relation parent reject a target whose related already names the entity (a legacy one-way edge)', async () => {
    const path = join(VAULT, 'entities/beta.md')
    const { frontmatter, body } = readEntity(path)
    writeFileSync(path, serializeFile({ ...frontmatter, related: ['child'] }, body))
    await expect(os.update('child', { parent: 'beta' })).rejects.toMatchObject(subsumed)
    await expect(os.link('child', 'beta', 'parent')).rejects.toMatchObject(subsumed)
    expect(readEntity(join(VAULT, 'entities/child.md')).frontmatter.parent).toBe('alpha')
  })

  it('a batch localises it to the op', async () => {
    const err = await os.batch([
      { op: 'update', slug: 'beta', fields: { brief: 'fine' } },
      { op: 'link', slug: 'child', target: 'alpha', relation: 'related' },
    ]).catch(e => e)
    expect(err.code).toBe('VALIDATION_FAILED')
    expect(err.details[0]).toMatch(/^op\[1\] \(link child\): .*parent subsumes related/)
  })
})

describe('in a batch', () => {
  it('create then link validates (dry-run too) and applies both ends', async () => {
    const ops = [
      { op: 'create' as const, kind: 'entity' as const, name: 'Gamma', fields: { type: 'entity' as const } },
      { op: 'link' as const, slug: 'alpha', target: 'gamma', relation: 'related' as const },
    ]
    expect((await os.validateBatch(ops)).valid).toBe(true)
    await os.batch(ops)
    expect(entityRelated('alpha')).toEqual(['gamma'])
    expect(entityRelated('gamma')).toEqual(['alpha'])
    expect(journal.commits.at(-1)!.written.sort()).toEqual(['entities/alpha.md', 'entities/gamma.md'])
  })

  it('the validate phase sees the reverse an earlier op wrote', async () => {
    const err = await os.batch([
      { op: 'link', slug: 'alpha', target: 'beta', relation: 'related' },
      { op: 'update', slug: 'beta', fields: { parent: 'alpha' } },
    ]).catch(e => e)
    expect(err.code).toBe('VALIDATION_FAILED')
    expect(err.details[0]).toMatch(/^op\[1\] \(update beta\): .*parent subsumes related/)
    expect(entityRelated('alpha')).toBeUndefined()
  })
})

describe('a legacy one-way edge', () => {
  it('survives a write elsewhere, an index rebuild and validate', async () => {
    const path = join(VAULT, 'entities/beta.md')
    const { frontmatter, body } = readEntity(path)
    writeFileSync(path, serializeFile({ ...frontmatter, related: ['alpha'] }, body))
    const before = readFileSync(path, 'utf-8')
    await os.create('entity', 'Gamma', { type: 'entity' })
    await os.link('gamma', 'alpha', 'related')
    await os.update('alpha', { brief: 'touched' })
    await os.rebuildIndex()
    expect((await os.validate()).broken_slugs).toEqual([])
    expect(readFileSync(path, 'utf-8')).toBe(before)
    expect(entityRelated('alpha')).toEqual(['gamma'])
  })

  it('unlink from the end that has it leaves the other file alone', async () => {
    const path = join(VAULT, 'entities/beta.md')
    const { frontmatter, body } = readEntity(path)
    writeFileSync(path, serializeFile({ ...frontmatter, related: ['alpha'] }, body))
    await os.unlink('beta', 'alpha', 'related')
    expect(entityRelated('beta')).toBeUndefined()
    expect(journal.commits.at(-1)!.written).toEqual(['entities/beta.md'])
  })

  it('unlink from the end that lacks it drops the edge on the other file, one commit', async () => {
    const path = join(VAULT, 'entities/beta.md')
    const { frontmatter, body } = readEntity(path)
    writeFileSync(path, serializeFile({ ...frontmatter, related: ['alpha'] }, body))
    const commits = journal.commits.length
    await os.unlink('alpha', 'beta', 'related')
    expect(entityRelated('beta')).toBeUndefined()
    expect(entityRelated('alpha')).toBeUndefined()
    expect(journal.commits.length).toBe(commits + 1)
    expect(journal.commits.at(-1)!.written).toContain('entities/beta.md')
  })

  it('unlink of an edge neither end carries succeeds and touches no other file', async () => {
    const before = readFileSync(join(VAULT, 'entities/beta.md'), 'utf-8')
    await os.unlink('alpha', 'beta', 'related')
    expect(readFileSync(join(VAULT, 'entities/beta.md'), 'utf-8')).toBe(before)
    expect(journal.commits.at(-1)!.written).toEqual(['entities/alpha.md'])
  })
})
