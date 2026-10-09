// tests/cli-stale-actions.test.ts
// Stale actions (#97): an open action older than the entity's
// `staleness-days` (default 14) since it was added is marked with its age on
// `read`, an undated one is marked undated, whatever the entity's status;
// `read --json` actions carry `added`, `age_days` and `stale`; a successful
// `update` names the Stale lines that remain. Asserted at the
// command-function seam over a memory-Journal factory, with the clock pinned
// to the read-project draft's day, against the read-project and
// update-output drafts.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createHafez } from '../src/index.js'
import { createMemoryJournal } from './helpers/memory-journal.js'
import { cmdRead, cmdUpdate } from '../src/cli/commands.js'
import { actionAge } from '../src/stale.js'
import type { Hafez } from '../src/types.js'

const TMP = join(tmpdir(), 'hafez-test-cli-stale-actions-' + Date.now())
const VAULT = join(TMP, 'vault')
const DRAFTS = 'tests/fixtures/surfaces'

/** The Next Actions lines of a rendered read or draft. */
const actionLinesOf = (out: string) => out.split('\n').filter(l => /^- \[[ x]\] /.test(l))
const handleOf = (line: string) => /^- \[ \] ([0-9a-f]+) {2}/.exec(line)?.[1]
/** The draft's own lines, and the update-output draft's stale render. */
const DRAFT_LINES = actionLinesOf(readFileSync(`${DRAFTS}/read-project.md`, 'utf-8'))
const DRAFT_REMINDER = [...readFileSync(`${DRAFTS}/update-output.md`, 'utf-8').matchAll(/^(`{3,4})\n([\s\S]*?)\n\1$/gm)][1][2]

/** The draft's Next Actions as the file stores them: stamped, one undated. */
const DRAFT_FILE_ACTIONS = [
  '- [ ] Migrate the mobile client to the token endpoint (added 2026-09-25)',
  '- [ ] Remove the cookie fallback (added 2026-08-01)',
  '- [ ] Ask security about refresh lifetime',
  '- [x] Ship the token endpoint (added 2026-09-10)',
].join('\n')

let os: Hafez

beforeAll(() => {
  // The day the draft was rendered: 62 days after 2026-08-01.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 2, 12))
  mkdirSync(join(VAULT, 'entities'), { recursive: true })
  mkdirSync(join(VAULT, 'knowledge'), { recursive: true })
  os = createHafez({ vaultPath: VAULT, persistence: createMemoryJournal() })
})
afterAll(() => {
  vi.useRealTimers()
  rmSync(TMP, { recursive: true, force: true })
})

let seq = 0
/** A project whose Next Actions are the draft's, with `frontmatter` lines added. */
async function draftEntity(frontmatter: string[] = []): Promise<string> {
  const slug = await os.create('entity', `Stale ${++seq}`, { type: 'project', add_action: 'placeholder' })
  const path = join(VAULT, 'entities', `${slug}.md`)
  const file = readFileSync(path, 'utf-8')
    .replace(/^- \[ \] placeholder.*$/m, DRAFT_FILE_ACTIONS)
    .replace(/^created:/m, [...frontmatter, 'created:'].join('\n'))
  writeFileSync(path, file)
  return slug
}

/** The draft's handles in place of the real ones, line by line: the Handle
 * itself is #83's, asserted there. */
function withDraftHandles(lines: string[]): string[] {
  return lines.map((line, i) => {
    const real = handleOf(line)
    const draft = handleOf(DRAFT_LINES[i] ?? '')
    return real && draft ? line.replace(real, draft) : line
  })
}

describe('actionAge', () => {
  it('counts whole local days since the stamp; stale only past the threshold', () => {
    expect(actionAge('2026-09-18', 14, '2026-10-02')).toEqual({ added: '2026-09-18', age_days: 14, stale: false })
    expect(actionAge('2026-09-17', 14, '2026-10-02')).toEqual({ added: '2026-09-17', age_days: 15, stale: true })
  })

  it('undated is stale with no age', () => {
    expect(actionAge(null, 14, '2026-10-02')).toEqual({ added: null, age_days: null, stale: true })
  })

  it('counts across a month and a year boundary', () => {
    expect(actionAge('2025-12-31', 14, '2026-01-01').age_days).toBe(1)
    expect(actionAge('2026-02-28', 14, '2026-03-01').age_days).toBe(1)
  })
})

describe('read marks stale lines', () => {
  it('reproduces the read-project draft\'s Next Actions: fresh, stale with age, stale undated', async () => {
    const slug = await draftEntity()
    const lines = actionLinesOf(await cmdRead(os, [slug]))
    expect(withDraftHandles(lines)).toEqual(DRAFT_LINES)
  })

  it('marks at full depth too', async () => {
    const slug = await draftEntity()
    expect(withDraftHandles(actionLinesOf(await cmdRead(os, [slug, '--depth', 'full'])))).toEqual(DRAFT_LINES)
  })

  it('a custom staleness-days moves the threshold', async () => {
    const lax = actionLinesOf(await cmdRead(os, [await draftEntity(['staleness-days: 90'])]))
    expect(lax[1]).toMatch(/\(added 2026-08-01\)$/)
    expect(lax[2]).toMatch(/ · stale, undated$/)

    const strict = actionLinesOf(await cmdRead(os, [await draftEntity(['staleness-days: 5'])]))
    expect(strict[0]).toMatch(/\(added 2026-09-25\) · stale 7d$/)
  })

  it('an entity marked done still renders the marks', async () => {
    const slug = await draftEntity()
    await os.update(slug, { status: 'done' })
    expect(withDraftHandles(actionLinesOf(await cmdRead(os, [slug])))).toEqual(DRAFT_LINES)
  })

  it('a ticked line is never marked', async () => {
    const slug = await draftEntity()
    const ticked = actionLinesOf(await cmdRead(os, [slug])).filter(l => l.startsWith('- [x]'))
    expect(ticked).toEqual(['- [x] Ship the token endpoint (added 2026-09-10)'])
  })
})

describe('read --json', () => {
  it('open actions are {handle, text, added, age_days, stale}; undated gives null added and age, stale true', async () => {
    const slug = await draftEntity()
    const handles = actionLinesOf(await cmdRead(os, [slug])).map(handleOf)
    const json = JSON.parse(await cmdRead(os, [slug], { json: true }))
    expect(json.actions).toEqual([
      { handle: handles[0], text: 'Migrate the mobile client to the token endpoint', added: '2026-09-25', age_days: 7, stale: false },
      { handle: handles[1], text: 'Remove the cookie fallback', added: '2026-08-01', age_days: 62, stale: true },
      { handle: handles[2], text: 'Ask security about refresh lifetime', added: null, age_days: null, stale: true },
      { text: 'Ship the token endpoint' },
    ])
  })
})

describe('update reminds of the stale lines that remain', () => {
  it('equals the update-output draft\'s stale render for the same inputs', async () => {
    const slug = await draftEntity()
    const [fresh] = actionLinesOf(await cmdRead(os, [slug])).map(handleOf)
    const out = await cmdUpdate(os, [slug, '--log', 'progress: Web client switched', '--complete-action', fresh!, '--add-action', 'Ask legal about retention'])
    const handles = actionLinesOf(await cmdRead(os, [slug])).flatMap(l => handleOf(l) ?? [])
    // The draft's handles stand for the two stale lines' own.
    const draft = DRAFT_REMINDER.replace(/auth-refactor/g, slug).replace('a3f9', handles[0]!).replace('7c21', handles[1]!)
    expect(out).toBe(draft)
  })

  it('prints nothing more when no stale line remains', async () => {
    const slug = await os.create('entity', `Fresh ${++seq}`, { type: 'entity', add_action: 'Something new' })
    expect(await cmdUpdate(os, [slug, '--add-action', 'Something else'])).toBe(`Updated ${slug}: 1 action added.`)
  })

  it('ticking a stale line drops it from the reminder in the same output', async () => {
    const slug = await draftEntity()
    const [, stale, undated] = actionLinesOf(await cmdRead(os, [slug])).map(handleOf)
    const out = await cmdUpdate(os, [slug, '--complete-action', stale!])
    expect(out).toBe(`Updated ${slug}: 1 action ticked.\n1 stale action remains: ${undated}. Tick what landed, drop what is dead.`)
  })

  it('a single remaining stale line, once removed, leaves no reminder', async () => {
    const slug = await draftEntity()
    const [, stale, undated] = actionLinesOf(await cmdRead(os, [slug])).map(handleOf)
    await os.update(slug, { complete_action: stale! })
    expect(await cmdUpdate(os, [slug, '--remove-action', undated!])).toBe(`Updated ${slug}: 1 action removed.`)
  })

  it('reminds on a done entity too', async () => {
    const slug = await draftEntity()
    expect(await cmdUpdate(os, [slug, '--status', 'done'])).toMatch(/\n2 stale actions remain: [0-9a-f]+, [0-9a-f]+\. Tick what landed, drop what is dead\.$/)
  })

  it('a read failing after the write drops the reminder, not the success', async () => {
    const stub = {
      update: async () => ({}),
      read: async () => { throw new Error('disk gone') },
    } as unknown as Hafez
    expect(await cmdUpdate(stub, ['s', '--add-action', 'x'])).toBe('Updated s: 1 action added.')
  })

  it('a knowledge note gets no reminder', async () => {
    const slug = await os.create('knowledge', `Stale Insight ${++seq}`, { synthesis: 'Held.' })
    expect(await cmdUpdate(os, [slug, '--add-evidence', 'Seen again'])).toBe(`Updated ${slug}: evidence added.`)
  })
})
