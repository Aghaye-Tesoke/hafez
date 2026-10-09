// src/cli/block-hook.ts
//
// `onboard --block`, what the SessionStart hook prints (onboard decision #58):
// the Block, then the read line for every entity whose `resource` or slug
// matches the folder. Three folders are tried, each exactly: the working
// directory, its git root, and in a linked worktree the main repository's
// root; no directory in between. A `resource` matches a folder's path or the
// URL of one of its git remotes (case, `.git`, ssh vs https aside); a slug
// matches a folder's name. The hook never loads: the agent does the read.
//
// The hook must never block a session: any failure (no vault, bad config, an
// unbuilt native binding, no git) prints nothing. So the core and its native
// binding load here, inside the catch, never at module top. A bad invocation
// (unknown flag or harness) throws a usage error from `cmdOnboard`, which the
// CLI's `main` silences for `onboard --block` like any other failure (#132).

import { execFileSync } from 'child_process'
import { existsSync, realpathSync } from 'fs'
import { basename, dirname, isAbsolute, resolve } from 'path'
import { ENTITY_STATUSES } from '../contracts.js'
import type { ConfigHome } from './resolve-vault.js'

export interface BlockHookCtx extends ConfigHome {
  /** Defaults to the process's; read inside the catch, since a deleted
   * working directory makes reading it throw. */
  cwd?: string
  vaultFlag?: string
}

/** The render, or null for any failure: the caller prints nothing. */
export async function blockHook(ctx: BlockHookCtx): Promise<string | null> {
  try {
    const { isVault, resolveVaultPath } = await import('./resolve-vault.js')
    const vaultPath = resolveVaultPath(ctx.vaultFlag, ctx)
    // A --vault flag is not checked by resolution; opening a non-vault would
    // leave an index file in it.
    if (typeof vaultPath !== 'string' || !isVault(vaultPath)) return null
    const cwd = realpathSync(ctx.cwd ?? process.cwd())
    const folders = foldersOf(cwd)
    const remotes = remoteUrls(cwd)

    const { createHafez } = await import('../index.js')
    const { items } = await createHafez({ vaultPath, git: { push: false } }).query({ filter: 'all' })
    const matches = items
      .filter(e => folders.some(f => basename(f) === e.slug) || (e.resource !== null && resourceMatches(e.resource, folders, remotes)))
      // Active first: the status tuple is ordered active, paused, done.
      .sort((a, b) => ENTITY_STATUSES.indexOf(a.status) - ENTITY_STATUSES.indexOf(b.status))

    const { renderBlockHook } = await import('../surfaces/surfaces.js')
    return renderBlockHook(matches)
  } catch {
    return null
  }
}

/** git's output, or null when git fails or is absent. */
function git(cwd: string, ...args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim()
  } catch {
    return null
  }
}

/** The working directory, its git root, and in a linked worktree the main
 * repository's root. */
function foldersOf(cwd: string): string[] {
  const folders = [cwd]
  const out = git(cwd, 'rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir')
  const [top, common] = out?.split('\n') ?? []
  // Before git 2.31 `--path-format` is echoed back, not obeyed: no git root.
  if (top && common && isAbsolute(top) && isAbsolute(common)) {
    folders.push(top)
    // A linked worktree shares the main checkout's `.git` as its common dir.
    if (basename(common) === '.git' && dirname(common) !== top) folders.push(dirname(common))
  }
  return [...new Set(folders)]
}

/** Every remote's URL, normalised. */
function remoteUrls(cwd: string): string[] {
  const out = git(cwd, 'config', '--get-regexp', '^remote\\..*\\.url$')
  return out ? out.split('\n').map(line => normaliseUrl(line.slice(line.indexOf(' ') + 1))) : []
}

/** `git@github.com:Org/Repo.git`, `ssh://git@github.com/org/repo` and
 * `https://github.com/org/repo/` are all `github.com/org/repo`. */
function normaliseUrl(url: string): string {
  return url.trim().toLowerCase()
    .replace(/^[a-z+]+:\/\//, '')
    .replace(/^[^@/]+@/, '')
    .replace(/^([^/:]+):(?!\d)/, '$1/')
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
}

function resourceMatches(resource: string, folders: string[], remotes: string[]): boolean {
  if (isAbsolute(resource)) {
    const path = resolve(resource)
    return folders.includes(existsSync(path) ? realpathSync(path) : path)
  }
  return remotes.includes(normaliseUrl(resource))
}
