// tests/near-match.test.ts
// The Near-match rule (#60, #92): names only, stopword-stripped tokens; a
// near-match shares all but one of the shorter name's tokens, at least three.
// A weaker resemblance (two shared tokens or more, short of a near-match) is
// only a suggested relation. Up to three of each, most tokens shared first.
import { describe, it, expect } from 'vitest'
import { resemblances } from '../src/near-match.js'

const note = (name: string) => ({ name })
const names = (xs: { name: string }[]) => xs.map(x => x.name)

describe('near-match', () => {
  it('5 of 6 shared tokens is a near-match (the vault duplicate pair)', () => {
    const { near } = resemblances('Sort an installed products list by install date', [
      note('Sort an installed systems list by install date'),
    ])
    expect(names(near)).toEqual(['Sort an installed systems list by install date'])
  })

  it('stopwords and case and punctuation do not count', () => {
    const { near } = resemblances('The Retry-Budget for Webhooks', [note('retry budget webhooks')])
    expect(near).toHaveLength(1)
  })

  it('all but one of the SHORTER name is enough, however long the other is', () => {
    const { near } = resemblances('Webhook retry budget design', [
      note('Webhook retry budget across regions with jitter and caps'),
    ])
    expect(near).toHaveLength(1)
  })

  it('fewer than three shared tokens is never a near-match', () => {
    const { near, weak } = resemblances('Retry budget', [note('Retry budget')])
    expect(near).toEqual([])
    expect(names(weak)).toEqual(['Retry budget'])
  })

  it('two tokens of the shorter name missing is not a near-match', () => {
    const { near } = resemblances('Simorgh vs OpenClaw memory model', [note('Simorgh vs OpenClaw plugin system')])
    expect(near).toEqual([])
  })

  it('two shared tokens short of a near-match is a weaker resemblance', () => {
    const { near, weak } = resemblances('Simorgh vs OpenClaw memory model', [
      note('Simorgh vs OpenClaw plugin system'),
      note('Unrelated gardening note'),
    ])
    expect(near).toEqual([])
    expect(names(weak)).toEqual(['Simorgh vs OpenClaw plugin system'])
  })

  it('one shared token is nothing', () => {
    expect(resemblances('Webhook retry budget', [note('Webhook signing keys')])).toEqual({ near: [], weak: [] })
  })

  it('returns at most three of each, most shared tokens first', () => {
    const { near, weak } = resemblances('alpha beta gamma delta epsilon', [
      note('alpha beta gamma delta zeta'),
      note('alpha beta gamma delta epsilon eta'),
      note('alpha beta gamma delta iota'),
      note('alpha beta gamma delta kappa'),
      note('alpha beta x'),
      note('alpha beta gamma'),
      note('alpha beta y'),
      note('alpha beta z'),
    ])
    expect(names(near)).toEqual([
      'alpha beta gamma delta epsilon eta',
      'alpha beta gamma delta zeta',
      'alpha beta gamma delta iota',
    ])
    expect(names(weak)).toEqual(['alpha beta x', 'alpha beta y', 'alpha beta z'])
  })
})
