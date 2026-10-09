// tests/cli-save.test.ts
// The save pipeline as the Agent Contract has it (#96): `digest` fails on an
// unknown slug and names it, a session already saved is skipped, the
// `hafez-save` skill's command runs as written, and a malformed `batch`
// payload prints the batch shape. Command-function seam over a memory Journal.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { Readable } from 'stream'
import { spawnSync } from 'child_process'
import { chmodSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs'
import { simpleGit } from 'simple-git'
import { join } from 'path'
import { tmpdir } from 'os'
import { createHafez } from '../src/index.js'
import { createMemoryJournal } from './helpers/memory-journal.js'
import { cmdBatch, cmdCreate, cmdDigest } from '../src/cli/commands.js'
import { errorText } from '../src/cli/index.js'
import { localDay } from '../src/dates.js'
import { HafezError, type Hafez } from '../src/types.js'

const TMP = join(tmpdir(), 'hafez-test-cli-save-' + Date.now())
const VAULT = join(TMP, 'vault')
const TODAY = localDay()
const SAVE_DRAFT = join(process.cwd(), 'skill', 'hafez-save', 'SKILL.md')

let os: Hafez
let n = 0

async function entity(): Promise<string> {
  return (await cmdCreate(os, ['entity', `Save target ${++n}`, '--type', 'project'])).trim()
}

function file(name: string, content: string): string {
  const path = join(TMP, `${++n}-${name}`)
  writeFileSync(path, content)
  return path
}

/** What the CLI prints for a thrown error. */
async function failure(run: Promise<unknown>): Promise<{ err: HafezError; text: string }> {
  const err = await run.then(() => { throw new Error('expected the command to fail') }, e => e)
  return { err, text: errorText(err) }
}

/** digest → batch through files, as the no-pipe form runs it. */
async function save(summary: Record<string, unknown>): Promise<string> {
  const ops = await cmdDigest(os, ['--file', file('summary.json', JSON.stringify(summary))])
  return cmdBatch(os, ['--file', file('ops.json', ops)])
}

function sessions(): string[] {
  const dir = join(VAULT, 'sessions')
  return existsSync(dir) ? readdirSync(dir) : []
}

const logEntries = (slug: string, summary: string) =>
  readFileSync(join(VAULT, 'entities', `${slug}.md`), 'utf-8').split('\n').filter(l => l === `Summary: ${summary}`)

beforeAll(() => {
  mkdirSync(join(VAULT, 'entities'), { recursive: true })
  mkdirSync(join(VAULT, 'knowledge'), { recursive: true })
  os = createHafez({ vaultPath: VAULT, persistence: createMemoryJournal() })
})

afterEach(() => { vi.restoreAllMocks() })
afterAll(() => rmSync(TMP, { recursive: true, force: true }))

describe('digest on an unknown slug', () => {
  it('exits non-zero, naming the unknown slug and no other', async () => {
    const known = await entity()
    const summary = { entities_touched: [known, 'no-such-entity'], narrative: 'Did work.', session_date: TODAY }
    const { err, text } = await failure(cmdDigest(os, ['--file', file('summary.json', JSON.stringify(summary))]))
    expect(err).toBeInstanceOf(HafezError)
    expect(err.code).toBe('NOT_FOUND')
    expect(text).toContain("'no-such-entity'")
    expect(text).not.toContain(known)
  })

  it('a knowledge slug is known: the note links it, with no session log on it', async () => {
    const a = await entity()
    const note = (await cmdCreate(os, ['knowledge', `Save note ${++n}`, '--synthesis', 'x'])).trim()
    const ops = JSON.parse(await cmdDigest(os, ['--file', file('summary.json', JSON.stringify(
      { entities_touched: [a, note], narrative: 'Read a note.', session_date: TODAY },
    ))]))
    expect(ops.filter((o: any) => o.op === 'update').map((o: any) => o.slug)).toEqual([a])
    expect(ops.find((o: any) => o.op === 'create').fields.related).toEqual([a, note])
  })

  it('a slug listed twice gets one session log entry', async () => {
    const a = await entity()
    await save({ entities_touched: [a, a], narrative: 'Listed twice.', session_date: TODAY })
    expect(logEntries(a, 'Listed twice.')).toHaveLength(1)
  })

  it('names every unknown slug', async () => {
    const summary = { entities_touched: ['ghost-a', 'ghost-b'], narrative: 'Did work.', session_date: TODAY }
    const { text } = await failure(cmdDigest(os, ['--file', file('summary.json', JSON.stringify(summary))]))
    expect(text).toContain("'ghost-a'")
    expect(text).toContain("'ghost-b'")
  })
})

describe('a second save of the same session', () => {
  it('leaves one session note and one log entry per entity, and says it was skipped', async () => {
    const a = await entity()
    const b = await entity()
    const before = sessions().length
    const summary = { entities_touched: [a, b], decisions: ['Keep it'], narrative: 'Saved twice.', session_date: TODAY }

    const first = await save(summary)
    expect(first).toMatch(/created: session-/)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const second = await save(summary)

    expect(sessions().length).toBe(before + 1)
    expect(logEntries(a, 'Saved twice. | Decisions: Keep it')).toHaveLength(1)
    expect(logEntries(b, 'Saved twice. | Decisions: Keep it')).toHaveLength(1)
    expect(second).toMatch(/skipped/)
    expect(stderr.mock.calls.map(c => String(c[0])).join('')).toMatch(/already saved.*skipped/)
  })

  it('a different narrative on the same date is a new session', async () => {
    const a = await entity()
    const before = sessions().length
    await save({ entities_touched: [a], narrative: 'Morning work.', session_date: TODAY })
    await save({ entities_touched: [a], narrative: 'Evening work.', session_date: TODAY })
    expect(sessions().length).toBe(before + 2)
  })
})

describe('the hafez-save draft, run as written', () => {
  const draft = readFileSync(SAVE_DRAFT, 'utf-8')

  /** The draft's summary JSON with its placeholders filled in validly. */
  function summaryFrom(json: string, slugs: string[]): string {
    let i = 0
    return json
      .replace(/<slug>/g, () => slugs[i++ % slugs.length])
      .replace('<YYYY-MM-DD>', TODAY)
      .replace(/<[^>"]+>/g, 'Filled in by the test')
  }

  it('the pipe form succeeds end to end, every stage a hafez command', async () => {
    // Every stage starts with `hafez`, so a harness allow rule on the command
    // (Codex's prefix rule) covers the whole pipe: an `echo` stage would not.
    const block = draft.match(/```\n(hafez digest --data '[\s\S]*?)\n```/)![1]
    const [, json, rest] = block.match(/^hafez digest --data '([\s\S]*)' \| (.*)$/)!
    expect(rest).toBe('hafez batch')
    const slugs = [await entity(), await entity()]

    const ops = await cmdDigest(os, ['--data', summaryFrom(json, slugs)])
    vi.spyOn(process, 'stdin', 'get').mockReturnValue(Readable.from([ops]) as any)
    const out = await cmdBatch(os, [])
    expect(out).toMatch(/^Batch complete: 3 operations \(created: session-/)
    for (const slug of slugs) expect(logEntries(slug, 'Filled in by the test | Decisions: Filled in by the test')).toHaveLength(1)
  })

  it('the no-pipe form succeeds end to end', async () => {
    const json = draft.match(/```\nhafez digest --data '([\s\S]*?)' \|/)![1]
    const steps = [...draft.match(/^No pipe \(PowerShell 5\.1\):.*$/m)![0].matchAll(/`([^`]+)`/g)].map(m => m[1])
    expect(steps).toEqual(['summary.json', 'hafez digest --file summary.json > ops.json', 'hafez batch --file ops.json'])
    const slugs = [await entity(), await entity()]
    const dir = join(TMP, `no-pipe-${++n}`)
    mkdirSync(dir)
    writeFileSync(join(dir, 'summary.json'), summaryFrom(json, slugs))

    let out = ''
    for (const step of steps.slice(1)) {
      const [, command, ...rest] = step.split(' ')
      const redirect = rest.indexOf('>')
      const args = (redirect < 0 ? rest : rest.slice(0, redirect)).map(a => (a.endsWith('.json') ? join(dir, a) : a))
      out = await ({ digest: cmdDigest, batch: cmdBatch } as const)[command as 'digest' | 'batch'](os, args)
      if (redirect >= 0) writeFileSync(join(dir, rest[redirect + 1]), out)
    }
    expect(out).toMatch(/^Batch complete: 3 operations \(created: session-/)
  })
})

// #135: the pipe form's JSON sits in single quotes, so a straight apostrophe
// in the prose ends the argument. The draft names the apostrophe to write
// instead; the command, filled in that way, runs in a real shell as written.
describe('the hafez-save draft, through a real shell', () => {
  const draft = readFileSync(SAVE_DRAFT, 'utf-8')
  const PROSE = "Mobile isn't migrated; $HOME and `date` stay literal"
  const SHELLS = ['bash', 'sh', 'zsh'].filter(sh => spawnSync(sh, ['-c', 'true']).status === 0)
  const dir = join(TMP, 'shell')
  const shimDir = join(dir, 'bin')
  const vault = join(dir, 'vault')
  const CLI = join(process.cwd(), 'dist', 'cli.js')

  /** The apostrophe the draft says to write inside the quoted JSON. */
  const apostrophe = () => draft.match(/apostrophe[^\n]*? as `([^`]+)`/)?.[1]

  beforeAll(async () => {
    mkdirSync(shimDir, { recursive: true })
    mkdirSync(join(vault, 'entities'), { recursive: true })
    mkdirSync(join(vault, 'knowledge'), { recursive: true })
    await simpleGit(vault).init()
    await simpleGit(vault).commit('init', ['--allow-empty'])
    writeFileSync(join(shimDir, 'hafez'), `#!/bin/sh\nexec node '${CLI}' --vault '${vault}' "$@"\n`)
    chmodSync(join(shimDir, 'hafez'), 0o755)
  })

  it('names an apostrophe that is not the one that ends the quotes', () => {
    expect(apostrophe()).toBeDefined()
    expect(apostrophe()).not.toContain("'")
  })

  it.each(SHELLS)('%s: prose with an apostrophe, a $VAR and a backtick saves', shell => {
    const env = { ...process.env, PATH: `${shimDir}:${process.env.PATH}` }
    const slug = spawnSync('hafez', ['create', 'entity', `Shell target ${shell}`, '--type', 'project'], { env, encoding: 'utf-8' }).stdout.trim()
    const prose = JSON.stringify(PROSE).slice(1, -1).replace(/'/g, apostrophe() ?? "'")
    const command = draft.match(/```\n(hafez digest --data '[\s\S]*?)\n```/)![1]
      .replace(/<slug>/g, slug)
      .replace('<YYYY-MM-DD>', TODAY)
      .replace(/<[^>"]+>/g, prose)

    const result = spawnSync(shell, ['-c', command], { env, encoding: 'utf-8' })
    expect(result.stderr).toBe('')
    expect(result.stdout).toMatch(/^Batch complete: 2 operations \(created: session-/)
    const literal = PROSE.replace(/'/g, apostrophe() ?? "'")
    expect(readFileSync(join(vault, 'entities', `${slug}.md`), 'utf-8')).toContain(`Summary: ${literal} | Decisions: ${literal}`)
  })
})

describe('batch misuse prints the batch shape', () => {
  const SHAPE = /a bare JSON array[\s\S]*```\n\[\n  \{"op":/

  it.each([
    ['a wrapper object', '{"ops":[{"op":"capture","name":"x"}]}'],
    ['invalid JSON', '[{"op":'],
    ['an empty array', '[]'],
    ['an op with a bad shape', '[{"op":"update","slug":"x","feilds":{}}]'],
  ])('%s', async (_name, payload) => {
    const { err, text } = await failure(cmdBatch(os, ['--file', file('ops.json', payload)]))
    expect(err.code).toBe('VALIDATION_FAILED')
    expect(text).toMatch(SHAPE)
    // One example op, after the error itself.
    expect(text.match(/\{"op":/g)).toHaveLength(1)
    expect(text.indexOf('Error: ')).toBe(0)
  })

  it('no input does not: in a pipe the stage before failed and said why', async () => {
    const { text } = await failure(cmdBatch(os, ['--file', file('ops.json', '')]))
    expect(text).toMatch(/No input received/)
    expect(text).not.toMatch(SHAPE)
  })

  it('a semantic failure on a well-formed payload does not', async () => {
    const { text } = await failure(cmdBatch(os, ['--file', file('ops.json', '[{"op":"update","slug":"no-such-slug","fields":{"status":"done"}}]')]))
    expect(text).not.toMatch(SHAPE)
  })
})
