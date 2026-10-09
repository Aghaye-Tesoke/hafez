// tests/onboard-install.test.ts
//
// The temp-home seam (Agent Contract, testing decision 3): `onboard --install`
// and `--remove` run in-process against a temporary home directory passed in,
// never the real one. Asserted: the files written, the bytes outside the
// Block's markers, and the three hash states (current, stale, hand-edited).

import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync, lstatSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname } from 'path'
import { cmdOnboard } from '../src/cli/onboard.js'
import { UsageError } from '../src/cli/args.js'
import { HafezError } from '../src/types.js'
import { contentHash, renderBlock, renderHafezSkill, renderHafezSaveSkill } from '../src/surfaces/surfaces.js'

const homes: string[] = []
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

function makeHome(files: Record<string, string> = {}): string {
  const home = mkdtempSync(join(tmpdir(), 'hafez-home-'))
  homes.push(home)
  for (const [rel, text] of Object.entries(files)) put(home, rel, text)
  return home
}

function put(home: string, rel: string, text: string): void {
  mkdirSync(dirname(join(home, rel)), { recursive: true })
  writeFileSync(join(home, rel), text)
}

const get = (home: string, rel: string): string => readFileSync(join(home, rel), 'utf-8')
const has = (home: string, rel: string): boolean => existsSync(join(home, rel))

const SKILL_FILES: Array<[string, () => string]> = [
  ['.claude/skills/hafez/SKILL.md', renderHafezSkill],
  ['.claude/skills/hafez-save/SKILL.md', renderHafezSaveSkill],
  ['.agents/skills/hafez/SKILL.md', renderHafezSkill],
  ['.agents/skills/hafez-save/SKILL.md', renderHafezSaveSkill],
]

const BLOCK = renderBlock()
const INNER = BLOCK.split('\n').slice(1, -2).join('\n') + '\n'
const USER_TEXT = '# My instructions\n\nAlways run the tests.\n'
const CLAUDE_MD = '.claude/CLAUDE.md'

/** A Block region with its own marker hash over `inner`. */
const region = (inner: string, hash = contentHash(inner)) => `<!-- hafez:begin ${hash} -->\n${inner}<!-- hafez:end -->\n`

const onboard = (home: string, args: string[], env: Record<string, string | undefined> = {}) =>
  cmdOnboard(args, { home, env })

const install = (home: string, mode: string, ...rest: string[]) =>
  onboard(home, ['--install', '--mode', mode, '--harness', 'claude-code', ...rest])

describe('onboard --install --mode always-on', () => {
  it('writes both skills to both skill directories and the Block after the user\'s text, which is byte-identical', () => {
    const home = makeHome({ [CLAUDE_MD]: USER_TEXT })
    const out = install(home, 'always-on')

    for (const [rel, render] of SKILL_FILES) expect(get(home, rel)).toBe(render())
    expect(get(home, CLAUDE_MD)).toBe(USER_TEXT + BLOCK)
    expect(out).toContain('Block in ~/.claude/CLAUDE.md: written')
    expect(out).toContain('~/.agents/skills/hafez-save/SKILL.md: written')
  })

  it('creates the instructions file when there is none', () => {
    const home = makeHome()
    install(home, 'always-on')
    expect(get(home, CLAUDE_MD)).toBe(BLOCK)
  })

  it('ends an unterminated last line before the Block, and adds nothing else', () => {
    const home = makeHome({ [CLAUDE_MD]: 'no newline at end' })
    install(home, 'always-on')
    expect(get(home, CLAUDE_MD)).toBe('no newline at end\n' + BLOCK)
  })

  it('changes nothing on a current install and says so', () => {
    const home = makeHome({ [CLAUDE_MD]: USER_TEXT })
    install(home, 'always-on')
    const before = SKILL_FILES.map(([rel]) => get(home, rel)).concat(get(home, CLAUDE_MD))

    const out = install(home, 'always-on')

    expect(SKILL_FILES.map(([rel]) => get(home, rel)).concat(get(home, CLAUDE_MD))).toEqual(before)
    expect(out).toContain('Nothing changed: the install is current.')
    expect(out).not.toMatch(/: (written|replaced|removed)/)
  })

  it('reads a Block an editor re-saved with CRLF endings as current, not hand-edited', () => {
    const crlf = (USER_TEXT + BLOCK).replace(/\n/g, '\r\n')
    const home = makeHome({ [CLAUDE_MD]: crlf })
    const out = install(home, 'always-on')
    expect(get(home, CLAUDE_MD)).toBe(crlf)
    expect(out).toContain('Block in ~/.claude/CLAUDE.md: current')
  })

  it('replaces a stale Block (its text matches its own marker, not the render) and nothing around it', () => {
    const stale = region('## Hafez\n\nAn older Block.\n')
    const home = makeHome({ [CLAUDE_MD]: `${USER_TEXT}\n${stale}\n## After\n` })

    const out = install(home, 'always-on')

    expect(get(home, CLAUDE_MD)).toBe(`${USER_TEXT}\n${BLOCK}\n## After\n`)
    expect(out).toContain('Block in ~/.claude/CLAUDE.md: replaced (was stale)')
  })

  it('leaves a hand-edited Block alone, shows the diff and the confirm command', () => {
    const edited = region(INNER.replace('## Hafez', '## Hafez (mine)'), contentHash(INNER))
    const file = `${USER_TEXT}${edited}`
    const home = makeHome({ [CLAUDE_MD]: file })

    const out = install(home, 'always-on')

    expect(get(home, CLAUDE_MD)).toBe(file)
    expect(out).toContain('Block in ~/.claude/CLAUDE.md: hand-edited, left alone')
    expect(out).toContain('-## Hafez (mine)\n+## Hafez\n')
    expect(out).toContain('hafez onboard --install --harness claude-code --mode always-on --confirm')
    // The skills do not wait on the Block.
    for (const [rel, render] of SKILL_FILES) expect(get(home, rel)).toBe(render())
  })

  it('overwrites a hand-edited Block with --confirm', () => {
    const edited = region(INNER.replace('## Hafez', '## Hafez (mine)'), contentHash(INNER))
    const home = makeHome({ [CLAUDE_MD]: `${USER_TEXT}${edited}` })

    const out = install(home, 'always-on', '--confirm')

    expect(get(home, CLAUDE_MD)).toBe(USER_TEXT + BLOCK)
    expect(out).toContain('Block in ~/.claude/CLAUDE.md: replaced (was hand-edited)')
  })

  it('replaces a stale or hand-edited skill file, and one with no hash', () => {
    const home = makeHome({
      '.claude/skills/hafez/SKILL.md': '# the old hand-installed skill\n',
      '.agents/skills/hafez/SKILL.md': renderHafezSkill().replace('# Hafez', '# Hafez, edited'),
    })

    const out = install(home, 'always-on')

    for (const [rel, render] of SKILL_FILES) expect(get(home, rel)).toBe(render())
    expect(out).toContain('~/.claude/skills/hafez/SKILL.md: replaced (was stale)')
    expect(out).toContain('~/.agents/skills/hafez/SKILL.md: replaced (was hand-edited)')
  })

  it('treats a skill whose description changed but whose body did not as stale', () => {
    const home = makeHome({
      '.claude/skills/hafez/SKILL.md': renderHafezSkill().replace('description: >', 'description: >\n  An older description.'),
    })
    const out = install(home, 'always-on')
    expect(get(home, '.claude/skills/hafez/SKILL.md')).toBe(renderHafezSkill())
    expect(out).toContain('~/.claude/skills/hafez/SKILL.md: replaced (was stale)')
  })

  it.each([
    ['two begin markers', `${region(INNER)}${region(INNER)}`],
    ['a begin marker with no end', `<!-- hafez:begin ${contentHash(INNER)} -->\n${INNER}`],
    ['an end marker before the begin marker', `<!-- hafez:end -->\n<!-- hafez:begin ${contentHash(INNER)} -->\n`],
    ['a begin marker with no hash', `<!-- hafez:begin -->\n${INNER}<!-- hafez:end -->\n`],
  ])('refuses %s and writes nothing', (_, broken) => {
    const home = makeHome({ [CLAUDE_MD]: USER_TEXT + broken })
    expect(() => install(home, 'always-on')).toThrow(HafezError)
    expect(() => install(home, 'always-on')).toThrow(/~\/\.claude\/CLAUDE\.md/)
    expect(get(home, CLAUDE_MD)).toBe(USER_TEXT + broken)
    for (const [rel] of SKILL_FILES) expect(has(home, rel)).toBe(false)
  })
})

describe('onboard --install --mode invoke-only', () => {
  it('removes a Block that is present and leaves the rest of the file untouched', () => {
    const home = makeHome({ [CLAUDE_MD]: `${USER_TEXT}${BLOCK}## After\n` })

    const out = install(home, 'invoke-only')

    expect(get(home, CLAUDE_MD)).toBe(`${USER_TEXT}## After\n`)
    expect(out).toContain('Block in ~/.claude/CLAUDE.md: removed (invoke-only)')
    for (const [rel, render] of SKILL_FILES) expect(get(home, rel)).toBe(render())
  })

  it('round-trips: always-on then invoke-only gives back the original bytes', () => {
    const home = makeHome({ [CLAUDE_MD]: USER_TEXT })
    install(home, 'always-on')
    install(home, 'invoke-only')
    expect(get(home, CLAUDE_MD)).toBe(USER_TEXT)
  })

  it('edits no file of the user\'s when there is no Block', () => {
    const home = makeHome()
    const out = install(home, 'invoke-only')
    expect(has(home, CLAUDE_MD)).toBe(false)
    expect(out).toContain('Block in ~/.claude/CLAUDE.md: absent (invoke-only)')
  })

  it('leaves a hand-edited Block in place without --confirm, removes it with', () => {
    const edited = `${USER_TEXT}${region(INNER + 'my own line\n', contentHash(INNER))}`
    const home = makeHome({ [CLAUDE_MD]: edited })

    const out = install(home, 'invoke-only')
    expect(get(home, CLAUDE_MD)).toBe(edited)
    expect(out).toContain('-my own line\n')
    expect(out).toContain('hafez onboard --install --harness claude-code --mode invoke-only --confirm')

    install(home, 'invoke-only', '--confirm')
    expect(get(home, CLAUDE_MD)).toBe(USER_TEXT)
  })
})

describe('onboard --remove', () => {
  it('deletes both skills from both directories and every Block region, and nothing else', () => {
    const home = makeHome({
      [CLAUDE_MD]: USER_TEXT,
      '.codex/AGENTS.md': 'codex text\n',
      '.claude/skills/other/SKILL.md': 'someone else\'s skill',
      '.agents/skills/hafez/notes.txt': 'a file Hafez did not write',
    })
    install(home, 'always-on')
    onboard(home, ['--install', '--mode', 'always-on', '--harness', 'codex'])

    const out = onboard(home, ['--remove'])

    for (const [rel] of SKILL_FILES) expect(has(home, rel)).toBe(false)
    expect(has(home, '.claude/skills/hafez')).toBe(false)
    expect(get(home, '.agents/skills/hafez/notes.txt')).toBe('a file Hafez did not write')
    expect(get(home, '.claude/skills/other/SKILL.md')).toBe('someone else\'s skill')
    expect(get(home, CLAUDE_MD)).toBe(USER_TEXT)
    expect(get(home, '.codex/AGENTS.md')).toBe('codex text\n')
    expect(out).toContain('Block in ~/.claude/CLAUDE.md: removed')
    expect(out).toContain('Block in ~/.codex/AGENTS.md: removed')
    expect(out).toContain('~/.claude/skills/hafez/SKILL.md: removed')
  })

  it('copes with one skill directory linked to the other, and keeps the link', () => {
    const home = makeHome()
    mkdirSync(join(home, '.claude/skills'), { recursive: true })
    mkdirSync(join(home, '.agents'), { recursive: true })
    symlinkSync(join(home, '.claude/skills'), join(home, '.agents/skills'))
    install(home, 'always-on')

    const out = onboard(home, ['--remove'])

    for (const [rel] of SKILL_FILES) expect(has(home, rel)).toBe(false)
    expect(lstatSync(join(home, '.agents/skills')).isSymbolicLink()).toBe(true)
    expect(out).toContain('Block in ~/.claude/CLAUDE.md: removed')
  })

  it('creates nothing when nothing is installed', () => {
    const home = makeHome()
    const out = onboard(home, ['--remove'])
    expect(has(home, '.claude')).toBe(false)
    expect(has(home, '.agents')).toBe(false)
    expect(out).toContain('Nothing to remove.')
  })

  it('leaves a hand-edited Block without --confirm', () => {
    const edited = `${USER_TEXT}${region(INNER + 'mine\n', contentHash(INNER))}`
    const home = makeHome({ [CLAUDE_MD]: edited })

    const out = onboard(home, ['--remove'])
    expect(get(home, CLAUDE_MD)).toBe(edited)
    expect(out).toContain('hafez onboard --remove --confirm')

    onboard(home, ['--remove', '--confirm'])
    expect(get(home, CLAUDE_MD)).toBe(USER_TEXT)
  })
})

describe('onboard --install: harness targets', () => {
  it('Codex: the Block goes to ~/.codex/AGENTS.md and the Claude Code file is not touched', () => {
    const home = makeHome()
    const out = onboard(home, ['--install', '--mode', 'always-on', '--harness', 'codex'])
    expect(get(home, '.codex/AGENTS.md')).toBe(BLOCK)
    expect(has(home, CLAUDE_MD)).toBe(false)
    expect(out).toContain('Block in ~/.codex/AGENTS.md: written')
  })

  it('Codex: an AGENTS.override.md, which Codex reads instead, takes the Block; --remove clears it', () => {
    const home = makeHome({ '.codex/AGENTS.override.md': 'override\n', '.codex/AGENTS.md': 'base\n' })
    onboard(home, ['--install', '--mode', 'always-on', '--harness', 'codex'])
    expect(get(home, '.codex/AGENTS.override.md')).toBe('override\n' + BLOCK)
    expect(get(home, '.codex/AGENTS.md')).toBe('base\n')

    onboard(home, ['--remove'])
    expect(get(home, '.codex/AGENTS.override.md')).toBe('override\n')
  })

  it('Cursor: the Block is printed for manual paste, not written', () => {
    const home = makeHome()
    const out = onboard(home, ['--install', '--mode', 'always-on', '--harness', 'cursor'])
    expect(out).toContain(BLOCK)
    expect(out).toContain('User Rules')
    expect(has(home, '.cursor')).toBe(false)
    expect(has(home, CLAUDE_MD)).toBe(false)
    for (const [rel, render] of SKILL_FILES) expect(get(home, rel)).toBe(render())
  })

  it('detects the harness from the environment when --harness is absent', () => {
    const home = makeHome()
    onboard(home, ['--install', '--mode', 'always-on'], { CODEX_THREAD_ID: 't' })
    expect(get(home, '.codex/AGENTS.md')).toBe(BLOCK)
  })

  it('asks for --harness when none is detectable', () => {
    const home = makeHome()
    expect(() => onboard(home, ['--install', '--mode', 'always-on'])).toThrow(/--harness <claude-code\|codex\|cursor\|gemini\|copilot>/)
    expect(has(home, '.claude')).toBe(false)
  })
})

describe('onboard: usage errors', () => {
  it.each([
    ['--install without --mode', ['--install', '--harness', 'claude-code']],
    ['an unknown mode', ['--install', '--mode', 'sometimes', '--harness', 'claude-code']],
    ['an unknown harness', ['--install', '--mode', 'always-on', '--harness', 'emacs']],
    ['--install with --remove', ['--install', '--remove', '--mode', 'always-on']],
    ['--mode without --install', ['--mode', 'always-on']],
    ['--remove with --mode', ['--remove', '--mode', 'always-on']],
    ['--confirm alone', ['--confirm']],
    ['--block with --install', ['--block', '--install', '--mode', 'always-on']],
    ['--block with --remove', ['--block', '--remove']],
    ['--block with --mode', ['--block', '--mode', 'always-on']],
    ['--block with --confirm', ['--block', '--confirm']],
    ['--block with an unknown harness', ['--block', '--harness', 'emacs']],
  ])('%s', (_, args) => {
    const home = makeHome()
    expect(() => onboard(home, args, { CLAUDECODE: '1' })).toThrow(UsageError)
    expect(has(home, '.claude')).toBe(false)
  })
})
