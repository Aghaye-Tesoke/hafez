// tests/stale-entities.test.ts
// Stale entities (#124): an active entity is stale when its last-touched day
// is more than `staleness-days` (default 14) whole LOCAL days ago — the same
// day count and the same strict rule `actionAge` gives its open actions.
// Exactly the threshold is not stale; one day older is. The clock is pinned
// so "today" is a known local day.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createIndex, type HafezIndex } from '../src/db.js'
import { serializeFile } from '../src/vault.js'
import { actionAge } from '../src/stale.js'

const TMP = join(tmpdir(), 'hafez-test-stale-entities-' + Date.now())
const TODAY = '2026-10-02'

/** Active entities by slug: last-touched day and optional staleness-days. */
const ENTITIES: Record<string, { touched: string; days?: number }> = {
  'at-threshold': { touched: '2026-09-18' },       // 14 days
  'past-threshold': { touched: '2026-09-17' },     // 15 days
  'custom-at': { touched: '2026-09-25', days: 7 }, // 7 days, threshold 7
  'custom-past': { touched: '2026-09-24', days: 7 }, // 8 days, threshold 7
  'touched-today': { touched: TODAY },
}

let index: HafezIndex

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  // Late in the local day: a fractional UTC clock would push the 14-day
  // entity past the threshold.
  vi.setSystemTime(new Date(2026, 9, 2, 23, 30))
  mkdirSync(join(TMP, 'entities'), { recursive: true })
  mkdirSync(join(TMP, 'knowledge'), { recursive: true })
  for (const [slug, { touched, days }] of Object.entries(ENTITIES)) {
    const fm: Record<string, unknown> = { name: slug, type: 'project', status: 'active', created: '2026-01-01', 'last-touched': touched }
    if (days !== undefined) fm['staleness-days'] = days
    writeFileSync(join(TMP, 'entities', `${slug}.md`), serializeFile(fm, '## Purpose\n\n## Session Log\n'))
  }
  index = createIndex(TMP)
})

afterAll(() => {
  index.close()
  vi.useRealTimers()
  rmSync(TMP, { recursive: true, force: true })
})

const staleQuerySlugs = () => index.queryEntities({ filter: 'stale' }).items.map(r => r.slug).sort()
const staleStatsSlugs = () => index.getStats().stale.map(s => s.slug).sort()

describe('stale entities count whole local days', () => {
  it('exactly staleness-days ago is not stale; one day older is (query)', () => {
    expect(staleQuerySlugs()).toEqual(['custom-past', 'past-threshold'])
  })

  it('exactly staleness-days ago is not stale; one day older is (stats)', () => {
    expect(staleStatsSlugs()).toEqual(['custom-past', 'past-threshold'])
  })

  it('stats days_since_touched is the integer local-day count', () => {
    const days = Object.fromEntries(index.getStats().stale.map(s => [s.slug, s.days_since_touched]))
    expect(days).toEqual({ 'past-threshold': 15, 'custom-past': 8 })
  })

  it('agrees with the action rule (actionAge) for the same day and threshold', () => {
    const actionStale = Object.entries(ENTITIES)
      .filter(([, { touched, days }]) => actionAge(touched, days ?? 14, TODAY).stale)
      .map(([slug]) => slug).sort()
    expect(staleQuerySlugs()).toEqual(actionStale)
    expect(staleStatsSlugs()).toEqual(actionStale)
  })
})
