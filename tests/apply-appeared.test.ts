// tests/apply-appeared.test.ts
// The mirror of tests/apply-vanished.test.ts: a vault file an EXTERNAL actor
// (Obsidian, a hand cp, a git checkout) creates between validate and apply, on
// a slug the op just claimed. The factory cannot produce this state by
// construction — the vault lock holds across both phases and claimNew rejects
// a taken slug — so this crosses the seam deliberately and calls the Apply
// entry directly against a vault where the file already exists.
//
// Two things pinned: the error is a caller-facing HafezError SLUG_EXISTS
// (which runMutations re-localises as `op[i] (op slug): …` in batch mode), and
// the file on disk is untouched. Rollback only restores an overwritten file
// when a LATER op in the same batch fails, so "not overwritten" has to be the
// arm's own guarantee.
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { applyOperation } from '../src/apply.js'
import { HafezError } from '../src/types.js'
import type { BatchOperation } from '../src/types.js'

const TMP = join(tmpdir(), 'hafez-test-apply-appeared-' + Date.now())
const VAULT = join(TMP, 'vault')
const FOREIGN = '---\nname: Written By Someone Else\n---\n\nContent hafez never saw.\n'

beforeEach(() => {
  rmSync(VAULT, { recursive: true, force: true })
  for (const dir of ['entities', 'knowledge', 'sessions']) mkdirSync(join(VAULT, dir), { recursive: true })
})

afterAll(() => rmSync(TMP, { recursive: true, force: true }))

const ctx = { vaultPath: VAULT, captureOriginal: () => {} }

/** Each case: the op, and where the external actor's file lands. `intruder`
 * is deliberately not always the op's own directory — claimNew is cross-kind,
 * so a knowledge note appearing under a claimed entity slug must trip too. */
const CASES: Array<{ label: string; op: BatchOperation; intruder: string }> = [
  {
    label: 'create entity',
    op: { op: 'create', kind: 'entity', name: 'Contested', fields: { type: 'project' } },
    intruder: join(VAULT, 'entities', 'contested.md'),
  },
  {
    label: 'create entity, knowledge note appears on the slug',
    op: { op: 'create', kind: 'entity', name: 'Contested', fields: { type: 'project' } },
    intruder: join(VAULT, 'knowledge', 'contested.md'),
  },
  {
    label: 'create knowledge',
    op: { op: 'create', kind: 'knowledge', name: 'Contested', fields: {} },
    intruder: join(VAULT, 'knowledge', 'contested.md'),
  },
  {
    label: 'create session',
    op: { op: 'create', kind: 'session', name: 'Contested', fields: {} },
    intruder: join(VAULT, 'sessions', 'contested.md'),
  },
  {
    label: 'capture',
    op: { op: 'capture', name: 'Contested' },
    intruder: join(VAULT, 'entities', 'contested.md'),
  },
]

describe('a file created between validate and apply', () => {
  for (const { label, op, intruder } of CASES) {
    it(`${label}: surfaces as caller-facing SLUG_EXISTS and writes nothing`, () => {
      writeFileSync(intruder, FOREIGN)
      let caught: unknown
      try {
        applyOperation(op, ctx)
      } catch (err) {
        caught = err
      }
      expect(caught).toBeInstanceOf(HafezError)
      const e = caught as HafezError
      expect(e.code).toBe('SLUG_EXISTS')
      expect(e.message).toContain('contested')
      expect(e.message).toContain('appeared after validation')
      expect(e.message).not.toContain('unreachable')
      // The whole point of the guard.
      expect(readFileSync(intruder, 'utf-8')).toBe(FOREIGN)
    })
  }

  it('an uncontested create still writes — the guard is the race, not the rule', () => {
    const applied = applyOperation({ op: 'create', kind: 'entity', name: 'Uncontested', fields: { type: 'project' } }, ctx)
    expect(applied.result).toMatchObject({ slug: 'uncontested', status: 'ok', created: true })
    expect(readFileSync(join(VAULT, 'entities', 'uncontested.md'), 'utf-8')).toContain('Uncontested')
  })
})
