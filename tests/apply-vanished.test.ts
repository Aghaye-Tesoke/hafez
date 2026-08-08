// tests/apply-vanished.test.ts
// The vanished-file race: a vault file deleted by an EXTERNAL actor (Obsidian,
// a hand rm, a git checkout) between validate and apply. The factory interface
// cannot produce this state by construction — the vault lock holds across both
// phases and validation rejects a missing slug — so this test crosses the seam
// deliberately and calls the Apply entry directly against a vault where the
// file is already gone. The one thing pinned: the error is a caller-facing
// HafezError NOT_FOUND (which runMutations' catch re-localises as
// `op[i] (op slug): …` in batch mode), not a bare internal throw that reads
// as a hafez bug.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { applyOperation } from '../src/apply.js'
import { HafezError } from '../src/types.js'
import type { BatchOperation } from '../src/types.js'

const TMP = join(tmpdir(), 'hafez-test-apply-vanished-' + Date.now())
const VAULT = join(TMP, 'vault')

beforeAll(() => {
  mkdirSync(join(VAULT, 'entities'), { recursive: true })
  mkdirSync(join(VAULT, 'knowledge'), { recursive: true })
})

afterAll(() => rmSync(TMP, { recursive: true, force: true }))

const ctx = { vaultPath: VAULT, captureOriginal: () => {} }

const OPS: BatchOperation[] = [
  { op: 'update', slug: 'gone', fields: { brief: 'x' } },
  { op: 'link', slug: 'gone', target: 'other', relation: 'related' },
  { op: 'unlink', slug: 'gone', target: 'other', relation: 'related' },
  { op: 'promote', slug: 'gone', target: 'project' },
]

describe('a file deleted between validate and apply', () => {
  for (const op of OPS) {
    it(`${op.op}: surfaces as caller-facing NOT_FOUND, not an internal throw`, () => {
      let caught: unknown
      try {
        applyOperation(op, ctx)
      } catch (err) {
        caught = err
      }
      expect(caught).toBeInstanceOf(HafezError)
      const e = caught as HafezError
      expect(e.code).toBe('NOT_FOUND')
      expect(e.message).toContain('gone')
      expect(e.message).toContain('vanished after validation')
      expect(e.message).not.toContain('unreachable')
    })
  }
})
