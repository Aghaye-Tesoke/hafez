import { describe, expect, it } from 'vitest'
import { GAP_MS, minutesByDay } from '../src/graph/heat/active.js'
import { localDay } from '../src/dates.js'

const T0 = new Date('2026-10-20T10:00:00').getTime()   // local time
const min = (n: number) => n * 60_000

describe('minutesByDay', () => {
  it('sums gaps at or under the threshold and drops longer ones', () => {
    const t = [T0, T0 + min(5), T0 + min(10), T0 + min(40), T0 + min(42)]
    expect(minutesByDay(t)).toEqual({ [localDay(new Date(T0))]: 12 })
  })
  it('sorts unsorted timestamps before measuring', () => {
    expect(minutesByDay([T0 + min(10), T0, T0 + min(5)])).toEqual({ [localDay(new Date(T0))]: 10 })
  })
  it('attributes a gap that crosses local midnight to the day it started', () => {
    const late = new Date('2026-10-20T23:55:00').getTime()
    expect(minutesByDay([late, late + min(10)])).toEqual({ '2026-10-20': 10 })
  })
  it('gives nothing for fewer than two timestamps', () => {
    expect(minutesByDay([])).toEqual({})
    expect(minutesByDay([T0])).toEqual({})
  })
  it('exposes the 15 minute threshold', () => { expect(GAP_MS).toBe(900_000) })
})
