// tests/batch-list-string.test.ts
// #33: the CLI's list flags (`--domain "a,b"`, `--tags`, `--related`) accept a
// comma string, so agents pass the same string in batch JSON. The batch shape
// takes it too, split the CLI's way (splitList: trim, drop empties); an array
// is still accepted as is.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createHafez, removeTemp } from './helpers/hafez.js'
import { mkdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { parseContent } from '../src/vault.js'
import { parseBatchInput } from '../src/cli/commands.js'
import { getOpSchema } from '../src/cli/schema-introspect.js'
import { createMemoryJournal } from './helpers/memory-journal.js'

const TMP = join(tmpdir(), 'hafez-test-batch-list-string-' + Date.now())
const VAULT = join(TMP, 'vault')

beforeAll(() => {
  mkdirSync(join(VAULT, 'entities'), { recursive: true })
  mkdirSync(join(VAULT, 'knowledge'), { recursive: true })
  mkdirSync(join(VAULT, 'sessions'), { recursive: true })
})

afterAll(() => removeTemp(TMP))

function makeOS() {
  return createHafez({ vaultPath: VAULT, persistence: createMemoryJournal() })
}

function frontmatterOf(dir: 'entities' | 'knowledge', slug: string): Record<string, any> {
  return parseContent(readFileSync(join(VAULT, dir, `${slug}.md`), 'utf-8')).frontmatter
}

describe('batch list fields accept a comma string (#33)', () => {
  it('create-knowledge splits domain, tags and related', async () => {
    const os = makeOS()
    await os.batch([{ op: 'create', kind: 'knowledge', name: 'List Target', fields: {} }])
    const results = await os.batch([
      { op: 'create', kind: 'knowledge', name: 'List Knowledge', fields: { domain: 'a, b', tags: 't1,, t2 ', related: 'list-target' } as any },
    ])
    expect(results[0].status).toBe('ok')
    const fm = frontmatterOf('knowledge', 'list-knowledge')
    expect(fm.domain).toEqual(['a', 'b'])
    expect(fm.tags).toEqual(['t1', 't2'])
    expect(fm.related).toEqual(['list-target'])
  })

  it('create-entity splits domain', async () => {
    const os = makeOS()
    const results = await os.batch([
      { op: 'create', kind: 'entity', name: 'List Entity', fields: { type: 'entity', domain: 'a, b' } as any },
    ])
    expect(results[0].status).toBe('ok')
    expect(frontmatterOf('entities', 'list-entity').domain).toEqual(['a', 'b'])
  })

  it('update splits domain', async () => {
    const os = makeOS()
    await os.batch([{ op: 'create', kind: 'knowledge', name: 'List Update', fields: {} }])
    const results = await os.batch([{ op: 'update', slug: 'list-update', fields: { domain: 'c, d' } as any }])
    expect(results[0].status).toBe('ok')
    expect(frontmatterOf('knowledge', 'list-update').domain).toEqual(['c', 'd'])
  })

  it('an array is still taken as is', async () => {
    const os = makeOS()
    await os.batch([{ op: 'create', kind: 'knowledge', name: 'List Array', fields: { domain: ['x', 'y'] } }])
    expect(frontmatterOf('knowledge', 'list-array').domain).toEqual(['x', 'y'])
  })

  it('the CLI batch path hands back the split array', () => {
    const [op] = parseBatchInput('[{"op":"create","kind":"knowledge","name":"probe","fields":{"domain":"practice, agentic-sdlc"}}]')
    expect((op as any).fields.domain).toEqual(['practice', 'agentic-sdlc'])
  })

  it('add_actions is not a comma list — its text keeps its commas', () => {
    expect(() => parseBatchInput('[{"op":"update","slug":"x","fields":{"add_actions":"a, b"}}]')).toThrow()
  })

  it('unknown fields are still rejected', () => {
    expect(() => parseBatchInput('[{"op":"create","kind":"knowledge","name":"probe","fields":{"domains":"a, b"}}]')).toThrow()
  })

  it('schema still reports the list fields as string arrays', () => {
    const fields = getOpSchema('create-knowledge')!.fields.fields.fields!
    for (const key of ['domain', 'tags', 'related']) {
      expect(fields[key].type).toBe('array')
      expect(fields[key].items?.type).toBe('string')
      expect(fields[key].optional).toBe(true)
    }
  })
})
