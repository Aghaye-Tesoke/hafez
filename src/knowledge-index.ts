// src/knowledge-index.ts
// Generates the vault-root index.md covering entities (grouped by status) and
// knowledge (grouped by domain) — local-only, auto-regenerated on every entity/knowledge write.
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'fs'
import { join, basename, resolve } from 'path'
import { parseFilePath, scanVaultDir, kindDir } from './vault.js'
import { deriveSummary } from './document.js'
import { ENTITY_STATUSES } from './contracts.js'

interface IndexEntry {
  slug: string
  name: string
  summary: string
  suffix: string
}

/** One indexed document, as the SQLite index can hand it over. index.md needs
 * nothing the index does not already hold, so a regeneration reads rows
 * instead of re-reading and re-parsing every file in the vault. Declared here
 * (not in db.ts) to keep the module edge pointing one way: db.ts already
 * imports from this file. */
export interface VaultIndexRow {
  slug: string
  kind: 'entity' | 'knowledge'
  name: string
  type: string | null
  status: string | null
  confidence: string | null
  description: string | null
  domain: string[]
  body: string
}

/** Index rows in the shape the renderer below expects — the same
 * {slug, fm, body} triple scanParsed produces from disk. */
function fromRows(rows: VaultIndexRow[], kind: 'entity' | 'knowledge'): Array<{ slug: string; fm: Record<string, any>; body: string }> {
  return rows
    .filter(r => r.kind === kind)
    .map(r => ({
      slug: r.slug,
      body: r.body,
      fm: {
        name: r.name,
        type: r.type ?? undefined,
        status: r.status ?? undefined,
        confidence: r.confidence ?? undefined,
        description: r.description ?? undefined,
        domain: r.domain,
      },
    }))
}

function truncate(s: string): string {
  return s.length > 100 ? s.slice(0, 97) + '...' : s
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function formatEntry(item: IndexEntry): string {
  const desc = item.summary ? ` — ${item.summary}` : ''
  return `- [[${item.slug}]]${desc} (${item.suffix})`
}

/** Parse every .md directly in dir (non-recursive — auto-excludes archive/), skipping malformed files. */
function scanParsed(dir: string): Array<{ slug: string; fm: Record<string, any>; body: string }> {
  const docs: Array<{ slug: string; fm: Record<string, any>; body: string }> = []
  for (const file of scanVaultDir(dir)) {
    try {
      const parsed = parseFilePath(file)
      const fm = parsed.frontmatter as Record<string, any>
      const body = parsed.body
      if (!fm.name) continue
      docs.push({ slug: basename(file, '.md'), fm, body })
    } catch { continue }
  }
  return docs
}

/** Local-only artifacts the CLI generates inside the vault. They must never
 * show up in the user's `git status`, but forcing a tracked .gitignore entry
 * would dirty their vault — so they go into .git/info/exclude instead. */
const LOCAL_EXCLUDES = ['/index.md', '/.hafez.db', '/.hafez.db-shm', '/.hafez.db-wal']

/** Locate the git directory that owns `info/exclude` for this vault.
 * `.git` is a directory in a normal clone, but a *gitfile* (`gitdir: <path>`)
 * in a linked worktree or submodule — treating that file as "not a repo" is
 * what let index.md and .hafez.db pollute `git status` there. Git reads
 * `info/exclude` from the COMMON dir, so for a linked worktree the pointed-at
 * per-worktree dir is one more hop from the answer: its `commondir` file names
 * the shared dir (writing the exclude in the per-worktree dir has no effect).
 * Returns null when the vault is not a git repo at all. */
function resolveExcludeGitDir(vaultPath: string): string | null {
  const dotGit = join(vaultPath, '.git')
  if (!existsSync(dotGit)) return null
  const stat = statSync(dotGit)
  if (stat.isDirectory()) return dotGit
  if (!stat.isFile()) return null
  const pointer = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, 'utf-8'))
  if (!pointer) return null
  const gitDir = resolve(vaultPath, pointer[1].trim())
  if (!existsSync(gitDir)) return null
  const commonDirFile = join(gitDir, 'commondir')
  if (existsSync(commonDirFile)) {
    const commonDir = resolve(gitDir, readFileSync(commonDirFile, 'utf-8').trim())
    if (existsSync(commonDir)) return commonDir
  }
  return gitDir
}

/** Ensure every generated local-only artifact is covered by .git/info/exclude. */
export function ensureLocalExclude(vaultPath: string): void {
  try {
    const gitDir = resolveExcludeGitDir(vaultPath)
    if (!gitDir) return
    const excludePath = join(gitDir, 'info', 'exclude')
    const existing = existsSync(excludePath) ? readFileSync(excludePath, 'utf-8') : ''
    const lines = new Set(existing.split('\n').map(l => l.trim()))
    const missing = LOCAL_EXCLUDES.filter(p => !lines.has(p))
    if (missing.length === 0) return
    mkdirSync(join(gitDir, 'info'), { recursive: true })
    const sep = existing.length === 0 || existing.endsWith('\n') ? '' : '\n'
    writeFileSync(excludePath, existing + sep + missing.join('\n') + '\n')
  } catch { /* best effort — never fail a vault write over ignore hygiene */ }
}

/** Regenerate the vault-root index.md.
 *
 * `rows` is the SQLite index's view of the vault — every mutation refreshes
 * those rows anyway, so passing them avoids a second full-vault read for the
 * same content. Omitting them (standalone/one-off use) falls back to reading
 * the files directly. */
export function generateVaultIndex(vaultPath: string, rows?: VaultIndexRow[]): void {
  const entitiesDir = join(vaultPath, kindDir('entity'))
  const knowledgeDir = join(vaultPath, kindDir('knowledge'))
  const hasEntities = existsSync(entitiesDir)
  const hasKnowledge = existsSync(knowledgeDir)
  if (!hasEntities && !hasKnowledge) return

  const docsFor = (kind: 'entity' | 'knowledge', dir: string) =>
    rows ? fromRows(rows, kind) : scanParsed(dir)

  const lines = ['# Vault Index', '', '> Auto-generated by hafez. Do not edit manually.', '']

  if (hasEntities) {
    const byStatus = new Map<string, IndexEntry[]>()
    for (const { slug, fm, body } of docsFor('entity', entitiesDir)) {
      const status = fm.status ?? 'active'
      const list = byStatus.get(status) ?? []
      list.push({ slug, name: fm.name, summary: truncate(deriveSummary('entity', fm, body)), suffix: fm.type ?? 'entity' })
      byStatus.set(status, list)
    }

    if (byStatus.size > 0) {
      // Known statuses in canonical order, then any non-standard values (hand-edited
      // files reach here unvalidated) so no live entity silently vanishes.
      const known: readonly string[] = ENTITY_STATUSES
      const extra = [...byStatus.keys()].filter(s => !known.includes(s)).sort()
      lines.push('## Entities', '')
      for (const status of [...known, ...extra]) {
        const items = byStatus.get(status)
        if (!items) continue
        lines.push(`### ${capitalize(status)}`)
        for (const item of items.sort((a, b) => a.name.localeCompare(b.name))) {
          lines.push(formatEntry(item))
        }
        lines.push('')
      }
    }
  }

  if (hasKnowledge) {
    const entries: Array<IndexEntry & { domains: string[] }> = []
    for (const { slug, fm, body } of docsFor('knowledge', knowledgeDir)) {
      entries.push({
        slug,
        name: fm.name,
        domains: Array.isArray(fm.domain) ? fm.domain : fm.domain ? [fm.domain] : [],
        summary: truncate(deriveSummary('knowledge', fm, body)),
        suffix: fm.confidence ?? 'observation',
      })
    }

    const groups = new Map<string, typeof entries>()
    for (const entry of entries) {
      if (entry.domains.length === 0) {
        const list = groups.get('Uncategorized') ?? []
        list.push(entry)
        groups.set('Uncategorized', list)
      } else {
        for (const domain of entry.domains) {
          const key = capitalize(domain)
          const list = groups.get(key) ?? []
          list.push(entry)
          groups.set(key, list)
        }
      }
    }

    const sortedKeys = [...groups.keys()].filter(k => k !== 'Uncategorized').sort()
    if (groups.has('Uncategorized')) sortedKeys.push('Uncategorized')

    if (sortedKeys.length > 0) {
      lines.push('## Knowledge', '')
      for (const key of sortedKeys) {
        lines.push(`### ${key}`)
        const items = groups.get(key)!.sort((a, b) => a.name.localeCompare(b.name))
        for (const item of items) {
          lines.push(formatEntry(item))
        }
        lines.push('')
      }
    }
  }

  ensureLocalExclude(vaultPath)
  writeFileSync(join(vaultPath, 'index.md'), lines.join('\n'))
}
