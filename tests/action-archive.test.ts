// tests/action-archive.test.ts
// Archive on write (#87): a removed action, and the oldest ticked actions once
// an entity holds ten or more, move to the entity's archive log — the file the
// session log archives to. On write only, never on read; the archive rides the
// entity write's commit and rolls back with it. Asserted at the command-function
// seam over a memory-Journal factory: the string a command returns and the
// vault files afterwards.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createHafez } from '../src/index.js'
import { createMemoryJournal, type MemoryJournal } from './helpers/memory-journal.js'
import { cmdRead, cmdUpdate } from '../src/cli/commands.js'
import { digest } from '../src/digest.js'
import { parseSessionLogHeading } from '../src/document.js'
import { localDay } from '../src/dates.js'
import type { Hafez } from '../src/types.js'

const TMP = join(tmpdir(), 'hafez-test-action-archive-' + Date.now())
const VAULT = join(TMP, 'vault')

let journal: MemoryJournal
let os: Hafez

beforeAll(() => {
  mkdirSync(join(VAULT, 'entities'), { recursive: true })
  mkdirSync(join(VAULT, 'knowledge'), { recursive: true })
  journal = createMemoryJournal()
  os = createHafez({ vaultPath: VAULT, persistence: journal })
})
afterAll(() => rmSync(TMP, { recursive: true, force: true }))

const entityRel = (slug: string) => `entities/${slug}.md`
const archiveRel = (slug: string) => `entities/archive/${slug}-log.md`
const fileOf = (slug: string) => readFileSync(join(VAULT, entityRel(slug)), 'utf-8')
const archiveOf = (slug: string) => readFileSync(join(VAULT, archiveRel(slug)), 'utf-8')
const archiveExists = (slug: string) => existsSync(join(VAULT, archiveRel(slug)))
const actionLines = (text: string) => text.split('\n').filter(l => /^- \[[ x]\] /.test(l))
const STAMP = `(added ${localDay()})`

let seq = 0
async function entityWith(actions: string[]): Promise<string> {
  const slug = await os.create('entity', `Archive ${++seq}`, { type: 'project' })
  if (actions.length) await os.update(slug, { add_actions: actions })
  return slug
}

/** Hand-edit ticked lines in below the entity's 'Open line' — a list no write has trimmed yet. */
function handTick(slug: string, ticked: string): void {
  writeFileSync(join(VAULT, entityRel(slug)), fileOf(slug).replace(/(- \[ \] Open line.*)/, `$1\n${ticked}`))
}

/** An entity with `n` ticked actions (T1…Tn, oldest first) and one open line. */
async function entityWithTicked(n: number): Promise<string> {
  const ticked = Array.from({ length: n }, (_, i) => `T${i + 1} done`)
  const slug = await entityWith([...ticked, 'Still open'])
  for (const t of ticked) await os.update(slug, { complete_action: t })
  return slug
}

describe('--remove-action archives the removed line', () => {
  it('appends the line, stamp included, to the archive log; the entity no longer shows it', async () => {
    const slug = await entityWith(['Drop the legacy flag', 'Keep this one'])
    await cmdUpdate(os, [slug, '--remove-action', 'legacy flag'])

    expect(fileOf(slug)).not.toContain('Drop the legacy flag')
    expect(fileOf(slug)).toContain('Keep this one')
    expect(await cmdRead(os, [slug])).not.toContain('Drop the legacy flag')
    expect(actionLines(archiveOf(slug))).toEqual([`- [ ] Drop the legacy flag ${STAMP}`])
  })

  it('writes the archive as a session-log entry stream, so a merge unions it like the session log archive', async () => {
    const slug = await entityWith(['Gone soon', 'Stays'])
    await cmdUpdate(os, [slug, '--remove-action', 'Gone soon'])
    const first = archiveOf(slug).trim().split('\n')[0]
    expect(parseSessionLogHeading(first)).not.toBeNull()
  })

  it('archives the line even when the removal empties the list', async () => {
    const slug = await entityWith(['Only one'])
    await cmdUpdate(os, [slug, '--remove-action', 'Only one'])
    expect(fileOf(slug)).not.toContain('## Next Actions')
    expect(actionLines(archiveOf(slug))).toEqual([`- [ ] Only one ${STAMP}`])
  })

  it('appends rather than overwrites on a later removal', async () => {
    const slug = await entityWith(['First out', 'Second out', 'Stays'])
    await cmdUpdate(os, [slug, '--remove-action', 'First out'])
    await cmdUpdate(os, [slug, '--remove-action', 'Second out'])
    expect(actionLines(archiveOf(slug))).toEqual([`- [ ] First out ${STAMP}`, `- [ ] Second out ${STAMP}`])
  })

  // #158: the query flags repeat like --add-action — one update, one commit.
  it('repeated --remove-action and --complete-action apply together in one commit, each removed line archived', async () => {
    const slug = await entityWith(['Drop one', 'Tick one', 'Drop two', 'Stays'])
    const commits = journal.commits.length
    const out = await cmdUpdate(os, [slug, '--remove-action', 'Drop one', '--remove-action', 'Drop two', '--complete-action', 'Tick one'])
    expect(out).toBe(`Updated ${slug}: 1 action ticked, 2 actions removed.`)
    expect(journal.commits.length).toBe(commits + 1)
    expect(actionLines(fileOf(slug))).toEqual([`- [x] Tick one ${STAMP}`, `- [ ] Stays ${STAMP}`])
    expect(actionLines(archiveOf(slug))).toEqual([`- [ ] Drop one ${STAMP}`, `- [ ] Drop two ${STAMP}`])
  })
})

describe('ticked overflow', () => {
  it('nine ticked lines stay put and write no archive', async () => {
    const slug = await entityWithTicked(9)
    expect(actionLines(fileOf(slug)).filter(l => l.startsWith('- [x]'))).toHaveLength(9)
    expect(archiveExists(slug)).toBe(false)
  })

  it('the tick that brings ticked lines to ten moves the oldest to the archive log', async () => {
    const slug = await entityWithTicked(9)
    await os.update(slug, { add_action: 'Another open' })
    await cmdUpdate(os, [slug, '--complete-action', 'Still open'])
    expect(actionLines(archiveOf(slug))).toEqual([`- [x] T1 done ${STAMP}`])
  })

  it('keeps the newest nine ticked lines on the entity, in order', async () => {
    const slug = await entityWithTicked(9)
    await os.update(slug, { add_action: 'Another open' })
    await cmdUpdate(os, [slug, '--complete-action', 'Still open'])
    const ticked = actionLines(fileOf(slug)).filter(l => l.startsWith('- [x]'))
    expect(ticked).toEqual([...Array.from({ length: 8 }, (_, i) => `- [x] T${i + 2} done ${STAMP}`), `- [x] Still open ${STAMP}`])
    expect(actionLines(fileOf(slug))).toContain(`- [ ] Another open ${STAMP}`)
    expect(actionLines(archiveOf(slug))).toEqual([`- [x] T1 done ${STAMP}`])
  })

  it('moves every ticked line beyond the limit, oldest first, when the entity already held more', async () => {
    const slug = await entityWith(['Open line'])
    const ticked = Array.from({ length: 12 }, (_, i) => `- [x] Old ${i + 1}`).join('\n')
    handTick(slug, ticked)

    await cmdUpdate(os, [slug, '--add-action', 'New open'])
    expect(actionLines(archiveOf(slug))).toEqual(['- [x] Old 1', '- [x] Old 2', '- [x] Old 3'])
    expect(actionLines(fileOf(slug)).filter(l => l.startsWith('- [x]'))).toEqual(
      Array.from({ length: 9 }, (_, i) => `- [x] Old ${i + 4}`),
    )
  })

  it('does not count a ticked line quoted outside Next Actions', async () => {
    const slug = await entityWithTicked(8)
    await os.update(slug, { brief: 'Quoted:\n- [x] Q1\n- [x] Q2\n- [x] Q3' })
    await cmdUpdate(os, [slug, '--add-action', 'More'])
    expect(archiveExists(slug)).toBe(false)
    expect(fileOf(slug)).toContain('- [x] Q1')
  })
})

describe('lines the section takes with it', () => {
  it('ticking the last open line archives every ticked line as the section goes, oldest first', async () => {
    const slug = await entityWithTicked(3)
    await cmdUpdate(os, [slug, '--complete-action', 'Still open'])
    expect(fileOf(slug)).not.toContain('## Next Actions')
    expect(actionLines(archiveOf(slug))).toEqual([
      `- [x] T1 done ${STAMP}`, `- [x] T2 done ${STAMP}`, `- [x] T3 done ${STAMP}`, `- [x] Still open ${STAMP}`,
    ])
  })

  it('removing the last open line archives it and the ticked lines beside it', async () => {
    const slug = await entityWithTicked(2)
    await cmdUpdate(os, [slug, '--remove-action', 'Still open'])
    expect(fileOf(slug)).not.toContain('## Next Actions')
    expect(actionLines(archiveOf(slug))).toEqual([
      `- [ ] Still open ${STAMP}`, `- [x] T1 done ${STAMP}`, `- [x] T2 done ${STAMP}`,
    ])
  })

  it('at the limit, the overflow and the pruned lines all reach the archive in order', async () => {
    const slug = await entityWithTicked(9)
    await cmdUpdate(os, [slug, '--complete-action', 'Still open'])
    expect(actionLines(archiveOf(slug))).toEqual([
      ...Array.from({ length: 9 }, (_, i) => `- [x] T${i + 1} done ${STAMP}`), `- [x] Still open ${STAMP}`,
    ])
  })

  it('--clear-actions archives the whole list, open and ticked', async () => {
    const slug = await entityWithTicked(1)
    await cmdUpdate(os, [slug, '--clear-actions'])
    expect(fileOf(slug)).not.toContain('## Next Actions')
    expect(actionLines(archiveOf(slug))).toEqual([`- [x] T1 done ${STAMP}`, `- [ ] Still open ${STAMP}`])
  })

  it('clear plus add rebuilds the list and archives the old one', async () => {
    const slug = await entityWith(['Old plan'])
    await os.update(slug, { clear_actions: true, add_actions: ['New plan'] })
    expect(actionLines(fileOf(slug))).toEqual([`- [ ] New plan ${STAMP}`])
    expect(actionLines(archiveOf(slug))).toEqual([`- [ ] Old plan ${STAMP}`])
  })
})

describe('lines nested under an action travel with it (#129)', () => {
  const NOTE = '  - blocked on the mobile team'

  /** Hand-write `note` under the action whose text is `action`. */
  function nest(slug: string, action: string, note: string): void {
    const file = fileOf(slug)
    const at = file.indexOf(action)
    const eol = file.indexOf('\n', at)
    writeFileSync(join(VAULT, entityRel(slug)), file.slice(0, eol) + '\n' + note + file.slice(eol))
  }

  it('ticking the last open line by its Handle archives the note with it as the section goes', async () => {
    const slug = await entityWith(['Ship v2'])
    nest(slug, 'Ship v2', NOTE)
    const handle = /- \[ \] ([0-9a-f]{4,})  Ship v2/.exec(await cmdRead(os, [slug]))![1]
    await cmdUpdate(os, [slug, '--complete-action', handle])
    expect(fileOf(slug)).not.toContain('## Next Actions')
    expect(archiveOf(slug)).toContain(`- [x] Ship v2 ${STAMP}\n${NOTE}\n`)
  })

  it('--remove-action archives the note with its line and orphans nothing under the next item', async () => {
    const slug = await entityWith(['Ship v2', 'Write docs'])
    nest(slug, 'Ship v2', NOTE)
    await cmdUpdate(os, [slug, '--remove-action', 'Ship v2'])
    expect(fileOf(slug)).not.toContain('blocked on the mobile team')
    expect(fileOf(slug)).toContain(`- [ ] Write docs ${STAMP}`)
    expect(archiveOf(slug)).toContain(`- [ ] Ship v2 ${STAMP}\n${NOTE}\n`)
  })

  it('a ticked line past the limit takes its note to the archive; the next ticked line keeps its own', async () => {
    const slug = await entityWith(['Open line'])
    const ticked = Array.from({ length: 10 }, (_, i) => `- [x] Old ${i + 1}`)
    ticked.splice(1, 0, '  - shipped in 1.4')
    ticked.splice(3, 0, '  - shipped in 1.5')
    handTick(slug, ticked.join('\n'))
    await cmdUpdate(os, [slug, '--add-action', 'New open'])
    expect(archiveOf(slug)).toContain('- [x] Old 1\n  - shipped in 1.4\n')
    expect(fileOf(slug)).not.toContain('shipped in 1.4')
    expect(fileOf(slug)).toContain('- [x] Old 2\n  - shipped in 1.5\n')
  })

  it('--clear-actions archives every note with its line', async () => {
    const slug = await entityWith(['Ship v2', 'Write docs'])
    nest(slug, 'Ship v2', NOTE)
    nest(slug, 'Write docs', '  see the style guide')
    await cmdUpdate(os, [slug, '--clear-actions'])
    expect(archiveOf(slug)).toContain(`- [ ] Ship v2 ${STAMP}\n${NOTE}\n- [ ] Write docs ${STAMP}\n  see the style guide\n`)
  })

  it('a kept action keeps its note directly beneath it when another action is added or ticked', async () => {
    const slug = await entityWith(['Write docs', 'Ship v2'])
    nest(slug, 'Ship v2', NOTE)
    await cmdUpdate(os, [slug, '--add-action', 'Plan v3'])
    await cmdUpdate(os, [slug, '--complete-action', 'Write docs'])
    expect(fileOf(slug)).toContain(`- [ ] Ship v2 ${STAMP}\n${NOTE}\n`)
    expect(archiveExists(slug)).toBe(false)
  })
})

describe('read never writes the archive', () => {
  it('reading an entity over the limit leaves the vault untouched', async () => {
    const slug = await entityWith(['Open line'])
    const ticked = Array.from({ length: 11 }, (_, i) => `- [x] Hand ${i + 1}`).join('\n')
    handTick(slug, ticked)
    const before = fileOf(slug)
    const commits = journal.commits.length

    await cmdRead(os, [slug])
    await cmdRead(os, [slug, '--depth', 'full'])
    await cmdRead(os, [slug], { json: true })

    expect(archiveExists(slug)).toBe(false)
    expect(fileOf(slug)).toBe(before)
    expect(journal.commits.length).toBe(commits)
  })
})

describe('the archive rides the entity write', () => {
  it('lands in the same commit as the entity', async () => {
    const slug = await entityWith(['Committed out', 'Stays'])
    await cmdUpdate(os, [slug, '--remove-action', 'Committed out'])
    const last = journal.commits[journal.commits.length - 1]
    expect(last.written).toEqual(expect.arrayContaining([entityRel(slug), archiveRel(slug)]))
  })

  it('is left out of a commit that archived nothing', async () => {
    const slug = await entityWith(['Out', 'Stays'])
    await cmdUpdate(os, [slug, '--remove-action', 'Out'])
    await cmdUpdate(os, [slug, '--brief', 'Unrelated'])
    const last = journal.commits[journal.commits.length - 1]
    expect(last.written).toEqual([entityRel(slug)])
  })

  it('rolls back with the entity when the commit fails', async () => {
    const failing = createMemoryJournal()
    const vault = join(TMP, 'rollback-vault')
    mkdirSync(join(vault, 'entities'), { recursive: true })
    const hz = createHafez({ vaultPath: vault, persistence: failing })
    const slug = await hz.create('entity', 'Rollback Archive', { type: 'project' })
    await hz.update(slug, { add_actions: ['Doomed removal', 'Stays'] })
    const entityFile = join(vault, entityRel(slug))
    const before = readFileSync(entityFile, 'utf-8')

    failing.commit = async () => { throw new Error('index.lock held') }
    await expect(hz.update(slug, { remove_action: 'Doomed removal' })).rejects.toThrow('index.lock held')

    expect(readFileSync(entityFile, 'utf-8')).toBe(before)
    expect(existsSync(join(vault, archiveRel(slug)))).toBe(false)
  })

  it('rolls back an archive that already existed to its prior content', async () => {
    const failing = createMemoryJournal()
    const vault = join(TMP, 'rollback-vault-2')
    mkdirSync(join(vault, 'entities'), { recursive: true })
    const hz = createHafez({ vaultPath: vault, persistence: failing })
    const slug = await hz.create('entity', 'Rollback Archive Two', { type: 'project' })
    await hz.update(slug, { add_actions: ['First out', 'Second out', 'Stays'] })
    await hz.update(slug, { remove_action: 'First out' })
    const archiveFile = join(vault, archiveRel(slug))
    const before = readFileSync(archiveFile, 'utf-8')

    failing.commit = async () => { throw new Error('index.lock held') }
    await expect(hz.update(slug, { remove_action: 'Second out' })).rejects.toThrow()
    expect(readFileSync(archiveFile, 'utf-8')).toBe(before)
  })
})

describe('batch and digest behave like the CLI', () => {
  it('batch remove_action archives the removed line in the batch commit', async () => {
    const slug = await entityWith(['Batch drop', 'Stays'])
    await os.batch([{ op: 'update', slug, fields: { remove_action: 'Batch drop' } }])
    expect(fileOf(slug)).not.toContain('Batch drop')
    expect(actionLines(archiveOf(slug))).toEqual([`- [ ] Batch drop ${STAMP}`])
    const last = journal.commits[journal.commits.length - 1]
    expect(last.message).toContain('batch')
    expect(last.written).toEqual(expect.arrayContaining([entityRel(slug), archiveRel(slug)]))
  })

  it('batch ticks past the limit archive the oldest, across ops of one batch', async () => {
    const ticked = Array.from({ length: 11 }, (_, i) => `B${i + 1} done`)
    const slug = await entityWith([...ticked, 'Open'])
    await os.batch(ticked.map(t => ({ op: 'update' as const, slug, fields: { complete_action: t } })))
    expect(actionLines(archiveOf(slug))).toEqual([`- [x] B1 done ${STAMP}`, `- [x] B2 done ${STAMP}`])
    expect(actionLines(fileOf(slug)).filter(l => l.startsWith('- [x]'))).toHaveLength(9)
  })

  it('a digest save onto an entity over the limit archives the overflow', async () => {
    const slug = await entityWith(['Open line'])
    const ticked = Array.from({ length: 10 }, (_, i) => `- [x] Digest ${i + 1}`).join('\n')
    handTick(slug, ticked)

    const ops = digest(
      { session_date: localDay(), entities_touched: [slug], decisions: [], narrative: 'Worked on it', agent: 'Test' },
      new Set([slug]),
    )
    await os.batch(ops)
    expect(actionLines(archiveOf(slug))).toEqual(['- [x] Digest 1'])
    expect(fileOf(slug)).not.toContain('- [x] Digest 1\n')
  })
})
