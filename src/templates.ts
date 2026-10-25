// src/templates.ts
import type { EntityType, KnowledgeSubtype } from './types.js'
import { SUBTYPE_SECTIONS, DEFAULT_KNOWLEDGE_SUBTYPE, SESSION_SECTIONS, ENTITY_TYPES, getContract } from './contracts.js'

/** Render a body from a section list, injecting each field's text under the
 * section that field writes into (contracts.CREATE_FIELD_SECTIONS names the
 * pairs; a field whose section this template lacks is rejected upstream by
 * `unreachableFields`, so an unplaced value never reaches here). */
function render(sections: string[], content: Record<string, string | undefined>): string {
  const lines: string[] = []
  for (const section of sections) {
    lines.push(`## ${section}`)
    const text = content[section]
    if (text) lines.push('', text)
    lines.push('')
  }
  return lines.join('\n')
}

export function bodyTemplate(type: EntityType, fields?: { purpose?: string; notes?: string }): string {
  // The template IS the contract's default sections — the Document module
  // derives its structural set from the same place, so the two can't drift.
  if (!(ENTITY_TYPES as readonly string[]).includes(type)) throw new Error(`Unknown item type: ${type}`)
  return render(getContract(type).defaultSections, { Purpose: fields?.purpose, Notes: fields?.notes })
}

export function knowledgeBodyTemplate(subtype?: KnowledgeSubtype, fields?: { synthesis?: string }): string {
  if ((subtype as string) === 'session') {
    throw new Error(
      "subtype 'session' is no longer supported for knowledge notes. " +
      "Use batch kind: 'session' instead. See knowledge-v2 migration."
    )
  }
  // 'Summary' was a second injection target here until sessions stopped being
  // a knowledge subtype; no SUBTYPE_SECTIONS entry has carried it since — the
  // session body is its own template below.
  return render(SUBTYPE_SECTIONS[subtype ?? DEFAULT_KNOWLEDGE_SUBTYPE], { Synthesis: fields?.synthesis })
}

/** Session bodies. Sessions have no TypeContract, but their headings are
 * structural for Document splitting — so the list lives in contracts with
 * every other section set, and this renders it. */
export function sessionBodyTemplate(fields?: { synthesis?: string; decisions?: string[]; entities_touched?: string[] }): string {
  const bullets = (items: string[] | undefined) => items?.map(i => `- ${i}`).join('\n')
  return render([...SESSION_SECTIONS], {
    Summary: fields?.synthesis,
    'Entities Touched': bullets(fields?.entities_touched?.map(slug => `[[${slug}]]`)),
    Decisions: bullets(fields?.decisions),
  })
}
