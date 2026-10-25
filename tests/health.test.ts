// tests/health.test.ts
// The Health pass (#239, #244): what placement would change, as a typed
// report from the files on disk. Applies nothing, reads the index never.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createHafez, removeTemp } from './helpers/hafez.js'
import { createMemoryJournal } from './helpers/memory-journal.js'
import { serializeFile } from '../src/vault.js'
import { cmdHealth } from '../src/cli/commands.js'
import { COMMANDS } from '../src/cli/index.js'
import type { Hafez, HealthReport } from '../src/types.js'

const TMP = join(tmpdir(), 'hafez-test-health-' + Date.now())
afterAll(() => removeTemp(TMP))

const EMPTY: HealthReport = { workstreams: [], recurring_names: [], leakage: [], one_way_edges: [], unlinked_mentions: [], restated_decisions: [] }

describe('health on an empty vault', () => {
  const VAULT = join(TMP, 'empty')
  let os: Hafez
  const journal = createMemoryJournal()
  beforeAll(() => {
    mkdirSync(join(VAULT, 'entities'), { recursive: true })
    mkdirSync(join(VAULT, 'knowledge'), { recursive: true })
    os = createHafez({ vaultPath: VAULT, persistence: journal })
  })

  it('every section empty, nothing written', async () => {
    expect(await os.health()).toEqual(EMPTY)
    const out = await cmdHealth(os, [])
    expect(out).toContain('### Workstreams (0)')
    expect(out).toContain('### Recurring names (0)')
    expect(out).toContain('### Leakage (0)')
    expect(out).toContain('### One-way edges (0)')
    expect(out).toContain('### Unlinked mentions (0)')
    expect(out).toContain('### Restated decisions (0)')
    expect(JSON.parse(await cmdHealth(os, [], { json: true }))).toEqual(EMPTY)
    expect(journal.commits).toEqual([])
    expect(readdirSync(join(VAULT, 'entities'))).toEqual([])
  })

  it('is a vault command that does not mutate', () => {
    expect(COMMANDS.health.phase).toBe('vault')
    expect((COMMANDS.health as { mutating?: boolean }).mutating).toBeUndefined()
  })
})

const entity = (name: string, fm: Record<string, any>, body: string) =>
  serializeFile({ name, type: 'project', status: 'active', created: '2026-08-01', 'last-touched': '2026-10-01', ...fm }, body)

describe('health on a fixture vault', () => {
  const VAULT = join(TMP, 'fixture')
  let os: Hafez
  beforeAll(() => {
    mkdirSync(join(VAULT, 'entities', 'archive'), { recursive: true })
    mkdirSync(join(VAULT, 'knowledge'), { recursive: true })
    // (i) QUEUE: three lines, one ticked, no child named it; ENGINE: split
    // into the child `engine-room`, so it stops.
    writeFileSync(join(VAULT, 'entities', 'gatehouse.md'), entity('Gatehouse', {}, [
      '## Next Actions',
      '- [ ] QUEUE, drain the backlog (added 2026-09-01)',
      '- [x] QUEUE: measure depth (added 2026-09-02)',
      '- [ ] QUEUE — alert on depth (added 2026-09-03)',
      '- [ ] ENGINE A1 start',
      '- [ ] ENGINE A2 warm',
      '- [ ] ENGINE A3 run',
      '',
      '## Session Log',
      '',
      '### 2026-09-20 — claude [progress]',
      'Summary: lantern lit',
      '',
      '### 2026-09-15 — claude [decision]',
      'Summary: decision: split the QUEUE lines out into their own child',
      'The Engine Room work moved out.',
      '',
      '### 2026-09-01 — claude [progress]',
      'Summary: engine-room planned, engine-rooms are not it',
    ].join('\n')))
    writeFileSync(join(VAULT, 'entities', 'archive', 'gatehouse-log.md'), [
      '### 2026-09-12 — claude [progress]',
      'Summary: moved engine-room out',
      '',
    ].join('\n'))
    // engine-room → gatehouse is a legacy one-way edge from a child to its
    // parent; cellar, another child, mentions [[gatehouse]] with no edge.
    // Both pairs are bound by `parent`, which subsumes related, so neither
    // (iii) nor (v) lists them — the link line would be rejected.
    writeFileSync(join(VAULT, 'entities', 'engine-room.md'), entity('Engine room', { parent: 'gatehouse', created: '2026-09-10', related: ['gatehouse'] }, '## Purpose\n'))
    writeFileSync(join(VAULT, 'entities', 'cellar.md'), entity('Cellar', { parent: 'gatehouse', created: '2026-09-10' }, '## Purpose\nUnder the [[gatehouse]].\n'))
    // (ii) `Beacon` in ten units across two days; `Harbour` in ten units on
    // one day; `Summary` is a stopword; `Ops Desk` is the entity's own name.
    // (iii) lantern → gatehouse is one-way (legacy); ops-desk ↔ lantern is
    // two-way; a cross-kind edge (knowledge → entity) is not reported.
    // (v) ops-desk's body mentions [[gatehouse]] with no edge either way;
    // lantern mentions [[gatehouse]], an edge that exists one way.
    // (vi) a decision on gatehouse restated by a knowledge note of that day.
    writeFileSync(join(VAULT, 'entities', 'ops-desk.md'), entity('Ops Desk', { related: ['lantern'] }, [
      '## Brief',
      'Hands the overflow to [[gatehouse]].',
      '',
      '## Next Actions',
      ...Array.from({ length: 8 }, (_, i) => `- [${i === 0 ? 'x' : ' '}] Fix the Beacon relay ${i} and the Harbour gate (added 2026-09-01)`),
      '- [ ] Fix the Harbour gate again (added 2026-09-01)',
      '- [ ] Fix the Harbour gate once more',
      '',
      '## Session Log',
      '',
      '### 2026-09-02 — claude [progress]',
      'Summary: The Beacon relay fixed; Ops Desk tidy',
      '',
      '### 2026-09-02 — claude [decision]',
      'Summary: Keep the relay',
      'Beacon stays as it is.',
      '',
      // The Summary line below a body line: still the entry's summary.
      '### 2026-09-16 — claude [decision]',
      'Written above the line.',
      'Summary: Keep the relay as the one path',
    ].join('\n')))
    writeFileSync(join(VAULT, 'entities', 'lantern.md'), entity('Lantern', { related: ['gatehouse', 'ops-desk'], created: '2026-09-01' }, '## Purpose\nLit for [[gatehouse]].\n'))
    const knowledge = (name: string, fm: Record<string, any>, body: string) =>
      serializeFile({ name, created: '2026-09-15', ...fm }, body)
    writeFileSync(join(VAULT, 'knowledge', 'split-rule.md'), knowledge('Split rule', { related: ['gatehouse', 'queue-note'] },
      '## Synthesis\nThe queue lines split out of the gatehouse into their own child once a prefix names them.\n'))
    writeFileSync(join(VAULT, 'knowledge', 'queue-note.md'), knowledge('Queue note', { related: ['gatehouse'] },
      '## Synthesis\nNothing of the sort; see [[split-rule]].\n'))
    writeFileSync(join(VAULT, 'knowledge', 'relay-rule.md'), knowledge('Relay rule', { related: ['ops-desk'], created: '2026-09-16' },
      '## Synthesis\nKeep the relay as the one path.\n'))
    writeFileSync(join(VAULT, 'knowledge', 'other-day.md'), knowledge('Split rule again', { related: ['gatehouse'], created: '2026-09-16' },
      '## Synthesis\nThe queue lines split out of the gatehouse into their own child.\n'))
    os = createHafez({ vaultPath: VAULT, persistence: createMemoryJournal() })
  })

  it('(i) lists each unsplit family with its open-line count, through the workstream Item', async () => {
    const report = await os.health()
    expect(report.workstreams).toEqual([{ entity: 'gatehouse', prefix: 'QUEUE', open_actions: 2 }])
    expect(await cmdHealth(os, [])).toContain('- gatehouse workstream: 2 open actions with `QUEUE`; no child named it')
  })

  it('(ii) lists a name in ten or more units across two or more days', async () => {
    const report = await os.health()
    expect(report.recurring_names).toEqual([{ entity: 'ops-desk', term: 'Beacon', units: 10, days: ['2026-09-01', '2026-09-02'] }])
    expect(await cmdHealth(os, [])).toContain('- ops-desk: `Beacon` in 10 units across 2 days (2026-09-01 .. 2026-09-02)')
  })

  it('(iv) leakage per (parent, child) pair: entries since the child was created, file plus archive', async () => {
    const report = await os.health()
    expect(report.leakage).toEqual([
      { parent: 'gatehouse', child: 'engine-room', relation: 'parent', hits: 2, entries: 3 },
      { parent: 'gatehouse', child: 'lantern', relation: 'related', hits: 1, entries: 4 },
    ])
    const out = await cmdHealth(os, [])
    expect(out).toContain('- gatehouse → engine-room (parent): 2 of 3 entries (67%)')
    expect(out).toContain('- gatehouse → lantern (related): 1 of 4 entries (25%)')
  })

  it('(iii) lists each one-way same-kind edge as the link line that closes it; cross-kind edges and a child→parent edge are not reported', async () => {
    const report = await os.health()
    expect(report.one_way_edges).toEqual([
      { from: 'lantern', to: 'gatehouse' },
      { from: 'split-rule', to: 'queue-note' },
    ])
    const out = await cmdHealth(os, [])
    expect(out).toContain('- lantern → gatehouse: `hafez link gatehouse lantern --relation related`')
    expect(out).toContain('- split-rule → queue-note: `hafez link queue-note split-rule --relation related`')
  })

  it('(v) lists a [[slug]] mention between same-kind notes with no edge either way, as a link line; a parent↔child mention is not listed', async () => {
    const report = await os.health()
    expect(report.unlinked_mentions).toEqual([{ from: 'ops-desk', to: 'gatehouse' }])
    expect(await cmdHealth(os, [])).toContain('- ops-desk mentions [[gatehouse]]: `hafez link ops-desk gatehouse --relation related`')
  })

  it('(vi) lists a decision restated by a knowledge note of the same day, related to the entity, sharing half its summary tokens; the Summary line is the first anywhere in the entry', async () => {
    const report = await os.health()
    expect(report.restated_decisions).toEqual([
      { day: '2026-09-15', entity: 'gatehouse', note: 'split-rule', share: 0.8, summary: 'decision: split the QUEUE lines out into their own child' },
      { day: '2026-09-16', entity: 'ops-desk', note: 'relay-rule', share: 1, summary: 'Keep the relay as the one path' },
    ])
    expect(await cmdHealth(os, [])).toContain('- 2026-09-15 gatehouse → split-rule (80%): decision: split the QUEUE lines out into their own child')
  })

  it('--json carries the typed report', async () => {
    expect(JSON.parse(await cmdHealth(os, [], { json: true }))).toEqual(await os.health())
  })

  it('the link line, run, makes the edge symmetric; health never rewrote it', async () => {
    expect(readFileSync(join(VAULT, 'entities', 'gatehouse.md'), 'utf-8')).not.toContain('- lantern')
    await os.link('gatehouse', 'lantern', 'related')
    expect(readFileSync(join(VAULT, 'entities', 'gatehouse.md'), 'utf-8')).toContain('- lantern')
    expect(readFileSync(join(VAULT, 'entities', 'lantern.md'), 'utf-8')).toContain('- gatehouse')
    expect((await os.health()).one_way_edges).toEqual([{ from: 'split-rule', to: 'queue-note' }])
  })

  it('is built from the files on disk: a stale index does not change it', async () => {
    await os.query()  // the index exists and knows the vault as it was
    writeFileSync(join(VAULT, 'entities', 'late.md'), entity('Late', {}, [
      '## Next Actions',
      '- [ ] CARRY the box',
      '- [ ] CARRY the crate',
      '- [ ] CARRY the chest',
    ].join('\n')))
    expect((await os.health()).workstreams).toContainEqual({ entity: 'late', prefix: 'CARRY', open_actions: 3 })
  })
})
