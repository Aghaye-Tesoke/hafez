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
import { isVaultRepo } from '../surfaces/items.js'

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

/** The hash, then a cloud Block's vault repo (#160). */
const BEGIN = /^<!-- hafez:begin ([0-9a-f]{12})(?: vault-repo=(\S+))? -->$/
const END = '<!-- hafez:end -->'

/** What broken markers are, for a refusal or a report about `path`. */
const brokenMarkers = (path: string) =>
  `The Hafez markers in ${path} are broken: expected one "<!-- hafez:begin <hash> -->" line followed by one "${END}" line.`

/** What to do about broken markers: a hand edit, then `rerun`. */
export const fixBrokenMarkers = (path: string, rerun: string) =>
  `${brokenMarkers(path)} Fix or delete them by hand, then re-run \`${rerun}\`.`

/** The marked region in a file: `start`..`end` is the begin marker through the
 * end marker, without the end marker's line break; `next` is past that break.
 * `vaultRepo`: a cloud Block's, from its begin marker. */
interface Region extends Installed {
  start: number
  end: number
  next: number
  vaultRepo?: string
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
  const [, hash, vaultRepo] = (begin && BEGIN.exec(begin.line)) || []
  if (begins.length !== 1 || ends.length !== 1 || end.start < begin.start || !hash || end.line !== END
    || (vaultRepo !== undefined && !isVaultRepo(vaultRepo))) {
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
    ...(vaultRepo !== undefined && { vaultRepo }),
  }
}

/** The flag that keeps an install a cloud one, for every printed install line. */
export const vaultRepoFlag = (vaultRepo: string | undefined) => (vaultRepo === undefined ? '' : ` --vault-repo ${vaultRepo}`)

// --- The 1.x section ---

/** The heading 1.2–1.4 `onboard` had the agent paste, with no markers (#157). */
const LEGACY_HEADING = '## Hafez — Session Memory'

/** The 1-based line of a 1.x section outside the Block region, or null. With
 * broken markers (`region` undefined) the region is unknown: every line is read. */
function findLegacy(file: string, region: Region | null | undefined): number | null {
  let offset = 0
  const lines = file.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const inside = region != null && offset >= region.start && offset < region.next
    if (!inside && lines[i].trimEnd() === LEGACY_HEADING) return i + 1
    offset += lines[i].length + 1
  }
  return null
}

/** What to do about a 1.x section: Hafez cannot tell where it ends. */
export const removeLegacy = (path: string, line: number) =>
  `Remove the Hafez 1.x section in ${path}, from its heading \`${LEGACY_HEADING}\` (line ${line}) to the end of that section, after the user's yes. It has no markers, so Hafez does not delete it.`

/** The status line for a 1.x section. */
export const legacyLine = (path: string, line: number) => `Legacy section in ${path}, line ${line}: \`${LEGACY_HEADING}\``

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

const RENDERS = new Map<string | undefined, Region>()

/** The Block Hafez writes, as a region; with `vaultRepo`, the cloud Block. A
 * found Block is checked against the render for its own marker's repo. */
function rendered(vaultRepo?: string): Region {
  if (!RENDERS.has(vaultRepo)) RENDERS.set(vaultRepo, findRegion(renderBlock(vaultRepo), 'the render')!)
  return RENDERS.get(vaultRepo)!
}

interface BlockOpts {
  home: string
  rel: string
  want: 'write' | 'remove'
  confirm: boolean
  /** The command that repeats this one with --confirm. */
  rerun: string
  /** Appended to the absent and removed lines, e.g. ` (invoke-only)`. */
  suffix?: string
  /** Write the cloud Block for this vault repo. */
  vaultRepo?: string
}

function blockStep({ home, rel, want, confirm, rerun, suffix = '', vaultRepo }: BlockOpts): Step {
  const path = join(home, rel)
  const label = `Block in ~/${rel}`
  const file = readInstalled(path)
  const text = file ?? ''
  const region = findRegion(text, `~/${rel}`)
  const target = rendered(want === 'write' ? vaultRepo : region?.vaultRepo)
  const state = hashState(region, target.text)

  if (region && state === 'hand-edited' && !confirm) {
    return {
      line: `${label}: hand-edited, left alone`,
      note: [
        `The Block in ~/${rel} was edited by hand, so it was left alone. Show the user this diff (\`-\` their text, \`+\` the Block Hafez writes). Only after their yes, run this; it ${want === 'write' ? 'replaces' : 'removes'} their text:`,
        '',
        rerun,
        '',
        '````diff',
        lineDiff(region.body, target.body),
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
    return { line: `${label}: written`, write: () => write(path, before + renderBlock(vaultRepo)) }
  }
  return {
    line: `${label}: replaced (was ${state})`,
    write: () => write(path, text.slice(0, region.start) + target.text + text.slice(region.end)),
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
  /** The line of a 1.x section in the instructions file, else null. */
  legacy: number | null
  /** The Block is a cloud Block, for this vault repo. */
  vaultRepo?: string
}

export function installState(home: string, harness: HarnessId): InstallState {
  const { instructions } = HARNESSES[harness]
  let block: InstallState['block'] = null
  let legacy: number | null = null
  let vaultRepo: string | undefined
  if (instructions !== null) {
    const rel = instructionsFile(home, instructions)
    const text = readInstalled(join(home, rel)) ?? ''
    let region: Region | null | undefined
    try {
      region = findRegion(text, `~/${rel}`)
      vaultRepo = region?.vaultRepo
      block = hashState(region, rendered(vaultRepo).text)
    } catch {
      block = 'broken'
    }
    legacy = findLegacy(text, region)
  }
  const skills = SKILL_DIRS.flatMap(dir => SKILLS.map(({ name, render }) => {
    const text = readInstalled(join(home, dir, name, 'SKILL.md'))
    const found = text === null ? null : parseSkill(text)
    return { state: hashState(found, render()), hashed: found?.hash != null }
  }))
  const states = new Set(skills.map(s => s.state))
  const [only] = states
  const merged = states.size === 1 ? only : states.has('hand-edited') ? 'hand-edited' : 'stale'
  return { block, skills: merged, onboarded: skills.some(s => s.hashed), legacy, ...(vaultRepo !== undefined && { vaultRepo }) }
}

// --- The two commands ---

/** `vaultRepo`: the install is for a cloud container, whose Block carries
 * the rule that attaches that repo as the vault (#160). */
export function install(opts: { home: string; harness: HarnessId; mode: Mode; confirm: boolean; vaultRepo?: string }): string {
  const { home, harness, mode, confirm, vaultRepo } = opts
  const { label, instructions } = HARNESSES[harness]
  const steps = skillSteps(home, 'write')
  const tail: string[] = []
  const rel = instructions === null ? null : instructionsFile(home, instructions)
  if (rel === null) {
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
      rel,
      want: mode === 'always-on' ? 'write' : 'remove',
      confirm,
      rerun: `hafez onboard --install --harness ${harness} --mode ${mode}${vaultRepoFlag(vaultRepo)} --confirm`,
      suffix: mode === 'invoke-only' ? ' (invoke-only)' : '',
      vaultRepo,
    }))
  }
  const out = run({ header: `${label}, ${mode}:`, steps, tail, unchanged: 'Nothing changed: the install is current.', listAll: true })
  if (rel === null) return out
  // A 1.x section loads beside the Block, or in place of invoke-only: named,
  // never touched (#162). Read after the writes, so its line is where it is now.
  const text = readInstalled(join(home, rel)) ?? ''
  const line = findLegacy(text, findRegion(text, `~/${rel}`))
  return line === null ? out : `${out}\n\n${removeLegacy(`~/${rel}`, line)}`
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
  /** A cloud Block: the vault repo it was written for. */
  vaultRepo?: string
}

export interface LegacyCheck {
  harness: HarnessId
  path: string
  line: number
}

/** Both skills in both directories, and the Block in the instructions file
 * each Harness reads — the one `--install` would write. Only Blocks that are
 * there are listed: none, and no 1.x section, means invoke-only. */
export function checkInstall(home: string): { skills: SkillCheck[]; blocks: BlockCheck[]; legacy: LegacyCheck[] } {
  const skills = skillFiles(home).map(({ rel, render, text }): SkillCheck => ({
    path: `~/${rel}`,
    state: hashState(text === null ? null : parseSkill(text), render()),
  }))
  const blocks: BlockCheck[] = []
  const legacy: LegacyCheck[] = []
  for (const [harness, { instructions }] of Object.entries(HARNESSES) as Array<[HarnessId, (typeof HARNESSES)[HarnessId]]>) {
    if (instructions === null) continue
    const rel = instructionsFile(home, instructions)
    const path = `~/${rel}`
    const text = readInstalled(join(home, rel))
    if (text === null) continue
    let region: Region | null | undefined
    try {
      region = findRegion(text, path)
    } catch {
      blocks.push({ harness, path, state: 'broken', renderChanged: false })
    }
    const line = findLegacy(text, region)
    if (line !== null) legacy.push({ harness, path, line })
    if (!region) continue
    const { vaultRepo } = region
    const render = rendered(vaultRepo)
    const state = hashState(region, render.text) as BlockCheck['state']
    blocks.push({ harness, path, state, renderChanged: region.hash !== render.hash, ...(vaultRepo !== undefined && { vaultRepo }) })
  }
  return { skills, blocks, legacy }
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
