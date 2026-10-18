// tests/parent-cycle.test.ts
// #130: no path that sets `parent` may make an entity its own ancestor, and
// `validate` reports a cycle already on disk.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHafez, removeTemp } from './helpers/hafez.js'
import { readEntity } from './helpers/vault-files.js'
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createMemoryJournal } from './helpers/memory-journal.js'

let TMP: string
let VAULT: string

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'hafez-test-parent-cycle-'))
  VAULT = join(TMP, 'vault')
  mkdirSync(join(VAULT, 'entities'), { recursive: true })
  mkdirSync(join(VAULT, 'knowledge'), { recursive: true })
})

afterEach(() => removeTemp(TMP))

function makeOS() {
  return createHafez({ vaultPath: VAULT, persistence: createMemoryJournal() })
}

function parentOf(slug: string): unknown {
  return readEntity(join(VAULT, `entities/${slug}.md`)).frontmatter.parent
}

describe('parent cycles (#130)', () => {
  it('update rejects an entity as its own parent', async () => {
    const os = makeOS()
    await os.create('entity', 'Alpha', { type: 'entity' })
    await expect(os.update('alpha', { parent: 'alpha' }))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: expect.stringContaining('alpha → alpha') })
    expect(parentOf('alpha')).toBeUndefined()
  })

  it('update rejects a parent whose chain leads back to the entity', async () => {
    const os = makeOS()
    await os.create('entity', 'Alpha', { type: 'entity' })
    await os.create('entity', 'Beta', { type: 'entity', parent: 'alpha' })
    await os.create('entity', 'Gamma', { type: 'entity', parent: 'beta' })
    await expect(os.update('alpha', { parent: 'gamma' }))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: expect.stringContaining('alpha → gamma → beta → alpha') })
    expect(parentOf('alpha')).toBeUndefined()
  })

  it('update still accepts a parent chain that does not return', async () => {
    const os = makeOS()
    await os.create('entity', 'Alpha', { type: 'entity' })
    await os.create('entity', 'Beta', { type: 'entity', parent: 'alpha' })
    await os.create('entity', 'Gamma', { type: 'entity' })
    await os.update('gamma', { parent: 'beta' })
    expect(parentOf('gamma')).toBe('beta')
  })

  it('link rejects an entity as its own parent', async () => {
    const os = makeOS()
    await os.create('entity', 'Alpha', { type: 'entity' })
    await expect(os.link('alpha', 'alpha', 'parent'))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: expect.stringContaining('alpha → alpha') })
    expect(parentOf('alpha')).toBeUndefined()
  })

  it('link rejects a two-node parent cycle', async () => {
    const os = makeOS()
    await os.create('entity', 'Alpha', { type: 'entity' })
    await os.create('entity', 'Beta', { type: 'entity', parent: 'alpha' })
    await expect(os.link('alpha', 'beta', 'parent'))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: expect.stringContaining('alpha → beta → alpha') })
  })

  it('batch rejects a two-node cycle built across its own ops, in-batch creates included', async () => {
    const os = makeOS()
    await os.create('entity', 'Alpha', { type: 'entity' })
    await expect(os.batch([
      { op: 'create', kind: 'entity', name: 'Beta', fields: { type: 'entity', parent: 'alpha' } },
      { op: 'update', slug: 'alpha', fields: { parent: 'beta' } },
    ])).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [expect.stringMatching(/^op\[1\] \(update alpha\): .*alpha → beta → alpha/)],
    })
    expect(parentOf('alpha')).toBeUndefined()
  })

  it('batch accepts re-pointing that breaks the chain before closing it', async () => {
    const os = makeOS()
    await os.create('entity', 'Alpha', { type: 'entity' })
    await os.create('entity', 'Beta', { type: 'entity', parent: 'alpha' })
    await os.batch([
      { op: 'unlink', slug: 'beta', target: 'alpha', relation: 'parent' },
      { op: 'update', slug: 'alpha', fields: { parent: 'beta' } },
    ])
    expect(parentOf('alpha')).toBe('beta')
    expect(parentOf('beta')).toBeUndefined()
  })

  it('validate reports a parent cycle already on disk, once per cycle', async () => {
    const entity = (name: string, parent: string) =>
      `---\nname: ${name}\ntype: entity\nstatus: active\ncreated: 2026-01-01\nlast-touched: 2026-01-01\nparent: ${parent}\n---\n\n## Session Log\n`
    writeFileSync(join(VAULT, 'entities/alpha.md'), entity('Alpha', 'beta'))
    writeFileSync(join(VAULT, 'entities/beta.md'), entity('Beta', 'alpha'))
    writeFileSync(join(VAULT, 'entities/gamma.md'), entity('Gamma', 'gamma'))
    writeFileSync(join(VAULT, 'entities/delta.md'), entity('Delta', 'alpha'))
    const report = await makeOS().validate()
    const cycles = report.broken_slugs.filter(b => b.field === 'parent')
    expect(cycles.map(c => c.issue).sort()).toEqual([
      'parent cycle: alpha → beta → alpha',
      'parent cycle: gamma → gamma',
    ])
  })
})
