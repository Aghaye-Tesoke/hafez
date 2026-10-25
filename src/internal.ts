// src/internal.ts
// What hafez's own CLI and graph server reach that the package does not
// export: src/index.ts re-exports none of it, and package.json's `exports`
// map stops a deep import. Off the library surface by the owner's call (#270).
import { createHafez } from './index.js'
import type { Hafez, HafezConfig } from './types.js'
import type { IndexSync } from './db.js'

export interface InternalHafezConfig extends HafezConfig {
  /** When the index catches up with files changed outside hafez (a hand edit,
   * a raw git pull). 'read' (default): before every index read, a stat per
   * note, so a long-lived instance never reads a stale index. 'once': the
   * first index read syncs, later reads trust the index — the CLI's mode, one
   * scan per process (#269); a file changed outside hafez after that read is
   * seen by the next process, or after `syncIndex()`. Writes through the
   * instance are indexed as they commit in every mode. 'manual': reads trust
   * the index, and `syncIndex()` syncs it — the graph server's mode, which
   * syncs when its poll sees a commit (#271). */
  indexSync?: IndexSync
}

export interface InternalHafez extends Hafez {
  /** Catch the index up with files changed outside hafez, in every mode:
   * what a read does first under `indexSync` 'read', and the first read under 'once'. */
  syncIndex(): Promise<void>
}

/** createHafez with the internal options: every instance it builds is an InternalHafez. */
export function createInternalHafez(config: InternalHafezConfig): InternalHafez {
  return createHafez(config) as InternalHafez
}
