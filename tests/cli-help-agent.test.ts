// tests/cli-help-agent.test.ts
//
// `hafez help --agent` prints the `hafez` skill body: one text from the one
// source (Agent Contract, "Surfaces"), the reference an agent reads when the
// skill is not installed. The byte-for-byte check against the committed skill
// file is in tests/surfaces.test.ts; this file asserts the command's wiring
// and the size an agent pays to read it.

import { describe, it, expect } from 'vitest'
import { execFileSync } from 'child_process'
import { join } from 'path'
import { renderAgentHelp, renderHafezSkill } from '../src/surfaces/surfaces.js'

describe('help --agent', () => {
  it('the built CLI prints the skill body and nothing else', () => {
    const out = execFileSync('node', [join(process.cwd(), 'dist', 'cli.js'), 'help', '--agent'], { encoding: 'utf-8' })
    expect(out).toBe(`${renderAgentHelp()}\n`)
    expect(out.startsWith('# Hafez\n')).toBe(true)
  })

  it('never names itself as the reference, and no longer carries the old API catalogue', () => {
    const out = renderAgentHelp()
    expect(out).not.toContain('help --agent')
    expect(out).not.toContain('<!-- SECTION:')
    expect(out).not.toContain('ALWAYS batch')
  })

  it('is covered by the skill file\'s hash', () => {
    const skill = renderHafezSkill()
    expect(skill.endsWith(`\n${renderAgentHelp()}\n`)).toBe(true)
  })

  it('stays under 1200 tokens', () => {
    // The skill body is read on every invoke and by `help --agent` on every
    // fallback. The cut-over (#100) measured about 670 tokens by the char/3.5
    // proxy, which overcounts, so the ceiling leaves room for an Item or two
    // and fails on a catalogue creeping back in.
    expect(Math.ceil(renderAgentHelp().length / 3.5)).toBeLessThan(1200)
  })
})
