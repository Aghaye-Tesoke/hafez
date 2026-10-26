import { describe, expect, it, vi } from 'vitest'
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

describe('burstsFor', () => {
  it('records everything when the key is absent and bursts none', () => {
    const st = fakeStorage()
    expect(burstsFor(['a', 'b', 'c'], storageSeen(st))).toEqual([])
    expect(JSON.parse(st.m.get(SEEN_KEY)!)).toEqual(['a', 'b', 'c'])
  })

  it('bursts only the newly done id later, and records all four', () => {
    const st = fakeStorage()
    const store = storageSeen(st)
    burstsFor(['a', 'b', 'c'], store)
    expect(burstsFor(['a', 'b', 'c', 'd'], store)).toEqual(['d'])
    expect(JSON.parse(st.m.get(SEEN_KEY)!)).toEqual(['a', 'b', 'c', 'd'])
    expect(burstsFor(['a', 'b', 'c', 'd'], store)).toEqual([])
  })

  it('treats garbage as absent and writes over it', () => {
    for (const junk of ['{nope', '{"a":1}']) {
      const st = fakeStorage()
      st.m.set(SEEN_KEY, junk)
      expect(burstsFor(['a'], storageSeen(st))).toEqual([])
      expect(JSON.parse(st.m.get(SEEN_KEY)!)).toEqual(['a'])
    }
  })

  it('null storage: unavailable, bursts nothing, set does not throw', () => {
    const store = storageSeen(null)
    expect(store.get()).toEqual({ kind: 'unavailable' })
    expect(burstsFor(['a'], store)).toEqual([])
    expect(() => store.set(new Set(['x']))).not.toThrow()
  })

  it('throwing getItem: bursts nothing and never calls setItem', () => {
    const st = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: vi.fn(),
    }
    expect(burstsFor(['a'], storageSeen(st))).toEqual([])
    expect(st.setItem).not.toHaveBeenCalled()
  })

  it('throwing setItem does not throw', () => {
    const st = {
      getItem: () => null,
      setItem: () => {
        throw new Error('full')
      },
    }
    expect(() => burstsFor(['a'], storageSeen(st))).not.toThrow()
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
