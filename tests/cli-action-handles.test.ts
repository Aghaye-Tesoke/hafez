// tests/cli-action-handles.test.ts
// Handles on open next actions (#83): `read` renders `- [ ] <handle>  <text>`
// on each open line, `--complete-action` / `--remove-action` take a Handle or
// text, `read --json` carries actions as `{handle, text}`. Asserted at the
// command-function seam over a memory-Journal factory: the string a command
// returns and the vault file afterwards.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createHash } from 'crypto'
import { createHafez } from '../src/index.js'
import { createMemoryJournal } from './helpers/memory-journal.js'
import { cmdRead, cmdUpdate } from '../src/cli/commands.js'
import { localDay } from '../src/dates.js'
import type { Hafez } from '../src/types.js'

const TMP = join(tmpdir(), 'hafez-test-cli-action-handles-' + Date.now())
const VAULT = join(TMP, 'vault')

let os: Hafez

beforeAll(() => {
  mkdirSync(join(VAULT, 'entities'), { recursive: true })
  mkdirSync(join(VAULT, 'knowledge'), { recursive: true })
  os = createHafez({ vaultPath: VAULT, persistence: createMemoryJournal() })
})
afterAll(() => rmSync(TMP, { recursive: true, force: true }))

const fileOf = (slug: string) => readFileSync(join(VAULT, 'entities', `${slug}.md`), 'utf-8')
const OPEN_LINE = /^- \[ \] ([0-9a-f]+) {2}(.+)$/

/** Handle → rendered text (stamp included) of every open line `read` shows. */
async function handlesOf(slug: string): Promise<Map<string, string>> {
  const out = await cmdRead(os, [slug])
  const map = new Map<string, string>()
  for (const line of out.split('\n')) {
    const m = OPEN_LINE.exec(line)
    if (m) map.set(m[1], m[2])
  }
  return map
}

function handleFor(handles: Map<string, string>, text: string): string {
  const hit = [...handles].find(([, t]) => t.startsWith(text))
  if (!hit) throw new Error(`no handle for "${text}"`)
  return hit[0]
}

let seq = 0
async function entityWith(actions: string[]): Promise<string> {
  const slug = await os.create('entity', `Handles ${++seq}`, { type: 'project' })
  if (actions.length) await os.update(slug, { add_actions: actions })
  return slug
}

describe('read renders Handles', () => {
  it('puts a bare-hex handle and two spaces in front of each open line; ticked lines carry none', async () => {
    const slug = await entityWith(['Migrate the mobile client', 'Remove the cookie fallback', 'Ship the token endpoint'])
    await os.update(slug, { complete_action: 'Ship the token' })

    const out = await cmdRead(os, [slug])
    const actionLines = out.split('\n').filter(l => l.startsWith('- ['))
    expect(actionLines).toHaveLength(3)
    expect(actionLines[0]).toMatch(/^- \[ \] [0-9a-f]{4,}  Migrate the mobile client \(added \d{4}-\d{2}-\d{2}\)$/)
    expect(actionLines[1]).toMatch(/^- \[ \] [0-9a-f]{4,}  Remove the cookie fallback \(added \d{4}-\d{2}-\d{2}\)$/)
    expect(actionLines[2]).toMatch(/^- \[x\] Ship the token endpoint \(added \d{4}-\d{2}-\d{2}\)$/)
  })

  it('never stores the handle in the file', async () => {
    const slug = await entityWith(['Write the runbook'])
    const before = fileOf(slug)
    const [handle] = (await handlesOf(slug)).keys()
    expect(fileOf(slug)).toBe(before)
    expect(before).not.toContain(handle)
  })

  it('renders handles at full depth too, and only inside Next Actions', async () => {
    const slug = await entityWith(['Audit the logs'])
    await os.update(slug, { brief: 'Quoted elsewhere:\n- [ ] Audit the logs' })
    const out = await cmdRead(os, [slug, '--depth', 'full'])
    expect(out).toContain('Quoted elsewhere:\n- [ ] Audit the logs\n')
    expect(out).toMatch(/^- \[ \] [0-9a-f]{4,}  Audit the logs/m)
  })

  it('two reads of an unchanged entity give the same handles', async () => {
    const slug = await entityWith(['One', 'Two', 'Three'])
    expect([...(await handlesOf(slug)).keys()]).toEqual([...(await handlesOf(slug)).keys()])
  })

  it('adding an action keeps existing handles', async () => {
    const slug = await entityWith(['Keep me', 'And me'])
    const before = await handlesOf(slug)
    await os.update(slug, { add_action: 'A newcomer' })
    const after = await handlesOf(slug)
    for (const [h, text] of before) expect(after.get(h)).toBe(text)
    expect(after.size).toBe(3)
  })

  it('identical open lines still get distinct handles', async () => {
    const slug = await entityWith(['Same text'])
    const path = join(VAULT, 'entities', `${slug}.md`)
    writeFileSync(path, fileOf(slug).replace(/(- \[ \] Same text[^\n]*)/, '$1\n$1'))
    const handles = await handlesOf(slug)
    expect(handles.size).toBe(2)
  })

  it('handles are unique, at least four hex, and only as long as a shared prefix forces', async () => {
    // Enough lines that four-hex prefixes collide (birthday bound over 16^4).
    const texts = Array.from({ length: 800 }, (_, i) => `Task number ${i}`)
    const slug = await entityWith(texts)
    const handles = [...(await handlesOf(slug)).keys()]

    expect(handles).toHaveLength(texts.length)
    expect(new Set(handles).size).toBe(handles.length)
    for (const h of handles) expect(h.length).toBeGreaterThanOrEqual(4)
    // A handle longer than four is longer because its one-shorter prefix is
    // shared — and a line sharing it carries a handle at least as long.
    const longer = handles.filter(h => h.length > 4)
    expect(longer.length).toBeGreaterThan(0)
    for (const h of longer) {
      const shorter = h.slice(0, -1)
      expect(handles.some(o => o !== h && o.startsWith(shorter))).toBe(true)
    }
    // Every other handle stays at the minimum: none is padded beyond need.
    for (const h of handles.filter(h => h.length === 4)) {
      expect(handles.filter(o => o.startsWith(h))).toEqual([h])
    }
  })
})

describe('read --json', () => {
  it('returns actions as objects; open ones carry their handle, ticked ones none', async () => {
    const slug = await entityWith(['Open item', 'Done item'])
    await os.update(slug, { complete_action: 'Done item' })
    const handles = await handlesOf(slug)
    const json = JSON.parse(await cmdRead(os, [slug], { json: true }))
    expect(json.actions).toEqual([
      { handle: handleFor(handles, 'Open item'), text: 'Open item', added: localDay(), age_days: 0, stale: false },
      { text: 'Done item' },
    ])
  })

  it('an entity with no actions has an empty list', async () => {
    const slug = await entityWith([])
    const json = JSON.parse(await cmdRead(os, [slug], { json: true }))
    expect(json.actions).toEqual([])
  })
})

describe('--complete-action / --remove-action accept a Handle', () => {
  it('--complete-action <handle> ticks that line', async () => {
    const slug = await entityWith(['First thing', 'Second thing'])
    const handle = handleFor(await handlesOf(slug), 'Second thing')
    const out = await cmdUpdate(os, [slug, '--complete-action', handle])
    expect(out).toBe(`Updated ${slug}: 1 action ticked.`)
    expect(fileOf(slug)).toMatch(/^- \[x\] Second thing/m)
    expect(fileOf(slug)).toMatch(/^- \[ \] First thing/m)
  })

  it('--remove-action <handle> removes that line', async () => {
    const slug = await entityWith(['Stay', 'Go away'])
    const handle = handleFor(await handlesOf(slug), 'Go away')
    const out = await cmdUpdate(os, [slug, '--remove-action', handle])
    expect(out).toBe(`Updated ${slug}: 1 action removed.`)
    expect(fileOf(slug)).not.toContain('Go away')
    expect(fileOf(slug)).toMatch(/^- \[ \] Stay/m)
  })

  it('a value that is not an open handle falls through to text matching', async () => {
    const slug = await entityWith(['Rotate the keys', 'Patch the server'])
    await cmdUpdate(os, [slug, '--complete-action', 'rotate'])
    expect(fileOf(slug)).toMatch(/^- \[x\] Rotate the keys/m)
  })

  it('a prefix shorter than four hex is not a handle, and matches no text', async () => {
    const slug = await entityWith(['Only line', 'Other line'])
    const handle = handleFor(await handlesOf(slug), 'Only line')
    await expect(cmdUpdate(os, [slug, '--complete-action', handle.slice(0, 3)])).rejects.toThrow(/No matching action/)
  })

  it('a ticked line has no handle: its old handle no longer names anything', async () => {
    const slug = await entityWith(['Tick me', 'Leave me'])
    const handle = handleFor(await handlesOf(slug), 'Tick me')
    await cmdUpdate(os, [slug, '--complete-action', handle])
    await expect(cmdUpdate(os, [slug, '--remove-action', handle])).rejects.toThrow(/No matching action/)
  })

  it('a handle names its line even when that text is a substring of another line', async () => {
    const slug = await entityWith(['Deploy', 'Deploy fix'])
    const handles = await handlesOf(slug)
    await cmdUpdate(os, [slug, '--complete-action', handleFor(handles, 'Deploy (added')])
    expect(fileOf(slug)).toMatch(/^- \[x\] Deploy \(added/m)
    expect(fileOf(slug)).toMatch(/^- \[ \] Deploy fix/m)
  })

  it('each of two identical lines is ticked or dropped by its own handle', async () => {
    const slug = await entityWith(['Twin', 'Anchor'])
    writeFileSync(join(VAULT, 'entities', `${slug}.md`), fileOf(slug).replace(/(- \[ \] Twin[^\n]*)/, '$1\n$1'))
    const [first, second] = [...(await handlesOf(slug)).keys()]
    await cmdUpdate(os, [slug, '--complete-action', second, '--remove-action', first])
    const lines = fileOf(slug).split('\n').filter(l => l.startsWith('- ['))
    expect(lines).toEqual([expect.stringMatching(/^- \[x\] Twin/), expect.stringMatching(/^- \[ \] Anchor/)])
  })

  it('complete and remove in one op both land when the removed line sits above the ticked one', async () => {
    const slug = await entityWith(['Drop me', 'Tick me', 'Keep me'])
    const handles = await handlesOf(slug)
    await cmdUpdate(os, [slug, '--remove-action', handleFor(handles, 'Drop me'), '--complete-action', handleFor(handles, 'Tick me')])
    const lines = fileOf(slug).split('\n').filter(l => l.startsWith('- ['))
    expect(lines).toEqual([expect.stringMatching(/^- \[x\] Tick me/), expect.stringMatching(/^- \[ \] Keep me/)])
  })

  it('batch update takes a handle the same way', async () => {
    const slug = await entityWith(['Batch one', 'Batch two'])
    const handle = handleFor(await handlesOf(slug), 'Batch two')
    await os.batch([{ op: 'update', slug, fields: { complete_action: handle } }])
    expect(fileOf(slug)).toMatch(/^- \[x\] Batch two/m)
  })
})

// Handle drift (#31): a handle is the shortest unique prefix among the open
// lines at render time, so ticking, removing or adding a sibling changes it.
// A query names a line when it is a prefix (four hex or more) of exactly one
// open line's hash, whatever length the current read would render.
describe('a Handle survives a sibling changing', () => {
  /** The hash a handle is cut from; plain ASCII text normalises to itself. */
  const hashOf = (text: string) => createHash('sha256').update(text).digest('hex')

  /** Two action texts whose hashes share their first four hex. */
  function collidingPair(): [string, string] {
    const seen = new Map<string, string>()
    for (let i = 0; ; i++) {
      const text = `Collide ${i}`
      const prefix = hashOf(text).slice(0, 4)
      const other = seen.get(prefix)
      if (other) return [other, text]
      seen.set(prefix, text)
    }
  }

  it('two ticks from one read both land, though the second handle is now longer than rendered', async () => {
    const [a, b] = collidingPair()
    const slug = await entityWith([a, b, 'Bystander'])
    const handles = await handlesOf(slug)
    const [ha, hb] = [handleFor(handles, `${a} (added`), handleFor(handles, `${b} (added`)]
    expect(ha.length).toBeGreaterThan(4)
    expect(hb.length).toBeGreaterThan(4)

    await cmdUpdate(os, [slug, '--complete-action', ha])
    expect((await handlesOf(slug)).has(hb.slice(0, 4))).toBe(true)
    expect(await cmdUpdate(os, [slug, '--complete-action', hb])).toBe(`Updated ${slug}: 1 action ticked.`)
    expect(fileOf(slug)).toMatch(new RegExp(`^- \\[x\\] ${b} `, 'm'))
  })

  it('a remove from an older read lands too', async () => {
    const [a, b] = collidingPair()
    const slug = await entityWith([a, b, 'Bystander'])
    const handles = await handlesOf(slug)
    await cmdUpdate(os, [slug, '--remove-action', handleFor(handles, `${a} (added`)])
    await cmdUpdate(os, [slug, '--remove-action', handleFor(handles, `${b} (added`)])
    expect(fileOf(slug)).not.toContain('Collide')
    expect(fileOf(slug)).toMatch(/^- \[ \] Bystander/m)
  })

  it('any unique prefix of four or more names the line, up to the full hash', async () => {
    const slug = await entityWith(['Prefix one', 'Prefix two', 'Bystander'])
    const full = hashOf('Prefix two')
    expect(handleFor(await handlesOf(slug), 'Prefix two')).toBe(full.slice(0, 4))
    await cmdUpdate(os, [slug, '--complete-action', full.slice(0, 7)])
    await cmdUpdate(os, [slug, '--remove-action', hashOf('Prefix one')])
    expect(fileOf(slug).split('\n').filter(l => l.startsWith('- ['))).toEqual([
      expect.stringMatching(/^- \[x\] Prefix two/), expect.stringMatching(/^- \[ \] Bystander/),
    ])
  })

  it('an add that lengthens a handle: the old four-hex handle now names two lines and is refused, the file untouched', async () => {
    const [a, b] = collidingPair()
    const slug = await entityWith([a])
    const old = handleFor(await handlesOf(slug), a)
    expect(old).toHaveLength(4)
    await os.update(slug, { add_action: b })
    const before = fileOf(slug)

    await expect(cmdUpdate(os, [slug, '--complete-action', old])).rejects.toThrow(new RegExp(`Ambiguous match for "${old}": ${a}, ${b}`))
    expect(fileOf(slug)).toBe(before)
    // The handle the next read shows names it.
    await cmdUpdate(os, [slug, '--complete-action', handleFor(await handlesOf(slug), `${a} (added`)])
    expect(fileOf(slug)).toMatch(new RegExp(`^- \\[x\\] ${a} `, 'm'))
  })

  it('a prefix two open lines share is ambiguous', async () => {
    const [a, b] = collidingPair()
    const slug = await entityWith([a, b])
    const shared = hashOf(a).slice(0, 4)
    await expect(cmdUpdate(os, [slug, '--remove-action', shared])).rejects.toThrow(/Ambiguous match/)
  })

  it('hex that prefixes no open line falls through to text matching', async () => {
    const slug = await entityWith(['Rotate key cafe1234', 'Patch the server'])
    for (const text of ['Rotate key cafe1234', 'Patch the server']) expect(hashOf(text).startsWith('cafe1234')).toBe(false)
    await cmdUpdate(os, [slug, '--complete-action', 'cafe1234'])
    expect(fileOf(slug)).toMatch(/^- \[x\] Rotate key cafe1234/m)
  })

  it('two queries naming one line, by different prefixes, are still an error', async () => {
    const slug = await entityWith(['Same target', 'Elsewhere'])
    const full = hashOf('Same target')
    await expect(cmdUpdate(os, [slug, '--remove-action', full.slice(0, 4), '--complete-action', full.slice(0, 9)]))
      .rejects.toThrow(/both match "Same target"/)
  })
})
