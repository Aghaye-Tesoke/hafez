// src/graph/heat/collect.ts
// The heat collector: reads Claude Code's session transcripts, maps each
// working folder to the vault entity whose `resource` holds it, and writes a
// per-slug hours sidecar. The sidecar's file cache is what carries memory
// between runs; `days` is rebuilt from the scan every time, so a transcript
// that is still on disk is never counted twice. Days past the heat window are
// dropped. A failed sidecar write propagates to the caller.
import { daysBetween, localDay } from '../../dates.js'
import type { Hafez } from '../../types.js'
import { WINDOW_DAYS, type DayMinutes } from './heat.js'
import { hostSlug } from './paths.js'
import { readSidecar, writeSidecar, type Sidecar } from './sidecar.js'
import { scanTranscripts } from './transcripts.js'

/** Where to read transcripts, where the sidecar lives, and the clock (for tests). */
export interface CollectOpts {
  transcriptRoot: string
  sidecarPath: string
  now?: Date
}

const PAGE = 500

/** Every entity's slug and resource, paged so no single query has to be huge. */
async function allResources(os: Hafez): Promise<Array<{ slug: string; resource: string | null }>> {
  const rows: Array<{ slug: string; resource: string | null }> = []
  for (let offset = 0; ; offset += PAGE) {
    const { items } = await os.query({ limit: PAGE, offset })
    for (const item of items) rows.push({ slug: item.slug, resource: item.resource })
    if (items.length < PAGE) return rows
  }
}

/** Scans transcripts into the sidecar at `sidecarPath` and returns it. */
export async function collectHeat(os: Hafez, opts: CollectOpts): Promise<Sidecar> {
  const now = opts.now ?? new Date()
  const previous = readSidecar(opts.sidecarPath)
  const resources = await allResources(os)
  const { byCwd, cache } = await scanTranscripts(opts.transcriptRoot, previous.files, now)

  const today = localDay(now)
  const days: Record<string, DayMinutes> = {}
  for (const [cwd, perDay] of byCwd) {
    const slug = hostSlug(cwd, resources)
    if (slug === undefined) continue
    const into = (days[slug] ??= {})
    for (const [day, minutes] of Object.entries(perDay)) {
      if (daysBetween(day, today) > WINDOW_DAYS) continue
      into[day] = (into[day] ?? 0) + minutes
    }
  }

  const sidecar: Sidecar = { version: 1, generated: now.toISOString(), files: cache, days }
  writeSidecar(opts.sidecarPath, sidecar)
  return sidecar
}
