// tests/helpers/memory-journal.ts
// In-memory Journal adapter (see CONTEXT.md: Journal). Lets logic tests run
// against createHafez() with zero git setup: commits are recorded, sync is a
// local-only no-op, changelog/fileTimes serve whatever the test seeds.
//
// Fidelity contract (mirrors the git adapter's observable behavior):
// - commit() resolves normally and stamps fileTimes like a commit would.
// - sync() reports a remote-less vault, matching the README-default setup.
// Deliberately NOT modeled — covered on real repos by git.test.ts /
// merge.test.ts / integration.test.ts / operations-git.test.ts instead:
// - push retries, semantic merge, rebase repair, commit-failure cleanup
// - git's no-op on idempotent writes (the fake records a commit and bumps
//   modifiedTimes even when content is unchanged)
// - delete-then-re-add addedTimes (git reports the NEWEST add; the fake
//   keeps the first) and deletion stamps in modifiedTimes
// - changelog() ignores `since` and path filtering: it returns exactly what
//   the test seeded
// - changesSince() answers from the recorded commits (cursor = commit count,
//   '' before the first): a file is in history once a commit wrote it, so a
//   fixture written to disk and never committed reads as a create on its
//   first committed write, where git would say update. An idempotent write
//   reads as an update (git: no change). No indexed-dir path filtering.
import { HafezError, type Journal, type ChangelogEntry, type FileChange } from '../../src/types.js'

export interface RecordedCommit {
  written: string[]
  deleted: string[]
  message: string
}

export interface MemoryJournal extends Journal {
  commits: RecordedCommit[]
  /** Times served by fileTimes('modified') — vault-relative path → ISO time. */
  modifiedTimes: Map<string, string>
  /** Times served by fileTimes('added') — vault-relative path → ISO time. */
  addedTimes: Map<string, string>
  /** Entries served by changelog(); tests seed these directly. */
  changelogEntries: ChangelogEntry[]
}

export function createMemoryJournal(): MemoryJournal {
  const journal: MemoryJournal = {
    commits: [],
    modifiedTimes: new Map(),
    addedTimes: new Map(),
    changelogEntries: [],

    async commit(written, deleted, message) {
      journal.commits.push({ written: [...written], deleted: [...deleted], message })
      // Mirror git: modified = newest commit touching the file, added = the
      // commit that created it. Seeded times survive unless re-committed.
      const now = new Date().toISOString()
      for (const f of written) {
        journal.modifiedTimes.set(f, now)
        if (!journal.addedTimes.has(f)) journal.addedTimes.set(f, now)
      }
    },

    async sync() {
      return { pulled: false, pushed: false, remote: false }
    },

    async changelog() {
      return journal.changelogEntries
    },

    async fileTimes(mode) {
      return mode === 'added' ? journal.addedTimes : journal.modifiedTimes
    },

    async changesSince(from) {
      const cursor = journal.commits.length ? String(journal.commits.length) : ''
      if (from === undefined || from === cursor) return { cursor, files: [] }
      const start = from === '' ? 0 : Number(from)
      if (!Number.isInteger(start) || start < 0 || start > journal.commits.length) {
        throw new HafezError('GIT_READ_FAILED', `git read failed: unknown cursor ${from}`)
      }
      // Net status, as a diff between two points: alive before the span vs after it.
      const aliveAt = (end: number): Set<string> => {
        const alive = new Set<string>()
        for (const c of journal.commits.slice(0, end)) {
          for (const f of c.written) alive.add(f)
          for (const f of c.deleted) alive.delete(f)
        }
        return alive
      }
      const before = aliveAt(start)
      const after = aliveAt(journal.commits.length)
      const touched = new Set(journal.commits.slice(start).flatMap(c => [...c.written, ...c.deleted]))
      const files: FileChange[] = []
      for (const path of touched) {
        if (!before.has(path) && after.has(path)) files.push({ path, op: 'create' })
        else if (before.has(path) && after.has(path)) files.push({ path, op: 'update' })
        else if (before.has(path)) files.push({ path, op: 'delete' })
      }
      return { cursor, files }
    },
  }
  return journal
}
