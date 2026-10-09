// src/cli/install.ts
//
// `onboard --install` and `onboard --remove`: the files Hafez owns outside the
// vault (onboard decision #58). Both skills go to both skill directories; in
// always-on Mode the Block goes between its hash markers in the Harness's
// instructions file. Nothing outside the markers is written, save a newline
// ending a last line that had none, so the Block's begin marker starts a line.
//
// Mode is never stored: a Block present means always-on. The home directory
// is an argument (the temp-home seam); nothing here reads the environment.
// Every check runs before the first write, so a refusal writes nothing.

import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { HafezError } from '../types.js'
import { HARNESSES, type HarnessId } from '../harness.js'
import { contentHash, renderBlock, renderHafezSaveSkill, renderHafezSkill } from '../surfaces/surfaces.js'

export const MODES = ['always-on', 'invoke-only'] as const
export type Mode = (typeof MODES)[number]
export const isMode = (value: string): value is Mode => (MODES as readonly string[]).includes(value)

export const SKILL_DIRS = ['.claude/skills', '.agents/skills']
const SKILLS = [
  { name: 'hafez', render: renderHafezSkill },
  { name: 'hafez-save', render: renderHafezSaveSkill },
]

export type HashState = 'absent' | 'current' | 'stale' | 'hand-edited'

/** What is installed: its whole text, the hash it carries, and the text that
 * hash covers. */
interface Installed {
  text: string
  hash: string | null
  body: string
}

/** An editor that re-saves a file with CRLF endings has not edited it. */
const lf = (text: string) => text.replace(/\r\n/g, '\n')

/** The one check that tells the states apart. Current is the render exactly;
 * hand-edited is text that no longer matches its own hash; anything else (an
 * older render, or a file from before hashes) is stale. */
function hashState(found: Installed | null, rendered: string): HashState {
  if (!found) return 'absent'
  if (lf(found.text) === rendered) return 'current'
  if (found.hash !== null && contentHash(lf(found.body)) !== found.hash) return 'hand-edited'
  return 'stale'
}

// --- The Block region ---

const BEGIN = /^<!-- hafez:begin ([0-9a-f]{12}) -->$/
const END = '<!-- hafez:end -->'

/** What broken markers are, for a refusal or a report about `path`. */
const brokenMarkers = (path: string) =>
  `The Hafez markers in ${path} are broken: expected one "<!-- hafez:begin <hash> -->" line followed by one "${END}" line.`

/** What to do about broken markers: a hand edit, then `rerun`. */
export const fixBrokenMarkers = (path: string, rerun: string) =>
  `${brokenMarkers(path)} Fix or delete them by hand, then re-run \`${rerun}\`.`

/** The marked region in a file: `start`..`end` is the begin marker through the
 * end marker, without the end marker's line break; `next` is past that break. */
interface Region extends Installed {
  start: number
  end: number
  next: number
}

/** Find the one Block region in `file`, or null when there are no markers.
 * Markers that are duplicated, unpaired, out of order or missing their hash
 * are refused: which bytes are Hafez's is then unknowable. */
function findRegion(file: string, displayPath: string): Region | null {
  const begins: Array<{ line: string; start: number; next: number }> = []
  const ends: Array<{ line: string; start: number; next: number }> = []
  let offset = 0
  for (const raw of file.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    const at = { line, start: offset, next: Math.min(offset + raw.length + 1, file.length) }
    if (line.startsWith('<!-- hafez:begin')) begins.push(at)
    else if (line.startsWith('<!-- hafez:end')) ends.push(at)
    offset += raw.length + 1
  }
  if (begins.length === 0 && ends.length === 0) return null
  const [begin] = begins
  const [end] = ends
  const hash = begin ? BEGIN.exec(begin.line)?.[1] : undefined
  if (begins.length !== 1 || ends.length !== 1 || end.start < begin.start || !hash || end.line !== END) {
    throw new HafezError(
      'VALIDATION_FAILED',
      `${brokenMarkers(displayPath)} Fix or delete them by hand, then re-run.`,
    )
  }
  return {
    start: begin.start,
    end: end.start + END.length,
    next: end.next,
    hash,
    body: file.slice(begin.next, end.start),
    text: file.slice(begin.start, end.start + END.length),
  }
}

/** A line diff of the user's Block against the render: ` ` both, `-` theirs
 * only, `+` the render only. */
function lineDiff(theirs: string, ours: string): string {
  const a = lf(theirs).replace(/\n$/, '').split('\n')
  const b = ours.replace(/\n$/, '').split('\n')
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  const out: string[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      out.push(` ${a[i++]}`)
      j++
    } else if (j >= b.length || (i < a.length && lcs[i + 1][j] >= lcs[i][j + 1])) {
      out.push(`-${a[i++]}`)
    } else {
      out.push(`+${b[j++]}`)
    }
  }
  return out.join('\n')
}

// --- Steps: every check first, then the writes ---

interface Step {
  line: string
  write?: () => void
  /** Printed after the lines: what the agent must show the user. */
  note?: string
}

const write = (path: string, text: string) => {
  mkdirSync(dirname(path), { recursive: true })
  // In place, never write-then-rename: an instructions file may be a symlink
  // serving two harnesses, and a rename would replace the link with a copy.
  writeFileSync(path, text)
}

function readInstalled(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf-8') : null
}

/** A skill file's hash is its frontmatter `hash:` line, over everything after
 * the closing `---`. */
function parseSkill(text: string): Installed {
  const close = text.startsWith('---\n') ? text.indexOf('\n---\n', 3) : -1
  if (close < 0) return { text, hash: null, body: text }
  const hash = /^hash: ([0-9a-f]{12})$/m.exec(text.slice(4, close + 1))?.[1] ?? null
  return { text, hash, body: text.slice(close + 5) }
}

/** Delete a skill file and its directory once empty. Either skill directory
 * may be a symlink to the other, so the file can already be gone, and a
 * linked directory is the user's link: never removed. */
function removeSkill(path: string): void {
  if (existsSync(path)) unlinkSync(path)
  const dir = dirname(path)
  if (existsSync(dir) && lstatSync(dir).isDirectory() && readdirSync(dir).length === 0) rmdirSync(dir)
}

/** Both skills in both directories, with what is installed at each. */
const skillFiles = (home: string) =>
  SKILL_DIRS.flatMap(dir => SKILLS.map(({ name, render }) => {
    const rel = `${dir}/${name}/SKILL.md`
    const path = join(home, rel)
    return { rel, path, render, text: readInstalled(path) }
  }))

function skillSteps(home: string, want: 'write' | 'remove'): Step[] {
  return skillFiles(home).map(({ rel, path, render, text }): Step => {
    if (want === 'remove') {
      return text === null ? { line: `~/${rel}: absent` } : { line: `~/${rel}: removed`, write: () => removeSkill(path) }
    }
    const rendered = render()
    const state = hashState(text === null ? null : parseSkill(text), rendered)
    if (state === 'current') return { line: `~/${rel}: current` }
    return { line: `~/${rel}: ${state === 'absent' ? 'written' : `replaced (was ${state})`}`, write: () => write(path, rendered) }
  })
}

const RENDERED = findRegion(renderBlock(), 'the render')!

interface BlockOpts {
  home: string
  rel: string
  want: 'write' | 'remove'
  confirm: boolean
  /** The command that repeats this one with --confirm. */
  rerun: string
  /** Appended to the absent and removed lines, e.g. ` (invoke-only)`. */
  suffix?: string
}

function blockStep({ home, rel, want, confirm, rerun, suffix = '' }: BlockOpts): Step {
  const path = join(home, rel)
  const label = `Block in ~/${rel}`
  const file = readInstalled(path)
  const text = file ?? ''
  const region = findRegion(text, `~/${rel}`)
  const state = hashState(region, RENDERED.text)

  if (region && state === 'hand-edited' && !confirm) {
    return {
      line: `${label}: hand-edited, left alone`,
      note: [
        `The Block in ~/${rel} was edited by hand, so it was left alone. Show the user this diff (\`-\` their text, \`+\` the Block Hafez writes). Only after their yes, run this; it ${want === 'write' ? 'replaces' : 'removes'} their text:`,
        '',
        rerun,
        '',
        '````diff',
        lineDiff(region.body, RENDERED.body),
        '````',
      ].join('\n'),
    }
  }
  if (want === 'remove') {
    if (!region) return { line: `${label}: absent${suffix}` }
    return { line: `${label}: removed${suffix}`, write: () => write(path, text.slice(0, region.start) + text.slice(region.next)) }
  }
  if (state === 'current') return { line: `${label}: current` }
  if (!region) {
    const before = text === '' || text.endsWith('\n') ? text : `${text}\n`
    return { line: `${label}: written`, write: () => write(path, before + renderBlock()) }
  }
  return {
    line: `${label}: replaced (was ${state})`,
    write: () => write(path, text.slice(0, region.start) + RENDERED.text + text.slice(region.end)),
  }
}

/** Codex reads an `AGENTS.override.md` in place of `AGENTS.md` when one
 * exists: the first candidate present, else the last. */
export const instructionsFile = (home: string, candidates: readonly string[]): string =>
  candidates.find(rel => existsSync(join(home, rel))) ?? candidates[candidates.length - 1]

interface Report {
  header: string
  steps: Step[]
  /** Printed after the notes. */
  tail?: string[]
  /** The line printed when no step writes or needs the user. */
  unchanged: string
  /** List every step, not only those that write or need the user. */
  listAll: boolean
}

function run({ header, steps, tail = [], unchanged, listAll }: Report): string {
  for (const step of steps) step.write?.()
  const acted = steps.filter(s => s.write || s.note)
  const shown = listAll ? steps : acted
  const notes = steps.flatMap(s => (s.note ? [s.note] : []))
  return [
    header,
    '',
    ...shown.map(s => `- ${s.line}`),
    ...(acted.length === 0 ? [...(shown.length ? [''] : []), unchanged] : []),
    ...[...notes, ...tail].flatMap(text => ['', text]),
  ].join('\n')
}

// --- What is installed: the state bare `onboard` reports ---

export interface InstallState {
  /** In the Harness's instructions file; null where it keeps no file.
   * `broken`: markers `--install` and `--remove` refuse until fixed by hand. */
  block: HashState | 'broken' | null
  /** Across both skill directories: the one state every file shares, else
   * hand-edited when any file is, else stale. */
  skills: HashState
  /** Some skill file carries a hash: `onboard --install` has run here. */
  onboarded: boolean
}

export function installState(home: string, harness: HarnessId): InstallState {
  const { instructions } = HARNESSES[harness]
  let block: InstallState['block'] = null
  if (instructions !== null) {
    const rel = instructionsFile(home, instructions)
    try {
      block = hashState(findRegion(readInstalled(join(home, rel)) ?? '', `~/${rel}`), RENDERED.text)
    } catch {
      block = 'broken'
    }
  }
  const skills = SKILL_DIRS.flatMap(dir => SKILLS.map(({ name, render }) => {
    const text = readInstalled(join(home, dir, name, 'SKILL.md'))
    const found = text === null ? null : parseSkill(text)
    return { state: hashState(found, render()), hashed: found?.hash != null }
  }))
  const states = new Set(skills.map(s => s.state))
  const [only] = states
  const merged = states.size === 1 ? only : states.has('hand-edited') ? 'hand-edited' : 'stale'
  return { block, skills: merged, onboarded: skills.some(s => s.hashed) }
}

// --- The two commands ---

export function install(opts: { home: string; harness: HarnessId; mode: Mode; confirm: boolean }): string {
  const { home, harness, mode, confirm } = opts
  const { label, instructions } = HARNESSES[harness]
  const steps = skillSteps(home, 'write')
  const tail: string[] = []
  if (instructions === null) {
    if (mode === 'always-on') {
      steps.push({ line: `Block: printed below, for ${label}'s User Rules` })
      tail.push(
        `${label} keeps its User Rules in Settings, not a file, so the Block was not written. Show the user the Block below and ask them to paste it into ${label} Settings → Rules → User Rules, marker lines included.`,
        `\`\`\`\`\n${renderBlock()}\`\`\`\``,
      )
    } else {
      steps.push({ line: `Block: not written (invoke-only). If it is pasted in ${label}'s User Rules, ask the user to delete it there.` })
    }
  } else {
    steps.push(blockStep({
      home,
      rel: instructionsFile(home, instructions),
      want: mode === 'always-on' ? 'write' : 'remove',
      confirm,
      rerun: `hafez onboard --install --harness ${harness} --mode ${mode} --confirm`,
      suffix: mode === 'invoke-only' ? ' (invoke-only)' : '',
    }))
  }
  return run({ header: `${label}, ${mode}:`, steps, tail, unchanged: 'Nothing changed: the install is current.', listAll: true })
}

// --- The check `upgrade` runs: reads, never writes ---

export interface SkillCheck {
  path: string
  state: HashState
}

export interface BlockCheck {
  harness: HarnessId
  path: string
  /** `broken`: markers `--install` would refuse until fixed by hand. */
  state: Exclude<HashState, 'absent'> | 'broken'
  /** The Block Hafez writes has changed since this one was written. */
  renderChanged: boolean
}

/** Both skills in both directories, and the Block in the instructions file
 * each Harness reads — the one `--install` would write. Only Blocks that are
 * there are listed: none means invoke-only. */
export function checkInstall(home: string): { skills: SkillCheck[]; blocks: BlockCheck[] } {
  const skills = skillFiles(home).map(({ rel, render, text }): SkillCheck => ({
    path: `~/${rel}`,
    state: hashState(text === null ? null : parseSkill(text), render()),
  }))
  const blocks: BlockCheck[] = []
  for (const [harness, { instructions }] of Object.entries(HARNESSES) as Array<[HarnessId, (typeof HARNESSES)[HarnessId]]>) {
    if (instructions === null) continue
    const rel = instructionsFile(home, instructions)
    const path = `~/${rel}`
    const text = readInstalled(join(home, rel))
    if (text === null) continue
    let region: Region | null
    try {
      region = findRegion(text, path)
    } catch {
      blocks.push({ harness, path, state: 'broken', renderChanged: false })
      continue
    }
    if (!region) continue
    const state = hashState(region, RENDERED.text) as BlockCheck['state']
    blocks.push({ harness, path, state, renderChanged: region.hash !== RENDERED.hash })
  }
  return { skills, blocks }
}

/** Remove everything Hafez wrote: both skills from both directories, and the
 * Block region from every instructions file a Harness reads. Nothing else. */
export function remove({ home, confirm }: { home: string; confirm: boolean }): string {
  const files = [...new Set(Object.values(HARNESSES).flatMap(h => h.instructions ?? []))]
  const steps = [
    ...skillSteps(home, 'remove'),
    ...files.map(rel => blockStep({ home, rel, want: 'remove', confirm, rerun: 'hafez onboard --remove --confirm' })),
  ]
  return run({ header: 'Removing what Hafez wrote:', steps, unchanged: 'Nothing to remove.', listAll: false })
}
