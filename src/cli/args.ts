// src/cli/args.ts
// The one flag parser behind every CLI command. Each command declares its
// flags; parseArgs enforces the declaration — unknown flags and missing
// values are UsageErrors instead of silently ignored tokens (the getFlag era
// needed a documented workaround because values stayed in the positional
// stream). It also holds the error classes the error → exit adapter maps,
// since the dispatch module may statically import only this file and types.

import { HafezError, type HafezErrorCode } from '../types.js'
import { splitCommaList } from '../batch-ops.js'

/** Bad invocation (unknown flag, missing value, missing positional).
 * Distinct from crashes: the error adapter maps it to exit 2. The message is
 * the reason, then the usage text when one is given; `reason` is the problem
 * alone, for a command that follows it with a shape of its own. */
export class UsageError extends Error {
  constructor(public reason: string, usage?: string) {
    super(usage === undefined ? reason : `${reason}\n${usage}`)
  }
}

/** A flag the command does not declare. */
export class UnknownFlagError extends UsageError {
  constructor(public flag: string, usage: string) {
    super(`Unknown flag --${flag}`, usage)
  }
}

/** `--help` or `-h` given to a command: the error adapter prints `usage` to
 * stdout and exits 0. Not a UsageError, so no misuse handler wraps it. */
export class HelpRequest extends Error {
  constructor(public usage: string) {
    super(usage)
  }
}

/** For a command that does not go through parseArgs: `--help` or `-h`
 * anywhere in its args is a HelpRequest for its usage. */
export function helpIfAsked(args: string[], usage: string): void {
  if (args.includes('--help') || args.includes('-h')) throw new HelpRequest(usage)
}

/** A failure whose output the command rendered in full (the `read` miss):
 * the error adapter writes `output` verbatim to `stream` and exits by `code`. */
export class RenderedError extends HafezError {
  constructor(code: HafezErrorCode, public output: string, public stream: 'stdout' | 'stderr') {
    super(code, output)
  }
}

/** A misuse whose report ends with the shape to retry from (Agent Contract: a
 * misuse returns the corrected shape). Keeps the wrapped error's code, so its
 * exit code is unchanged. */
export class MisuseError extends HafezError {
  constructor(cause: HafezError, public shape: string) {
    super(cause.code, cause.message, cause.details)
  }
}

/** `repeat` is the one flag that may be given more than once: each repeat
 * appends, and its value is always a list. Every other flag given twice is a
 * UsageError on every command — never last-wins, which would drop the first
 * value with exit 0 (`query --tag a --tag b` used to query `b` alone). */
export type FlagType = 'string' | 'boolean' | 'repeat'

export type FlagValue = string | boolean | string[] | undefined

/** Flag names WITHOUT the leading dashes, e.g. { 'add-action': 'string' }. */
export type FlagSpec = Record<string, FlagType>

export interface ParsedArgs {
  flags: Record<string, FlagValue>
  positionals: string[]
}

export function parseArgs(args: string[], spec: FlagSpec, usage: string): ParsedArgs {
  const flags: Record<string, FlagValue> = {}
  const positionals: string[] = []

  for (let i = 0; i < args.length; i++) {
    const token = args[i]
    if (token === '--help' || token === '-h') throw new HelpRequest(usage)
    if (token.startsWith('--')) {
      const name = token.slice(2)
      // Own keys only: `--constructor` must not find Object.prototype's (#134)
      const type = Object.hasOwn(spec, name) ? spec[name] : undefined
      if (!type) throw new UnknownFlagError(name, usage)
      if (type !== 'repeat' && Object.hasOwn(flags, name)) {
        throw new UsageError(`--${name} was given more than once; it takes one value`, usage)
      }
      if (type === 'boolean') {
        flags[name] = true
        continue
      }
      const value = args[i + 1]
      // A declared flag in value position means the value was omitted
      // (`--brief --clear-actions`) — consuming it would both corrupt the
      // string and silently drop the swallowed flag.
      if (value === undefined || (value.startsWith('--') && Object.hasOwn(spec, value.slice(2)))) {
        throw new UsageError(`--${name} requires a value`, usage)
      }
      const prev = flags[name]
      flags[name] = type === 'repeat' ? [...(Array.isArray(prev) ? prev : []), value] : value
      i++
    } else {
      positionals.push(token)
    }
  }

  return { flags, positionals }
}

/** The one comma-list parser — every list flag on every command goes through
 * it. Trims each segment and drops the empty ones, so `"ai, ml"` is two
 * domains (not `ai` and ` ml`, which no query matches) and `"eng,"` is one
 * (not one plus an empty string persisted to frontmatter and the index).
 * undefined stays undefined; an all-empty list is an empty array (a clear). */
export function splitList(value: FlagValue): string[] | undefined {
  if (typeof value !== 'string') return undefined
  return splitCommaList(value)
}

export function str(value: FlagValue): string | undefined {
  return typeof value === 'string' ? value : undefined
}
