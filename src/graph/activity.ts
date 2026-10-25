// src/graph/activity.ts
// The graph server's `/activity` (#278): the Vault's last note changes from
// changelog(), newest first, each run of consecutive writes to one note as
// one row with a count, named, with the agent the Vault records for it.
import type { ActivityRow, ChangeOp, ChangelogEntry, Hafez } from '../types.js'
import { parseSessionLog } from '../document.js'
import { localDay } from '../dates.js'
import { kindDir, noteAtRelPath } from '../vault.js'

/** How many rows `/activity` lists. */
export const ACTIVITY_ROWS = 20
/** How many of the newest commits are read first: a history read costs
 * ~25 ms a commit on drvfs, so the whole history is never read at once.
 * While those collapse into fewer rows, twice as many are read, until the
 * rows are full or a read covers fewer commits than it asked for (the
 * history's end). */
const COMMITS_READ = 50

const OP: Record<ChangelogEntry['operation'], ChangeOp> = { created: 'create', updated: 'update', deleted: 'delete' }

/** `names` maps a slug to the name its node carries now. */
export async function activity(os: Hafez, names: Map<string, string>): Promise<ActivityRow[]> {
  for (let commits = COMMITS_READ; ; commits *= 2) {
    const entries = await os.changelog('', commits)
    const { rows, full } = collapse(entries, names)
    // The commits the read covered, counted by hash: every note commit lists
    // at least one entry (a commit touching no note under a note dir, the
    // scaffold's .gitkeep, is the history's first).
    if (full || new Set(entries.map(e => e.commit)).size < commits) return withAgents(os, rows)
  }
}

/** The changelog's entries as rows, newest first; `full` once a row past the
 * last has begun, so the last row's run of writes is known to be whole. */
function collapse(entries: ChangelogEntry[], names: Map<string, string>): { rows: Array<ActivityRow & { commit: string }>; full: boolean } {
  const rows: Array<ActivityRow & { commit: string }> = []
  for (const e of entries) {
    // The changelog lists every file under a kind dir, an archive log
    // (`entities/archive/<slug>-log.md`) too; the Layout says which are notes.
    if (!noteAtRelPath(`${kindDir(e.kind)}/${e.slug}.md`)) continue
    const op = OP[e.operation]
    const last = rows[rows.length - 1]
    if (last?.slug === e.slug) {
      // A promote deletes and creates the note in one commit: one write, and
      // the create is what happened to it.
      if (last.commit === e.commit && (last.op === 'delete') !== (op === 'delete')) {
        if (op !== 'delete' && last.count === 1) Object.assign(last, { op, kind: e.kind })
      } else {
        last.count++
        last.commit = e.commit
      }
      continue
    }
    if (rows.length === ACTIVITY_ROWS) return { rows, full: true }
    rows.push({ slug: e.slug, kind: e.kind, op, timestamp: e.timestamp, name: names.get(e.slug) ?? e.slug, count: 1, commit: e.commit })
  }
  return { rows, full: false }
}

/** Each Entity row with the agent its Session Log records for the write's day. */
function withAgents(os: Hafez, rows: Array<ActivityRow & { commit: string }>): Promise<ActivityRow[]> {
  return Promise.all(rows.map(async ({ commit: _, ...row }) => {
    const agent = row.kind === 'entity' && row.op !== 'delete' ? await agentOf(os, row.slug, localDay(new Date(row.timestamp))) : undefined
    return agent ? { ...row, agent } : row
  }))
}

/** The agent of the Entity's newest Session Log entry dated `day`. */
async function agentOf(os: Hafez, slug: string, day: string): Promise<string | undefined> {
  try {
    return parseSessionLog((await os.read(slug, 'full')).body).find(entry => entry.date === day)?.agent
  } catch {
    return undefined // gone since: nothing to read the agent from
  }
}
