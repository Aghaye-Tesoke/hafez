import { join, basename } from 'path'
import { parseFilePath, scanVaultDir, kindDir, vaultFileExists } from './vault.js'
import { validateEntityFrontmatter, validateKnowledgeFrontmatter } from './schema.js'
import type { ValidationReport } from './types.js'
import { parentCycle } from './batch-ops.js'

/** The vault integrity scan. Deliberately independent of the SQLite index:
 * this is the one operation that does not trust the index, so it reads the
 * files directly. Re-implementing it as an index query was considered and
 * rejected — an integrity checker that reads the index is checking the
 * index's model of the vault, not the vault. */
export function validateVault(vaultPath: string): ValidationReport {
  const exists = (slug: string) => vaultFileExists(vaultPath, slug)

  const report: ValidationReport = {
    broken_slugs: [],
    orphaned_knowledge: [],
    missing_fields: [],
    total_entities: 0,
    total_knowledge: 0,
  }

  const knowledgeSlugs = new Set<string>()
  const referencedKnowledge = new Set<string>()
  const parents = new Map<string, string>()

  // Scan entities
  const entDir = join(vaultPath, kindDir('entity'))
  {
    const files = scanVaultDir(entDir)
    report.total_entities = files.length
    for (const filePath of files) {
      const slug = basename(filePath, '.md')
      let fm: Record<string, any>
      try {
        fm = parseFilePath(filePath).frontmatter
      } catch {
        report.missing_fields.push({ slug, field: '', issue: 'failed to parse frontmatter' })
        continue
      }

      const errors = validateEntityFrontmatter(fm)
      for (const e of errors) report.missing_fields.push({ slug, field: '', issue: e })

      if (fm.parent) {
        parents.set(slug, fm.parent)
        if (!exists(fm.parent)) report.broken_slugs.push({ slug, field: 'parent', issue: `parent '${fm.parent}' does not exist` })
      }
      if (fm.related && Array.isArray(fm.related)) {
        for (const r of fm.related) {
          if (!exists(r)) report.broken_slugs.push({ slug, field: 'related', issue: `related '${r}' does not exist` })
          // Track referenced knowledge
          referencedKnowledge.add(r)
        }
      }
    }
  }

  // Parent cycles: reported once each, under the first member found
  const inCycle = new Set<string>()
  for (const [slug, parent] of parents) {
    if (inCycle.has(slug)) continue
    const cycle = parentCycle(slug, parent, s => parents.get(s))
    if (!cycle) continue
    for (const s of cycle) inCycle.add(s)
    report.broken_slugs.push({ slug, field: 'parent', issue: `parent cycle: ${cycle.join(' → ')}` })
  }

  // Scan knowledge
  const knDir = join(vaultPath, kindDir('knowledge'))
  {
    const files = scanVaultDir(knDir)
    report.total_knowledge = files.length
    for (const filePath of files) {
      const slug = basename(filePath, '.md')
      knowledgeSlugs.add(slug)
      let fm: Record<string, any>
      try {
        fm = parseFilePath(filePath).frontmatter
      } catch {
        report.missing_fields.push({ slug, field: '', issue: 'failed to parse frontmatter' })
        continue
      }

      const errors = validateKnowledgeFrontmatter(fm)
      for (const e of errors) report.missing_fields.push({ slug, field: '', issue: e })

      if (fm.related && Array.isArray(fm.related)) {
        for (const r of fm.related) {
          if (!exists(r)) report.broken_slugs.push({ slug, field: 'related', issue: `related '${r}' does not exist` })
        }
      }
    }
  }

  // Find orphaned knowledge: no related, and not referenced by any entity
  for (const slug of knowledgeSlugs) {
    let fm: Record<string, any>
    try {
      fm = parseFilePath(join(knDir, `${slug}.md`)).frontmatter
    } catch {
      continue // already reported above
    }
    const hasRelated = fm.related && Array.isArray(fm.related) && fm.related.length > 0
    if (!hasRelated && !referencedKnowledge.has(slug)) {
      report.orphaned_knowledge.push(slug)
    }
  }

  return report
}
