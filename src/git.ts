// src/git.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { simpleGit, type SimpleGit, type SimpleGitOptions } from 'simple-git'

import { mergeVaultContent } from './merge.js'
import { VAULT_FILE_RE, INDEXED_DIR_PATHSPECS, classifyIndexedRelPath, vaultKindFromRelPath } from './vault.js'
import { normalizeSinceDate } from './dates.js'
import { HafezError, type GitConfig, type ChangelogEntry, type Journal } from './types.js'

// Hafez runs git in the user's own shell, and git inherited that environment before simple-git
// guarded it. simple-git 4 guards it two ways, and both are opened in full: `allowEnvironment`
// names every key the process carries (the guard otherwise strips ambient GIT_* / EDITOR / PAGER
// keys and rejects supplied ones — a user's GIT_SSH_COMMAND or GIT_AUTHOR_* would vanish), and
// `unsafe` opens every category — `Required`, so a category the library adds fails the build
// instead of rejecting some user's shell at runtime (4.0 moved GIT_EXEC_PATH to allowUnsafeExec).
const OPEN_UNSAFE: Required<SimpleGitOptions['unsafe']> = {
  allowUnsafeAlias: true,
  allowUnsafeAskPass: true,
  allowUnsafeCommandBinaries: true,
  allowUnsafeConfigEnvCount: true,
  allowUnsafeConfigPaths: true,
  allowUnsafeCredentialHelper: true,
  allowUnsafeDiffExternal: true,
  allowUnsafeDiffTextConv: true,
  allowUnsafeEditor: true,
  allowUnsafeExec: true,
  allowUnsafeFilter: true,
  allowUnsafeFsMonitor: true,
  allowUnsafeGitProxy: true,
  allowUnsafeGpgProgram: true,
  allowUnsafeHooksPath: true,
  allowUnsafeInclude: true,
  allowUnsafeMergeDriver: true,
  allowUnsafePack: true,
  allowUnsafePager: true,
  allowUnsafeProtocolOverride: true,
  allowUnsafeSshCommand: true,
  allowUnsafeSubmodule: true,
  allowUnsafeTemplateDir: true,
  allowUnsafeUrlRewrite: true,
  allowUnsafeCustomBinary: true,
  // Otherwise the plugin exports GIT_TEST_DISALLOW_ABBREVIATED_OPTIONS to the child and the
  // vault's own hooks start failing on abbreviated long options only when hafez commits.
  allowAbbreviatedOptions: true
}

// Hafez's own git calls are never interactive: GIT_EDITOR outranks core.editor, -c, VISUAL and
// EDITOR. `.env()` replaces the child env, hence the spread.
const vaultGit = (vaultPath: string): SimpleGit =>
  simpleGit({
    baseDir: vaultPath,
    allowEnvironment: [...Object.keys(process.env), 'GIT_EDITOR'],
    unsafe: OPEN_UNSAFE
  }).env({ ...process.env, GIT_EDITOR: 'true' })

const logMerge = (msg: string) => process.stderr.write(`[hafez-merge] ${msg}\n`)

const MAX_PUSH_RETRIES = 3
const RETRY_BASE_MS = 200
// A pull --rebase replays one local commit at a time; each can stop on a
// conflict. Bound the resolution loop far above any realistic commit count.
const MAX_REBASE_STEPS = 50

function isRebaseInProgress(vaultPath: string): boolean {
  return (
    existsSync(join(vaultPath, '.git', 'rebase-merge')) ||
    existsSync(join(vaultPath, '.git', 'rebase-apply'))
  )
}

function isMergeInProgress(vaultPath: string): boolean {
  return existsSync(join(vaultPath, '.git', 'MERGE_HEAD'))
}

/**
 * Abort any in-progress rebase or merge, restoring the repo to a clean state.
 * Silently ignores "nothing to abort" errors (TOCTOU race: another process
 * may have resolved the state between our check and the abort call).
 */
async function ensureCleanState(git: SimpleGit, vaultPath: string): Promise<void> {
  if (isRebaseInProgress(vaultPath)) {
    try {
      await git.rebase(['--abort'])
    } catch {
      // Already resolved by another process — safe to ignore
    }
  }
  if (isMergeInProgress(vaultPath)) {
    try {
      await git.raw(['merge', '--abort'])
    } catch {
      // Already resolved by another process — safe to ignore
    }
  }
}

/**
 * True if the vault repo has an `origin` remote. A local-only vault (the
 * default the README setup produces) has none — every pull/push must be
 * skipped for it, silently: the commit IS the whole job.
 */
async function hasOriginRemote(git: SimpleGit): Promise<boolean> {
  const remotes = await git.getRemotes()
  return remotes.some(r => r.name === 'origin')
}

/** The branch this vault is on (symbolic HEAD). */
async function currentBranch(git: SimpleGit): Promise<string> {
  return (await git.raw(['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
}

/** The branch's configured upstream (`origin/main`), or null when it has none. */
async function upstreamRef(git: SimpleGit): Promise<string | null> {
  try {
    const ref = (await git.raw(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])).trim()
    return ref || null
  } catch {
    return null
  }
}

/**
 * Give the current branch an upstream when git does not know about one yet.
 *
 * `git remote add origin …` on a vault that has only ever been local leaves
 * the branch both unpublished and untracked, and in that state `git pull`,
 * `git push` and `@{u}` are all fatal — so every mutation after the remote
 * was added died at the sync/push stage. Returns false when origin does not
 * carry the branch at all: there is nothing to pull and nothing to track
 * until the first push creates it (see pushCurrent).
 *
 * A remote we cannot reach also reports false — the caller's push, and its
 * retry loop, is where a network failure belongs.
 */
async function ensureUpstream(git: SimpleGit): Promise<boolean> {
  if (await upstreamRef(git)) return true
  try {
    const branch = await currentBranch(git)
    const heads = await git.raw(['ls-remote', '--heads', 'origin', branch])
    if (!heads.trim()) return false
    await git.fetch('origin', branch)
    await git.raw(['branch', `--set-upstream-to=origin/${branch}`, branch])
    return true
  } catch {
    return false
  }
}

/**
 * Push the current branch, publishing it when it has no upstream yet. That
 * first `push --set-upstream` is what turns a freshly-added origin into a
 * normal tracking setup; every push after it is the plain push.
 */
async function pushCurrent(git: SimpleGit): Promise<void> {
  if (await upstreamRef(git)) {
    await git.push()
    return
  }
  await git.push(['--set-upstream', 'origin', await currentBranch(git)])
}

/** Read one side of a conflicted file from the index; null if that side deleted it. */
async function showStage(git: SimpleGit, stage: 2 | 3, file: string): Promise<string | null> {
  try {
    return await git.show([`:${stage}:${file}`])
  } catch (err) {
    // Only a genuinely absent stage means "this side deleted the file". Any
    // other failure (spawn error, repo corruption) must abort resolution —
    // treating it as a deletion would silently drop that side's content.
    if (/not at stage|does not exist/i.test(String(err))) return null
    throw err
  }
}

/**
 * Resolve a conflicted in-progress rebase by semantically merging each
 * conflicting vault file and continuing the rebase — never by resetting.
 * Every non-conflicting local commit is replayed untouched, so nothing
 * outside the conflicting files can be lost.
 *
 * On failure (non-vault conflicts, malformed content, unexpected git error)
 * the rebase is aborted, which restores the local branch exactly as it was
 * before the pull. Returns the conflicting files either way, for error messages.
 */
async function resolveRebaseConflicts(
  git: SimpleGit,
  vaultPath: string
): Promise<{ resolved: boolean; files: string[] }> {
  let lastFiles: string[] = []

  // Only rebase conflicts are resolvable here. A merge (MERGE_HEAD) can only
  // come from an interrupted non-rebase pull, which hafez never runs — abort it.
  if (isMergeInProgress(vaultPath)) {
    await ensureCleanState(git, vaultPath)
    return { resolved: false, files: [] }
  }

  try {
    for (let step = 0; step < MAX_REBASE_STEPS && isRebaseInProgress(vaultPath); step++) {
      const conflictFiles = await getConflictingFiles(git)
      if (conflictFiles.length > 0) lastFiles = conflictFiles

      if (!conflictFiles.every(f => VAULT_FILE_RE.test(f))) {
        await ensureCleanState(git, vaultPath)
        return { resolved: false, files: conflictFiles }
      }

      if (conflictFiles.length > 0) {
        logMerge(`conflict detected, attempting semantic merge for: ${conflictFiles.join(', ')}`)
      }

      for (const file of conflictFiles) {
        // During a rebase, stage 2 ("ours") is the upstream/remote side and
        // stage 3 ("theirs") is the local commit being replayed.
        const remoteContent = await showStage(git, 2, file)
        const localContent = await showStage(git, 3, file)

        if (remoteContent === null && localContent === null) {
          // Deleted on both sides — accept the deletion
          await git.raw(['rm', '--force', '--ignore-unmatch', '--', file])
          continue
        }
        // Classify from the repo-relative path: every file here passed
        // VAULT_FILE_RE, so the Layout classifier is total over it — no
        // fallback kind to drift when a vault dir is added.
        const merged =
          localContent === null ? remoteContent!
          : remoteContent === null ? localContent
          : mergeVaultContent(remoteContent, localContent, vaultKindFromRelPath(file))

        const fullPath = join(vaultPath, file)
        mkdirSync(dirname(fullPath), { recursive: true })
        writeFileSync(fullPath, merged)
        await git.add([file])
      }

      // Decide structurally whether this step still has anything to commit:
      // no staged paths means the merged result is identical to the already-
      // applied tree, so the replayed commit became empty and must be skipped.
      // Output-based on purpose — never `--quiet` exit codes (simple-git
      // swallows diff's silent exit 1) and never git's error prose (localized,
      // and it quotes commit subjects; a false "empty" match would skip a
      // real commit — the COR-1 bug class again).
      const staged = (await git.raw(['diff', '--cached', '--name-only'])).trim()
      const stepEmpty = staged.length === 0

      try {
        // Non-interactive: --continue reuses the replayed commit's message
        await git.rebase([stepEmpty ? '--skip' : '--continue'])
      } catch (err) {
        // --continue/--skip exit non-zero when the rebase stops again on the
        // NEXT local commit's conflict. That is progress, not failure — the
        // loop resolves the new conflicts on its next pass. Anything else
        // (stuck with nothing to resolve) aborts via the outer catch.
        const nextConflicts = await getConflictingFiles(git)
        if (!isRebaseInProgress(vaultPath) || nextConflicts.length === 0) {
          throw err
        }
      }
    }

    if (isRebaseInProgress(vaultPath)) {
      // Step budget exhausted — bail out safely
      await ensureCleanState(git, vaultPath)
      return { resolved: false, files: lastFiles }
    }

    if (lastFiles.length > 0) logMerge(`semantic merge succeeded for: ${lastFiles.join(', ')}`)
    return { resolved: true, files: lastFiles }
  } catch (err) {
    logMerge(`semantic merge failed, restoring local state: ${err}`)
    try { await ensureCleanState(git, vaultPath) } catch { /* last resort failed */ }
    return { resolved: false, files: lastFiles }
  }
}

/**
 * One `pull --rebase` attempt, resolving vault-file conflicts inside the
 * rebase. Throws HafezError when a conflict cannot be auto-resolved (the
 * repo is left clean, local commits intact); rethrows the raw git error on
 * transient failures so the caller can retry.
 */
async function pullResolving(
  git: SimpleGit,
  vaultPath: string,
  conflictMessage: (files: string[]) => string
): Promise<void> {
  try {
    await git.pull('origin', undefined, { '--rebase': null })
  } catch (err) {
    if (isRebaseInProgress(vaultPath) || isMergeInProgress(vaultPath)) {
      const { resolved, files } = await resolveRebaseConflicts(git, vaultPath)
      if (resolved) return
      const detail = err instanceof Error ? err.message : String(err)
      throw new HafezError('GIT_PUSH_FAILED', conflictMessage(files), [detail])
    }
    try { await ensureCleanState(git, vaultPath) } catch { /* preserve error */ }
    throw err
  }
}

/**
 * Push local commits, pulling with rebase and resolving vault-file conflicts
 * semantically when the push is rejected. Push-first: callers either just
 * pulled (gitSync) or usually have a current remote view, so the extra
 * round-trip only happens when the remote actually moved. Shared by gitSync
 * and gitCommitAndPush — this is the single code path that decides whether
 * local data survives a conflict.
 */
async function pushResolving(
  git: SimpleGit,
  vaultPath: string,
  conflictMessage: (files: string[]) => string,
  exhaustedMessage: string
): Promise<void> {
  // Bootstrap a freshly-added origin before the retry loop: without an
  // upstream the rejection handling below (pull --rebase) is itself fatal.
  await ensureUpstream(git)

  let lastDetail = ''
  for (let attempt = 1; attempt <= MAX_PUSH_RETRIES; attempt++) {
    try {
      await pushCurrent(git)
      return
    } catch (pushErr) {
      lastDetail = pushErr instanceof Error ? pushErr.message : String(pushErr)
      // Rejected (remote moved) or transient — integrate remote, then retry
      try {
        await pullResolving(git, vaultPath, conflictMessage)
      } catch (err) {
        if (err instanceof HafezError) throw err
        lastDetail = err instanceof Error ? err.message : String(err)
      }
      if (attempt === MAX_PUSH_RETRIES) {
        throw new HafezError('GIT_PUSH_FAILED', exhaustedMessage, [lastDetail])
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_BASE_MS * attempt))
    }
  }
}

/**
 * Bidirectional sync: pull remote changes, push local commits.
 * All work must be committed before calling — no file save/restore needed.
 */
export async function gitSync(
  vaultPath: string
): Promise<{ pulled: boolean; pushed: boolean; remote: boolean }> {
  const git: SimpleGit = vaultGit(vaultPath)

  if (!(await hasOriginRemote(git))) {
    return { pulled: false, pushed: false, remote: false }
  }

  // Clean up any stuck rebase/merge from a previous crash.
  // Safe to abort without saving files — all work is already committed.
  await ensureCleanState(git, vaultPath)

  const syncConflictMessage = (files: string[]) =>
    `Git conflict during sync (files: ${files.join(', ')}). Changes saved locally.`

  let pulled = false

  // A remote that does not carry this branch yet (freshly added to a vault
  // that has only ever been local) has nothing to pull and no `@{u}` to count
  // against — both steps would be fatal. Skip straight to the push, which
  // publishes the branch and sets the upstream.
  const tracking = await ensureUpstream(git)

  if (tracking) {
    // Always pull first (bidirectional sync)
    const headBefore = (await git.revparse(['HEAD'])).trim()
    for (let attempt = 1; attempt <= MAX_PUSH_RETRIES; attempt++) {
      try {
        await pullResolving(git, vaultPath, syncConflictMessage)
        const headAfter = (await git.revparse(['HEAD'])).trim()
        pulled = headAfter !== headBefore
        break
      } catch (err) {
        if (err instanceof HafezError) throw err
        if (attempt === MAX_PUSH_RETRIES) {
          const detail = err instanceof Error ? err.message : String(err)
          throw new HafezError(
            'GIT_PUSH_FAILED',
            `Git pull failed after ${MAX_PUSH_RETRIES} attempts during sync. Changes saved locally.`,
            [detail]
          )
        }
        await new Promise((resolve) => setTimeout(resolve, RETRY_BASE_MS * attempt))
      }
    }

    // Check if there are local commits to push
    const ahead = await git.raw(['rev-list', '--count', '@{u}..HEAD']).then(s => parseInt(s.trim(), 10))
    if (ahead === 0) return { pulled, pushed: false, remote: true }
  }

  await pushResolving(
    git, vaultPath, syncConflictMessage,
    `Git push failed after ${MAX_PUSH_RETRIES} attempts during sync. Changes saved locally.`
  )
  return { pulled, pushed: true, remote: true }
}

/**
 * Unstage files (best effort). Used by the journal adapter's commit-failure
 * repair: a commit that fails after `git add` leaves the new blobs staged in
 * .git/index, and the next successful commit would publish rolled-back
 * content under the wrong message. Clearing the index entries restores
 * worktree/HEAD/index agreement.
 */
async function gitUnstage(vaultPath: string, files: string[]): Promise<void> {
  try {
    await vaultGit(vaultPath).raw(['reset', '-q', 'HEAD', '--', ...files])
  } catch { /* best effort — rollback must not mask the original error */ }
}

/**
 * The subset of `files` that `git add` can actually stage. `git add` is fatal
 * on a pathspec matching nothing, and a batch that creates then deletes the
 * same slug (capture then cross-kind promote) hands the Journal a deleted path
 * that is absent from the worktree AND was never tracked — unstageable by
 * construction, and it needs no staging: git never knew about it. A deleted
 * path git DOES track still goes through `add`, which stages its removal.
 */
async function stageablePaths(git: SimpleGit, vaultPath: string, files: string[]): Promise<string[]> {
  const absent = files.filter(f => !existsSync(join(vaultPath, f)))
  if (absent.length === 0) return files
  // -z: NUL-separated, so git never quotes/escapes the paths it echoes back.
  const tracked = new Set(
    (await git.raw(['ls-files', '-z', '--', ...absent])).split('\0').filter(Boolean)
  )
  const absentSet = new Set(absent)
  return files.filter(f => !absentSet.has(f) || tracked.has(f))
}

/** Get list of files with unresolved conflicts */
async function getConflictingFiles(git: SimpleGit): Promise<string[]> {
  try {
    const output = await git.diff(['--name-only', '--diff-filter=U'])
    return output.split('\n').map(f => f.trim()).filter(Boolean)
  } catch {
    return []
  }
}

type ChangelogOperation = 'created' | 'updated' | 'deleted'

const FILE_STATUS_MAP: Record<string, ChangelogOperation> = {
  A: 'created',
  M: 'updated',
  D: 'deleted',
}

/**
 * One `--name-status` line → the (path, operation) pairs it stands for.
 *
 * Rename and copy lines carry a similarity score and TWO paths
 * (`R100\told\tnew`), so they match neither the single-path shape nor a
 * bare status letter. A promote moves entities/<slug>.md to
 * knowledge/<slug>.md, which git reports exactly that way — dropping the
 * line made every promote invisible in the changelog. A rename reads as the
 * old path disappearing and the new one appearing; a copy leaves the source
 * in place, so only the destination is news.
 */
function parseNameStatusLine(line: string): Array<{ path: string; operation: ChangelogOperation }> {
  const moveMatch = line.match(/^([RC])\d*\t([^\t]+)\t(.+)$/)
  if (moveMatch) {
    const [, statusChar, from, to] = moveMatch
    const dest = [{ path: to, operation: 'created' as const }]
    return statusChar === 'C' ? dest : [{ path: from, operation: 'deleted' as const }, ...dest]
  }

  const match = line.match(/^([A-Z])\t(.+)$/)
  if (!match) return []
  const operation = FILE_STATUS_MAP[match[1]]
  return operation ? [{ path: match[2], operation }] : []
}

/**
 * Read-side "no history": the one state where `git log` has nothing to say
 * and empty is the true answer — a repo with no commits yet. Everything else
 * (a directory that is not a repository, an env-guard or unsafe-category
 * rejection, a missing git binary, a corrupt repo) is a failure the write
 * side already reports loudly, so the read side must not hide it. Matched on
 * git's stderr text, which simple-git carries in `GitError.message`; both
 * callers pass a `--` pathspec and no revision, and an unborn HEAD then says
 * exactly this.
 */
const NO_HISTORY_RE = /does not have any commits yet/i

function isNoHistory(err: unknown): boolean {
  return NO_HISTORY_RE.test(err instanceof Error ? err.message : String(err))
}

function gitReadFailed(err: unknown): HafezError {
  const lines = (err instanceof Error ? err.message : String(err)).split('\n').map(l => l.trim()).filter(Boolean)
  return new HafezError('GIT_READ_FAILED', `git read failed: ${lines[0] ?? 'unknown error'}`, lines)
}

export async function gitChangelog(vaultPath: string, since: string): Promise<ChangelogEntry[]> {
  const git: SimpleGit = vaultGit(vaultPath)

  // Bare dates become local midnight — the same calendar-day boundary the
  // vault stamps and query comparisons use (see dates.ts).
  const normalizedSince = normalizeSinceDate(since)

  let output: string
  try {
    output = await git.raw([
      'log', `--since=${normalizedSince}`, '--name-status',
      '--pretty=format:%H|%aI|%s', '--', ...INDEXED_DIR_PATHSPECS,
    ])
  } catch (err) {
    if (isNoHistory(err)) return []
    throw gitReadFailed(err)
  }

  if (!output.trim()) return []

  const entries: ChangelogEntry[] = []
  const blocks = output.split(/\n(?=[0-9a-f]{40}\|)/)

  for (const block of blocks) {
    const lines = block.split('\n').filter(l => l.trim())
    if (lines.length === 0) continue

    const headerMatch = lines[0].match(/^([0-9a-f]+)\|(.+?)\|(.*)$/)
    if (!headerMatch) continue

    const [, , timestamp, commit_message] = headerMatch

    for (let i = 1; i < lines.length; i++) {
      for (const { path: filePath, operation } of parseNameStatusLine(lines[i])) {
        // Only vault documents — scaffold files (.gitkeep) live in the same
        // dirs and would otherwise surface as changelog rows.
        if (!filePath.endsWith('.md')) continue

        const classified = classifyIndexedRelPath(filePath)
        if (!classified) continue

        entries.push({ slug: classified.slug, kind: classified.kind, operation, timestamp, commit_message })
      }
    }
  }

  return entries
}

/**
 * Latest git time per file (repo-relative, forward-slash paths). Used to
 * break day-granularity frontmatter ties in stats recents. `modified` maps
 * each file to its most recent commit; `added` to the commit that added it.
 * Files with no history (not yet committed) are absent from the map.
 */
export async function gitFileTimes(vaultPath: string, mode: 'modified' | 'added'): Promise<Map<string, string>> {
  const git: SimpleGit = vaultGit(vaultPath)
  let output: string
  try {
    const args = ['log', '--pretty=format:%x00%aI', '--name-only', '--', ...INDEXED_DIR_PATHSPECS]
    if (mode === 'added') args.splice(1, 0, '--diff-filter=A')
    output = await git.raw(args)
  } catch (err) {
    if (isNoHistory(err)) return new Map()
    throw gitReadFailed(err)
  }
  const times = new Map<string, string>()
  let current = ''
  for (const line of output.split('\n')) {
    if (line.startsWith('\0')) { current = line.slice(1); continue }
    const file = line.trim()
    if (file && !times.has(file)) times.set(file, current) // first hit = newest
  }
  return times
}

export async function gitCommitAndPush(
  vaultPath: string,
  files: string[],
  message: string,
  config: GitConfig = {}
): Promise<void> {
  const git: SimpleGit = vaultGit(vaultPath)

  // If a previous run crashed mid-rebase/merge, the repo is stuck.
  // Aborting restores tracked files to their pre-rebase state, which may
  // overwrite files that index.ts just wrote. Save and restore them.
  if (isRebaseInProgress(vaultPath) || isMergeInProgress(vaultPath)) {
    const saved = new Map<string, Buffer>()
    for (const f of files) {
      const full = join(vaultPath, f)
      if (existsSync(full)) saved.set(full, readFileSync(full))
    }

    await ensureCleanState(git, vaultPath)

    for (const [fullPath, content] of saved) {
      writeFileSync(fullPath, content)
    }
  }

  const stageable = await stageablePaths(git, vaultPath, files)
  if (stageable.length === 0) return
  await git.add(stageable)

  // Handle "nothing to commit" (e.g., idempotent update wrote identical
  // content). Ask the index directly rather than via simple-git's status:
  // its `staged` list omits renamed paths (they go to `renamed` only), so a
  // promote git detected as a rename read as "nothing to commit" and was
  // silently dropped — left staged, uncommitted, absent from the changelog.
  // Same output-based protocol the rebase loop uses, and it is well-defined
  // against an unborn HEAD (diffs the empty tree).
  const stagedPaths = (await git.raw(['diff', '--cached', '--name-only'])).trim()
  if (stagedPaths.length === 0) return

  const committed = await git.commit(message)
  // simple-git swallows some commit failures (e.g. a rejected pre-commit
  // hook) into an empty result instead of throwing. Staged content with no
  // commit hash means the commit did NOT land — surface it so callers
  // (batch rollback in particular) treat it as a commit-stage failure.
  if (!committed.commit) {
    throw new HafezError('GIT_COMMIT_FAILED', `git commit produced no commit for: ${files.join(', ')}`)
  }

  if (config.push === false) return
  if (!(await hasOriginRemote(git))) return

  await pushResolving(
    git, vaultPath,
    (conflictFiles) => `Git conflict with remote (files: ${conflictFiles.join(', ')}). Changes saved locally.`,
    `Git push failed after ${MAX_PUSH_RETRIES} attempts. Changes saved locally.`
  )
}

/**
 * The production Journal (see CONTEXT.md): vault persistence backed by git.
 * Local-only vaults (no origin remote) commit silently without pushing —
 * that behavior lives in gitCommitAndPush/gitSync, inside this adapter.
 */
export function createGitJournal(vaultPath: string, config: GitConfig = {}): Journal {
  return {
    async commit(written: string[], deleted: string[], message: string): Promise<void> {
      const files = [...written, ...deleted]
      try {
        await gitCommitAndPush(vaultPath, files, message, config)
      } catch (err) {
        // Commit-stage failure: nothing landed, but `git add` may have staged
        // the new blobs — clean up our own partial state before rethrowing.
        // Push-stage failure keeps the local commit (GIT_PUSH_FAILED).
        if (!(err instanceof HafezError && err.code === 'GIT_PUSH_FAILED')) {
          await gitUnstage(vaultPath, files)
        }
        // The Journal is the seam: git's own error types must not escape it,
        // or callers (and the CLI exit-code table) see an unclassified failure.
        if (err instanceof HafezError) throw err
        const detail = err instanceof Error ? err.message : String(err)
        throw new HafezError('GIT_COMMIT_FAILED', `git commit failed for: ${files.join(', ')}`, [detail])
      }
    },
    sync: () => gitSync(vaultPath),
    changelog: (since: string) => gitChangelog(vaultPath, since),
    fileTimes: (mode: 'modified' | 'added') => gitFileTimes(vaultPath, mode),
  }
}
