// src/graph/client/galaxy/supernova.ts
// The supernova plays once per browser per finished star, and never on first
// sight (spec "Supernova"). Which stars have already burst is remembered in
// localStorage; a blocked or missing storage behaves as an empty memory and a
// silent no-op write, so the page never throws over it. Pure: no DOM, no three.js.

export const SEEN_KEY = 'hafez.galaxy.seenDone'
export const BURST_MS = 1800

export interface SeenStore {
  get(): Set<string>
  set(ids: Set<string>): void
}

export function storageSeen(storage: Pick<Storage, 'getItem' | 'setItem'> | null): SeenStore {
  return {
    get() {
      try {
        const raw = storage?.getItem(SEEN_KEY)
        if (!raw) return new Set()
        const parsed: unknown = JSON.parse(raw)
        if (!Array.isArray(parsed)) return new Set()
        return new Set(parsed.filter((x): x is string => typeof x === 'string'))
      } catch {
        return new Set()
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

/** Ids that should burst now, in `doneNow` order; records every id as seen. */
export function burstsFor(doneNow: string[], store: SeenStore, firstLoad: boolean): string[] {
  if (firstLoad) {
    store.set(new Set(doneNow))
    return []
  }
  const seen = store.get()
  const fresh = doneNow.filter((id) => !seen.has(id))
  store.set(new Set([...seen, ...doneNow]))
  return fresh
}

/** 0..1 through the burst; 1 at once under reduced motion. */
export function burstProgress(startMs: number, nowMs: number, reduced: boolean): number {
  if (reduced) return 1
  return Math.min(1, Math.max(0, (nowMs - startMs) / BURST_MS))
}
