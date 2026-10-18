// tests/read-archive.test.ts
// The archive is an entity's attachment (#34): out of the index and out of
// search, read on purpose with `read <slug> --archive`, and pointed to from
// the entity's header while it exists.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createHafez, removeTemp } from './helpers/hafez.js'
import type { Hafez } from '../src/types.js'
import { serializeFile } from '../src/vault.js'
import { cmdRead } from '../src/cli/commands.js'
import { UsageError } from '../src/cli/args.js'
import { createMemoryJournal } from './helpers/memory-journal.js'

const TMP = join(tmpdir(), 'hafez-test-read-archive-' + Date.now())
const VAULT = join(TMP, 'vault')

const ARCHIVE = [
  '### 2026-03-11 — orchestrator [progress]',
  'Summary: Created entity, imported open items',
  '',
  '### 2026-04-05 — claude [progress]',
  'Summary: Built the tmux integration',
  '',
].join('\n')

let os: Hafez

beforeAll(async () => {
  mkdirSync(join(VAULT, 'entities', 'archive'), { recursive: true })
  mkdirSync(join(VAULT, 'knowledge'), { recursive: true })
  const entity = (name: string) => serializeFile(
    { name, type: 'project', status: 'active', created: '2026-01-01', 'last-touched': '2026-10-01' },
    '## Purpose\n\n## Session Log\n\n### 2026-10-01 — claude [progress]\nSummary: Latest\n',
  )
  writeFileSync(join(VAULT, 'entities', 'command-center.md'), entity('Command Center'))
  writeFileSync(join(VAULT, 'entities', 'fresh.md'), entity('Fresh'))
  writeFileSync(join(VAULT, 'entities', 'archive', 'command-center-log.md'), ARCHIVE)
  writeFileSync(join(VAULT, 'knowledge', 'a-note.md'), serializeFile({ name: 'A note', created: '2026-01-01' }, '## Synthesis\n\nx\n'))
  os = createHafez({ vaultPath: VAULT, persistence: createMemoryJournal() })
})
afterAll(() => removeTemp(TMP))

describe('read --archive', () => {
  it('prints the archive file as-is, no Footer', async () => {
    expect(await os.archive('command-center')).toBe(ARCHIVE)
    const out = await cmdRead(os, ['command-center', '--archive'])
    expect(out).toBe(ARCHIVE)
    expect(out).not.toContain('hafez update')
    expect(JSON.parse(await cmdRead(os, ['command-center', '--archive'], { json: true }))).toEqual({ slug: 'command-center', archive: ARCHIVE })
  })

  it('an entity with no archive: one line, not an error', async () => {
    expect(await os.archive('fresh')).toBeNull()
    expect(await cmdRead(os, ['fresh', '--archive'])).toBe('no archive for fresh')
    expect(JSON.parse(await cmdRead(os, ['fresh', '--archive'], { json: true }))).toEqual({ slug: 'fresh', archive: null })
  })

  it('a knowledge note is a usage error; a miss is the read miss', async () => {
    await expect(cmdRead(os, ['a-note', '--archive'])).rejects.toThrow(UsageError)
    await expect(os.archive('nope')).rejects.toThrow(/not found/)
  })
})

describe('the archive pointer in the entity header', () => {
  it('names the entry count and the command while an archive exists', async () => {
    const out = await cmdRead(os, ['command-center'])
    expect(out).toContain('archive: 2 older log entries · hafez read command-center --archive')
    expect(JSON.parse(await cmdRead(os, ['command-center'], { json: true })).archive_entries).toBe(2)
    expect(await cmdRead(os, ['fresh'])).not.toContain('archive:')
  })

  it('the archive is never searched', async () => {
    expect(await os.search('tmux integration', 'all')).toEqual([])
  })
})
