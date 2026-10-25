// src/graph/heat/sidecar.ts
// The hours sidecar: the collector's persisted result, kept in the hafez config
// directory as hours.json. It holds the per-file transcript cache (so an
// unchanged transcript is never reopened) and each project slug's days. It is
// not part of the vault and is never committed. Reads are tolerant: a missing,
// unreadable, torn or foreign-version file reads as empty, so a bad sidecar
// costs one re-scan and never breaks `hafez graph`. Writes go to a .tmp file and
// are renamed over the target, so a crash mid-write leaves the old file intact.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { getConfigDir } from '../../cli/resolve-vault.js'
import type { DayMinutes } from './heat.js'
import type { FileCache } from './transcripts.js'

/** The sidecar as written to hours.json. `days` is keyed by project slug. */
export interface Sidecar {
  version: 1
  generated: string
  files: FileCache
  days: Record<string, DayMinutes>
}

/** A sidecar with nothing collected yet. */
export function emptySidecar(): Sidecar {
  return { version: 1, generated: '', files: {}, days: {} }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Reads a sidecar, or an empty one when the file is missing, unreadable, or not a version-1 sidecar. */
export function readSidecar(path: string): Sidecar {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return emptySidecar()
  }
  if (!isObject(parsed) || parsed.version !== 1) return emptySidecar()
  if (!isObject(parsed.files) || !isObject(parsed.days)) return emptySidecar()
  return parsed as unknown as Sidecar
}

/** Writes a sidecar atomically: the directory is created, the JSON goes to `<path>.tmp`, then it is renamed over `path`. */
export function writeSidecar(path: string, sidecar: Sidecar): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(sidecar, null, 2))
  renameSync(tmp, path)
}

/** Where the sidecar lives: hours.json in the hafez config directory. */
export function defaultSidecarPath(): string {
  return join(getConfigDir(), 'hours.json')
}
