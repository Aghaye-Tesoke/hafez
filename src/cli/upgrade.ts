// src/cli/upgrade.ts
//
// `hafez upgrade` — agent-directed update check. It CHECKS AND PRINTS; it
// never installs. The printed steps install code and overwrite the user's
// agent instructions, so the privileged step is the human's — same discipline
// as `onboard` (writes nothing outside the vault) and as the release skill
// (`npm publish` is the user's action). It also sidesteps a process replacing
// its own binary mid-run.
//
// `pre-vault` on purpose: it must still work when the vault is unresolvable
// or the native SQLite binding is unbuilt, which is exactly when someone is
// trying to upgrade. Nothing here touches the core.
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
import { UsageError } from './args.js'
import { INTEGRATION_SNIPPET } from './onboard.js'

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
  skill: 'present' | 'absent'
  skillSource: string
  skillTarget: string
  /** Mutually exclusive with the registry install in `steps` — exposed
   * separately so an agent iterating `steps` cannot run both. */
  alternativeInstall: string | null
  steps: UpgradeStep[]
}

export interface UpgradeDeps {
  fetch: typeof globalThis.fetch
  registryUrl: string
  packageRoot: string
  installedSkillPath: string
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

function skillCopyStep(source: string, target: string, sourceExists: boolean): UpgradeStep {
  if (!sourceExists) {
    // Emitting the cp anyway would hand the agent a step that fails with
    // ENOENT and reads as a failed upgrade, for a check that found nothing.
    return {
      kind: 'action',
      text:
        `No bundled skill at ${source}, so the installed copy at ${target} cannot be refreshed from this ` +
        'package. Re-copy it from the installed hafez package after upgrading — see the README Updating section.',
    }
  }
  if (unquotable(source) || unquotable(target)) {
    return {
      kind: 'action',
      text:
        'Copy the bundled skill file over the installed one by hand — the paths contain characters ' +
        `that single-quoting cannot make safe. Source: ${source} — Target: ${target}`,
    }
  }
  return { kind: 'command', text: `mkdir -p '${dirname(target)}' && cp '${source}' '${target}'` }
}

/** The action list, in execution order. Every command is built from static
 * constants; the only interpolated values are the regex-validated version and
 * the quoted absolute paths (package root, skill source, skill target). */
function deriveSteps(
  state: Omit<UpgradeState, 'steps' | 'alternativeInstall'>,
  ctx: { packageRoot: string; skillSourceExists: boolean },
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

  // Unconditional when the skill exists: the bundled skill ships INSIDE the
  // installed package, so on the main upgrade path the bundled copy is equally
  // stale and any byte-compare reports "current" in exactly the silent-drift
  // case detection would exist for. Copying an identical file is a no-op.
  if (state.skill === 'present') steps.push(skillCopyStep(state.skillSource, state.skillTarget, ctx.skillSourceExists))

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
    skill: exists(deps.installedSkillPath) ? ('present' as const) : ('absent' as const),
    skillSource: join(deps.packageRoot, 'skill', 'SKILL.md'),
    skillTarget: deps.installedSkillPath,
  }
  return {
    ...base,
    ...deriveSteps(base, { packageRoot: deps.packageRoot, skillSourceExists: exists(base.skillSource) }),
  }
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
  out.push(
    state.skill === 'present'
      ? `Skill: installed at ${state.skillTarget}. The skill ships inside the hafez package, so an upgraded package leaves this copy stale — the re-copy step is idempotent, run it either way.`
      : `Skill: none at ${state.skillTarget} — nothing to re-copy (a non-Claude-Code harness, not drift).`,
  )
  out.push('')
  out.push('Integration snippet — compare this against the Hafez section of the')
  out.push("user's instructions file (Claude Code: ~/.claude/CLAUDE.md; any")
  out.push('AGENTS.md harness: its global AGENTS.md) and reconcile differences')
  out.push('with them. Do not rewrite their file unasked.')
  out.push('')
  out.push(INTEGRATION_SNIPPET)
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
    installedSkillPath: join(homedir(), '.claude', 'skills', 'hafez', 'SKILL.md'),
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
  for (const arg of args) {
    if (arg.startsWith('--')) throw new UsageError(`Unknown flag ${arg}\n${USAGE}`)
    throw new UsageError(`upgrade takes no arguments\n${USAGE}`)
  }
  const state = await buildUpgradeState(deps)
  return ctx.json ? JSON.stringify(state, null, 2) : renderUpgrade(state)
}
