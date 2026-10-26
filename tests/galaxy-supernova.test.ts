import { describe, expect, it } from 'vitest'
import {
  BURST_MS,
  SEEN_KEY,
  burstProgress,
  burstsFor,
  storageSeen,
} from '../src/graph/client/galaxy/supernova.js'

function fakeStorage() {
  const m = new Map<string, string>()
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  }
}
const throwing = {
  getItem: () => {
    throw new Error('blocked')
  },
  setItem: () => {
    throw new Error('blocked')
  },
}

describe('burstsFor', () => {
  it('records everything on first load and bursts none', () => {
    const st = fakeStorage()
    const store = storageSeen(st)
    expect(burstsFor(['a', 'b', 'c'], store, true)).toEqual([])
    expect(JSON.parse(st.m.get(SEEN_KEY)!)).toEqual(['a', 'b', 'c'])
  })

  it('bursts only the newly done id later, and records all four', () => {
    const st = fakeStorage()
    const store = storageSeen(st)
    burstsFor(['a', 'b', 'c'], store, true)
    expect(burstsFor(['a', 'b', 'c', 'd'], store, false)).toEqual(['d'])
    expect(JSON.parse(st.m.get(SEEN_KEY)!)).toEqual(['a', 'b', 'c', 'd'])
    expect(burstsFor(['a', 'b', 'c', 'd'], store, false)).toEqual([])
  })

  it('treats unparsable JSON as empty', () => {
    const st = fakeStorage()
    st.m.set(SEEN_KEY, '{nope')
    expect(storageSeen(st).get().size).toBe(0)
  })

  it.each([['throwing', throwing], ['null', null]] as const)('%s storage: no bursts, no throw', (_n, s) => {
    const store = storageSeen(s)
    expect(store.get().size).toBe(0)
    expect(() => store.set(new Set(['x']))).not.toThrow()
    expect(burstsFor(['a'], store, false)).toEqual(['a'])
    expect(burstsFor(['a'], store, true)).toEqual([])
  })
})

describe('burstProgress', () => {
  it('is 1 under reduced motion', () => expect(burstProgress(1000, 1000, true)).toBe(1))
  it('is 0 at start', () => expect(burstProgress(1000, 1000, false)).toBe(0))
  it('is 0.5 at half', () => {
    expect(BURST_MS).toBe(1800)
    expect(burstProgress(1000, 1900, false)).toBe(0.5)
  })
  it('clamps to 1', () => expect(burstProgress(1000, 6000, false)).toBe(1))
})
