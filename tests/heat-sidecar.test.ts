// tests/heat-sidecar.test.ts
import { describe, expect, it, afterAll } from 'vitest'
import { existsSync, mkdirSync, statSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { defaultSidecarPath, emptySidecar, readSidecar, writeSidecar, type Sidecar } from '../src/graph/heat/sidecar.js'

const ROOT = join(tmpdir(), 'hafez-test-sidecar-' + Date.now())
afterAll(() => rmSync(ROOT, { recursive: true, force: true }))

const sample: Sidecar = {
  version: 1,
  generated: '2026-10-25T12:00:00.000Z',
  files: {
    'C:/Users/aryan/.claude/projects/x/a.jsonl': {
      mtimeMs: 1761393600000,
      size: 2048,
      cwd: 'D:\CLAUDE\AUTOMAZON',
      days: { '2026-10-24': 12 },
    },
  },
  days: { automazon: { '2026-10-24': 12 } },
}

describe('hours sidecar', () => {
  it('round trips a sidecar through write and read', () => {
    const path = join(ROOT, 'round', 'hours.json')
    writeSidecar(path, sample)
    expect(readSidecar(path)).toEqual(sample)
  })

  it('writes the file owner-only', () => {
    const path = join(ROOT, 'mode', 'hours.json')
    writeSidecar(path, sample)
    // Mode bits are advisory on Windows, so only POSIX can assert them.
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600)
    else expect(existsSync(path)).toBe(true)
  })

  it('reads a missing file as an empty sidecar', () => {
    expect(readSidecar(join(ROOT, 'absent', 'hours.json'))).toEqual(emptySidecar())
  })

  it('reads a truncated file as an empty sidecar', () => {
    mkdirSync(join(ROOT, 'torn'), { recursive: true })
    const path = join(ROOT, 'torn', 'hours.json')
    writeFileSync(path, '{"version":1,"days":')
    expect(readSidecar(path)).toEqual(emptySidecar())
  })

  it('reads a file with an unknown version as an empty sidecar', () => {
    mkdirSync(join(ROOT, 'v2'), { recursive: true })
    const path = join(ROOT, 'v2', 'hours.json')
    writeFileSync(path, '{"version":2,"files":{},"days":{}}')
    expect(readSidecar(path)).toEqual(emptySidecar())
  })

  it('points the default path at hafez/hours.json under the config dir', () => {
    expect(defaultSidecarPath()).toBe(join(process.env.XDG_CONFIG_HOME!, 'hafez', 'hours.json'))
  })

  it('creates missing parent directories and leaves no tmp file behind', () => {
    const path = join(ROOT, 'deep', 'nested', 'hours.json')
    writeSidecar(path, sample)
    expect(existsSync(path)).toBe(true)
    expect(existsSync(`${path}.tmp`)).toBe(false)
  })
})
