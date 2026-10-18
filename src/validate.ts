import { join, basename } from 'path'
import { parseFilePath, scanVaultDir, kindDir, findReadableFile, type VaultKind } from './vault.js'
import { validateEntityFrontmatter, validateKnowledgeFrontmatter, validateSessionFrontmatter } from './schema.js'
import type { ValidationReport } from './types.js'
import { parentCycle } from './batch-ops.js'

const FRONTMATTER_CHECKS: Record<VaultKind, (fm: Record<string, any>) => string[]> = {
  entity: validateEntityFrontmatter,
  knowledge: validateKnowledgeFrontmatter,
  session: validateSessionFrontmatter,
}

/** The vault integrity scan. Deliberately independent of the SQLite index:
 * this is the one operation that does not trust the index, so it reads the
 * files directly. Re-implementing it as an index query was considered and
 * rejected — an integrity checker that reads the index is checking the
 * index's model of the vault, not the vault. */
export function validateVault(vaultPath: string): ValidationReport {
  // Any readable file satisfies a link: an invalid slug definitionally does
  // not exist, and must report as missing rather than crash.
  const exists = (slug: string) => { try { return findReadableFile(vaultPath, slug) !== null } catch { return false } }

  const report: ValidationReport = {
    broken_slugs: [],
    orphaned_knowledge: [],
    missing_fields: [],
    total_entities: 0,
    total_knowledge: 0,
    total_sessions: 0,
  }

  const knowledgeRelated = new Map<string, number>()
  const referencedKnowledge = new Set<string>()
  const parents = new Map<string, string>()

  // One scan per kind: parse, the kind's frontmatter check, then every
  // `related` must exist. What a kind adds on top (parent, the orphan
  // bookkeeping) is in `each`.
  function scan(kind: VaultKind, each: (slug: string, fm: Record<string, any>) => void): number {
    const files = scanVaultDir(join(vaultPath, kindDir(kind)))
    for (const filePath of files) {
      const slug = basename(filePath, '.md')
      let fm: Record<string, any>
      try {
        fm = parseFilePath(filePath).frontmatter
      } catch {
        report.missing_fields.push({ slug, field: '', issue: 'failed to parse frontmatter' })
        continue
      }
      for (const e of FRONTMATTER_CHECKS[kind](fm)) report.missing_fields.push({ slug, field: '', issue: e })
      if (fm.related && Array.isArray(fm.related)) {
        for (const r of fm.related) {
          if (!exists(r)) report.broken_slugs.push({ slug, field: 'related', issue: `related '${r}' does not exist` })
        }
      }
      each(slug, fm)
    }
    return files.length
  }

  report.total_entities = scan('entity', (slug, fm) => {
    if (fm.parent) {
      parents.set(slug, fm.parent)
      if (!exists(fm.parent)) report.broken_slugs.push({ slug, field: 'parent', issue: `parent '${fm.parent}' does not exist` })
    }
    // Track referenced knowledge
    if (Array.isArray(fm.related)) for (const r of fm.related) referencedKnowledge.add(r)
  })

  // Parent cycles: reported once each, under the first member found
  const inCycle = new Set<string>()
  for (const [slug, parent] of parents) {
    if (inCycle.has(slug)) continue
    const cycle = parentCycle(slug, parent, s => parents.get(s))
    if (!cycle) continue
    for (const s of cycle) inCycle.add(s)
    report.broken_slugs.push({ slug, field: 'parent', issue: `parent cycle: ${cycle.join(' → ')}` })
  }

  report.total_knowledge = scan('knowledge', (slug, fm) => {
    knowledgeRelated.set(slug, Array.isArray(fm.related) ? fm.related.length : 0)
  })

  // A session with no related is never an orphan — a session that touched
  // nothing is legitimate.
  report.total_sessions = scan('session', () => {})

  // Find orphaned knowledge: no related, and not referenced by any entity
  for (const [slug, related] of knowledgeRelated) {
    if (related === 0 && !referencedKnowledge.has(slug)) report.orphaned_knowledge.push(slug)
  }

  return report
}
