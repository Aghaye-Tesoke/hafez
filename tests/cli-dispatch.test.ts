// tests/cli-dispatch.test.ts
// In-process coverage of the CLI dispatch layer (S3 of
// plans/2026-08-07-mutation-spine-series.md): the exit-code contract and
// global-flag extraction are pure exports, testable without spawning the
// binary. The spawn suites stay as end-to-end cover of the real argv →
// exit-code → stdout surface.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { COMMANDS, EXIT_CODES, USAGE, exitCodeFor, extractGlobalFlags, isBindingsFailure } from '../src/cli/index.js'
import { UsageError } from '../src/cli/args.js'
import { HafezError } from '../src/types.js'

// The dispatch module is loaded on every single invocation, so what it
// imports at the top level is what `hafez --version` pays for. Everything
// heavy (the core + its native SQLite binding, zod-backed introspection, the
// formatters, vault resolution) is imported on demand from the command that
// needs it. A static import creeping back in is invisible at runtime — the
// CLI just gets slower — so it is asserted here instead.
describe('CLI startup stays lazy', () => {
  const source = readFileSync(new URL('../src/cli/index.ts', import.meta.url), 'utf-8')
  const staticImports = [...source.matchAll(/^import\s+(?!type\b)[^\n]*?from\s+'([^']+)'/gm)].map(m => m[1])

  it('the dispatch module statically imports only builtins, args and types', () => {
    expect(staticImports.sort()).toEqual(['../types.js', './args.js', 'fs', 'path', 'url'])
  })

  it('every heavy module is reached through a dynamic import', () => {
    for (const heavy of ['../index.js', './commands.js', './commands-schema.js', './help-agent.js', './onboard.js', './resolve-vault.js', './upgrade.js']) {
      expect(staticImports, `${heavy} must stay lazy`).not.toContain(heavy)
      expect(source, `${heavy} must be dynamically imported`).toContain(`import('${heavy}')`)
    }
  })
})

describe('exit-code contract', () => {
  it('maps every HafezError code per the documented table', () => {
    expect(EXIT_CODES).toEqual({
      NOT_FOUND: 1,
      VALIDATION_FAILED: 2,
      GIT_PUSH_FAILED: 3,
      SLUG_EXISTS: 5,
      GIT_COMMIT_FAILED: 6,
      VAULT_LOCKED: 7,
    })
    for (const [code, exit] of Object.entries(EXIT_CODES)) {
      expect(exitCodeFor(new HafezError(code as any, 'x'))).toBe(exit)
    }
  })

  it('usage errors exit 2, unknown errors and unmapped codes exit 1', () => {
    expect(exitCodeFor(new UsageError('bad flag'))).toBe(2)
    expect(exitCodeFor(new HafezError('BOGUS' as any, 'x'))).toBe(1)
    expect(exitCodeFor(new Error('boom'))).toBe(1)
    expect(exitCodeFor('not even an error')).toBe(1)
  })
})

describe('global flag extraction', () => {
  it('extracts --vault and --json from anywhere in argv', () => {
    const r = extractGlobalFlags(['read', 'my-slug', '--vault', '/v', '--json'])
    expect(r).toEqual({ rest: ['read', 'my-slug'], vaultFlag: '/v', json: true })
    const r2 = extractGlobalFlags(['--json', 'query', '--filter', 'active'])
    expect(r2.json).toBe(true)
    expect(r2.rest).toEqual(['query', '--filter', 'active'])
  })

  it('a flag in the vault-path position is an error, never consumed', () => {
    // The bedcac5 bug class, applied to the last hand-parsed layer:
    // '--vault --json' used to silently take '--json' as the vault path.
    expect(() => extractGlobalFlags(['--vault', '--json', 'read', 'x'])).toThrow(UsageError)
    expect(() => extractGlobalFlags(['read', 'x', '--vault'])).toThrow(UsageError)
  })

  it('a duplicated --vault is an error, never silently last-wins', () => {
    // The old one-shot extraction left the second --vault for the declared
    // parser to reject; silently taking the last one would point a mutating
    // command at a different vault than the first flag named.
    expect(() => extractGlobalFlags(['read', 'x', '--vault', '/a', '--vault', '/b'])).toThrow(UsageError)
  })
})

describe('the dispatch table covers every command', () => {
  it('pre-vault commands are exactly the vault-free set', () => {
    const preVault = Object.entries(COMMANDS).filter(([, s]) => s.phase === 'pre-vault').map(([n]) => n).sort()
    expect(preVault).toEqual(['help', 'init', 'onboard', 'schema', 'upgrade', 'version'])
  })

  it('every registered command is documented in the usage text', () => {
    // `version` is surfaced as the --version global flag, listed under Global
    // flags rather than as a command. Everything else must appear, or a
    // registered command ships that nothing tells the user about.
    for (const name of Object.keys(COMMANDS)) {
      if (name === 'version') continue
      expect(USAGE, `${name} is registered but missing from USAGE`).toMatch(new RegExp(`^\\s+${name}\\b`, 'm'))
    }
    expect(USAGE).toContain('--version')
  })

  it('mutating commands are exactly the auto-sync set', () => {
    const mutating = Object.entries(COMMANDS)
      .filter(([, s]) => s.phase === 'vault' && s.mutating)
      .map(([n]) => n)
      .sort()
    expect(mutating).toEqual(['batch', 'capture', 'create', 'link', 'promote', 'unlink', 'update'])
  })

  it('export dispatches from the table like any other command', () => {
    expect(COMMANDS.export).toBeDefined()
    expect(COMMANDS.export.phase).toBe('vault')
    expect((COMMANDS.export as { mutating?: boolean }).mutating).toBeUndefined()
  })
})

describe('the unbuilt-bindings heuristic', () => {
  function withStack(message: string, stack: string): Error {
    const err = new Error(message)
    err.stack = stack
    return err
  }

  it('matches the real build/ABI failures it was written for', () => {
    expect(isBindingsFailure(new Error('Could not locate the bindings file. Tried: ...'))).toBe(true)
    expect(isBindingsFailure(new Error("Cannot find module '/x/node_modules/better-sqlite3/build/Release/better_sqlite3.node'"))).toBe(true)
    expect(isBindingsFailure(new Error("The module '/x/better_sqlite3.node' was compiled against a different Node.js version using NODE_MODULE_VERSION 115."))).toBe(true)
    expect(isBindingsFailure(new Error('/x/better_sqlite3.node: invalid ELF header'))).toBe(true)
  })

  it('does not match a query error that merely passed through better-sqlite3', () => {
    // Every SqliteError's stack names better-sqlite3 — matching the stack made
    // the CLI print reinstall advice for `--limit abc` and friends.
    const sqliteErr = withStack(
      'near "abc": syntax error',
      'SqliteError: near "abc": syntax error\n    at Database.prepare (/vault/node_modules/better-sqlite3/lib/methods/wrappers.js:5:21)',
    )
    expect(isBindingsFailure(sqliteErr)).toBe(false)
    expect(isBindingsFailure(withStack('no such column: bogus', 'SqliteError\n at /node_modules/better-sqlite3/lib/database.js:1:1'))).toBe(false)
    expect(isBindingsFailure(new Error('boom'))).toBe(false)
    expect(isBindingsFailure('not an error')).toBe(false)
  })
})
