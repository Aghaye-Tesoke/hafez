// tests/cli-args.test.ts
// C5: the declared-flag parser and handler behavior WITHOUT subprocess
// spawns — handlers take (os, args) and return strings, so a stub Hafez is
// enough. The exit-code contract itself is asserted in cli.test.ts against
// the real binary.
import { describe, it, expect } from 'vitest'
import { HelpRequest, parseArgs, splitList, UsageError } from '../src/cli/args.js'
import { cmdRead, cmdUpdate, cmdCapture, cmdQuery } from '../src/cli/commands.js'
import type { Hafez } from '../src/types.js'

describe('parseArgs', () => {
  it('parses declared string and boolean flags and positionals', () => {
    const { flags, positionals } = parseArgs(
      ['my-slug', '--brief', 'text here', '--clear-actions'],
      { brief: 'string', 'clear-actions': 'boolean' },
      'usage',
    )
    expect(positionals).toEqual(['my-slug'])
    expect(flags.brief).toBe('text here')
    expect(flags['clear-actions']).toBe(true)
  })

  it('flag values never leak into positionals (the parseLinkArgs bug class)', () => {
    const { flags, positionals } = parseArgs(
      ['a', 'b', '--relation', 'parent'],
      { relation: 'string' },
      'usage',
    )
    expect(positionals).toEqual(['a', 'b'])
    expect(flags.relation).toBe('parent')
  })

  it('rejects unknown flags with a UsageError', () => {
    expect(() => parseArgs(['--bogus', 'v'], { brief: 'string' }, 'usage'))
      .toThrow(UsageError)
  })

  it('rejects a flag named after an Object.prototype member as unknown (#134)', () => {
    for (const name of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
      expect(() => parseArgs([`--${name}`, 'v'], { brief: 'string' }, 'usage'))
        .toThrow(`Unknown flag --${name}`)
    }
  })

  it('--help or -h anywhere outside value position is a HelpRequest carrying the usage (#32)', () => {
    for (const args of [['--help'], ['-h'], ['slug', '--brief', 'x', '-h']]) {
      let caught: unknown
      try { parseArgs(args, { brief: 'string' }, 'the usage') } catch (err) { caught = err }
      expect(caught).toBeInstanceOf(HelpRequest)
      expect(caught).not.toBeInstanceOf(UsageError)
      expect((caught as HelpRequest).usage).toBe('the usage')
    }
    expect(parseArgs(['--brief', '-h'], { brief: 'string' }, 'usage').flags.brief).toBe('-h')
  })

  it('rejects a string flag with no value', () => {
    expect(() => parseArgs(['--brief'], { brief: 'string' }, 'usage'))
      .toThrow(/requires a value/)
  })

  it('rejects a declared flag in value position instead of swallowing it', () => {
    // `--brief --clear-actions`: consuming the token would both corrupt the
    // brief and silently drop the clear
    expect(() => parseArgs(
      ['--brief', '--clear-actions'],
      { brief: 'string', 'clear-actions': 'boolean' },
      'usage',
    )).toThrow(/--brief requires a value/)
  })

  it('a repeatable flag collects every value, in order', () => {
    const { flags } = parseArgs(['--add-action', 'a', '--add-action', 'b'], { 'add-action': 'repeat' }, 'usage')
    expect(flags['add-action']).toEqual(['a', 'b'])
  })

  it('a repeatable flag given once is still a list', () => {
    const { flags } = parseArgs(['--add-action', 'a'], { 'add-action': 'repeat' }, 'usage')
    expect(flags['add-action']).toEqual(['a'])
  })

  // Never last-wins: a silently overwritten value is a dropped value.
  it('a repeated scalar flag is a UsageError naming the flag', () => {
    expect(() => parseArgs(['--brief', 'x', '--brief', 'y'], { brief: 'string' }, 'usage'))
      .toThrow(UsageError)
    expect(() => parseArgs(['--brief', 'x', '--brief', 'y'], { brief: 'string' }, 'usage'))
      .toThrow(/--brief/)
  })

  it('a repeated boolean flag is a UsageError too', () => {
    expect(() => parseArgs(['--clear-actions', '--clear-actions'], { 'clear-actions': 'boolean' }, 'usage'))
      .toThrow(/--clear-actions/)
  })

  it('splitList trims comma lists', () => {
    expect(splitList('a, b ,c')).toEqual(['a', 'b', 'c'])
    expect(splitList(undefined)).toBeUndefined()
  })
})

describe('handlers without subprocess spawns', () => {
  it('cmdRead maps --depth and slug onto the core call', async () => {
    const calls: unknown[] = []
    const os = {
      read: async (slug: string, depth: string) => {
        calls.push([slug, depth])
        return { frontmatter: { name: 'X', type: 'entity' }, body: '' }
      },
    } as unknown as Hafez
    await cmdRead(os, ['my-slug', '--depth', 'full'])
    expect(calls).toEqual([['my-slug', 'full']])
  })

  it('cmdRead without a slug is a UsageError', async () => {
    await expect(cmdRead({} as Hafez, [])).rejects.toThrow(UsageError)
  })

  it('cmdUpdate maps flags to typed fields (empty --brief clears)', async () => {
    const calls: Record<string, unknown>[] = []
    const os = {
      update: async (slug: string, fields: Record<string, unknown>) => {
        calls.push({ slug, ...fields })
        return {}
      },
      // A knowledge target, so no session log is added: this test pins the
      // flag mapping alone (the added entry is tests/cli-update-session-log).
      read: async () => ({ kind: 'knowledge' }),
    } as unknown as Hafez
    await cmdUpdate(os, ['s', '--brief', '', '--tags', 'a,b', '--clear-actions'])
    expect(calls[0]).toEqual({ slug: 's', brief: null, tags: ['a', 'b'], clear_actions: true })
  })

  it('cmdUpdate maps a repeated --add-action to the add_actions array field', async () => {
    const calls: Record<string, unknown>[] = []
    const os = {
      update: async (slug: string, fields: Record<string, unknown>) => { calls.push(fields); return {} },
      // A knowledge target: no stale reminder to read for.
      read: async () => ({ kind: 'knowledge' }),
    } as unknown as Hafez
    await cmdUpdate(os, ['s', '--add-action', 'a', '--add-action', 'b'])
    await cmdUpdate(os, ['s', '--add-action', 'one'])
    expect(calls).toEqual([{ add_actions: ['a', 'b'] }, { add_action: 'one' }])
  })

  // The repeated-scalar rule lives in the one parser, so it binds every
  // command — not just update and create. Last-wins here queried `b` alone.
  it('cmdQuery rejects a repeated --tag instead of keeping the last', async () => {
    await expect(cmdQuery({} as Hafez, ['--tag', 'a', '--tag', 'b'])).rejects.toThrow(/--tag was given more than once/)
  })

  it('cmdUpdate still fails loudly on the removed --next-action flag', async () => {
    await expect(cmdUpdate({} as Hafez, ['s', '--next-action', 'x']))
      .rejects.toThrow(/removed in v1.0.2/)
  })

  it('cmdCapture joins positionals into the name', async () => {
    const calls: unknown[] = []
    const os = {
      capture: async (name: string, notes?: string) => { calls.push([name, notes]); return 'slug' },
    } as unknown as Hafez
    await cmdCapture(os, ['Multi', 'Word', 'Name', '--notes', 'n'])
    expect(calls).toEqual([[ 'Multi Word Name', 'n' ]])
  })
})
