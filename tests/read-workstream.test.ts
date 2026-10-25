// tests/read-workstream.test.ts
// The `workstream:` fact line (#240): one per unsplit prefix family on an
// entity's read, after `resource:` and before `sessions:`; a fact, never a
// command; a flat entity's header is unchanged; `read --json` carries
// `workstreams`, empty when none fire.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createHafez, removeTemp } from './helpers/hafez.js'
import type { Hafez } from '../src/types.js'
import { serializeFile } from '../src/vault.js'
import { cmdRead } from '../src/cli/commands.js'
import { createMemoryJournal } from './helpers/memory-journal.js'

const TMP = join(tmpdir(), 'hafez-test-read-workstream-' + Date.now())
const VAULT = join(TMP, 'vault')

const FAMILY = [
  '- [ ] QUEUE, drain the backlog (added 2026-09-01)',
  '- [x] QUEUE, prime the pump (added 2026-09-01)',
  '- [ ] QUEUE A3 flush (added 2026-09-02)',
  '- [ ] CHECK the gate (added 2026-09-02)',
  '- [ ] CHECK the lock (added 2026-09-02)',
  '- [ ] CHECK the door (added 2026-09-02)',
  '- [ ] Something plain (added 2026-09-02)',
].join('\n')

let os: Hafez

beforeAll(async () => {
  mkdirSync(join(VAULT, 'entities'), { recursive: true })
  mkdirSync(join(VAULT, 'knowledge'), { recursive: true })
  mkdirSync(join(VAULT, 'sessions'), { recursive: true })
  const entity = (name: string, actions: string, extra: Record<string, unknown> = {}) => serializeFile(
    { name, type: 'project', status: 'active', created: '2026-01-01', 'last-touched': '2026-10-01', resource: 'https://example.com/' + name, ...extra },
    `## Purpose\n\nx\n\n## Next Actions\n\n${actions}\n\n## Session Log\n\n### 2026-10-01 — claude [progress]\nSummary: Latest\n`,
  )
  writeFileSync(join(VAULT, 'entities', 'gatehouse.md'), entity('Gatehouse', FAMILY))
  writeFileSync(join(VAULT, 'entities', 'split.md'), entity('Split', FAMILY))
  writeFileSync(join(VAULT, 'entities', 'queue.md'), entity('Queue', '- [ ] one', { parent: 'split' }))
  writeFileSync(join(VAULT, 'entities', 'checker.md'), entity('The Check', '- [ ] one', { related: ['split'] }))
  writeFileSync(join(VAULT, 'entities', 'flat.md'), entity('Flat', '- [ ] one (added 2026-09-02)'))
  writeFileSync(join(VAULT, 'sessions', 's1.md'), serializeFile({ name: 'S1', created: '2026-10-01', 'session-date': '2026-10-01', related: ['gatehouse'] }, '## Summary\n\nx\n'))
  os = createHafez({ vaultPath: VAULT, persistence: createMemoryJournal() })
})
afterAll(() => removeTemp(TMP))

describe('the workstream fact line', () => {
  it('one line per firing family, after resource: and before sessions:, counting open lines', async () => {
    const lines = (await cmdRead(os, ['gatehouse'])).split('\n')
    const at = (prefix: string) => lines.findIndex(l => l.startsWith(prefix))
    expect(lines[at('workstream:')]).toBe('workstream: 2 open actions with `QUEUE`; no child named it')
    expect(lines[at('workstream:') + 1]).toBe('workstream: 3 open actions with `CHECK`; no child named it')
    expect(at('resource:')).toBeLessThan(at('workstream:'))
    expect(at('workstream:') + 1).toBeLessThan(at('sessions:'))
  })

  it('is a fact, never a command', async () => {
    const out = await cmdRead(os, ['gatehouse'])
    expect(out).not.toMatch(/hafez create .*CHECK/)
    expect(out).not.toMatch(/CHECK\?/)
  })

  it('stops for a child or related entity carrying the token', async () => {
    expect(await cmdRead(os, ['split'])).not.toContain('workstream:')
    expect(JSON.parse(await cmdRead(os, ['split'], { json: true })).workstreams).toEqual([])
  })

  it('--json carries workstreams', async () => {
    expect(JSON.parse(await cmdRead(os, ['gatehouse'], { json: true })).workstreams)
      .toEqual([{ prefix: 'QUEUE', open_actions: 2 }, { prefix: 'CHECK', open_actions: 3 }])
    expect(JSON.parse(await cmdRead(os, ['flat'], { json: true })).workstreams).toEqual([])
  })

  it('is the same at every depth: a frontmatter read computes it from the file', async () => {
    for (const depth of ['frontmatter', 'full']) {
      const out = await cmdRead(os, ['gatehouse', '--depth', depth])
      expect(out).toContain('workstream: 2 open actions with `QUEUE`; no child named it')
      expect(JSON.parse(await cmdRead(os, ['gatehouse', '--depth', depth], { json: true })).workstreams)
        .toEqual([{ prefix: 'QUEUE', open_actions: 2 }, { prefix: 'CHECK', open_actions: 3 }])
    }
  })

  it('a flat entity has no such line', async () => {
    expect(await cmdRead(os, ['flat'])).not.toContain('workstream')
  })
})
