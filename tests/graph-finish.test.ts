// tests/graph-finish.test.ts
// The pure half of the panel's Mark finished control: who may be finished, the
// warning it shows, the typed-slug check and the route it posts to.
import { describe, expect, it } from 'vitest'
import { canFinish, finishUrl, finishWarning, typedMatches } from '../src/graph/client/finish.js'
import type { GraphNode } from '../src/types.js'

const node = (over: Partial<GraphNode>): GraphNode => ({ id: 'hafez-galaxy', kind: 'entity', name: 'Hafez Galaxy', type: 'project', status: 'active', ...over })

describe('canFinish', () => {
  it('is true for an active project', () => expect(canFinish(node({}))).toBe(true))
  it('is false for a done project', () => expect(canFinish(node({ status: 'done' }))).toBe(false))
  it('is false for a capture', () => expect(canFinish(node({ type: 'entity' }))).toBe(false))
  it('is false for a knowledge node', () => expect(canFinish(node({ kind: 'knowledge', type: undefined, status: undefined }))).toBe(false))
})

describe('finishWarning', () => {
  const first = 'This star will go supernova. It cannot un-explode.'
  it('says no open actions at zero', () => {
    expect(finishWarning(node({ open_actions: 0 }))).toBe(`${first}\n"Hafez Galaxy" has no open actions.`)
    expect(finishWarning(node({}))).toBe(`${first}\n"Hafez Galaxy" has no open actions.`)
  })
  it('is singular at one', () => expect(finishWarning(node({ open_actions: 1 }))).toBe(`${first}\n"Hafez Galaxy" has 1 open action.`))
  it('is plural at three', () => expect(finishWarning(node({ open_actions: 3 }))).toBe(`${first}\n"Hafez Galaxy" has 3 open actions.`))
})

describe('typedMatches', () => {
  it('trims and matches exactly', () => expect(typedMatches(' hafez-galaxy ', 'hafez-galaxy')).toBe(true))
  it('rejects a prefix', () => expect(typedMatches('hafez', 'hafez-galaxy')).toBe(false))
})

describe('finishUrl', () => {
  it('encodes the slug', () => expect(finishUrl('a b')).toBe('/note/a%20b/finish'))
})
