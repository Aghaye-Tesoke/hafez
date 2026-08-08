// src/cli/index.ts
//
// Import discipline: this module is loaded for EVERY invocation, so it may
// only import what every invocation needs — node builtins, the flag parser,
// and the error type. Everything else (the core factory and its native SQLite
// binding, zod-backed schema introspection, the markdown formatters, even
// vault-path resolution) loads on demand from the command that needs it, so
// `hafez --version` / `help` / `init` no longer pay for the whole program.
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { HafezError } from '../types.js'
import { UsageError } from './args.js'
import type { CommandOpts } from './commands.js'

// The one dispatch table. `pre-vault` commands run without a resolved vault
// (help, schema, onboarding, registration); `vault` commands get a resolved
// vault path and a Hafez instance. `mutating` entries auto-sync afterwards.
// Every command lives here — nothing dispatches inline from main() (the
// inline bypass region is where three of the last five CLI fixes landed).
type PreVaultRun = (args: string[], ctx: { json: boolean; vaultFlag?: string }) => Promise<string | null> | string | null
type VaultRun = (os: any, args: string[], opts: CommandOpts) => Promise<string>

export type CommandSpec =
  | { phase: 'pre-vault'; run: PreVaultRun }
  | { phase: 'vault'; mutating?: boolean; run: VaultRun }

/** Bind a vault command to its handler without importing the handler module
 * until the command actually runs. */
function lazy(pick: (m: typeof import('./commands.js')) => VaultRun): VaultRun {
  return async (os, args, opts) => pick(await import('./commands.js'))(os, args, opts)
}

export const COMMANDS: Record<string, CommandSpec> = {
  // --- pre-vault ---
  help: { phase: 'pre-vault', run: async (args) => (args[0] === '--agent' ? (await import('./help-agent.js')).renderAgentHelp() : USAGE) },
  onboard: { phase: 'pre-vault', run: async () => (await import('./onboard.js')).renderOnboard() },
  schema: { phase: 'pre-vault', run: async (args) => (await import('./commands-schema.js')).cmdSchema(null, args) },
  version: { phase: 'pre-vault', run: () => versionLine() },
  init: { phase: 'pre-vault', run: async (args, ctx) => { (await import('./resolve-vault.js')).cmdInit(args, ctx.vaultFlag); return null } },
  // Binds (args, ctx) explicitly: cmdUpgrade's third parameter is its
  // dependency seam, and PreVaultRun's signature keeps dispatch from ever
  // passing a third argument into it.
  upgrade: { phase: 'pre-vault', run: async (args, ctx) => (await import('./upgrade.js')).cmdUpgrade(args, ctx) },
  // --- vault ---
  read: { phase: 'vault', run: lazy(m => m.cmdRead) },
  sync: { phase: 'vault', run: lazy(m => m.cmdSync) },
  query: { phase: 'vault', run: lazy(m => m.cmdQuery) },
  search: { phase: 'vault', run: lazy(m => m.cmdSearch) },
  create: { phase: 'vault', mutating: true, run: lazy(m => m.cmdCreate) },
  capture: { phase: 'vault', mutating: true, run: lazy(m => m.cmdCapture) },
  update: { phase: 'vault', mutating: true, run: lazy(m => m.cmdUpdate) },
  link: { phase: 'vault', mutating: true, run: lazy(m => m.cmdLink) },
  unlink: { phase: 'vault', mutating: true, run: lazy(m => m.cmdUnlink) },
  promote: { phase: 'vault', mutating: true, run: lazy(m => m.cmdPromote) },
  batch: { phase: 'vault', mutating: true, run: lazy(m => m.cmdBatch) },
  validate: { phase: 'vault', run: lazy(m => m.cmdValidate) },
  index: {
    phase: 'vault',
    run: async (os, args) => {
      if (args[0] === 'rebuild') return (await import('./commands.js')).cmdIndexRebuild(os)
      throw new UsageError('Usage: hafez index rebuild')
    },
  },
  stats: { phase: 'vault', run: lazy(m => m.cmdStats) },
  changelog: { phase: 'vault', run: lazy(m => m.cmdChangelog) },
  digest: { phase: 'vault', run: lazy(m => m.cmdDigest) },
  export: { phase: 'vault', run: lazy(m => m.cmdExport) },
}

/** Exported so a guard test can assert every registered command is documented
 * here — a registered-but-undocumented command is otherwise invisible. */
export const USAGE = `Usage: hafez <command> [args]

Commands:
  read <slug>                Read entity or knowledge note
  query [--filter ...] ...   Filter entities/knowledge
    --kind all               Both kinds; --filter matches entity status only,
                             so knowledge notes (which have none) always show
  search <terms>             Full-text search
  create <kind> <name>       Create entity or knowledge note
  capture <name> [--notes]   Quick inbox capture
  promote <slug> <target>    Promote capture→entity/project/knowledge, entity→project
  update <slug> [--status]   Update an entity or knowledge note
    --brief "text"           Set/replace Brief (use --brief "" to clear)
    --description "text"     Set one-line description (use --description "" to clear)
    --resource "uri"         Set canonical resource URI, entities only (use --resource "" to clear)
    --add-action "text"      Add a next action
    --complete-action "text"  Complete matching action
    --remove-action "text"   Remove matching action
    --clear-actions          Remove all next actions
    --synthesis "text"       Set/replace Synthesis section (--insight is an alias)
    --add-evidence "text"    Append to Evidence section
    --add-source "text"      Append to Sources section
  batch                      Apply multiple operations atomically (JSON on stdin)
  digest                     Apply digest input (JSON stdin) → batch payload (JSON stdout)
  export --okf [--out <dir>] Export vault as an OKF v0.1 bundle (read-only)
  sync                       Pull remote changes and push local commits
  link <slug> <target> --relation <rel>    Add a link
  unlink <slug> <target> --relation <rel>  Remove a link
  stats                      Vault summary: counts, stale items, recents
  changelog --since <when>   Git-derived change history (e.g. --since 7.days.ago)
  schema [op] [--examples]   Machine-readable JSON schema for batch operations
  validate                   Check vault integrity
  index rebuild              Rebuild the SQLite index
  init --register <path>     Register an existing vault
  init                       Show current vault resolution
  onboard                    Agent-directed first run: seed the vault, pick integration level
  upgrade                    Check whether hafez is outdated and print the update steps
  help --agent               Full API reference for agents

Global flags:
  --vault <path>    Vault path (overrides config)
  --json            JSON output (structured, machine-readable)
  --version         Print the hafez version

Vault discovery: --vault flag > ~/.config/hafez/vault
`

/** Exit codes, documented in `hafez help --agent`. 0 = success; 4 is the
 * mutate-succeeded-sync-failed warning path; anything unmapped = 1. */
export const EXIT_CODES: Record<string, number> = {
  NOT_FOUND: 1,
  VALIDATION_FAILED: 2,
  GIT_PUSH_FAILED: 3,
  SLUG_EXISTS: 5,
  GIT_COMMIT_FAILED: 6,
  VAULT_LOCKED: 7,
}

/** The pure half of the error → exit adapter: which code an error maps to.
 * Exported so the exit-code contract is testable without spawning the CLI. */
export function exitCodeFor(err: unknown): number {
  if (err instanceof UsageError) return 2
  if (err instanceof HafezError) return EXIT_CODES[err.code] ?? 1
  return 1
}

/** The one error → exit adapter. Usage errors (bad flags/args) are distinct
 * from vault errors and from unknown crashes. */
function report(err: unknown): never {
  if (err instanceof UsageError) {
    process.stderr.write(`Error: ${err.message}\n`)
    process.exit(exitCodeFor(err))
  }
  if (err instanceof HafezError) {
    process.stderr.write(`Error: ${err.message}\n`)
    if (err.details?.length) {
      for (const detail of err.details) process.stderr.write(`  - ${detail}\n`)
    }
    process.exit(exitCodeFor(err))
  }
  failUnknown(err)
}

/** Does this error mean the native module failed to load/build?
 *
 * Matched on the MESSAGE only, and only on the messages a load/ABI failure
 * actually produces. The old test also scanned the stack for "better-sqlite3",
 * which every SqliteError's stack contains — so a plain query error ("near
 * 'abc': syntax error") printed reinstall advice instead of itself. */
export function isBindingsFailure(err: unknown): boolean {
  const message = (err as Error | undefined)?.message
  if (typeof message !== 'string') return false
  return /Could not locate the bindings file|better_sqlite3\.node|was compiled against a different Node\.js version|NODE_MODULE_VERSION|invalid ELF header/i.test(message)
}

// Terminal handler for non-Hafez errors. Special-cases unbuilt better-sqlite3
// bindings: npm 11+ blocks install scripts by default, so `npm install -g
// hafez` reports success with the native module unbuilt and the first indexed
// command dies here — guide instead of stack-tracing.
function failUnknown(err: unknown): never {
  const e = err as Error
  if (isBindingsFailure(e)) {
    process.stderr.write(
      'Error: the SQLite bindings (better-sqlite3) are not built.\n' +
      'npm 11+ blocks install scripts by default, so the install reports success\n' +
      'while skipping the native build. Fix with:\n\n' +
      '  npm install -g hafez --allow-scripts=better-sqlite3\n',
    )
    process.exit(1)
  }
  process.stderr.write(`Error: ${e.message}\n`)
  process.exit(1)
}

function versionLine(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const pkg = JSON.parse(readFileSync(join(here, '..', '..', 'package.json'), 'utf-8'))
  return `hafez ${pkg.version}`
}

/** Extract the global flags (--vault <path>, --json) from anywhere in argv.
 * Exported for the in-process dispatch tests. A flag sitting where the vault
 * path should be means the value is missing — never consume it (the same
 * value-position rule parseArgs applies to declared command flags). */
export function extractGlobalFlags(args: string[]): { rest: string[]; vaultFlag?: string; json: boolean } {
  const rest: string[] = []
  let vaultFlag: string | undefined
  let json = false
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--vault') {
      const v = args[i + 1]
      if (v === undefined || v.startsWith('--')) throw new UsageError('--vault requires a path value')
      // The old one-shot extraction left a second --vault in the command args
      // where the declared-flag parser rejected it — keep failing loudly
      // rather than silently letting the last one win (a mutating command
      // would write to a different vault than the first flag named).
      if (vaultFlag !== undefined) throw new UsageError('--vault specified more than once')
      vaultFlag = v
      i++
    } else if (a === '--json') {
      json = true
    } else {
      rest.push(a)
    }
  }
  return { rest, vaultFlag, json }
}

export async function main(argv: string[]): Promise<void> {
  try {
    const { rest: args, vaultFlag, json } = extractGlobalFlags(argv.slice(2))

    const command = args.shift()
    if (!command || command === '--help' || command === '-h') {
      process.stdout.write(USAGE)
      return
    }
    const name = command === '--version' || command === '-v' ? 'version' : command

    const spec = COMMANDS[name]
    if (!spec) {
      process.stderr.write(`Unknown command: ${command}\n${USAGE}`)
      process.exit(1)
    }

    if (spec.phase === 'pre-vault') {
      const out = await spec.run(args, { json, vaultFlag })
      if (out !== null) process.stdout.write(out.endsWith('\n') ? out : out + '\n')
      return
    }

    // Resolve vault (loaded here, not at module top: the pre-vault commands
    // above return without ever needing the vault machinery)
    const { resolveVaultPath, noVaultMessage } = await import('./resolve-vault.js')
    const resolution = resolveVaultPath(vaultFlag)
    if (resolution === null) {
      process.stderr.write(noVaultMessage())
      process.exit(1)
    }
    if (typeof resolution === 'object' && 'error' in resolution) {
      process.stderr.write(`Error: ${resolution.error}\n`)
      process.exit(1)
    }
    const vaultPath = resolution

    // First touch of the core — and so of the native SQLite binding. A
    // failure to load it lands in the catch below and is recognised by
    // isBindingsFailure, exactly as it was when this import was static.
    const { createHafez } = await import('../index.js')
    const os = createHafez({ vaultPath, git: { push: false } })
    const result = await spec.run(os, args, { json, vaultPath })

    // Auto-sync after mutating commands
    if (spec.mutating) {
      try {
        await os.sync()
      } catch (syncErr) {
        // Operation succeeded but sync failed — emit result with warning, exit 4
        process.stdout.write(result + '\n')
        process.stderr.write(`Warning: ${(syncErr as HafezError).message ?? (syncErr as Error).message}\n`)
        process.exit(4)
      }
    }

    process.stdout.write(result + '\n')
  } catch (err) {
    report(err)
  }
}

