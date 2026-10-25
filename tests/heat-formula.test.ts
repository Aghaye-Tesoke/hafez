import { describe, expect, it } from 'vitest'
import { heatOf, touchesAsMinutes, SATURATION_MINUTES } from '../src/graph/heat/heat.js'

const TODAY = '2026-10-25'

describe('heatOf', () => {
  it('saturates at one working week of minutes today', () => {
    expect(heatOf({ [TODAY]: SATURATION_MINUTES }, TODAY)).toEqual({ heat: 1, last_active: TODAY })
  })
  it('halves every seven days', () => {
    expect(heatOf({ '2026-10-18': SATURATION_MINUTES }, TODAY).heat).toBeCloseTo(0.5, 3)
  })
  it('is a red dwarf below 0.07 after 28 cold days', () => {
    expect(heatOf({ '2026-09-27': SATURATION_MINUTES }, TODAY).heat).toBeLessThan(0.07)
  })
  it('names the newest day with minutes as last_active, and ignores days outside the window', () => {
    expect(heatOf({ '2026-08-01': 5000, '2026-10-01': 30 }, TODAY)).toEqual({ heat: expect.any(Number), last_active: '2026-10-01' })
    expect(heatOf({ '2026-08-01': 5000 }, TODAY)).toEqual({ heat: 0 })
  })
  it('clamps to one', () => {
    expect(heatOf({ [TODAY]: 99999 }, TODAY).heat).toBe(1)
  })
})

describe('touchesAsMinutes', () => {
  it('counts each distinct touch day as one hour', () => {
    expect(touchesAsMinutes(['2026-10-20', '2026-10-20', '2026-10-21'])).toEqual({ '2026-10-20': 60, '2026-10-21': 60 })
  })
})
