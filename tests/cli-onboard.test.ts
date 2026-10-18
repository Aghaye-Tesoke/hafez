// tests/cli-onboard.test.ts
//
// Bare `hafez onboard`: the status lines, then the script the agent follows.
// The temp-home seam: what a first run prints and what a re-run walks once
// things are installed; the teaching lines equal the Teaching lines blocks of
// tests/fixtures/surfaces/onboard.md. The bare render and the seeding step are checked
// whole in tests/surfaces.test.ts.

import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname } from 'path'
import { cmdOnboard } from '../src/cli/onboard.js'
import { UsageError } from '../src/cli/args.js'
import { ITEMS } from '../src/surfaces/items.js'
import { contentHash, renderBlock, renderHafezSkill, renderHafezSaveSkill } from '../src/surfaces/surfaces.js'

const DRAFT = readFileSync('tests/fixtures/surfaces/onboard.md', 'utf-8')
/** The Teaching lines section's blocks: always-on, then invoke-only's line 2. */
const [ALWAYS_ON_LINES, INVOKE_ONLY_LINE_2] = [...DRAFT.slice(DRAFT.indexOf('## Teaching lines')).matchAll(/^```\n([\s\S]*?)\n```$/gm)]
  .map(m => m[1])

const CLAUDE = { CLAUDECODE: '1' }
const CODEX = { CODEX_THREAD_ID: 't1' }

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

function put(root: string, rel: string, text: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true })
  writeFileSync(join(root, rel), text)
}

/** A vault with `entities` entity files and `knowledge` knowledge notes. */
function makeVault(entities: number, knowledge: number): string {
  const vault = tempDir('hafez-vault-')
  mkdirSync(join(vault, 'entities'))
  mkdirSync(join(vault, 'knowledge'))
  for (let i = 0; i < entities; i++) put(vault, `entities/e${i}.md`, '')
  for (let i = 0; i < knowledge; i++) put(vault, `knowledge/k${i}.md`, '')
  return vault
}

function makeHome(files: Record<string, string> = {}, dirsToMake: string[] = []): string {
  const home = tempDir('hafez-home-')
  for (const dir of dirsToMake) mkdirSync(join(home, dir), { recursive: true })
  for (const [rel, text] of Object.entries(files)) put(home, rel, text)
  return home
}

const SETTINGS = '.claude/settings.json'
const HOOK_ENTRY = { matcher: 'startup|compact', hooks: [{ type: 'command', command: 'hafez onboard --block --harness claude-code' }] }
const settings = (opts: { allow?: boolean; hook?: boolean }) => JSON.stringify({
  ...(opts.allow ? { permissions: { allow: ['Bash(git:*)', 'Bash(hafez:*)'] } } : {}),
  ...(opts.hook ? { hooks: { SessionStart: [HOOK_ENTRY] } } : {}),
})

const INSTALLED = {
  '.claude/CLAUDE.md': `# Mine\n\n${renderBlock()}`,
  '.claude/skills/hafez/SKILL.md': renderHafezSkill(),
  '.claude/skills/hafez-save/SKILL.md': renderHafezSaveSkill(),
  '.agents/skills/hafez/SKILL.md': renderHafezSkill(),
  '.agents/skills/hafez-save/SKILL.md': renderHafezSaveSkill(),
}

const { ['.claude/CLAUDE.md']: _block, ...SKILLS_ONLY } = INSTALLED

/** A skill an older release wrote: its text matches its own hash, not the render. */
function olderSkill(render: () => string): string {
  const close = render().indexOf('\n---\n', 4) + '\n---\n'.length
  const body = render().slice(close).replace('# Hafez', '# Hafez, older')
  return render().slice(0, close).replace(/^hash: .*$/m, `hash: ${contentHash(body)}`) + body
}

const onboard = (home: string, vault: string, env: Record<string, string> = CLAUDE, args: string[] = []) =>
  cmdOnboard(args, { home, env, vaultFlag: vault }) as string

const teaching = (harness: 'claude-code' | 'codex', mode: 'always-on' | 'invoke-only') =>
  ITEMS.teachingLines.render({ harness, mode })

describe('bare onboard: the render', () => {
  it('on an empty vault, step 6 seeds and is not marked skipped', () => {
    const out = onboard(makeHome({}, ['.codex']), makeVault(0, 0))
    expect(out).toContain('\n\n## 6. Seed the vault\n\nAn empty vault gives you nothing to load.')
    expect(out).toContain('\n\n## 7. Hand over')
    expect(out).not.toContain('skipped: the vault is not empty')
  })

  it('counts one entity and one note in the singular', () => {
    const vault = makeVault(1, 1)
    expect(onboard(makeHome(), vault)).toContain(`Vault: ${vault} (1 entity, 1 knowledge note)`)
  })
})

describe('the teaching lines', () => {
  it('equal the draft\'s always-on block under Claude Code', () => {
    expect(teaching('claude-code', 'always-on')).toBe(ALWAYS_ON_LINES)
  })

  it('carry $hafez-save under Codex in line 1, and nothing else changes', () => {
    expect(teaching('codex', 'always-on')).toBe(ALWAYS_ON_LINES.replace('/hafez-save', '$hafez-save'))
  })

  it('invoke-only swaps line 2 for the draft\'s', () => {
    const lines = teaching('claude-code', 'invoke-only').split('\n')
    expect(lines).toEqual([...ALWAYS_ON_LINES.split('\n').slice(0, 1), INVOKE_ONLY_LINE_2, ...ALWAYS_ON_LINES.split('\n').slice(2)])
  })

  it('under Codex, the bare render teaches $hafez-save', () => {
    const out = onboard(makeHome(), makeVault(1, 0), CODEX)
    expect(out).toContain('1. Nothing saves itself. Run $hafez-save before you end a session.')
    expect(out).not.toContain('/hafez-save')
  })
})

describe('bare onboard: re-run walks only what is not current', () => {
  const steps = (out: string) => [...out.matchAll(/^## (\d+)\. (.*)$/gm)].map(m => `${m[1]}. ${m[2]}`)

  it('with a current install, omits the install and hook steps and repeats no teaching line', () => {
    const home = makeHome({ ...INSTALLED, [SETTINGS]: settings({ allow: true, hook: true }) })
    const out = onboard(home, makeVault(3, 0))
    expect(out).toContain('Claude Code (this harness): Block current | skills current | hook present | allowlist present')
    expect(steps(out)).toEqual([
      '1. Ask how Hafez should run',
      '2. Seed the vault (skipped: the vault is not empty)',
      '3. Hand over',
    ])
    for (const line of teaching('claude-code', 'always-on').split('\n')) expect(out).not.toContain(line.slice(3))
    // A Mode switch is still one command away, and teaches the new line 2.
    expect(out).toContain('It runs always-on now. To switch to invoke-only, run:\n\nhafez onboard --install --mode invoke-only')
    expect(out).toContain(INVOKE_ONLY_LINE_2)
  })

  it('reads a cloud Block (#160) as current: no install step that would drop its rule', () => {
    const home = makeHome({ ...INSTALLED, '.claude/CLAUDE.md': renderBlock('ana/vault'), [SETTINGS]: settings({ allow: true, hook: true }) })
    const out = onboard(home, makeVault(3, 0))
    expect(out).toContain('Claude Code (this harness): Block current | skills current')
    expect(steps(out)).not.toContain('2. Install')
  })

  it('with a cloud Block stale, the install step keeps it a cloud Block', () => {
    const home = makeHome({
      ...INSTALLED,
      '.claude/CLAUDE.md': renderBlock('ana/vault'),
      '.agents/skills/hafez/SKILL.md': olderSkill(renderHafezSkill),
      [SETTINGS]: settings({ allow: true, hook: true }),
    })
    const out = onboard(home, makeVault(3, 0))
    expect(steps(out)).toContain('2. Install')
    expect(out).toContain('\nhafez onboard --install --mode always-on --vault-repo ana/vault\n')
    expect(out).toContain(renderBlock('ana/vault'))
    expect(out).not.toContain(renderBlock())
  })

  it('with only a skill stale, walks the install step and not the hook step', () => {
    const home = makeHome({
      ...INSTALLED,
      '.agents/skills/hafez/SKILL.md': olderSkill(renderHafezSkill),
      [SETTINGS]: settings({ allow: true, hook: true }),
    })
    const out = onboard(home, makeVault(3, 0))
    expect(out).toContain('Block current | skills stale | hook present | allowlist present')
    expect(steps(out)).toEqual([
      '1. Ask how Hafez should run',
      '2. Install',
      '3. Seed the vault (skipped: the vault is not empty)',
      '4. Hand over',
    ])
    expect(out).toContain('It runs always-on now.')
  })

  it('walks the hook step and not the allowlist step when only the allowlist is in place', () => {
    const home = makeHome({ ...INSTALLED, [SETTINGS]: settings({ allow: true }) })
    expect(steps(onboard(home, makeVault(3, 0)))).toEqual([
      '1. Ask how Hafez should run',
      '2. Offer the session-start hook (always-on only)',
      '3. Seed the vault (skipped: the vault is not empty)',
      '4. Hand over',
    ])
  })

  it('with a current invoke-only install, omits the install and hook steps; the switch shows the Block', () => {
    const out = onboard(makeHome({ ...SKILLS_ONLY, [SETTINGS]: settings({ allow: true }) }), makeVault(3, 0))
    expect(out).toContain('Block absent | skills current | hook absent | allowlist present')
    expect(steps(out)).toEqual([
      '1. Ask how Hafez should run',
      '2. Seed the vault (skipped: the vault is not empty)',
      '3. Hand over',
    ])
    expect(out).toContain('It runs invoke-only now. To switch to always-on, show the user the Block below word for word, not a summary, say it goes into ~/.claude/CLAUDE.md')
    expect(out).toContain(`hafez onboard --install --mode always-on\n\nthen \`hafez onboard\` again for the session-start hook.\n\n\`\`\`\`\n${renderBlock()}\`\`\`\``)
    expect(out).toContain(ALWAYS_ON_LINES.split('\n')[1])
    expect(out).not.toContain(INVOKE_ONLY_LINE_2)
  })

  it('a switch to invoke-only names the hook entry to remove', () => {
    const out = onboard(makeHome({ ...INSTALLED, [SETTINGS]: settings({ allow: true, hook: true }) }), makeVault(3, 0))
    expect(out).toContain('and remove the hafez entry from hooks.SessionStart in ~/.claude/settings.json.')
  })

  it('with a stale invoke-only install, walks the install step and not the hook step', () => {
    const out = onboard(makeHome({ ...SKILLS_ONLY, '.claude/skills/hafez/SKILL.md': olderSkill(renderHafezSkill) }), makeVault(3, 0))
    expect(out).toContain('Block absent | skills stale')
    expect(steps(out)).toEqual([
      '1. Ask how Hafez should run',
      '2. Install',
      '3. Allow the command',
      '4. Seed the vault (skipped: the vault is not empty)',
      '5. Hand over',
    ])
  })

  it('reports a hand-edited skill as hand-edited', () => {
    const home = makeHome({ ...INSTALLED, '.claude/skills/hafez/SKILL.md': renderHafezSkill().replace('# Hafez', '# Mine') })
    expect(onboard(home, makeVault(1, 0))).toContain('Block current | skills hand-edited')
  })

  it('treats a setup from before onboard (a skill with no hash, no Block) as a first run', () => {
    const out = onboard(makeHome({ '.claude/skills/hafez/SKILL.md': '---\nname: hafez\n---\nold body\n' }), makeVault(3, 0))
    expect(out).toContain('Block absent | skills stale')
    expect(out).not.toContain('now.')
    expect(out).toContain(ALWAYS_ON_LINES)
  })

  it('offers no other harness when none is found, and offers each one found that is not current', () => {
    expect(onboard(makeHome(), makeVault(1, 0))).not.toContain('Offer the other harness')
    const out = onboard(makeHome({}, ['.codex', '.gemini', '.cursor']), makeVault(1, 0))
    expect(out).toContain('Gemini CLI (found at ~/.gemini): Block absent | skills absent')
    expect(out).toContain('Cursor (found at ~/.cursor): skills absent')
    expect(out).toContain('Codex, Cursor and Gemini CLI are installed too. Ask once whether to set them up the same way. If yes:\n\n'
      + 'hafez onboard --install --harness codex --mode always-on\n'
      + 'hafez onboard --install --harness cursor --mode always-on\n'
      + 'hafez onboard --install --harness gemini --mode always-on')
  })

  it('offers another harness with the Mode in place on a re-run', () => {
    const out = onboard(makeHome({ ...SKILLS_ONLY }, ['.gemini']), makeVault(1, 0))
    expect(out).toContain('Gemini CLI (found at ~/.gemini): Block absent | skills current')
    expect(out).not.toContain('Offer the other harness')
    const stale = onboard(makeHome({ ...SKILLS_ONLY, '.agents/skills/hafez/SKILL.md': olderSkill(renderHafezSkill) }, ['.gemini']), makeVault(1, 0))
    expect(stale).toContain('hafez onboard --install --harness gemini --mode invoke-only')
  })

  it('does not offer another harness whose install is current', () => {
    const home = makeHome({ ...INSTALLED, '.codex/AGENTS.md': renderBlock() })
    const out = onboard(home, makeVault(1, 0))
    expect(out).toContain('Codex (found at ~/.codex): Block current | skills current')
    expect(out).not.toContain('Offer the other harness')
  })

  it('treats an unreadable settings file as nothing in place', () => {
    const out = onboard(makeHome({ [SETTINGS]: '{ not json' }), makeVault(1, 0))
    expect(out).toContain('hook absent | allowlist absent')
  })
})

describe('bare onboard: broken markers', () => {
  const steps = (out: string) => [...out.matchAll(/^## (\d+)\. (.*)$/gm)].map(m => `${m[1]}. ${m[2]}`)
  const BEGIN_ONLY = `# Mine\n\n${renderBlock().split('<!-- hafez:end -->')[0]}`
  const FIX = 'The Hafez markers in ~/.claude/CLAUDE.md are broken: expected one "<!-- hafez:begin <hash> -->" line followed by one "<!-- hafez:end -->" line. '
    + 'Fix or delete them by hand, then re-run `hafez onboard`.'

  it('reports them in the status with the file and the hand fix, and prints the rest of the script', () => {
    const home = makeHome({ ...INSTALLED, '.claude/CLAUDE.md': BEGIN_ONLY, [SETTINGS]: settings({ allow: true }) })
    const out = onboard(home, makeVault(3, 0))
    expect(out).toContain('Claude Code (this harness): Block broken markers | skills current | hook absent | allowlist present')
    expect(out).toContain(FIX)
    // No install step: `--install` refuses until the markers are fixed.
    expect(steps(out)).toEqual([
      '1. Ask how Hafez should run',
      '2. Offer the session-start hook (always-on only)',
      '3. Seed the vault (skipped: the vault is not empty)',
      '4. Hand over',
    ])
  })

  it('reports another harness\'s broken markers and does not offer an install that would refuse', () => {
    const home = makeHome({ ...INSTALLED, '.codex/AGENTS.md': '<!-- hafez:end -->\n' })
    const out = onboard(home, makeVault(1, 0))
    expect(out).toContain('Codex (found at ~/.codex): Block broken markers | skills current')
    expect(out).toContain('The Hafez markers in ~/.codex/AGENTS.md are broken')
    expect(out).not.toContain('Offer the other harness')
  })

  it('--install and --remove still refuse and write nothing', () => {
    const home = makeHome({ '.claude/CLAUDE.md': BEGIN_ONLY })
    expect(() => onboard(home, makeVault(1, 0), CLAUDE, ['--install', '--mode', 'always-on'])).toThrow(/markers in ~\/\.claude\/CLAUDE\.md are broken/)
    expect(() => onboard(home, makeVault(1, 0), CLAUDE, ['--install', '--mode', 'invoke-only'])).toThrow(/are broken/)
    expect(() => onboard(home, makeVault(1, 0), CLAUDE, ['--remove'])).toThrow(/are broken/)
    expect(readFileSync(join(home, '.claude/CLAUDE.md'), 'utf-8')).toBe(BEGIN_ONLY)
  })
})

describe('bare onboard under Codex', () => {
  it('prints the Codex rule, the vault as a writable root, and the hooks.json entry', () => {
    const home = makeHome({}, ['.claude'])
    const vault = makeVault(1, 0)
    const out = onboard(home, vault, CODEX)
    expect(out).toContain('Codex (this harness): Block absent | skills absent | hook absent | allowlist absent\nClaude Code (found at ~/.claude): Block absent | skills absent')
    expect(out).toContain('say it goes into ~/.codex/AGENTS.md between two marker lines')
    expect(out).toContain('prefix_rule(pattern = ["hafez"], decision = "allow")')
    expect(out).toContain(`writable_roots = [${JSON.stringify(vault)}]`)
    expect(out).toContain('add it to ~/.codex/hooks.json under hooks.SessionStart:\n\n'
      + '{"matcher": "startup|compact", "hooks": [{"type": "command", "command": "hafez onboard --block --harness codex"}]}')
    expect(out).toContain('hafez onboard --install --harness claude-code --mode always-on')
  })
})

describe('bare onboard under Codex: re-run', () => {
  it('reads the rule, the writable root and the hook from Codex\'s files, and walks none of them', () => {
    const vault = makeVault(1, 0)
    const home = makeHome({
      ...SKILLS_ONLY,
      '.codex/AGENTS.md': renderBlock(),
      '.codex/rules/default.rules': 'prefix_rule(\n    pattern = ["hafez"],\n    decision = "allow",\n)\n',
      '.codex/config.toml': `[sandbox_workspace_write]\nwritable_roots = [${JSON.stringify(vault)}]\n`,
      '.codex/hooks.json': JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'hafez onboard --block --harness codex' }] }] } }),
    })
    const out = onboard(home, vault, CODEX)
    expect(out).toContain('Codex (this harness): Block current | skills current | hook present | allowlist present')
    expect(out).not.toMatch(/## \d\. (Install|Allow the command|Offer the session-start hook)/)
  })

  it('walks the allow step while the vault is not a writable root', () => {
    const vault = makeVault(1, 0)
    const home = makeHome({ '.codex/rules/default.rules': 'prefix_rule(pattern = ["hafez"], decision = "allow")\n' })
    expect(onboard(home, vault, CODEX)).toContain('allowlist absent')
  })
})

describe('bare onboard: usage', () => {
  it('names the way out when no harness is detected', () => {
    expect(() => onboard(makeHome(), makeVault(1, 0), {})).toThrow(/No harness detected/)
    expect(() => onboard(makeHome(), makeVault(1, 0), {})).toThrow(UsageError)
  })
})

describe('bare onboard: a 1.x section with no markers (#157)', () => {
  const LEGACY = '# Mine\n\n## Hafez — Session Memory\n\nThe 1.x snippet, pasted by hand.\n'

  it('names it in the status and puts its removal before the install', () => {
    const out = onboard(makeHome({ '.claude/CLAUDE.md': LEGACY, '.claude/skills/hafez/SKILL.md': '---\nname: hafez\n---\nold body\n' }), makeVault(3, 0))
    const status = 'Legacy section in ~/.claude/CLAUDE.md, line 3: `## Hafez — Session Memory`, from Hafez 1.x, with no markers.'
    expect(out).toContain(status)
    const removal = out.indexOf('Remove the Hafez 1.x section in ~/.claude/CLAUDE.md, from its heading')
    expect(removal).toBeGreaterThan(out.indexOf('## 2. Install'))
    expect(removal).toBeLessThan(out.indexOf('hafez onboard --install --mode always-on'))
  })

  it('beside a current invoke-only install, the removal is a step of its own', () => {
    const out = onboard(makeHome({ ...SKILLS_ONLY, '.claude/CLAUDE.md': LEGACY }), makeVault(1, 0))
    expect(out).not.toContain('## 2. Install')
    expect(out).toContain('## 2. Remove the Hafez 1.x section\n\nRemove the Hafez 1.x section in ~/.claude/CLAUDE.md, from its heading')
  })

  it('no legacy section: no legacy line', () => {
    expect(onboard(makeHome(INSTALLED), makeVault(1, 0))).not.toContain('Legacy section')
  })
})
