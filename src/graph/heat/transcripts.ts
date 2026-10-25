// src/graph/heat/transcripts.ts
// Active minutes per folder, read from Claude Code's session transcripts
// (<root>/<folder>/*.jsonl). Privacy: these files hold private conversations,
// so each line is parsed and only its `timestamp` and `cwd` are kept; no other
// field is stored, returned, or logged. Files stream line by line, and a file
// whose mtime and size match the cache is not opened at all.
import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { minutesByDay } from './active.js'
import { WINDOW_DAYS, type DayMinutes } from './heat.js'

/** What one transcript file contributed, with the stat that proves it is current. */
export interface FileEntry {
  mtimeMs: number
  size: number
  cwd: string
  days: DayMinutes
}

/** File entries keyed by absolute file path. */
export type FileCache = Record<string, FileEntry>

async function readTranscript(path: string): Promise<{ cwd?: string; days: DayMinutes }> {
  const stamps: number[] = []
  let cwd: string | undefined
  const lines = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity })
  for await (const text of lines) {
    let parsed: unknown
    try { parsed = JSON.parse(text) } catch { continue }
    if (typeof parsed !== 'object' || parsed === null) continue
    const { timestamp, cwd: lineCwd } = parsed as { timestamp?: unknown; cwd?: unknown }
    if (cwd === undefined && typeof lineCwd === 'string') cwd = lineCwd
    if (typeof timestamp !== 'string') continue
    const ms = Date.parse(timestamp)
    if (!Number.isNaN(ms)) stamps.push(ms)
  }
  return { cwd, days: minutesByDay(stamps) }
}

/**
 * Active minutes per day for every transcript under `root`, grouped by the
 * working directory each session ran in (the folder name when a file records
 * none). Files older than the heat window are skipped. The returned cache
 * holds only the files seen this run.
 */
export async function scanTranscripts(
  root: string,
  cache: FileCache,
  now: Date,
): Promise<{ byCwd: Map<string, DayMinutes>; cache: FileCache }> {
  const byCwd = new Map<string, DayMinutes>()
  const next: FileCache = {}
  const oldest = now.getTime() - WINDOW_DAYS * 86_400_000

  let folders: string[] = []
  try {
    folders = (await readdir(root, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name)
  } catch {
    return { byCwd, cache: next }
  }

  for (const folder of folders) {
    let files: string[] = []
    try { files = (await readdir(join(root, folder))).filter(f => f.endsWith('.jsonl')) } catch { continue }
    for (const file of files) {
      const path = join(root, folder, file)
      let info
      try { info = await stat(path) } catch { continue }
      if (!info.isFile() || info.mtimeMs < oldest) continue

      const hit = cache[path]
      let entry: FileEntry
      if (hit && hit.mtimeMs === info.mtimeMs && hit.size === info.size) {
        entry = hit
      } else {
        let read
        try { read = await readTranscript(path) } catch { continue }
        entry = { mtimeMs: info.mtimeMs, size: info.size, cwd: read.cwd ?? folder, days: read.days }
      }
      next[path] = entry

      const total = byCwd.get(entry.cwd) ?? {}
      for (const [day, minutes] of Object.entries(entry.days)) total[day] = (total[day] ?? 0) + minutes
      byCwd.set(entry.cwd, total)
    }
  }
  return { byCwd, cache: next }
}
