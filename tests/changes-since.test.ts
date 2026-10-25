// tests/changes-since.test.ts
// changesSince (#258): which notes were created, updated or deleted since a
// cursor, read from the Journal's history. One suite, run against the git
// Journal on a real repo and against the in-memory Journal.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { tmpdir } from 'os'
import { simpleGit } from 'simple-git'
import { createHafez, removeTemp } from './helpers/hafez.js'
import { createMemoryJournal, type MemoryJournal } from './helpers/memory-journal.js'
import type { Hafez } from '../src/types.js'

interface Backend {
  /** A Hafez instance on `vault`, its history empty. */
  open(vault: string): Promise<Hafez>
  /** Write these files and commit them outside the Hafez instance. */
  commitRaw(vault: string, files: Record<string, string>): Promise<void>
}

function writeAll(vault: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(vault, rel)), { recursive: true })
    writeFileSync(join(vault, rel), content)
  }
}

let memory: MemoryJournal

const backends: Record<string, Backend> = {
  git: {
    async open(vault) {
      await simpleGit(vault).init()
      return createHafez({ vaultPath: vault, git: { push: false } })
    },
    async commitRaw(vault, files) {
      writeAll(vault, files)
      const git = simpleGit(vault)
      await git.add(Object.keys(files))
      await git.commit('raw')
    },
  },
  memory: {
    async open(vault) {
      memory = createMemoryJournal()
      return createHafez({ vaultPath: vault, persistence: memory })
    },
    async commitRaw(vault, files) {
      writeAll(vault, files)
      await memory.commit(Object.keys(files), [], 'raw')
    },
  },
}

describe.each(Object.entries(backends))('changesSince on the %s Journal', (_name, backend) => {
  let TMP: string
  let VAULT: string
  let os: Hafez

  beforeEach(async () => {
    TMP = mkdtempSync(join(tmpdir(), 'hafez-test-changes-since-'))
    VAULT = join(TMP, 'vault')
    mkdirSync(join(VAULT, 'entities'), { recursive: true })
    mkdirSync(join(VAULT, 'knowledge'), { recursive: true })
    os = await backend.open(VAULT)
  })

  afterEach(() => removeTemp(TMP))

  it('with no commits, the cursor is empty and there are no changes', async () => {
    expect(await os.changesSince()).toEqual({ cursor: '', changes: [] })
  })

  it('with no cursor, gives the current cursor and no changes', async () => {
    await os.create('entity', 'Alpha', { type: 'entity' })
    const { cursor, changes } = await os.changesSince()
    expect(cursor).not.toBe('')
    expect(changes).toEqual([])
  })

  it('reports a create, an update and a delete', async () => {
    await os.create('entity', 'Alpha', { type: 'entity' })
    await os.create('knowledge', 'Old Note', {})
    const { cursor } = await os.changesSince()

    await os.create('knowledge', 'New Note', {})
    await os.update('alpha', { brief: 'Moved on' })
    await os.delete('old-note')

    const result = await os.changesSince(cursor)
    expect(result.changes).toHaveLength(3)
    expect(result.changes).toEqual(expect.arrayContaining([
      { slug: 'new-note', kind: 'knowledge', op: 'create' },
      { slug: 'alpha', kind: 'entity', op: 'update' },
      { slug: 'old-note', kind: 'knowledge', op: 'delete' },
    ]))
    expect(result.cursor).not.toBe(cursor)
    expect(await os.changesSince(result.cursor)).toEqual({ cursor: result.cursor, changes: [] })
  })

  it('from the empty cursor, every note in history is a create', async () => {
    await os.create('entity', 'Alpha', { type: 'entity' })
    const { changes } = await os.changesSince('')
    expect(changes).toEqual([{ slug: 'alpha', kind: 'entity', op: 'create' }])
  })

  it('a promote is the old note deleted and the new one created', async () => {
    await os.capture('Loose Thought')
    const { cursor } = await os.changesSince()
    await os.promote('loose-thought', 'knowledge')
    const { changes } = await os.changesSince(cursor)
    expect(changes).toEqual(expect.arrayContaining([
      { slug: 'loose-thought', kind: 'entity', op: 'delete' },
      { slug: 'loose-thought', kind: 'knowledge', op: 'create' },
    ]))
  })

  it('ignores paths that are not Vault notes', async () => {
    await os.create('entity', 'Alpha', { type: 'entity' })
    const { cursor } = await os.changesSince()
    await backend.commitRaw(VAULT, {
      'README.md': '# vault\n',
      'entities/.gitkeep': '',
      'entities/.hidden.md': '---\nname: Hidden\n---\n',
      'entities/archive/alpha-log.md': '### 2026-01-01 — system [progress]\n',
      'notes/elsewhere.md': '---\nname: Elsewhere\n---\n',
      'sessions/a-session.md': '---\nname: A Session\ncreated: 2026-01-01\n---\n',
    })
    const { changes } = await os.changesSince(cursor)
    expect(changes).toEqual([{ slug: 'a-session', kind: 'session', op: 'create' }])
  })

  it('an unknown cursor is GIT_READ_FAILED', async () => {
    await os.create('entity', 'Alpha', { type: 'entity' })
    await expect(os.changesSince('0123456789abcdef0123456789abcdef01234567')).rejects.toMatchObject({ code: 'GIT_READ_FAILED' })
  })
})

describe('changesSince on the git Journal: history from any writer', () => {
  let TMP: string
  let VAULT: string

  beforeEach(() => {
    TMP = mkdtempSync(join(tmpdir(), 'hafez-test-changes-since-git-'))
    VAULT = join(TMP, 'vault')
    mkdirSync(join(VAULT, 'entities'), { recursive: true })
  })

  afterEach(() => removeTemp(TMP))

  it('sees a commit made by another process, non-Latin slugs unquoted', async () => {
    await simpleGit(VAULT).init()
    const os = createHafez({ vaultPath: VAULT, git: { push: false } })
    await os.create('entity', 'Alpha', { type: 'entity' })
    const { cursor } = await os.changesSince()
    await backends.git.commitRaw(VAULT, { 'entities/café.md': '---\nname: Café\n---\n' })
    expect((await os.changesSince(cursor)).changes).toEqual([{ slug: 'café', kind: 'entity', op: 'create' }])
  })
})
