// tests/digest.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { parseDigestInput, digest } from '../src/digest.js'
import { HafezError, type BatchOperation, type Hafez } from '../src/types.js'
import { createHafez, removeTemp } from './helpers/hafez.js'
import { createMemoryJournal } from './helpers/memory-journal.js'
import { cmdRead } from '../src/cli/commands.js'

describe('parseDigestInput', () => {
  it('accepts valid input with all fields', () => {
    const result = parseDigestInput({
      entities_touched: ['simorgh', 'hafez'],
      decisions: ['Merged auth middleware'],
      narrative: 'Focused session on auth rewrite.',
      session_date: '2026-03-29',
      agent: 'claude',
    })
    expect(result.success).toBe(true)
  })

  it('accepts input with empty decisions', () => {
    const result = parseDigestInput({
      entities_touched: ['simorgh'],
      decisions: [],
      narrative: 'Some narrative',
      session_date: '2026-03-29',
    })
    expect(result.success).toBe(true)
  })

  it('accepts input with empty entities_touched', () => {
    const result = parseDigestInput({
      entities_touched: [],
      decisions: [],
      narrative: 'Some narrative',
      session_date: '2026-03-29',
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing narrative', () => {
    const result = parseDigestInput({
      entities_touched: ['simorgh'],
      decisions: [],
      session_date: '2026-03-29',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].path).toContain('narrative')
    }
  })

  it('rejects missing session_date', () => {
    const result = parseDigestInput({
      entities_touched: ['simorgh'],
      decisions: [],
      narrative: 'Some narrative',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].path).toContain('session_date')
    }
  })

  it('rejects missing entities_touched', () => {
    const result = parseDigestInput({
      decisions: [],
      narrative: 'Some narrative',
      session_date: '2026-03-29',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].path).toContain('entities_touched')
    }
  })

  it('detects unknown fields via strict parse', () => {
    const result = parseDigestInput({
      entities_touched: [],
      decisions: [],
      narrative: 'Some narrative',
      session_date: '2026-03-29',
      unknown_field: 'oops',
    })
    // parsing still succeeds but unknown fields are detected
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.unknownFields).toContain('unknown_field')
    }
  })
})

describe('digest()', () => {
  const KNOWN_SLUGS = new Set(['simorgh', 'hafez', 'command-center'])

  it('produces session log updates for each known slug', () => {
    const ops = digest(
      {
        entities_touched: ['simorgh', 'hafez'],
        decisions: ['Merged auth middleware'],
        narrative: 'Focused session on auth rewrite.',
        session_date: '2026-03-29',
        agent: 'claude',
      },
      KNOWN_SLUGS,
    )

    const updates = ops.filter(o => o.op === 'update')
    const slugs = updates.map(o => (o as any).slug)
    expect(slugs).toContain('simorgh')
    expect(slugs).toContain('hafez')
  })

  it('session log entry type is progress', () => {
    const ops = digest(
      {
        entities_touched: ['simorgh'],
        decisions: [],
        narrative: 'Did some work.',
        session_date: '2026-03-29',
        agent: 'claude',
      },
      KNOWN_SLUGS,
    )

    const update = ops.find(o => o.op === 'update' && (o as any).slug === 'simorgh') as any
    expect(update).toBeDefined()
    expect(update.fields.session_log.type).toBe('progress')
    expect(update.fields.session_log.agent).toBe('claude')
    expect(typeof update.fields.session_log.summary).toBe('string')
    expect(update.fields.session_log.summary.length).toBeGreaterThan(0)
  })

  it('session log entry uses the agent from input', () => {
    const ops = digest(
      {
        entities_touched: ['simorgh'],
        decisions: [],
        narrative: 'Did some work.',
        session_date: '2026-03-29',
        agent: 'custom-agent',
      },
      KNOWN_SLUGS,
    )

    const update = ops.find(o => o.op === 'update' && (o as any).slug === 'simorgh') as any
    expect(update.fields.session_log.agent).toBe('custom-agent')
  })

  it('creates a session note with kind: session', () => {
    const ops = digest(
      {
        entities_touched: ['simorgh'],
        decisions: ['Deferred caching'],
        narrative: 'Auth rewrite session.',
        session_date: '2026-03-29',
        agent: 'claude',
      },
      KNOWN_SLUGS,
    )

    const creates = ops.filter(o => o.op === 'create') as any[]
    const sessionNote = creates.find(o => o.kind === 'session')
    expect(sessionNote).toBeDefined()
    // Named by session date and note, so the same session derives the same slug
    expect(sessionNote.name).toMatch(/^Session 2026-03-29 [0-9a-f]{8}$/)
    expect(sessionNote.fields['session-date']).toBe('2026-03-29')
  })

  it('session note carries the narrative as synthesis, decisions and touched slugs as their own fields', () => {
    const ops = digest(
      {
        entities_touched: ['simorgh'],
        decisions: ['Deferred caching', 'Merged auth middleware'],
        narrative: 'Auth rewrite session.',
        session_date: '2026-03-29',
        agent: 'claude',
      },
      KNOWN_SLUGS,
    )

    const creates = ops.filter(o => o.op === 'create') as any[]
    const sessionNote = creates.find(o => o.kind === 'session')
    expect(sessionNote.fields.synthesis).toBe('Auth rewrite session.')
    expect(sessionNote.fields.decisions).toEqual(['Deferred caching', 'Merged auth middleware'])
    expect(sessionNote.fields.entities_touched).toEqual(['simorgh'])
  })

  it('links session note to touched entities via related field', () => {
    const ops = digest(
      {
        entities_touched: ['simorgh', 'hafez'],
        decisions: [],
        narrative: 'Cross-cutting session.',
        session_date: '2026-03-29',
        agent: 'claude',
      },
      KNOWN_SLUGS,
    )

    const creates = ops.filter(o => o.op === 'create') as any[]
    const sessionNote = creates.find(o => o.kind === 'session')
    expect(sessionNote.fields.related).toContain('simorgh')
    expect(sessionNote.fields.related).toContain('hafez')
  })

  it('includes all touched slugs in related (no cap)', () => {
    const manySlugs = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g'])
    const ops = digest(
      {
        entities_touched: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
        decisions: [],
        narrative: 'Big session.',
        session_date: '2026-03-29',
        agent: 'claude',
      },
      manySlugs,
    )

    const creates = ops.filter(o => o.op === 'create') as any[]
    const sessionNote = creates.find(o => o.kind === 'session')
    expect(sessionNote.fields.related.length).toBe(7)
  })

  it('throws NOT_FOUND naming only the unknown slugs', () => {
    const input = {
      entities_touched: ['simorgh', 'does-not-exist', 'nor-this'],
      decisions: [],
      narrative: 'Some session.',
      session_date: '2026-03-29',
      agent: 'claude',
    }
    expect(() => digest(input, KNOWN_SLUGS)).toThrow(HafezError)
    expect(() => digest(input, KNOWN_SLUGS)).toThrow("Unknown slugs in entities_touched: 'does-not-exist', 'nor-this'.")
    expect(() => digest(input, KNOWN_SLUGS)).not.toThrow(/simorgh/)
  })

  it('the same session date and note derive the same session name; a different note does not', () => {
    const input = { entities_touched: ['simorgh'], decisions: [], narrative: 'Some session.', session_date: '2026-03-29' }
    const name = (i: typeof input & { agent?: string }) => (digest(i, KNOWN_SLUGS).find(o => o.op === 'create') as any).name
    expect(name({ ...input, agent: 'a' })).toBe(name({ ...input, agent: 'b' }))
    expect(name({ ...input, narrative: 'Another session.' })).not.toBe(name(input))
    expect(name({ ...input, session_date: '2026-03-30' })).not.toBe(name(input))
  })

  it('on empty entities_touched: creates only the session knowledge note, no updates', () => {
    const ops = digest(
      {
        entities_touched: [],
        decisions: ['Decided to rest'],
        narrative: 'Planning session with no specific entities.',
        session_date: '2026-03-29',
        agent: 'claude',
      },
      KNOWN_SLUGS,
    )

    const updates = ops.filter(o => o.op === 'update')
    expect(updates).toHaveLength(0)
    const creates = ops.filter(o => o.op === 'create') as any[]
    expect(creates.some(o => o.kind === 'session')).toBe(true)
  })

  it('produces valid BatchOperation types', () => {
    const ops = digest(
      {
        entities_touched: ['simorgh'],
        decisions: [],
        narrative: 'Test.',
        session_date: '2026-03-29',
        agent: 'claude',
      },
      KNOWN_SLUGS,
    )

    for (const op of ops) {
      expect(['update', 'create', 'capture', 'link', 'unlink', 'reinforce', 'promote']).toContain(op.op)
    }
  })
})

// #210: the saved note's three sections each hold their own part.
describe('digest → batch → read: the session note', () => {
  const TMP = join(tmpdir(), 'hafez-test-digest-note-' + Date.now())
  const VAULT = join(TMP, 'vault')
  let os: Hafez

  beforeAll(async () => {
    mkdirSync(join(VAULT, 'entities'), { recursive: true })
    mkdirSync(join(VAULT, 'knowledge'), { recursive: true })
    os = createHafez({ vaultPath: VAULT, persistence: createMemoryJournal() })
    await os.create('entity', 'x', { type: 'entity' })
  })
  afterAll(() => removeTemp(TMP))

  const save = async (input: Parameters<typeof digest>[0]) => {
    const results = await os.batch(digest(input, new Set(['x'])))
    return results[results.length - 1]
  }

  it('puts the narrative in Summary, one bullet per decision in Decisions, a wiki-link per slug in Entities Touched', async () => {
    const result = await save({ entities_touched: ['x'], decisions: ['d1'], narrative: 'n', session_date: '2026-10-18' })
    const note = await os.read(result.slug, 'full')
    expect(note.body.trim()).toBe('## Summary\n\nn\n\n## Entities Touched\n\n- [[x]]\n\n## Decisions\n\n- d1')
  })

  it('a second save of the same session is skipped, under the name a save before the split gave it', async () => {
    const input = { entities_touched: ['x'], decisions: ['d1'], narrative: 'n', session_date: '2026-10-18' }
    await save(input)
    const result = await save(input)
    expect(result.slug).toBe('session-2026-10-18-3760b6cd')
    expect(result.warning).toBe("session 'session-2026-10-18-3760b6cd' already exists — op skipped (batch continues)")
  })

  it('a session with no decisions and no touched slugs has the narrative and two empty sections, nothing else', async () => {
    const result = await save({ entities_touched: [], decisions: [], narrative: 'Quiet session.', session_date: '2026-10-19' })
    const note = await os.read(result.slug, 'full')
    expect(note.body.trim()).toBe('## Summary\n\nQuiet session.\n\n## Entities Touched\n\n## Decisions')
  })

  it('read and read --json show the three sections', async () => {
    const result = await save({ entities_touched: ['x'], decisions: ['Ship it'], narrative: 'Read me.', session_date: '2026-10-20' })
    const text = await cmdRead(os, [result.slug], {})
    expect(text).toContain('## Summary\n\nRead me.')
    expect(text).toContain('## Entities Touched\n\n- [[x]]')
    expect(text).toContain('## Decisions\n\n- Ship it')
    const json = JSON.parse(await cmdRead(os, [result.slug], { json: true }))
    expect(json.body).toContain('## Entities Touched\n\n- [[x]]\n\n## Decisions\n\n- Ship it')
  })

  it('the touched entities see the session as a mention', async () => {
    const result = await save({ entities_touched: ['x'], decisions: [], narrative: 'Mention me.', session_date: '2026-10-21' })
    const { items } = await os.related_to('x', 'mention')
    expect(items.map(i => i.slug)).toContain(result.slug)
  })

  it('a decision is prose: one string is never split on its commas', async () => {
    const op = { op: 'create', kind: 'session', name: 'Session comma', fields: { decisions: 'Keep a, b and c together' } } as unknown as BatchOperation
    const report = await os.validateBatch([op])
    expect(report.valid).toBe(false)
    expect(report.operations[0].errors.join('\n')).toMatch(/decisions/)
  })

  it('a blank decision is dropped, not a failed save', async () => {
    const result = await save({ entities_touched: ['x'], decisions: ['  ', 'Kept'], narrative: 'Blank.', session_date: '2026-10-22' })
    expect(result.status).toBe('ok')
    expect(result.warning).toBeUndefined()
    const note = await os.read(result.slug, 'full')
    expect(note.body).toContain('## Decisions\n\n- Kept')
    expect(note.body).not.toContain('- \n')
  })
})
