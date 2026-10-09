// src/cli/upgrade.ts
//
// `hafez upgrade` — agent-directed update check. It CHECKS AND PRINTS; it
// never installs. The printed steps install code and overwrite the user's
// agent instructions, so the privileged step is the human's — same discipline
// as bare `onboard` (writes nothing; only `--install`/`--remove`, run after
// the user's yes, write outside the vault) and as the release skill
// (`npm publish` is the user's action). It also sidesteps a process replacing
// its own binary mid-run.
//
// `pre-vault` on purpose: it must still work when the vault is unresolvable
// or the native SQLite binding is unbuilt, which is exactly when someone is
// trying to upgrade. Nothing here touches the core.
//
// The skills and the Block are checked by their hashes, in every place
// `onboard --install` writes them (install.ts), and only where they are
// installed: no Block means invoke-only, never a Block to offer. Refreshing
// them is `onboard --install`'s job, so that is the step printed.
//
// Untrusted input: the registry response is rendered into a document an agent
// will execute commands from. Only the `version` field is read, only after it
// matches plain X.Y.Z, and no caught error's message, cause, or stack ever
// reaches stdout — `JSON.parse` embeds a slice of the offending body in its
// message, so every failure branch renders a fixed string constant.

import { execFileSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { UsageError, helpIfAsked } from './args.js'
import { HARNESSES, detectAgent, isHarness } from '../harness.js'
import { checkInstall, fixBrokenMarkers, type BlockCheck, type SkillCheck } from './install.js'

const PLAIN_SEMVER = /^\d+\.\d+\.\d+$/
const REGISTRY_TIMEOUT_MS = 3000
const NPM_PROBE_TIMEOUT_MS = 3000
const DEFAULT_REGISTRY_URL = 'https://registry.npmjs.org/hafez/latest'

export type Comparison = 'behind' | 'equal' | 'ahead' | 'unknown'

/** `command` entries are directly executable (after user approval); `action`
 * entries are prose, so an agent that shells out every entry does not try to
 * run English. */
export interface UpgradeStep {
  kind: 'command' | 'action'
  text: string
}

export interface UpgradeState {
  current: string
  latest: string | null
  comparison: Comparison
  registryReachable: boolean
  npmMajor: number | null
  install: 'registry' | 'dev-checkout'
  /** Null when the installed files could not be read. */
  integration: Integration | null
  /** Mutually exclusive with the registry install in `steps` — exposed
   * separately so an agent iterating `steps` cannot run both. */
  alternativeInstall: string | null
  steps: UpgradeStep[]
}

/** Mode is not stored: a Block present means always-on. */
export interface Integration {
  mode: 'always-on' | 'invoke-only'
  blocks: BlockCheck[]
  skills: SkillCheck[]
}

export interface UpgradeDeps {
  fetch: typeof globalThis.fetch
  registryUrl: string
  packageRoot: string
  /** The temp-home seam, as onboard's. */
  home: string
  /** Names the Harness for an invoke-only `onboard --install`. */
  env: Record<string, string | undefined>
  npmVersion: () => string
}

const DEV_CHECKOUT_WORK = 'git pull && npm run build && npm run install:local'

const NPM_PROBE_NOTE =
  'The local npm version could not be determined, so every install flag is included above. ' +
  'npm majors that predate a flag print `npm warn Unknown cli config` and proceed — that warning is harmless.'

const ETARGET_NOTE =
  'If the install fails with ETARGET, your configured registry (a mirror or proxy) does not have the pinned version — ' +
  'append `--registry=https://registry.npmjs.org` to the install command.'

const VERIFY_NOTE = 'Re-run `hafez upgrade` to verify.'

/** Three-way compare on the numeric segments. Hand-rolled string compare is
 * the trap this exists to avoid: `1.10.0` < `1.9.0` lexicographically.
 * Anything that is not plain X.Y.Z (a prerelease, a build tag) is `unknown` —
 * this tool never guesses at a version it cannot order. */
export function compareVersions(local: string, latest: string): Comparison {
  if (!PLAIN_SEMVER.test(local) || !PLAIN_SEMVER.test(latest)) return 'unknown'
  const a = local.split('.').map(Number)
  const b = latest.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if (a[i] < b[i]) return 'behind'
    if (a[i] > b[i]) return 'ahead'
  }
  return 'equal'
}

/** A path that cannot be made safe by single-quoting it. Spaces, `$(`, and
 * globs are all inert inside single quotes; a quote, newline, or control
 * character is not. */
function unquotable(path: string): boolean {
  return /['\u0000-\u001f]/.test(path)
}

function exists(path: string): boolean {
  try {
    return existsSync(path)
  } catch {
    return false
  }
}

/** The installed version, from our own package.json — trusted input, so it is
 * echoed as-is. A non-plain version (a dev prerelease) still prints; it just
 * makes the comparison `unknown`. */
function readLocalVersion(packageRoot: string): string {
  try {
    const parsed = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf-8'))
    return typeof parsed?.version === 'string' && parsed.version.length > 0 ? parsed.version : 'unknown'
  } catch {
    return 'unknown'
  }
}

type RegistryCheck = { latest: string | null; reachable: boolean }

/** Reachability and parseability are different facts, so they get different
 * statuses: no usable answer at all (transport failure, timeout, non-2xx, or
 * an unparseable body) is `reachable: false`; a parsed answer whose `version`
 * is not plain X.Y.Z is `reachable: true` with a null latest. Both print no
 * install command — there is no verified version to pin. The `reachable:
 * false` message covers the mirror-404 case too, so it does not claim the
 * user is offline when the registry answered. */
async function checkRegistry(deps: UpgradeDeps): Promise<RegistryCheck> {
  try {
    const res = await deps.fetch(deps.registryUrl, { signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS) })
    if (!res.ok) return { latest: null, reachable: false }
    const body = (await res.json()) as unknown
    const version = (body as { version?: unknown } | null)?.version
    if (typeof version !== 'string' || !PLAIN_SEMVER.test(version)) return { latest: null, reachable: true }
    return { latest: version, reachable: true }
  } catch {
    // Deliberately discards the caught value: its message can carry a slice of
    // the response body straight into an agent's execution context.
    return { latest: null, reachable: false }
  }
}

function probeNpmMajor(deps: UpgradeDeps): number | null {
  try {
    const major = Number(deps.npmVersion().trim().split('.')[0])
    return Number.isInteger(major) && major > 0 ? major : null
  } catch {
    return null
  }
}

/** The dev-checkout upgrade runs git and npm scripts, so it MUST name its
 * directory: an agent's cwd is the user's own project, not this checkout, and
 * a bare `git pull && npm run build` would upgrade whatever repo it happens to
 * be standing in. */
function devCheckoutStep(packageRoot: string): UpgradeStep {
  if (unquotable(packageRoot)) {
    return {
      kind: 'action',
      text: `Upgrade the development checkout at ${packageRoot} by hand — its path contains characters that single-quoting cannot make safe. In that directory run: ${DEV_CHECKOUT_WORK}`,
    }
  }
  return { kind: 'command', text: `cd '${packageRoot}' && ${DEV_CHECKOUT_WORK}` }
}

function readIntegration(home: string): Integration | null {
  try {
    const { skills, blocks } = checkInstall(home)
    return { mode: blocks.length > 0 ? 'always-on' : 'invoke-only', blocks, skills }
  } catch {
    return null
  }
}

const HARNESS_IDS = Object.keys(HARNESSES).join('|')

/** `onboard --install` writes both skills on every run, so a skill needs no
 * run of its own when a Block's run is printed. Broken markers make that run
 * refuse, so they get only the hand fix until it is done. When upgrading,
 * every installed piece is refreshed: the new version renders new text, and
 * this check can only compare against the running one's. */
function integrationSteps(integration: Integration | null, upgrading: boolean, env: UpgradeDeps['env']): UpgradeStep[] {
  if (integration === null) {
    return [{ kind: 'action', text: 'The installed skills and Block could not be read, so they were not checked.' }]
  }
  const broken = integration.blocks.filter(b => b.state === 'broken')
  if (broken.length > 0) {
    return broken.map(b => ({
      kind: 'action',
      text: fixBrokenMarkers(b.path, 'hafez upgrade'),
    }))
  }
  const { blocks, skills } = integration
  const skillDrift = skills.some(s => s.state === 'stale' || s.state === 'hand-edited')
  const blockDrift = (b: BlockCheck) => b.state === 'stale' || (b.state === 'hand-edited' && b.renderChanged)
  const installed = blocks.length > 0 || skills.some(s => s.state !== 'absent')
  if (!installed || (!upgrading && !skillDrift && !blocks.some(blockDrift))) return []

  if (blocks.length > 0) {
    // Skills alone: any Block's run writes them, so pick one that run will not
    // stop on to ask about a hand-edit the status says needs nothing.
    const skillsOnly = [blocks.find(b => b.state !== 'hand-edited') ?? blocks[0]]
    const targets = upgrading ? blocks : blocks.filter(blockDrift)
    return (targets.length > 0 ? targets : skillsOnly).map(b => ({
      kind: 'command',
      text: `hafez onboard --install --mode always-on --harness ${b.harness}`,
    }))
  }
  const harness = detectAgent(env)
  if (isHarness(harness)) return [{ kind: 'command', text: `hafez onboard --install --mode invoke-only --harness ${harness}` }]
  return [{
    kind: 'action',
    text: `Run \`hafez onboard --install --mode invoke-only --harness <${HARNESS_IDS}>\`, naming the harness you are running in.`,
  }]
}

/** The action list, in execution order. Every command is built from static
 * constants; the only interpolated values are the regex-validated version,
 * the quoted package root, and harness ids from the HARNESSES table. */
function deriveSteps(
  state: Omit<UpgradeState, 'steps' | 'alternativeInstall'>,
  ctx: { packageRoot: string; env: UpgradeDeps['env'] },
): Pick<UpgradeState, 'steps' | 'alternativeInstall'> {
  const steps: UpgradeStep[] = []
  let alternativeInstall: string | null = null
  const upgrading = state.comparison === 'behind' && state.latest !== null

  if (upgrading) {
    if (state.install === 'dev-checkout') {
      // A contributor whose ~/.local/bin/hafez symlinks into a source tree
      // would have the symlink shadow any global install forever — and the
      // mandatory re-run would report `behind` forever with it.
      steps.push(devCheckoutStep(ctx.packageRoot))
    } else {
      // Pinned, never `@latest`: an unpinned command resolves at install time
      // and can install something other than what was just verified.
      const scripts = state.npmMajor === null || state.npmMajor >= 11 ? ' --allow-scripts=better-sqlite3' : ''
      const remote = state.npmMajor === null || state.npmMajor >= 12 ? ' --allow-remote=root' : ''
      steps.push({ kind: 'command', text: `npm install -g hafez@${state.latest}${scripts}` })
      // Same package, same install scripts — the tarball needs the scripts flag too.
      alternativeInstall =
        `npm install -g https://github.com/shrvn-r/hafez/releases/download/v${state.latest}/hafez.tgz${scripts}${remote}`
      if (state.npmMajor === null) steps.push({ kind: 'action', text: NPM_PROBE_NOTE })
      steps.push({ kind: 'action', text: ETARGET_NOTE })
    }
  }

  steps.push(...integrationSteps(state.integration, upgrading, ctx.env))

  // A SCHEMA_VERSION bump does not self-heal: the read-only path warns and
  // returns null, so the first post-upgrade query answers *empty* until a
  // write command or an explicit rebuild.
  if (upgrading) steps.push({ kind: 'command', text: 'hafez index rebuild' })

  if (steps.length > 0) steps.push({ kind: 'action', text: VERIFY_NOTE })
  return { steps, alternativeInstall }
}

export async function buildUpgradeState(deps: UpgradeDeps): Promise<UpgradeState> {
  const current = readLocalVersion(deps.packageRoot)
  const registry = await checkRegistry(deps)
  const base = {
    current,
    latest: registry.latest,
    comparison: registry.latest === null ? ('unknown' as Comparison) : compareVersions(current, registry.latest),
    registryReachable: registry.reachable,
    npmMajor: probeNpmMajor(deps),
    // Published tarballs carry only dist, skill, README.md and LICENSE.
    install: exists(join(deps.packageRoot, 'src')) ? ('dev-checkout' as const) : ('registry' as const),
    integration: readIntegration(deps.home),
  }
  return { ...base, ...deriveSteps(base, { packageRoot: deps.packageRoot, env: deps.env }) }
}

function versionLines(state: UpgradeState): string[] {
  const lines = [`Installed version: ${state.current}`]
  if (state.latest === null) {
    lines.push(
      state.registryReachable
        ? "Published version: unknown — the registry's answer is not a plain X.Y.Z. Check manually at https://www.npmjs.com/package/hafez."
        : "Published version: couldn't check (offline?) — the registry gave no usable answer. If HAFEZ_REGISTRY_URL points at a mirror, it may simply not carry hafez. Nothing has changed.",
    )
    return lines
  }
  lines.push(`Published version: ${state.latest}`)
  if (state.comparison === 'behind') lines.push('Your install is BEHIND the published version — steps below.')
  else if (state.comparison === 'equal')
    lines.push(
      'Your install is current. Checked against the npm registry only — a just-cut GitHub Release may not be published yet.',
    )
  else if (state.comparison === 'ahead')
    lines.push('Local build is ahead of the published version — nothing to do.')
  else lines.push('Could not compare: the installed version is not a plain X.Y.Z. Check manually.')
  return lines
}

const BLOCK_STATE: Record<BlockCheck['state'], (b: BlockCheck) => string> = {
  current: () => 'current',
  stale: () => 'stale',
  'hand-edited': b =>
    b.renderChanged
      ? "hand-edited, and the Block Hafez writes has changed since. `onboard --install` leaves it alone and prints a diff; replace it with --confirm only after the user's yes"
      : 'hand-edited, over the current Block — nothing to update',
  broken: () => 'broken markers',
}

function integrationLines(integration: Integration | null): string[] {
  if (integration === null) return ['Skills and Block: could not be read.']
  const lines =
    integration.mode === 'always-on'
      ? ['Mode: always-on (a Block is installed).']
      : [
          'Mode: invoke-only (no Block in any instructions file Hafez writes); installing a Block is not offered.',
          "A Block pasted into Cursor's User Rules lives in its Settings and is not checked here.",
        ]
  for (const b of integration.blocks) lines.push(`- Block in ${b.path}: ${BLOCK_STATE[b.state](b)}`)
  for (const s of integration.skills) {
    const lost = s.state === 'hand-edited' ? ' — `onboard --install` replaces it, and the edit is lost' : ''
    lines.push(`- ${s.path}: ${s.state}${lost}`)
  }
  return lines
}

export function renderUpgrade(state: UpgradeState): string {
  const out: string[] = [
    '# Hafez — Upgrade Check',
    '',
    'You are an agent reading this on behalf of your user. This command checks',
    'and prints — it never installs anything. The steps below install code and',
    "overwrite the user's agent instructions, so show them verbatim, get an",
    'explicit yes, and only then run them. Never run them unattended.',
    '',
    '## Status',
    '',
    ...versionLines(state),
  ]

  if (state.install === 'dev-checkout') {
    out.push('Install source: development checkout (this package has a src/ directory) — upgrade with git, not npm.')
  }

  out.push('')
  out.push(...integrationLines(state.integration))
  out.push('')
  out.push('## Steps')
  out.push('')

  if (state.steps.length === 0) {
    out.push('Nothing to do.')
    return out.join('\n') + '\n'
  }

  out.push('In this order, after the user approves:')
  out.push('')
  state.steps.forEach((step, i) => {
    out.push(`${i + 1}. [${step.kind}] ${step.text}`)
  })

  if (state.alternativeInstall !== null) {
    out.push('')
    out.push('Alternative to the npm install above — ONLY if hafez was installed from')
    out.push('the GitHub release tarball rather than the npm registry. Run one or the')
    out.push('other, never both:')
    out.push('')
    out.push(`  ${state.alternativeInstall}`)
  }

  return out.join('\n') + '\n'
}

function defaultDeps(): UpgradeDeps {
  const here = dirname(fileURLToPath(import.meta.url))
  return {
    fetch: (...args) => globalThis.fetch(...args),
    // The documented escape hatch for private registries and proxied networks.
    registryUrl: process.env.HAFEZ_REGISTRY_URL || DEFAULT_REGISTRY_URL,
    packageRoot: join(here, '..', '..'),
    home: homedir(),
    env: process.env,
    // Bounded for the same reason the registry fetch is: a global prefix on a
    // network mount or a cold cache can hang npm, and `upgrade` has to stay
    // answerable when the environment is the thing that is broken. A timeout
    // kills the probe, which degrades to npmMajor: null and every flag.
    npmVersion: () =>
      execFileSync('npm', ['--version'], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: NPM_PROBE_TIMEOUT_MS,
      }),
  }
}

const USAGE = 'Usage: hafez upgrade [--json]'

/** `deps` is the third parameter, unreachable from dispatch (PreVaultRun is
 * `(args, ctx)`) — the tests inject it directly. */
export async function cmdUpgrade(
  args: string[],
  ctx: { json: boolean },
  deps: UpgradeDeps = defaultDeps(),
): Promise<string> {
  helpIfAsked(args, USAGE)
  for (const arg of args) {
    if (arg.startsWith('--')) throw new UsageError(`Unknown flag ${arg}\n${USAGE}`)
    throw new UsageError(`upgrade takes no arguments\n${USAGE}`)
  }
  const state = await buildUpgradeState(deps)
  return ctx.json ? JSON.stringify(state, null, 2) : renderUpgrade(state)
}
