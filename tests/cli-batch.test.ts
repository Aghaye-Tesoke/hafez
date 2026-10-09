// tests/cli-batch.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'child_process'
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { simpleGit } from 'simple-git'
import { join } from 'path'
import { tmpdir } from 'os'
import { parseBatchInput } from '../src/cli/commands.js'
import { HafezError } from '../src/types.js'

describe('parseBatchInput', () => {
  it('parses a valid batch of updates', () => {
    const ops = parseBatchInput(JSON.stringify([
      { op: 'update', slug: 'foo', fields: { status: 'done' } },
      { op: 'update', slug: 'bar', fields: { add_action: 'Write tests' } },
    ]))
    expect(ops).toHaveLength(2)
    expect(ops[0]).toEqual({ op: 'update', slug: 'foo', fields: { status: 'done' } })
  })

  it('parses mixed operation types', () => {
    const ops = parseBatchInput(JSON.stringify([
      { op: 'update', slug: 'foo', fields: { status: 'active' } },
      { op: 'create', kind: 'entity', name: 'New Project', fields: { type: 'project' } },
      { op: 'capture', name: 'Quick note' },
      { op: 'link', slug: 'a', target: 'b', relation: 'related' },
      { op: 'unlink', slug: 'a', target: 'b', relation: 'related' },
      { op: 'create', kind: 'session', name: 'Session 2026-04-06 10:00:00' },
    ]))
    expect(ops).toHaveLength(6)
  })

  it('parses update with session_log', () => {
    const ops = parseBatchInput(JSON.stringify([
      { op: 'update', slug: 'foo', fields: {
        session_log: { type: 'progress', summary: 'Did stuff', agent: 'claude' },
      } },
    ]))
    expect(ops[0]).toEqual({
      op: 'update', slug: 'foo', fields: {
        session_log: { type: 'progress', summary: 'Did stuff', agent: 'claude' },
      },
    })
  })

  it('throws VALIDATION_FAILED on invalid JSON', () => {
    expect(() => parseBatchInput('not json')).toThrow(HafezError)
    try { parseBatchInput('not json') } catch (e) {
      expect((e as HafezError).code).toBe('VALIDATION_FAILED')
    }
  })

  it('throws VALIDATION_FAILED on non-array input', () => {
    expect(() => parseBatchInput('{"op":"update"}')).toThrow(HafezError)
    try { parseBatchInput('{"op":"update"}') } catch (e) {
      expect((e as HafezError).code).toBe('VALIDATION_FAILED')
      expect((e as HafezError).message).toContain('array')
    }
  })

  it('throws VALIDATION_FAILED on empty array', () => {
    expect(() => parseBatchInput('[]')).toThrow(HafezError)
    try { parseBatchInput('[]') } catch (e) {
      expect((e as HafezError).code).toBe('VALIDATION_FAILED')
      expect((e as HafezError).message).toContain('empty')
    }
  })

  it('throws VALIDATION_FAILED with index on schema violation', () => {
    const input = JSON.stringify([
      { op: 'update', slug: 'foo', fields: { status: 'active' } },
      { op: 'update', slug: 'bar' }, // missing fields
    ])
    expect(() => parseBatchInput(input)).toThrow(HafezError)
    try { parseBatchInput(input) } catch (e) {
      expect((e as HafezError).code).toBe('VALIDATION_FAILED')
      const err = e as HafezError
      expect(err.details).toBeDefined()
      expect(err.details?.join('\n')).toContain('index 1')
    }
  })

  it('throws VALIDATION_FAILED on unknown op', () => {
    const input = JSON.stringify([{ op: 'archive', slug: 'foo' }])
    expect(() => parseBatchInput(input)).toThrow(HafezError)
    try { parseBatchInput(input) } catch (e) {
      expect((e as HafezError).code).toBe('VALIDATION_FAILED')
      const err = e as HafezError
      expect(err.details?.join('\n')).toContain('index 0')
    }
  })

  it('parses create entity with brief and add_action', () => {
    const ops = parseBatchInput(JSON.stringify([
      { op: 'create', kind: 'entity', name: 'Test', fields: {
        type: 'project', brief: 'Context.', add_action: 'First task',
      } },
    ]))
    expect(ops).toHaveLength(1)
    const op = ops[0] as any
    expect(op.fields.brief).toBe('Context.')
    expect(op.fields.add_action).toBe('First task')
  })

  it('accepts knowledge metadata fields in batch update schema', () => {
    const ops = parseBatchInput(JSON.stringify([
      { op: 'update', slug: 'some-knowledge', fields: {
        domain: ['engineering', 'ai'],
        confidence: 'pattern',
        tags: ['testing'],
        related: ['other-slug'],
        insight: 'Updated insight text',
      } },
    ]))
    expect(ops).toHaveLength(1)
    const op = ops[0] as any
    expect(op.fields.domain).toEqual(['engineering', 'ai'])
    expect(op.fields.confidence).toBe('pattern')
    expect(op.fields.tags).toEqual(['testing'])
    // insight is aliased to synthesis during parsing
    expect(op.fields.synthesis).toBe('Updated insight text')
    expect(op.fields.insight).toBeUndefined()
  })

  it('accepts synthesis field directly in batch update schema', () => {
    const ops = parseBatchInput(JSON.stringify([
      { op: 'update', slug: 'some-knowledge', fields: {
        synthesis: 'Direct synthesis text',
        add_evidence: 'New evidence item',
        add_source: 'https://example.com',
      } },
    ]))
    expect(ops).toHaveLength(1)
    const op = ops[0] as any
    expect(op.fields.synthesis).toBe('Direct synthesis text')
    expect(op.fields.add_evidence).toBe('New evidence item')
    expect(op.fields.add_source).toBe('https://example.com')
  })

  it('synthesis takes precedence over insight when both are provided in batch', () => {
    const ops = parseBatchInput(JSON.stringify([
      { op: 'update', slug: 'some-knowledge', fields: {
        synthesis: 'Explicit synthesis',
        insight: 'Legacy insight',
      } },
    ]))
    expect(ops).toHaveLength(1)
    const op = ops[0] as any
    // synthesis already present, so insight alias should not overwrite it
    expect(op.fields.synthesis).toBe('Explicit synthesis')
  })

  it('accepts add_actions (plural) in batch update schema', () => {
    const ops = parseBatchInput(JSON.stringify([
      { op: 'update', slug: 'some-entity', fields: {
        add_actions: ['First action', 'Second action'],
      } },
    ]))
    expect(ops).toHaveLength(1)
    const op = ops[0] as any
    expect(op.fields.add_actions).toEqual(['First action', 'Second action'])
  })

  it('rejects invalid confidence value in update schema', () => {
    const input = JSON.stringify([
      { op: 'update', slug: 'foo', fields: { confidence: 'confirmed' } },
    ])
    expect(() => parseBatchInput(input)).toThrow(HafezError)
    try { parseBatchInput(input) } catch (e) {
      expect((e as HafezError).code).toBe('VALIDATION_FAILED')
    }
  })

  it('gives clear deprecation message for retired reinforce op', () => {
    const input = JSON.stringify([
      { op: 'reinforce', slug: 'some-knowledge', evidence: 'new data' },
    ])
    expect(() => parseBatchInput(input)).toThrow(HafezError)
    try { parseBatchInput(input) } catch (e) {
      expect((e as HafezError).code).toBe('VALIDATION_FAILED')
      const err = e as HafezError
      const blob = err.details?.join('\n') ?? ''
      expect(blob).toContain('reinforce')
      expect(blob).toContain('deprecated')
      expect(blob).toContain('add_evidence')
    }
  })

  // --- Phase 1: multi-error + did-you-mean + strict coverage ---

  it('unrecognized key on link op suggests "relation" for "kind"', () => {
    const input = JSON.stringify([
      { op: 'link', slug: 'foo', target: 'bar', kind: 'parent' },
    ])
    try { parseBatchInput(input) } catch (e) {
      const err = e as HafezError
      const blob = err.details?.join('\n') ?? ''
      expect(blob).toContain('unknown field')
      expect(blob).toContain('did you mean "relation"')
    }
  })

  it('invalid enum on session_log.type lists expected values', () => {
    const input = JSON.stringify([
      { op: 'update', slug: 'foo', fields: { session_log: { type: 'audit', summary: 's', agent: 'claude' } } },
    ])
    try { parseBatchInput(input) } catch (e) {
      const err = e as HafezError
      const blob = err.details?.join('\n') ?? ''
      expect(blob).toContain('progress')
      expect(blob).toContain('decision')
      expect(blob).toContain('blocker')
      expect(blob).toContain('research')
    }
  })

  it('typo in op reports unknown op with full op list', () => {
    const input = JSON.stringify([{ op: 'updaet', slug: 'foo', fields: { status: 'done' } }])
    try { parseBatchInput(input) } catch (e) {
      const err = e as HafezError
      const blob = err.details?.join('\n') ?? ''
      expect(blob).toContain('unknown op')
      expect(blob).toContain('update')
      expect(blob).toContain('create')
    }
  })

  it('multi-error: 3 ops each failing once returns 3 detail blocks', () => {
    const input = JSON.stringify([
      { op: 'update', slug: 'a', fields: { status: 'paaused' } }, // bad enum
      { op: 'link', slug: 'b', target: 'c', kind: 'parent' },     // unknown key
      { op: 'create', kind: 'entity', name: 'n', fields: { type: 'nope' } }, // bad enum
    ])
    try { parseBatchInput(input) } catch (e) {
      const err = e as HafezError
      expect(err.details).toBeDefined()
      expect(err.details!.length).toBe(3)
      const blob = err.details!.join('\n')
      expect(blob).toContain('index 0')
      expect(blob).toContain('index 1')
      expect(blob).toContain('index 2')
    }
  })

  it('multi-error: 1 op with 3 simultaneous issues returns 3 issues in one block', () => {
    const input = JSON.stringify([
      { op: 'update', slug: 'a', fields: { status: 'bad', confidence: 'bad', unknown_field: 'x' } },
    ])
    try { parseBatchInput(input) } catch (e) {
      const err = e as HafezError
      expect(err.details).toBeDefined()
      // Multi-issue within one op is concatenated into a single details entry
      // by formatBatchError, so details.length should be 1 but contain 3 blocks.
      expect(err.details!.length).toBe(1)
      const block = err.details![0]
      const issueCount = (block.match(/\[index 0\]/g) || []).length
      expect(issueCount).toBeGreaterThanOrEqual(3)
    }
  })

  // #151: Zod v4 sets no `received` on an issue, so `got` comes from the op
  // payload at the issue's path — and is left out when nothing is there.
  function blockFor(op: unknown): string {
    try { parseBatchInput(JSON.stringify([op])) } catch (e) {
      return (e as HafezError).details?.join('\n') ?? ''
    }
    throw new Error('expected parseBatchInput to throw')
  }

  it('wrong type reports the value sent', () => {
    const block = blockFor({ op: 'create', kind: 'knowledge', name: 'probe', fields: { domain: 5 } })
    expect(block).toContain('issue: wrong type')
    expect(block).toMatch(/got: +5$/m)
    expect(block).not.toContain('undefined')
  })

  it('wrong type at a nested path reports the value at that path', () => {
    const block = blockFor({ op: 'update', slug: 'foo', fields: {
      session_log: { type: 'progress', summary: { x: 1 }, agent: 'claude' },
    } })
    expect(block).toContain('field: fields.session_log.summary')
    expect(block).toMatch(/got: +\{"x":1\}$/m)
  })

  it('wrong type with nothing at the path has no got line', () => {
    const block = blockFor({ op: 'create', kind: 'knowledge', fields: {} })
    expect(block).toContain('field: name')
    expect(block).toContain('issue: wrong type')
    expect(block).not.toMatch(/got:/)
  })

  it('a long value sent is truncated', () => {
    const block = blockFor({ op: 'update', slug: 'foo', fields: { session_log: 'x'.repeat(200) } })
    const got = block.match(/got: +(.*)$/m)?.[1] ?? ''
    expect(got.startsWith('"xxx')).toBe(true)
    expect(got.endsWith('…')).toBe(true)
    expect(got.length).toBe(60)
  })

  it('invalid value reports the value sent', () => {
    const block = blockFor({ op: 'update', slug: 'foo', fields: { status: 'bogus' } })
    expect(block).toContain('issue: invalid value')
    expect(block).toMatch(/got: +"bogus"$/m)
  })

  it('insight → synthesis alias still normalizes post-refactor', () => {
    const ops = parseBatchInput(JSON.stringify([
      { op: 'update', slug: 'k', fields: { insight: 'note text' } },
    ]))
    const op = ops[0] as any
    expect(op.fields.synthesis).toBe('note text')
    expect(op.fields.insight).toBeUndefined()
  })
})

describe('parseBatchInput description/resource null-clear', () => {
  it('accepts null to clear description and resource on update', () => {
    const ops = parseBatchInput(JSON.stringify([
      { op: 'update', slug: 'x', fields: { description: null, resource: null } },
    ]))
    expect(ops).toHaveLength(1)
    expect((ops[0] as any).fields.description).toBeNull()
    expect((ops[0] as any).fields.resource).toBeNull()
  })
})

// #145: the hafez skill's batch example keeps its JSON in single quotes, so a
// straight apostrophe in a brief or an action ends the argument. The skill
// names the apostrophe to write instead; the example, filled in that way, runs
// in a real shell as written.
describe('the hafez skill batch example, through a real shell', () => {
  const skill = readFileSync(join(process.cwd(), 'skill', 'hafez', 'SKILL.md'), 'utf-8')
  const PROSE = "Mobile isn't migrated; $HOME and `date` stay literal"
  const SHELLS = ['bash', 'sh', 'zsh'].filter(sh => spawnSync(sh, ['-c', 'true']).status === 0)
  const dir = join(tmpdir(), 'hafez-test-cli-batch-shell-' + Date.now())
  const shimDir = join(dir, 'bin')
  const CLI = join(process.cwd(), 'dist', 'cli.js')

  /** The apostrophe the skill says to write inside the quoted JSON. */
  const apostrophe = () => skill.match(/write each apostrophe as `([^`]+)`/)?.[1]

  beforeAll(() => {
    mkdirSync(shimDir, { recursive: true })
    writeFileSync(join(shimDir, 'hafez'), `#!/bin/sh\nexec node '${CLI}' --vault "$HAFEZ_TEST_VAULT" "$@"\n`)
    chmodSync(join(shimDir, 'hafez'), 0o755)
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('names an apostrophe that is not the one that ends the quotes', () => {
    expect(apostrophe()).toBeDefined()
    expect(apostrophe()).not.toContain("'")
  })

  it.each(SHELLS)('%s: a brief and an action with an apostrophe, a $VAR and a backtick land', async shell => {
    const vault = join(dir, shell)
    mkdirSync(join(vault, 'entities'), { recursive: true })
    mkdirSync(join(vault, 'knowledge'), { recursive: true })
    await simpleGit(vault).init()
    await simpleGit(vault).commit('init', ['--allow-empty'])
    const env = { ...process.env, PATH: `${shimDir}:${process.env.PATH}`, HAFEZ_TEST_VAULT: vault }
    // The example links to a parent it does not create.
    expect(spawnSync('hafez', ['create', 'entity', 'Auth Refactor', '--type', 'project'], { env, encoding: 'utf-8' }).stdout.trim()).toBe('auth-refactor')

    const prose = JSON.stringify(PROSE).slice(1, -1).replace(/'/g, apostrophe() ?? "'")
    const command = skill.match(/```\n(hafez batch --data '[\s\S]*?)\n```/)![1]
      .replace('"fields":{"type":"entity"}', `"fields":{"type":"entity","brief":"${prose}","add_action":"${prose}"}`)

    expect(command).toContain('"brief"')

    const result = spawnSync(shell, ['-c', command], { env, encoding: 'utf-8' })
    expect(result.stderr).toBe('')
    expect(result.stdout).toMatch(/^Batch complete: 2 operations/)
    const literal = PROSE.replace(/'/g, apostrophe() ?? "'")
    const body = readFileSync(join(vault, 'entities', 'token-rotation.md'), 'utf-8')
    expect(body).toContain(`## Brief\n\n${literal}\n`)
    expect(body).toContain(`- [ ] ${literal}`)
    expect(body).toMatch(/^parent: auth-refactor$/m)
  })
})
