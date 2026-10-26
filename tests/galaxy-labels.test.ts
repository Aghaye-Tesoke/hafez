import { describe, expect, it } from 'vitest'
import type { Body } from '../src/graph/client/galaxy/bodies.js'
import { HOSTED_STAR_REACH, LABEL, labelShows, labelSize } from '../src/graph/client/galaxy/labels.js'

const BODIES: Body[] = ['core', 'star', 'nebula', 'planet-ringed', 'planet-banded', 'planet-rocky', 'moon', 'belt']
const ALWAYS = new Set<Body>(['core', 'star', 'nebula'])

const cases: [Body, number, boolean, boolean, boolean][] = []
for (const body of BODIES) {
  for (const distance of [50, 500, 4000]) {
    for (const hovered of [false, true]) {
      for (const selected of [false, true]) {
        const limit = ALWAYS.has(body) ? LABEL.always : LABEL.near
        cases.push([body, distance, hovered, selected, distance <= limit || hovered || selected])
      }
    }
  }
}

describe('labelShows', () => {
  it.each(cases)('%s at %i, hovered=%s selected=%s -> %s', (body, distance, hovered, selected, expected) => {
    expect(labelShows(body, distance, hovered, selected, false)).toBe(expected)
  })

  it('uses the stated thresholds', () => {
    expect(LABEL).toEqual({ always: 3000, near: 300 })
    expect(labelShows('star', 3000, false, false, false)).toBe(true)
    expect(labelShows('moon', 300, false, false, false)).toBe(true)
    expect(labelShows('moon', 301, false, false, false)).toBe(false)
  })
})

describe('labelShows for a hosted star', () => {
  const reach = LABEL.near * HOSTED_STAR_REACH
  it('names a star in a galaxy only from inside it, or when hovered or selected', () => {
    expect(labelShows('star', reach, false, false, true)).toBe(true)
    expect(labelShows('star', reach + 1, false, false, true)).toBe(false)
    expect(labelShows('star', LABEL.always, true, false, true)).toBe(true)
    expect(labelShows('star', LABEL.always, false, true, true)).toBe(true)
  })
  it('keeps the always rule for a rogue star and for a core, hosted or not', () => {
    expect(labelShows('star', reach + 1, false, false, false)).toBe(true)
    expect(labelShows('core', reach + 1, false, false, true)).toBe(true)
  })
})

describe('labelShows with a wider overview reach', () => {
  it('names far bodies out to the reach it is given; near bodies keep LABEL.near', () => {
    expect(labelShows('core', 5000, false, false, false)).toBe(false)
    expect(labelShows('core', 5000, false, false, false, 6000)).toBe(true)
    expect(labelShows('nebula', 6001, false, false, false, 6000)).toBe(false)
    expect(labelShows('moon', 301, false, false, false, 6000)).toBe(false)
    expect(labelShows('star', LABEL.near * HOSTED_STAR_REACH + 1, false, false, true, 6000)).toBe(false)
  })
})

describe('labelSize', () => {
  it.each([
    ['core', 9],
    ['star', 6],
    ['nebula', 4],
    ['planet-ringed', 2.5],
    ['planet-banded', 2.5],
    ['planet-rocky', 2.5],
    ['moon', 2.5],
    ['belt', 2.5],
  ] as [Body, number][])('%s is %d', (body, size) => {
    expect(labelSize(body)).toBe(size)
  })
})
