// src/harness.ts
// Which Harness is running this command, read from the environment. The one
// helper the Apply update arm, the CLI's --log and `digest` call to name the
// agent in a session log, and `onboard` calls to pick the Harness it sets up.
// Also where each Harness keeps its instructions file.

/** Recorded when no Harness is detectable. */
export const NEUTRAL_AGENT = 'agent'

/** Variables Codex sets on the commands it runs. CODEX_HOME and the Claude
 * Code plugin's CODEX_COMPANION_* are deliberately absent: both can be set in
 * a shell Codex is not running. */
const CODEX_VARS = ['CODEX_THREAD_ID', 'CODEX_SANDBOX', 'CODEX_SANDBOX_NETWORK_DISABLED']

export function detectAgent(env: Record<string, string | undefined> = process.env): string {
  const set = (key: string): boolean => Boolean(env[key])
  // Codex first: Codex started from inside Claude Code inherits CLAUDECODE,
  // and the innermost Harness is the one running the command.
  if (CODEX_VARS.some(set)) return 'codex'
  if (set('CLAUDECODE')) return 'claude-code'
  return NEUTRAL_AGENT
}

/** Every Harness `onboard` can configure, and where its always-loaded
 * user-level instructions file lives, relative to the home directory (harness
 * research, docs/research/2026-09-29-harness-instruction-surfaces.md): the
 * first candidate that exists, else the last. Cursor keeps its User Rules in a
 * Settings UI, not a file: `null`, and the Block is printed for manual paste.
 * `dir` is the config directory whose presence says the Harness is installed. */
export const HARNESSES = {
  'claude-code': { label: 'Claude Code', dir: '.claude', instructions: ['.claude/CLAUDE.md'] },
  codex: { label: 'Codex', dir: '.codex', instructions: ['.codex/AGENTS.override.md', '.codex/AGENTS.md'] },
  cursor: { label: 'Cursor', dir: '.cursor', instructions: null },
  gemini: { label: 'Gemini CLI', dir: '.gemini', instructions: ['.gemini/GEMINI.md'] },
  copilot: { label: 'Copilot CLI', dir: '.copilot', instructions: ['.copilot/copilot-instructions.md'] },
} as const satisfies Record<string, { label: string; dir: string; instructions: readonly string[] | null }>

export type HarnessId = keyof typeof HARNESSES

/** The Harnesses bare `onboard` sets up from inside — the ones detected from
 * the environment — and, relative to the home directory, where each keeps
 * what the agent applies: the SessionStart hook and the permission entries.
 * `keystroke` invokes the `hafez-save` skill there. */
export const ONBOARD_HARNESSES = {
  'claude-code': { keystroke: '/hafez-save', hooks: '.claude/settings.json', allowEntry: 'Bash(hafez:*)' },
  codex: {
    keystroke: '$hafez-save',
    hooks: '.codex/hooks.json',
    rules: '.codex/rules/default.rules',
    rule: 'prefix_rule(pattern = ["hafez"], decision = "allow")',
    config: '.codex/config.toml',
  },
} as const

export type OnboardHarness = keyof typeof ONBOARD_HARNESSES

export const isOnboardHarness = (value: string): value is OnboardHarness => Object.hasOwn(ONBOARD_HARNESSES, value)

export const isHarness = (value: string): value is HarnessId => Object.hasOwn(HARNESSES, value)
