// tests/delete-op.test.ts
// The `delete` op (#88): knowledge and session notes only — an entity is
// retired with `--status done`, never deleted. A note that another file links
// to (the links `validate` checks: parent, related) is REJECTED, never
// deleted with a warning, so `validate` stays clean after every permitted
// delete. Links are judged as the vault would stand after the earlier ops of
// the same batch, so dry-run and apply agree.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHafez } from '../src/index.js'
import { HafezError, type Hafez, type Journal } from '../src/types.js'
import { serializeFile } from '../src/vault.js'
import { cmdDelete, cmdBatch } from '../src/cli/commands.js'
import { getOpSchema } from '../src/cli/schema-introspect.js'
import { readEntity } from './helpers/vault-files.js'
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createMemoryJournal, type MemoryJournal } from './helpers/memory-journal.js'

let TMP: string
let VAULT: string
let os: Hafez
let journal: MemoryJournal

beforeEach(async () => {
  TMP = join(tmpdir(), `hafez-test-delete-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  VAULT = join(TMP, 'vault')
  mkdirSync(join(VAULT, 'entities'), { recursive: true })
  mkdirSync(join(VAULT, 'knowledge'), { recursive: true })
  journal = createMemoryJournal()
  os = createHafez({ vaultPath: VAULT, persistence: journal })
  await os.create('entity', 'Holder', { type: 'project' })
  await os.create('knowledge', 'Twin A', { synthesis: 'first copy' })
  await os.create('knowledge', 'Twin B', { synthesis: 'second copy' })
})
afterEach(() => rmSync(TMP, { recursive: true, force: true }))

const knowledgeFile = (slug: string) => join(VAULT, 'knowledge', `${slug}.md`)
const sessionFile = (slug: string) => join(VAULT, 'sessions', `${slug}.md`)

async function rejection(p: Promise<unknown>): Promise<HafezError> {
  let caught: unknown
  try { await p } catch (e) { caught = e }
  expect(caught, 'expected a rejection').toBeInstanceOf(HafezError)
  return caught as HafezError
}

function fullText(err: HafezError): string {
  return [err.message, ...(err.details ?? [])].join('\n')
}

describe('delete a knowledge note', () => {
  it('removes the file in one commit and the index no longer returns it', async () => {
    const commitsBefore = journal.commits.length
    const kind = await os.delete('twin-a')

    expect(kind).toBe('knowledge')
    expect(existsSync(knowledgeFile('twin-a'))).toBe(false)
    expect(journal.commits.length).toBe(commitsBefore + 1)
    expect(journal.commits.at(-1)).toEqual({ written: [], deleted: ['knowledge/twin-a.md'], message: 'delete: twin-a (knowledge)' })
    expect((await os.query_knowledge()).items.map(k => k.slug)).not.toContain('twin-a')
    expect((await os.search('first copy')).map(r => r.slug)).not.toContain('twin-a')
    expect(readFileSync(join(VAULT, 'index.md'), 'utf-8')).not.toContain('twin-a')
    await expect(os.read('twin-a')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('an unknown slug is NOT_FOUND', async () => {
    const err = await rejection(os.delete('nope'))
    expect(err.code).toBe('NOT_FOUND')
    expect(err.message).toContain("'nope' not found")
  })
})

describe('delete a session note', () => {
  it('removes the session file in one commit', async () => {
    await os.batch([{ op: 'create', kind: 'session', name: 'Session One', fields: { related: ['holder'] } }])
    expect(existsSync(sessionFile('session-one'))).toBe(true)

    const kind = await os.delete('session-one')

    expect(kind).toBe('session')
    expect(existsSync(sessionFile('session-one'))).toBe(false)
    expect(journal.commits.at(-1)).toEqual({ written: [], deleted: ['sessions/session-one.md'], message: 'delete: session-one (session)' })
  })

  it('a slug naming both a knowledge note and a session note is rejected as ambiguous', async () => {
    mkdirSync(join(VAULT, 'sessions'), { recursive: true })
    writeFileSync(sessionFile('twin-a'), serializeFile({ name: 'Twin A', created: '2026-10-01' }, '## Summary\n'))
    const err = await rejection(os.delete('twin-a'))
    expect(err.code).toBe('VALIDATION_FAILED')
    expect(err.message).toContain('ambiguous')
    expect(existsSync(knowledgeFile('twin-a'))).toBe(true)
    expect(existsSync(sessionFile('twin-a'))).toBe(true)
  })
})

describe('an entity is never deleted', () => {
  it('is rejected with a pointer at --status done, and the file stays', async () => {
    const err = await rejection(os.delete('holder'))
    expect(err.code).toBe('VALIDATION_FAILED')
    expect(err.message).toContain('is an entity')
    expect(err.message).toContain('hafez update holder --status done')
    expect(existsSync(join(VAULT, 'entities', 'holder.md'))).toBe(true)
  })
})

describe('a linked-to note is rejected, not deleted', () => {
  it.each([
    ['an entity related', async () => { await os.link('holder', 'twin-a', 'related') }, 'holder'],
    ['an entity parent', async () => { await os.create('entity', 'Child', { type: 'entity', parent: 'twin-a' }) }, 'child'],
    ['a knowledge related', async () => { await os.link('twin-b', 'twin-a', 'related') }, 'twin-b'],
  ])('when %s names it, naming the referrer', async (_label, seed, referrer) => {
    await seed()
    const err = await rejection(os.delete('twin-a'))
    expect(err.code).toBe('VALIDATION_FAILED')
    expect(err.message).toContain(`still linked from ${referrer}`)
    expect(existsSync(knowledgeFile('twin-a'))).toBe(true)
  })

  it('a self-link does not block the delete', async () => {
    await os.link('twin-a', 'twin-a', 'related')
    await os.delete('twin-a')
    expect(existsSync(knowledgeFile('twin-a'))).toBe(false)
  })
})

describe('in a batch, links are judged after the earlier ops', () => {
  it('an earlier unlink clears the referrer; validate stays clean', async () => {
    await os.link('holder', 'twin-a', 'related')
    const ops = [
      { op: 'unlink', slug: 'holder', target: 'twin-a', relation: 'related' },
      { op: 'delete', slug: 'twin-a' },
    ] as const

    // Reversed, the unlink has not happened yet when the delete is judged.
    const reversed = await os.validateBatch([ops[1], ops[0]])
    expect(reversed.valid).toBe(false)
    expect(reversed.operations[0].errors.join()).toContain('still linked from holder')

    expect((await os.validateBatch([...ops])).valid).toBe(true)
    const results = await os.batch([...ops])
    expect(results.map(r => r.status)).toEqual(['ok', 'ok'])
    expect(existsSync(knowledgeFile('twin-a'))).toBe(false)
    expect(readEntity(join(VAULT, 'entities', 'holder.md')).frontmatter.related ?? []).not.toContain('twin-a')
    expect((await os.validate()).broken_slugs).toEqual([])
  })

  it('an earlier update re-pointing related to the surviving twin clears it', async () => {
    await os.link('holder', 'twin-a', 'related')
    await os.batch([
      { op: 'update', slug: 'holder', fields: { related: ['twin-b'] } },
      { op: 'delete', slug: 'twin-a' },
    ])
    expect(existsSync(knowledgeFile('twin-a'))).toBe(false)
    expect((await os.validate()).broken_slugs).toEqual([])
  })

  it('an earlier update moving parent off the note clears it, and one moving parent onto it blocks', async () => {
    await os.create('entity', 'Child', { type: 'entity', parent: 'twin-a' })
    const moved = await os.validateBatch([
      { op: 'update', slug: 'child', fields: { parent: 'holder' } },
      { op: 'delete', slug: 'twin-a' },
    ])
    expect(moved.valid).toBe(true)

    const onto = await os.validateBatch([
      { op: 'update', slug: 'holder', fields: { parent: 'twin-b' } },
      { op: 'delete', slug: 'twin-b' },
    ])
    expect(onto.operations[1].errors.join()).toContain('still linked from holder')
  })

  it('an earlier link or create that names the note blocks the delete', async () => {
    const viaLink = await os.validateBatch([
      { op: 'link', slug: 'holder', target: 'twin-a', relation: 'related' },
      { op: 'delete', slug: 'twin-a' },
    ])
    expect(viaLink.operations[1].errors.join()).toContain('still linked from holder')

    const viaCreate = await os.validateBatch([
      { op: 'create', kind: 'entity', name: 'Kid', fields: { type: 'entity', parent: 'twin-a' } },
      { op: 'delete', slug: 'twin-a' },
    ])
    expect(viaCreate.operations[1].errors.join()).toContain('still linked from kid')
  })

  it('an earlier delete of the referrer clears it', async () => {
    await os.link('twin-b', 'twin-a', 'related')
    await os.batch([
      { op: 'delete', slug: 'twin-b' },
      { op: 'delete', slug: 'twin-a' },
    ])
    expect(existsSync(knowledgeFile('twin-a'))).toBe(false)
    expect(existsSync(knowledgeFile('twin-b'))).toBe(false)
  })

  it('later ops see the note as gone', async () => {
    const report = await os.validateBatch([
      { op: 'delete', slug: 'twin-a' },
      { op: 'delete', slug: 'twin-a' },
      { op: 'link', slug: 'holder', target: 'twin-a', relation: 'related' },
    ])
    expect(report.operations[1].errors).toEqual(["'twin-a' not found"])
    expect(report.operations[2].errors).toEqual(["Target 'twin-a' does not exist"])
  })

  it('delete then create of one slug is a rewrite', async () => {
    const results = await os.batch([
      { op: 'delete', slug: 'twin-a' },
      { op: 'create', kind: 'knowledge', name: 'Twin A', fields: { synthesis: 'rewritten' } },
    ])
    expect(results.map(r => r.status)).toEqual(['ok', 'ok'])
    expect(readFileSync(knowledgeFile('twin-a'), 'utf-8')).toContain('rewritten')
    expect((await os.query_knowledge()).items.map(k => k.slug)).toContain('twin-a')
  })
})

describe('the batch op shape', () => {
  it('is { op, slug } and strict', async () => {
    const report = await os.validateBatch([{ op: 'delete', slug: 'twin-a', kind: 'knowledge' } as never])
    expect(report.valid).toBe(false)
    expect(report.operations[0].errors.join()).toContain('kind')
    expect(existsSync(knowledgeFile('twin-a'))).toBe(true)
  })

  it('a malformed delete of an existing session note is not reported as not found', async () => {
    await os.batch([{ op: 'create', kind: 'session', name: 'Session One' }])
    const report = await os.validateBatch([{ op: 'delete', slug: 'session-one', kind: 'session' } as never])
    expect(report.operations[0].errors.join()).not.toContain('not found')
    expect(report.operations[0].primaryCode).toBeUndefined()
  })

  it('schema delete describes it', () => {
    const schema = getOpSchema('delete')
    expect(schema).not.toBeNull()
    expect(Object.keys(schema!.fields).sort()).toEqual(['op', 'slug'])
    expect(schema!.description).toContain('--status done')
  })

  it('dry-run reports and touches nothing', async () => {
    expect((await os.validateBatch([{ op: 'delete', slug: 'twin-a' }])).valid).toBe(true)
    expect(existsSync(knowledgeFile('twin-a'))).toBe(true)
  })
})

describe('rollback', () => {
  it('a commit-stage failure restores the deleted file', async () => {
    const failing: Journal = {
      ...createMemoryJournal(),
      async commit() { throw new HafezError('GIT_COMMIT_FAILED', 'index.lock') },
    }
    const before = readFileSync(knowledgeFile('twin-a'), 'utf-8')
    const failingOs = createHafez({ vaultPath: VAULT, persistence: failing })
    await expect(failingOs.delete('twin-a')).rejects.toMatchObject({ code: 'GIT_COMMIT_FAILED' })
    expect(readFileSync(knowledgeFile('twin-a'), 'utf-8')).toBe(before)
  })
})

describe('hafez delete <slug>', () => {
  it('deletes and says what it deleted', async () => {
    expect(await cmdDelete(os, ['twin-a'])).toBe('Deleted twin-a (knowledge)')
    expect(existsSync(knowledgeFile('twin-a'))).toBe(false)
  })

  it('--json returns slug and kind', async () => {
    expect(JSON.parse(await cmdDelete(os, ['twin-a'], { json: true }))).toEqual({ slug: 'twin-a', kind: 'knowledge' })
  })

  it('needs exactly one slug', async () => {
    await expect(cmdDelete(os, [])).rejects.toThrow(/Usage: hafez delete <slug>/)
    await expect(cmdDelete(os, ['twin-a', 'twin-b'])).rejects.toThrow(/Usage: hafez delete <slug>/)
    expect(existsSync(knowledgeFile('twin-a'))).toBe(true)
  })

  it('an entity slug is rejected with the --status done line', async () => {
    await expect(cmdDelete(os, ['holder'])).rejects.toThrow('hafez update holder --status done')
  })

  it('batch takes the same op', async () => {
    const payload = join(TMP, 'ops.json')
    writeFileSync(payload, JSON.stringify([{ op: 'delete', slug: 'twin-a' }]))
    await cmdBatch(os, ['--file', payload])
    expect(existsSync(knowledgeFile('twin-a'))).toBe(false)
  })
})
