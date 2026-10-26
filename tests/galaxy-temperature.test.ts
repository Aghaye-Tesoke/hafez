// tests/galaxy-temperature.test.ts
// The cooling clock's colour, the glow from heat, and the alarm (pure rules).
import { describe, it, expect } from 'vitest'
import type { GraphNode } from '../src/types.js'
import { GALAXY } from '../src/graph/client/tokens.js'
import { daysSince, temperatureColor, isRedDwarf, glow, isAlarm, isEstimated, starRadius, COOL_DAYS } from '../src/graph/client/galaxy/temperature.js'
import { size } from '../src/graph/client/signals.js'

const TODAY = '2026-10-26'
const rgb = (h: string): number[] => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
const project = (over: Partial<GraphNode> = {}): GraphNode =>
  ({ id: 'p', kind: 'entity', type: 'project', status: 'active', last_active: '2026-09-26', open_actions: 2, ...over }) as GraphNode

describe('temperatureColor', () => {
  it('uses lowercase #rrggbb anchors', () => {
    for (const a of GALAXY.anchors) expect(a).toMatch(/^#[0-9a-f]{6}$/)
  })
  it('hits the anchors and clamps past day 28', () => {
    expect(COOL_DAYS).toBe(28)
    expect(temperatureColor(0)).toBe(GALAXY.anchors[0])
    expect(temperatureColor(28)).toBe(GALAXY.anchors[4])
    expect(temperatureColor(400)).toBe(GALAXY.anchors[4])
    expect(temperatureColor(Infinity)).toBe(GALAXY.anchors[4])
  })
  it('interpolates channel by channel', () => {
    const [a, b] = [rgb(GALAXY.anchors[0]), rgb(GALAXY.anchors[1])]
    const mid = rgb(temperatureColor(3.5))
    mid.forEach((c, i) => expect(Math.abs(c - (a[i] + b[i]) / 2)).toBeLessThanOrEqual(1))
  })
})

describe('daysSince and isRedDwarf', () => {
  it('clamps a future day to 0', () => expect(daysSince('2099-01-01', TODAY)).toBe(0))
  it('is Infinity when never active, and a red dwarf', () => {
    expect(daysSince(undefined, TODAY)).toBe(Infinity)
    expect(isRedDwarf(Infinity)).toBe(true)
    expect(isRedDwarf(27)).toBe(false)
  })
})

describe('glow', () => {
  it('maps heat to intensity and reach', () => {
    expect(glow(undefined)).toEqual({ intensity: 0.1, reach: 1.4 })
    expect(glow(1).intensity).toBeCloseTo(0.5, 10)
    expect(glow(1).reach).toBeCloseTo(2.2, 10)
    expect(glow(5)).toEqual(glow(1))
  })
})

describe('isAlarm', () => {
  it('fires for a cold active project with open actions', () => expect(isAlarm(project(), TODAY)).toBe(true))
  it('not when paused', () => expect(isAlarm(project({ status: 'paused' }), TODAY)).toBe(false))
  it('not at 27 days', () => expect(isAlarm(project({ last_active: '2026-09-29' }), TODAY)).toBe(false))
  it('not with 0 open actions', () => expect(isAlarm(project({ open_actions: 0 }), TODAY)).toBe(false))
  it('not for type entity', () => expect(isAlarm(project({ type: 'entity' }), TODAY)).toBe(false))
  it('ignores stale', () => expect(isAlarm(project({ stale: true, open_actions: 0 }), TODAY)).toBe(false))
})

describe('estimated and radius', () => {
  it('flags touches-sourced heat', () => {
    expect(isEstimated(project({ heat_source: 'touches' }))).toBe(true)
    expect(isEstimated(project({ heat_source: 'hours' }))).toBe(false)
  })
  it('radius is the signals size', () => expect(starRadius(project())).toBe(size(project())))
})
