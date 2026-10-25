// tests/heat-transcripts.test.ts
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { scanTranscripts } from '../src/graph/heat/transcripts.js'

const ROOT = join(tmpdir(), 'hafez-test-transcripts-' + Date.now())
const NOW = new Date('2026-10-25T12:00:00')
const line = (iso: string, extra = '') => `{"type":"user","timestamp":"${iso}"${extra}}\n`

beforeAll(() => {
  mkdirSync(join(ROOT, 'D--CLAUDE-AUTOMAZON'), { recursive: true })
  writeFileSync(join(ROOT, 'D--CLAUDE-AUTOMAZON', 'a.jsonl'),
    line('2026-10-24T09:00:00', ',"cwd":"D:\\\\CLAUDE\\\\AUTOMAZON"') + line('2026-10-24T09:10:00') + 'not json\n' + line('garbage-date') + line('2026-10-24T09:12:00'))
  mkdirSync(join(ROOT, 'no-cwd'), { recursive: true })
  writeFileSync(join(ROOT, 'no-cwd', 'b.jsonl'), line('2026-10-24T10:00:00') + line('2026-10-24T10:05:00'))
})
afterAll(() => rmSync(ROOT, { recursive: true, force: true }))

describe('scanTranscripts', () => {
  it('reads timestamps and cwd only, skips bad lines, and sums per cwd and day', async () => {
    const { byCwd } = await scanTranscripts(ROOT, {}, NOW)
    expect(byCwd.get('D:\\CLAUDE\\AUTOMAZON')).toEqual({ '2026-10-24': 12 })
  })
  it('uses the folder name when no line carries a cwd', async () => {
    const { byCwd } = await scanTranscripts(ROOT, {}, NOW)
    expect(byCwd.get('no-cwd')).toEqual({ '2026-10-24': 5 })
  })
  it('reuses an unchanged file from the cache without reading it', async () => {
    const first = await scanTranscripts(ROOT, {}, NOW)
    const path = Object.keys(first.cache).find(p => p.endsWith('a.jsonl'))!
    const poisoned = { ...first.cache, [path]: { ...first.cache[path], days: { '2026-10-24': 999 } } }
    const second = await scanTranscripts(ROOT, poisoned, NOW)
    expect(second.byCwd.get('D:\\CLAUDE\\AUTOMAZON')).toEqual({ '2026-10-24': 999 })
  })
  it('drops a cached file that no longer exists', async () => {
    const { cache } = await scanTranscripts(ROOT, { '/gone.jsonl': { mtimeMs: 0, size: 0, cwd: 'x', days: {} } }, NOW)
    expect(cache['/gone.jsonl']).toBeUndefined()
  })
})
