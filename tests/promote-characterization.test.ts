// tests/promote-characterization.test.ts
// Pins promoteCore's body-splitting behavior BEFORE it moves onto Document
// (S2 of plans/2026-08-07-mutation-spine-series.md). The `BUG:` tests pin
// known substring-match defects — each flip is an explicit, reviewed bugfix
// in the commit that lands the Document ops, mirroring the C3 method.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createHafez } from '../src/index.js'
import { parseFilePath } from '../src/vault.js'
import { countSessionLogEntries } from '../src/document.js'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createMemoryJournal } from './helpers/memory-journal.js'

const TMP = join(tmpdir(), 'hafez-test-promo-char-' + Date.now())
const VAULT = join(TMP, 'vault')

beforeAll(() => {
  mkdirSync(join(VAULT, 'entities'), { recursive: true })
  mkdirSync(join(VAULT, 'knowledge'), { recursive: true })
})
afterAll(() => rmSync(TMP, { recursive: true, force: true }))

function makeOS() {
  return createHafez({ vaultPath: VAULT, persistence: createMemoryJournal() })
}

describe('promote body handling (characterization)', () => {
  it('capture → project: Notes renamed to Purpose, Goals inserted, promotion logged', async () => {
    const os = makeOS()
    await os.capture('Promo Plain', 'the raw notes')
    await os.promote('promo-plain', 'project')
    const { body } = parseFilePath(join(VAULT, 'entities/promo-plain.md'))
    expect(body).toMatch(/^## Purpose$/m)
    expect(body).not.toMatch(/^## Notes$/m)
    expect(body).toMatch(/^## Goals$/m)
    expect(body.indexOf('## Purpose')).toBeLessThan(body.indexOf('## Goals'))
    expect(body).toMatch(/^## Session Log$/m)
    expect(body).toContain('Summary: Promoted from capture to project')
    expect(countSessionLogEntries(body)).toBe(1)
    expect(body).toContain('the raw notes')
  })

  it('entity → project: Context renamed to Purpose, Goals inserted after it', async () => {
    const os = makeOS()
    await os.create('entity', 'Promo Entity', { type: 'entity' })
    await os.promote('promo-entity', 'project')
    const { body } = parseFilePath(join(VAULT, 'entities/promo-entity.md'))
    expect(body).toMatch(/^## Purpose$/m)
    expect(body).not.toMatch(/^## Context$/m)
    expect(body).toMatch(/^## Goals$/m)
    expect(body.indexOf('## Purpose')).toBeLessThan(body.indexOf('## Goals'))
    expect(countSessionLogEntries(body)).toBe(1)
  })

  // FIXED (was BUG): a quoted '## Goals' mention suppressed the section via
  // String.includes — ensureSection only sees structural headings.
  it('a quoted "## Goals" mention in Notes no longer suppresses the Goals section', async () => {
    const os = makeOS()
    await os.capture('Promo Goals Mention', 'the ## Goals heading convention is discussed here')
    await os.promote('promo-goals-mention', 'project')
    const { body } = parseFilePath(join(VAULT, 'entities/promo-goals-mention.md'))
    expect(body).toMatch(/^## Goals$/m)
    // The quoted mention stays untouched inside the renamed Notes content
    expect(body).toContain('the ## Goals heading convention is discussed here')
  })

  // FIXED (was BUG): lastIndexOf spliced the promotion entry into a quoted
  // '## Session Log' mention mid-paragraph — prependSessionLogEntry targets
  // the real structural section, creating it when absent.
  it('a quoted "## Session Log" mention no longer hijacks the promotion log entry', async () => {
    const os = makeOS()
    await os.capture('Promo Log Mention', 'see the ## Session Log convention for details')
    await os.promote('promo-log-mention', 'entity')
    const { body } = parseFilePath(join(VAULT, 'entities/promo-log-mention.md'))
    expect(body).toMatch(/^## Session Log$/m)
    expect(countSessionLogEntries(body)).toBe(1)
    // The quoted mention stays intact — no entry spliced into the paragraph
    expect(body).toContain('see the ## Session Log convention for details')
  })
})
