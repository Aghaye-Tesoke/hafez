// tests/workstream.test.ts
// The prefix-family rule (#240, Number A of the workstream-signal research):
// the family of one Next Actions line and the families an entity body
// carries unsplit, checked against tools/research/ws_caps_prefix.py.
import { describe, it, expect } from 'vitest'
import { familyOf, workstreams } from '../src/workstream.js'

describe('familyOf', () => {
  it('the nine baseline families, each from a line of the owner\'s vault shape', () => {
    expect(familyOf('CHECK the gate on Monday')).toBe('CHECK')
    expect(familyOf('CARRY: the open set to Friday')).toBe('CARRY')
    expect(familyOf('ENGINE — rebuild the index')).toBe('ENGINE')
    expect(familyOf('RUNNER, wire the queue')).toBe('RUNNER')
    expect(familyOf('DECIDE; the vendor')).toBe('DECIDE')
    expect(familyOf('WS-A A3 reconcile the accounts')).toBe('WS-A')
    expect(familyOf('BASE B1 migrate the tables')).toBe('BASE')
    expect(familyOf('QUEUE, drain the backlog')).toBe('QUEUE')
    expect(familyOf('COMMERCIAL: price the tier')).toBe('COMMERCIAL')
  })

  it('a family code is WS<n> or WS-<L>; a run of caps tokens is joined', () => {
    expect(familyOf('WS4 ship it')).toBe('WS4')
    expect(familyOf('NEXT SESSION FIRST read the brief')).toBe('NEXT SESSION FIRST')
  })

  it('a trailing step id is dropped; a lone step id is not a family', () => {
    expect(familyOf('QUEUE A3 drain')).toBe('QUEUE')
    expect(familyOf('A3 drain the queue')).toBeNull()
    expect(familyOf('A12, then P2')).toBeNull()
  })

  it('a one-letter token, a sentence-case line and a lowercase line are not families', () => {
    expect(familyOf('A run of words')).toBeNull()
    expect(familyOf('Check the gate')).toBeNull()
    expect(familyOf('check the gate')).toBeNull()
    expect(familyOf('')).toBeNull()
  })

  it('a caps token glued to lowercase is not a prefix', () => {
    expect(familyOf('QUEUEing the work')).toBeNull()
    expect(familyOf("BOSS'S orders")).toBe('BOSS')
    expect(familyOf('BOSS’S orders')).toBe('BOSS')
  })
})

const body = (lines: string[]) => `## Brief\n\nx\n\n## Next Actions\n\n${lines.join('\n')}\n`

describe('workstreams', () => {
  it('fires at three lines, open or ticked, and counts the open ones', () => {
    expect(workstreams(body([
      '- [ ] QUEUE, drain (added 2026-09-01)',
      '- [x] QUEUE, prime (added 2026-09-01)',
      '- [ ] QUEUE A3 flush (added 2026-09-02)',
      '- [ ] Something else',
    ]), [])).toEqual([{ prefix: 'QUEUE', open_actions: 2 }])
  })

  it('two lines are not a family', () => {
    expect(workstreams(body(['- [ ] QUEUE, drain', '- [ ] QUEUE, prime']), [])).toEqual([])
  })

  it('an imperative family is a fact like any other', () => {
    expect(workstreams(body(['- [ ] CHECK a', '- [ ] CHECK b', '- [ ] CHECK c']), [])).toEqual([{ prefix: 'CHECK', open_actions: 3 }])
  })

  it('a family whose lines are all ticked does not render: nothing left to split', () => {
    expect(workstreams(body(['- [x] CHECK a', '- [x] CHECK b', '- [x] CHECK c']), [])).toEqual([])
  })

  it('stops when a naming entity carries a family token in its slug or name', () => {
    const lines = ['- [ ] WS-A A1 x', '- [ ] WS-A A2 y', '- [ ] WS-A A3 z', '- [ ] QUEUE a', '- [ ] QUEUE b', '- [ ] QUEUE c']
    expect(workstreams(body(lines), [{ slug: 'dynamics-ws-a', name: 'Dynamics account structure' }])).toEqual([{ prefix: 'QUEUE', open_actions: 3 }])
    expect(workstreams(body(lines), [{ slug: 'gatehouse', name: 'The Queue' }])).toEqual([{ prefix: 'WS-A', open_actions: 3 }])
    expect(workstreams(body(lines), [{ slug: 'queue', name: 'Queue' }, { slug: 'ws-a', name: 'WS-A' }])).toEqual([])
  })

  it('a code family stops on its whole code only: a slug segment or a name word', () => {
    const lines = ['- [ ] WS-A A1 x', '- [ ] WS-A A2 y', '- [ ] WS-A A3 z', '- [ ] WS3 a', '- [ ] WS3 b', '- [ ] WS3 c']
    expect(workstreams(body(lines), [{ slug: 'a-plan', name: 'A Plan' }, { slug: 'ws', name: 'WS' }]))
      .toEqual([{ prefix: 'WS-A', open_actions: 3 }, { prefix: 'WS3', open_actions: 3 }])
    expect(workstreams(body(lines), [{ slug: 'ws-a-dynamics', name: 'Dynamics' }])).toEqual([{ prefix: 'WS3', open_actions: 3 }])
    expect(workstreams(body(lines), [{ slug: 'dynamics', name: 'WS-A dynamics' }])).toEqual([{ prefix: 'WS3', open_actions: 3 }])
    expect(workstreams(body(lines), [{ slug: 'third', name: 'The WS3 stream' }])).toEqual([{ prefix: 'WS-A', open_actions: 3 }])
    expect(workstreams(body(lines), [{ slug: 'ws-ab', name: 'WS-AB' }, { slug: 'ws30', name: 'WS30' }]))
      .toEqual([{ prefix: 'WS-A', open_actions: 3 }, { prefix: 'WS3', open_actions: 3 }])
  })

  it('a token inside a longer word does not stop the family', () => {
    expect(workstreams(body(['- [ ] BASE a', '- [ ] BASE b', '- [ ] BASE c']), [{ slug: 'database', name: 'Database' }]))
      .toEqual([{ prefix: 'BASE', open_actions: 3 }])
  })

  it('families come in first-appearance order', () => {
    expect(workstreams(body(['- [ ] CARRY a', '- [ ] DECIDE a', '- [ ] CARRY b', '- [ ] DECIDE b', '- [ ] CARRY c', '- [ ] DECIDE c']), []).map(w => w.prefix))
      .toEqual(['CARRY', 'DECIDE'])
  })
})
