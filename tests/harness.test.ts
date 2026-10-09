// tests/harness.test.ts
// The agent name recorded in session logs comes from the Harness the command
// runs under, read from the environment, with a neutral fallback.
import { describe, it, expect } from 'vitest'
import { detectAgent, NEUTRAL_AGENT } from '../src/harness.js'

describe('detectAgent', () => {
  it('names Claude Code when CLAUDECODE is set', () => {
    expect(detectAgent({ CLAUDECODE: '1' })).toBe('claude-code')
  })

  it.each(['CODEX_THREAD_ID', 'CODEX_SANDBOX', 'CODEX_SANDBOX_NETWORK_DISABLED'])('names Codex when %s is set', (key) => {
    expect(detectAgent({ [key]: 'x' })).toBe('codex')
  })

  it('falls back to the neutral name when nothing is detectable', () => {
    expect(detectAgent({})).toBe(NEUTRAL_AGENT)
    expect(NEUTRAL_AGENT).toBe('agent')
  })

  it('treats an empty variable as absent', () => {
    expect(detectAgent({ CLAUDECODE: '', CODEX_THREAD_ID: '' })).toBe(NEUTRAL_AGENT)
  })

  // Codex launched from inside Claude Code inherits CLAUDECODE; the harness
  // running the command is the innermost one, and only Codex sets its vars.
  it('prefers Codex when both are present', () => {
    expect(detectAgent({ CLAUDECODE: '1', CODEX_THREAD_ID: 't' })).toBe('codex')
  })

  // Claude Code's Codex plugin exports CODEX_COMPANION_* into Claude Code's
  // own shell; that is not Codex running the command.
  it('ignores CODEX_ variables Codex itself does not set', () => {
    expect(detectAgent({ CLAUDECODE: '1', CODEX_COMPANION_SESSION_ID: 's', CODEX_HOME: '/h' })).toBe('claude-code')
  })

  it('reads process.env by default', () => {
    expect(typeof detectAgent()).toBe('string')
  })
})
