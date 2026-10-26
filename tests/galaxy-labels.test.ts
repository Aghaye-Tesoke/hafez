import { describe, expect, it } from 'vitest'
import type { Body } from '../src/graph/client/galaxy/bodies.js'
import { LABEL, labelShows, labelSize } from '../src/graph/client/galaxy/labels.js'

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
    expect(labelShows(body, distance, hovered, selected)).toBe(expected)
  })

  it('uses the stated thresholds', () => {
    expect(LABEL).toEqual({ always: 3000, near: 300 })
    expect(labelShows('star', 3000, false, false)).toBe(true)
    expect(labelShows('moon', 300, false, false)).toBe(true)
    expect(labelShows('moon', 301, false, false)).toBe(false)
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
