// tests/update-session-log.test.ts
// The mechanised session log lives in the Spine's update path (#107), so
// every caller gets it — batch, the library, an MCP wrapper — not only the
// CLI. An entity update with no session_log gets one `progress` entry naming
// the fields written; an update whose only fields are action fields is
// exempt; a knowledge note is never given one. The agent is detected from the
// Harness; the `agent` field overrides it. Library seam over a memory Journal.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { createHafez } from '../src/index.js'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createMemoryJournal } from './helpers/memory-journal.js'
import { localDay } from '../src/dates.js'
import type { Hafez, UpdateFields } from '../src/types.js'

const TMP = join(tmpdir(), 'hafez-test-update-session-log-' + Date.now())
const VAULT = join(TMP, 'vault')
const TODAY = localDay()

let os: Hafez
let n = 0

/** Run under a given Harness: every detectable variable cleared, then `vars` set. */
function harness(vars: Record<string, string> = {}): void {
  for (const key of ['CLAUDECODE', 'CODEX_THREAD_ID', 'CODEX_SANDBOX', 'CODEX_SANDBOX_NETWORK_DISABLED']) vi.stubEnv(key, '')
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v)
}

async function entity(type: 'project' | 'capture' = 'project'): Promise<string> {
  const slug = `log-target-${++n}`
  await os.create('entity', `Log target ${n}`, { type, add_action: 'Ship it @dev' })
  return slug
}

async function body(slug: string): Promise<string> {
  return ((await os.read(slug, 'full')) as unknown as { body: string }).body
}

function entries(text: string): string[] {
  return text.split('\n').filter(l => l.startsWith('### '))
}

beforeAll(() => {
  mkdirSync(join(VAULT, 'entities'), { recursive: true })
  mkdirSync(join(VAULT, 'knowledge'), { recursive: true })
  os = createHafez({ vaultPath: VAULT, persistence: createMemoryJournal() })
})

afterEach(() => { vi.unstubAllEnvs() })
afterAll(() => rmSync(TMP, { recursive: true, force: true }))

describe('every path adds the entry', () => {
  it('a batch update with brief and no session_log writes one progress entry', async () => {
    harness()
    const slug = await entity()
    await os.batch([{ op: 'update', slug, fields: { brief: 'Handoff context' } }])
    const text = await body(slug)
    expect(entries(text)).toEqual([`### ${TODAY} — agent [progress]`])
    expect(text).toContain('Summary: Updated brief')
  })

  it('os.update(slug, { brief }) does the same', async () => {
    harness()
    const slug = await entity()
    await os.update(slug, { brief: 'Handoff context' })
    const text = await body(slug)
    expect(entries(text)).toEqual([`### ${TODAY} — agent [progress]`])
    expect(text).toContain('Summary: Updated brief')
  })

  it('names every field written, with dashes', async () => {
    harness()
    const slug = await entity()
    await os.update(slug, { current_state: 'Mid-flight', status: 'paused' })
    expect(await body(slug)).toMatch(/Summary: Updated (current-state, status|status, current-state)\n?/)
  })

  it('one entry per op in a batch', async () => {
    harness()
    const a = await entity()
    const b = await entity()
    await os.batch([
      { op: 'update', slug: a, fields: { status: 'paused' } },
      { op: 'update', slug: b, fields: { brief: 'x' } },
    ])
    expect(entries(await body(a))).toHaveLength(1)
    expect(entries(await body(b))).toHaveLength(1)
  })

  it('a capture is not exempt', async () => {
    harness()
    const slug = await entity('capture')
    await os.update(slug, { description: 'One line' })
    expect(entries(await body(slug))).toEqual([`### ${TODAY} — agent [progress]`])
  })

  it('an explicit session_log is the only entry written', async () => {
    harness()
    const slug = await entity()
    await os.update(slug, { brief: 'x', session_log: { type: 'decision', summary: 'Chose the thing', agent: 'simorgh' } })
    const text = await body(slug)
    expect(entries(text)).toEqual([`### ${TODAY} — simorgh [decision]`])
    expect(text).not.toContain('Summary: Updated brief')
  })

  it('a knowledge note gets no entry — session logs are entity-only', async () => {
    harness()
    await os.create('knowledge', `Log note ${++n}`, {})
    const slug = `log-note-${n}`
    await os.update(slug, { description: 'One line' })
    expect(entries(await body(slug))).toEqual([])
  })
})

describe('action-only updates are exempt, on every path', () => {
  const ACTION_ONLY: Array<[string, UpdateFields]> = [
    ['complete_action', { complete_action: 'Ship' }],
    ['add_action', { add_action: 'Another @dev' }],
    ['add_actions', { add_actions: ['One @dev', 'Two @dev'] }],
    ['remove_action', { remove_action: 'Ship' }],
    ['clear_actions', { clear_actions: true }],
    ['add_action with complete_action', { add_action: 'Another @dev', complete_action: 'Ship' }],
  ]
  for (const [label, fields] of ACTION_ONLY) {
    it(`${label} through update() writes no entry`, async () => {
      harness()
      const slug = await entity()
      await os.update(slug, fields)
      expect(entries(await body(slug))).toEqual([])
    })

    it(`${label} through batch() writes no entry`, async () => {
      harness()
      const slug = await entity()
      await os.batch([{ op: 'update', slug, fields }])
      expect(entries(await body(slug))).toEqual([])
    })
  }

  it('agent on an action-only update is rejected — there is no entry to name', async () => {
    const slug = await entity()
    await expect(os.update(slug, { complete_action: 'Ship', agent: 'simorgh' })).rejects.toThrow(/agent/)
    await expect(os.batch([{ op: 'update', slug, fields: { agent: 'simorgh' } }]))
      .rejects.toMatchObject({ details: [expect.stringMatching(/agent names the session log entry/)] })
    expect(await body(slug)).toContain('- [ ] Ship it')
  })

  it('a field given as undefined is neither counted nor named', async () => {
    harness()
    const a = await entity()
    await os.update(a, { brief: undefined, status: 'paused' })
    expect(await body(a)).toMatch(/^Summary: Updated status$/m)
    const b = await entity()
    await os.update(b, { status: undefined, complete_action: 'Ship' })
    expect(entries(await body(b))).toEqual([])
  })

  it('an action field alongside a non-action field is not exempt, and is not named', async () => {
    harness()
    const slug = await entity()
    await os.update(slug, { brief: 'x', complete_action: 'Ship' })
    const text = await body(slug)
    expect(entries(text)).toHaveLength(1)
    expect(text).toMatch(/^Summary: Updated brief$/m)
  })
})

describe('agent — detected from the Harness, the agent field overrides', () => {
  it('Claude Code', async () => {
    harness({ CLAUDECODE: '1' })
    const slug = await entity()
    await os.batch([{ op: 'update', slug, fields: { brief: 'x' } }])
    expect(entries(await body(slug))).toEqual([`### ${TODAY} — claude-code [progress]`])
  })

  it('Codex', async () => {
    harness({ CODEX_THREAD_ID: 'thread-1' })
    const slug = await entity()
    await os.update(slug, { brief: 'x' })
    expect(entries(await body(slug))).toEqual([`### ${TODAY} — codex [progress]`])
  })

  it('agent overrides detection, and is not named as a field written', async () => {
    harness({ CLAUDECODE: '1' })
    const slug = await entity()
    await os.update(slug, { brief: 'x', agent: 'simorgh' })
    const text = await body(slug)
    expect(entries(text)).toEqual([`### ${TODAY} — simorgh [progress]`])
    expect(text).toMatch(/^Summary: Updated brief$/m)
  })

  it('agent alongside session_log is rejected — the entry names its own agent', async () => {
    const slug = await entity()
    await expect(os.update(slug, { agent: 'a', session_log: { type: 'progress', summary: 's', agent: 'b' } }))
      .rejects.toThrow(/agent/)
    expect(entries(await body(slug))).toEqual([])
  })

  it('agent on a knowledge note is rejected — it has no session log to name', async () => {
    await os.create('knowledge', `Log note ${++n}`, {})
    await expect(os.update(`log-note-${n}`, { description: 'x', agent: 'simorgh' }))
      .rejects.toThrow(/entity-only fields on knowledge note: agent/)
  })

  it('an empty agent is rejected, never silently replaced', async () => {
    const slug = await entity()
    await expect(os.update(slug, { brief: 'x', agent: '  ' })).rejects.toThrow(/agent/)
  })
})
