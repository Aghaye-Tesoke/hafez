// tests/cli-update-session-log.test.ts
// Every non-exempt `update` carries a session log entry without the agent
// remembering it (Agent Contract, #85). Settled behaviour: when an entity
// update carries no --log, the binary ADDS one — a `progress` entry naming
// the fields written — rather than warning or refusing. An update whose only
// fields are action fields is exempt. The agent name is detected from the
// Harness; --agent overrides it. The entry is added by the Spine (#107), so
// the CLI passes no session_log of its own. Command-function seam over a
// memory Journal.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { createHafez, removeTemp } from './helpers/hafez.js'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createMemoryJournal } from './helpers/memory-journal.js'
import { cmdCreate, cmdUpdate, cmdDigest } from '../src/cli/commands.js'
import { localDay } from '../src/dates.js'
import type { Hafez } from '../src/types.js'

const TMP = join(tmpdir(), 'hafez-test-cli-update-session-log-' + Date.now())
const VAULT = join(TMP, 'vault')
const TODAY = localDay()

let os: Hafez
let n = 0

/** Run under a given Harness: every detectable variable cleared, then `vars` set. */
function harness(vars: Record<string, string> = {}): void {
  for (const key of ['CLAUDECODE', 'CODEX_THREAD_ID', 'CODEX_SANDBOX', 'CODEX_SANDBOX_NETWORK_DISABLED']) vi.stubEnv(key, '')
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v)
}

async function entity(): Promise<string> {
  return (await cmdCreate(os, ['entity', `Log target ${++n}`, '--type', 'project', '--add-action', 'Ship it @dev'])).trim()
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
afterAll(() => removeTemp(TMP))

describe('update without --log — the binary adds the entry', () => {
  it('--brief alone writes one progress entry naming the field', async () => {
    harness()
    const slug = await entity()
    await cmdUpdate(os, [slug, '--brief', 'Handoff context'])
    const text = await body(slug)
    expect(entries(text)).toEqual([`### ${TODAY} — agent [progress]`])
    expect(text).toContain('Summary: Updated brief')
  })

  it('names every field written, as flags', async () => {
    harness()
    const slug = await entity()
    await cmdUpdate(os, [slug, '--current-state', 'Mid-flight', '--status', 'paused'])
    expect(await body(slug)).toMatch(/Summary: Updated (current-state, status|status, current-state)\n?/)
  })

  it('an action field alongside a non-action field is not exempt', async () => {
    harness()
    const slug = await entity()
    await cmdUpdate(os, [slug, '--brief', 'x', '--complete-action', 'Ship'])
    expect(entries(await body(slug))).toHaveLength(1)
  })

  it('an explicit --log is the only entry written', async () => {
    harness()
    const slug = await entity()
    await cmdUpdate(os, [slug, '--brief', 'x', '--log', 'decision: Chose the thing'])
    const text = await body(slug)
    expect(entries(text)).toEqual([`### ${TODAY} — agent [decision]`])
    expect(text).not.toContain('Summary: Updated brief')
  })

  it('a knowledge note gets no entry — session logs are entity-only', async () => {
    harness()
    const slug = (await cmdCreate(os, ['knowledge', `Log note ${++n}`])).split('\n')[0]
    await cmdUpdate(os, [slug, '--description', 'One line'])
    expect(entries(await body(slug))).toEqual([])
  })

  it('the CLI composes no entry and reads nothing before the write — the Spine adds it', async () => {
    harness()
    const slug = await entity()
    const update = vi.spyOn(os, 'update')
    const read = vi.spyOn(os, 'read')
    try {
      await cmdUpdate(os, [slug, '--brief', 'x', '--agent', 'simorgh'])
      expect(update).toHaveBeenCalledWith(slug, { brief: 'x', agent: 'simorgh' })
      // The one read is after the write: the stale reminder's.
      expect(read.mock.invocationCallOrder.every(order => order > update.mock.invocationCallOrder[0])).toBe(true)
    } finally {
      update.mockRestore()
      read.mockRestore()
    }
    expect(entries(await body(slug))).toEqual([`### ${TODAY} — simorgh [progress]`])
  })

  it('an unknown slug still fails with the miss error', async () => {
    harness()
    await expect(cmdUpdate(os, ['no-such-slug', '--brief', 'x'])).rejects.toThrow(/no-such-slug/)
  })
})

describe('action-only updates are exempt', () => {
  const ACTION_ONLY: Array<[string, string[]]> = [
    ['--complete-action', ['--complete-action', 'Ship']],
    ['--add-action', ['--add-action', 'Another @dev']],
    ['--remove-action', ['--remove-action', 'Ship']],
    ['--clear-actions', ['--clear-actions']],
    ['--add-action with --complete-action', ['--add-action', 'Another @dev', '--complete-action', 'Ship']],
  ]
  for (const [label, args] of ACTION_ONLY) {
    it(`${label} writes no session log entry`, async () => {
      harness()
      const slug = await entity()
      await cmdUpdate(os, [slug, ...args])
      expect(entries(await body(slug))).toEqual([])
    })
  }

  it('--agent does not make an action-only update loggable — it is rejected, never dropped', async () => {
    harness()
    const slug = await entity()
    await expect(cmdUpdate(os, [slug, '--complete-action', 'Ship', '--agent', 'someone'])).rejects.toThrow(/agent/)
    expect(entries(await body(slug))).toEqual([])
  })

  it('--agent on a knowledge note is rejected — it has no session log', async () => {
    harness()
    const slug = (await cmdCreate(os, ['knowledge', `Log note ${++n}`])).split('\n')[0]
    await expect(cmdUpdate(os, [slug, '--description', 'x', '--agent', 'someone']))
      .rejects.toThrow(/entity-only fields on knowledge note: agent/)
  })
})

describe('agent name — detected from the Harness, --agent overrides', () => {
  it('Claude Code', async () => {
    harness({ CLAUDECODE: '1' })
    const slug = await entity()
    await cmdUpdate(os, [slug, '--brief', 'x'])
    expect(entries(await body(slug))).toEqual([`### ${TODAY} — claude-code [progress]`])
  })

  it('Codex', async () => {
    harness({ CODEX_THREAD_ID: 'thread-1' })
    const slug = await entity()
    await cmdUpdate(os, [slug, '--log', 'progress: Did it'])
    expect(entries(await body(slug))).toEqual([`### ${TODAY} — codex [progress]`])
  })

  it('nothing detectable → the neutral fallback', async () => {
    harness()
    const slug = await entity()
    await cmdUpdate(os, [slug, '--log', 'progress: Did it'])
    expect(entries(await body(slug))).toEqual([`### ${TODAY} — agent [progress]`])
  })

  it('--agent overrides detection, on an explicit log and an added one', async () => {
    harness({ CLAUDECODE: '1' })
    const a = await entity()
    await cmdUpdate(os, [a, '--log', 'progress: Did it', '--agent', 'simorgh'])
    expect(entries(await body(a))).toEqual([`### ${TODAY} — simorgh [progress]`])
    const b = await entity()
    await cmdUpdate(os, [b, '--brief', 'x', '--agent', 'simorgh'])
    expect(entries(await body(b))).toEqual([`### ${TODAY} — simorgh [progress]`])
  })
})

describe('digest calls the same detection', () => {
  async function digestAgent(input: Record<string, unknown>): Promise<string> {
    const slug = await entity()
    const file = join(TMP, `digest-${++n}.json`)
    writeFileSync(file, JSON.stringify({ entities_touched: [slug], narrative: 'Did work.', session_date: TODAY, ...input }))
    const ops = JSON.parse(await cmdDigest(os, ['--file', file]))
    return ops.find((o: any) => o.op === 'update').fields.session_log.agent
  }

  it('fills the detected name when agent is absent, matching update', async () => {
    harness({ CODEX_SANDBOX: 'seatbelt' })
    expect(await digestAgent({})).toBe('codex')
    harness({ CLAUDECODE: '1' })
    expect(await digestAgent({})).toBe('claude-code')
    harness()
    expect(await digestAgent({})).toBe('agent')
  })

  it('keeps an explicit agent', async () => {
    harness({ CLAUDECODE: '1' })
    expect(await digestAgent({ agent: 'simorgh' })).toBe('simorgh')
  })
})
