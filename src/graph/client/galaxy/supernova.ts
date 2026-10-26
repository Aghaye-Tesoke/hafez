// src/graph/client/galaxy/supernova.ts
// The supernova plays once per browser per finished star, and never on first
// sight (spec "Supernova"). Which stars have already burst is remembered in
// localStorage; blocked or missing storage bursts nothing and remembers
// nothing, so the page never throws over it. Pure: no DOM, no three.js.

export const SEEN_KEY = 'hafez.galaxy.seenDone'
export const BURST_MS = 1800

export type Seen = { kind: 'seen'; ids: Set<string> } | { kind: 'absent' } | { kind: 'unavailable' }

export interface SeenStore {
  get(): Seen
  set(ids: Set<string>): void
}

export function storageSeen(storage: Pick<Storage, 'getItem' | 'setItem'> | null): SeenStore {
  return {
    get() {
      if (!storage) return { kind: 'unavailable' }
      let raw: string | null
      try {
        raw = storage.getItem(SEEN_KEY)
      } catch {
        return { kind: 'unavailable' }
      }
      if (raw === null) return { kind: 'absent' }
      try {
        const parsed: unknown = JSON.parse(raw)
        if (!Array.isArray(parsed)) return { kind: 'absent' }
        return { kind: 'seen', ids: new Set(parsed.filter((x): x is string => typeof x === 'string')) }
      } catch {
        return { kind: 'absent' }
      }
    },
    set(ids) {
      try {
        storage?.setItem(SEEN_KEY, JSON.stringify([...ids].sort()))
      } catch {
        // storage blocked or full: forget silently
      }
    },
  }
}

/**
 * Ids that should burst now, in `doneNow` order. Unavailable storage bursts
 * nothing and remembers nothing; a never-written key (first ever load) records
 * everything and bursts none.
 */
export function burstsFor(doneNow: string[], store: SeenStore): string[] {
  const seen = store.get()
  if (seen.kind === 'unavailable') return []
  if (seen.kind === 'absent') {
    store.set(new Set(doneNow))
    return []
  }
  const fresh = doneNow.filter((id) => !seen.ids.has(id))
  store.set(new Set([...seen.ids, ...doneNow]))
  return fresh
}

/** 0..1 through the burst; 1 at once under reduced motion. */
export function burstProgress(startMs: number, nowMs: number, reduced: boolean): number {
  if (reduced) return 1
  return Math.min(1, Math.max(0, (nowMs - startMs) / BURST_MS))
}
