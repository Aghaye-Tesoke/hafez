// src/document.ts
// The Document module (see CONTEXT.md): owns the body of a vault file —
// structural sections, session-log entries, wiki-links. Every body read or
// mutation goes through the single structural-heading model defined here.
// Pure string→string.
//
// Which headings are structural is per-file knowledge: documentFor(ctx)
// derives the section set from the file's kind/type/subtype via contracts
// and returns the Document operations bound to it. There is deliberately no
// global fallback set — a session-only heading like '## Decisions' quoted
// inside an entity's Brief must NOT terminate that section.

import type { SessionLogEntry, SessionLogType } from './types.js'
import { ALL_CONTRACTS, SUBTYPE_SECTIONS, SESSION_SECTIONS, getContract } from './contracts.js'
import { localDay } from './dates.js'

const UNCHECKED_RE = /^- \[ \] (.+)$/gm

// --- Set-independent helpers ---

const HEADING_RE = /^### (\d{4}-\d{2}-\d{2}) (?:—|--) (.+?)(?:\s+\[(\w+)\])?$/

export function parseSessionLogHeading(line: string): { date: string; agent: string; type: SessionLogType } | null {
  const match = line.match(HEADING_RE)
  if (!match) return null
  return {
    date: match[1],
    agent: match[2],
    type: (match[3] as SessionLogType) || 'progress'
  }
}

export function formatSessionLogEntry(entry: SessionLogEntry): string {
  const today = localDay()
  const lines = [`### ${today} — ${entry.agent} [${entry.type}]`, `Summary: ${entry.summary}`]
  if (entry.body) lines.push(entry.body)
  return lines.join('\n')
}

/**
 * Split a Session Log section's content into raw entry blocks, each beginning
 * with a parseable entry heading. Non-entry text before the first heading is
 * not an entry and is dropped. Document owns entry block splitting — merge's
 * dedup/sort policy stays in merge.ts.
 */
export function splitLogEntries(content: string): string[] {
  return content
    .split(/\n(?=### \d{4}-\d{2}-\d{2})/)
    .map(b => b.trim())
    .filter(b => b && parseSessionLogHeading(b.split('\n')[0]) !== null)
}

export function firstNonEmptyLine(s: string | null | undefined): string {
  return s?.split('\n').find(l => l.trim())?.trim() ?? ''
}

/** The one wiki-link syntax the vault recognizes: [[slug]] or
 * [[slug|display text]] — slug in group 1, display text in group 2.
 * Padding inside the brackets is Obsidian-idiomatic ([[ slug ]], [[slug | Label]])
 * and is absorbed by the pattern, so both captures come out already trimmed —
 * every consumer (Related coverage, mention harvesting, export) sees the bare slug.
 * Non-global — wrap with `new RegExp(WIKI_LINK_RE.source, 'g')` for iteration. */
export const WIKI_LINK_RE = /\[\[\s*([^\]|]+?)\s*(?:\|\s*([^\]]+?)\s*)?\]\]/

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Normalize text for matching: trim whitespace, replace smart quotes with
 * straight equivalents, normalize em-dashes to regular dashes.
 * Applied to both query and action text before comparison only — stored text is unchanged.
 */
function normalizeForMatch(s: string): string {
  return s
    .trim()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/—/g, '-')
}

// --- Per-file section sets ---

/** What documentFor needs to know about a file to bind its section set.
 *
 * KIND is the whole context — deliberately no type/subtype narrowing. A file
 * can legitimately carry sections outside its current type's contract (a
 * promote race merged in a capture's Notes, a plan-shaped note never had its
 * subtype persisted, a hand edit added Open Questions to a plain entity), and
 * a narrower binding demotes those headings to non-structural text that the
 * next section rewrite silently deletes. The kind-level union makes every
 * same-kind heading a boundary, so no same-kind section is ever swallowed;
 * the cost is that a same-kind heading quoted at line start inside a section
 * strands as its own section on rewrite — visible and recoverable, unlike
 * deletion. Cross-KIND headings (a session-only ## Decisions quoted in an
 * entity Brief) are still not boundaries. */
export interface DocContext {
  kind: 'entity' | 'knowledge' | 'session'
}

const ENTITY_CONTRACTS = ALL_CONTRACTS.filter(c => c.kind === 'item')

function sectionNamesFor(ctx: DocContext): string[] {
  if (ctx.kind === 'session') return [...SESSION_SECTIONS]
  if (ctx.kind === 'knowledge') {
    const subtypeTable = SUBTYPE_SECTIONS as Record<string, string[]>
    const names = [...getContract('knowledge').defaultSections]
    for (const s of Object.keys(subtypeTable)) names.push(...subtypeTable[s])
    return names
  }
  return ENTITY_CONTRACTS.flatMap(c => [...c.defaultSections, ...c.optionalSections])
}

/** The structural set a context binds — exposed for introspection and the
 * contract-coverage tests; runtime consumers go through documentFor. */
export function structuralSectionsFor(ctx: DocContext): ReadonlySet<string> {
  return new Set([...sectionNamesFor(ctx), 'Related'])
}

const docCache = new Map<string, Doc>()

/** The Document operations bound to one file's structural section set. */
export function documentFor(ctx: DocContext): Doc {
  const key = ctx.kind
  let doc = docCache.get(key)
  if (!doc) {
    doc = makeDoc(new Set(structuralSectionsFor(ctx)))
    docCache.set(key, doc)
  }
  return doc
}

/** Bind from a parsed vault file — kind from Layout. */
export function documentForFile(parsed: { kind: 'entity' | 'knowledge' | 'session' }): Doc {
  return documentFor({ kind: parsed.kind })
}

export interface DocSection { heading: string; content: string }

export interface Doc {
  findNextStructuralHeading(body: string, from: number): number
  findSection(body: string, heading: string): { start: number; headingEnd: number; end: number; content: string } | null
  splitStructural(body: string): { preamble: string; sections: DocSection[] }
  setSection(body: string, heading: string, content: string, insertBefore?: string): string
  appendToSection(body: string, heading: string, content: string): string
  renameSection(body: string, from: string, to: string): string
  ensureSection(body: string, heading: string, opts?: { after?: string }): string
  prependSessionLogEntry(body: string, entry: string): string
  bodyBeforeSessionLog(body: string): string
  countSessionLogEntries(body: string): number
  parseSessionLog(body: string): Array<{ date: string; agent: string; type: SessionLogType; summary: string }>
  extractOldestSessionLogEntry(body: string): { entry: string; remaining: string } | null
  getBrief(body: string): string | null
  setBrief(body: string, content: string): string
  removeBrief(body: string): string
  getNextActions(body: string): string[]
  addNextAction(body: string, action: string): string
  completeNextAction(body: string, query: string): { matched: string; body: string }
  removeNextAction(body: string, query: string): { matched: string; body: string }
  clearNextActions(body: string): string
  syncRelatedSection(body: string, frontmatter: { parent?: string; related?: string[] }): string
}

// --- The bound implementation ---

function makeDoc(structuralSections: Set<string>): Doc {
  /**
   * Find the next structural `## Heading` boundary after a given position.
   * Skips `## ` headings that are not known structural sections (content headings).
   * Returns the index of the `\n` before the `## `, or -1 if no structural heading found.
   */
  function findNextStructuralHeading(body: string, from: number): number {
    const re = /\n## ([^\n]+)/g
    re.lastIndex = from
    let match
    while ((match = re.exec(body)) !== null) {
      const headingName = match[1].trim()
      if (structuralSections.has(headingName)) {
        return match.index
      }
    }
    return -1
  }

  /**
   * Find a ## Heading section and its content.
   * Returns { start, headingEnd, end, content } or null if not found.
   * Matches heading exactly (e.g. "## Brief" won't match "## Briefing").
   * Trailing whitespace on the heading line is tolerated — the splitter's
   * boundary tokenizer trims headings, so anything it treats as a boundary
   * must also be findable here (a hand-edited `## Session Log ` otherwise
   * gets a duplicate section and archival never fires).
   * Only treats known structural headings as section boundaries -- content
   * inside a section may contain arbitrary `## ` headings without corruption.
   */
  function findSection(body: string, heading: string): { start: number; headingEnd: number; end: number; content: string } | null {
    const re = new RegExp(`(^|\\n)(## ${escapeRegex(heading)}[ \\t]*)(?:\\n|$)`)
    const match = re.exec(body)
    if (!match) return null

    const start = match.index + match[1].length
    const headingEnd = start + match[2].length
    const afterHeading = headingEnd + 1

    // Find the next structural ## heading or EOF. Scan from the heading's own
    // trailing newline (afterHeading - 1), not past it — otherwise a structural
    // heading on the immediately following line (no blank line between, as in
    // hand-edited files) is invisible and mutators swallow the next section.
    const nextHeading = findNextStructuralHeading(body, Math.max(0, afterHeading - 1))
    const end = nextHeading === -1 ? body.length : nextHeading

    const rawContent = body.slice(afterHeading, end)
    const content = rawContent.replace(/^\n+/, '').replace(/\n+$/, '')

    return { start, headingEnd, end, content }
  }

  /**
   * Split a body into preamble + structural sections. Non-structural `## `
   * headings stay inside the enclosing section's content — sections are
   * atomic units of authored content, never split at user headings.
   * Headings and content come back trimmed; reassemble with
   * `## ${heading}\n\n${content}` joined by blank lines.
   */
  function splitStructural(body: string): { preamble: string; sections: DocSection[] } {
    const marks: Array<{ start: number; contentStart: number; heading: string }> = []
    const re = /(^|\n)## ([^\n]*)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(body)) !== null) {
      const heading = m[2].trim()
      if (!structuralSections.has(heading)) continue
      marks.push({ start: m.index + m[1].length, contentStart: m.index + m[0].length, heading })
    }
    if (marks.length === 0) return { preamble: body.trim(), sections: [] }
    const preamble = body.slice(0, marks[0].start).trim()
    const sections = marks.map((mk, i) => ({
      heading: mk.heading,
      content: body.slice(mk.contentStart, i + 1 < marks.length ? marks[i + 1].start : body.length).trim(),
    }))
    return { preamble, sections }
  }

  /**
   * Replace a structural section's content, or create the section: before
   * `insertBefore` when that section exists, at EOF otherwise.
   */
  function setSection(body: string, heading: string, content: string, insertBefore?: string): string {
    const existing = findSection(body, heading)
    if (existing) {
      return body.slice(0, existing.start) + `## ${heading}\n\n${content}\n` + body.slice(existing.end)
    }
    if (insertBefore) {
      const target = findSection(body, insertBefore)
      if (target) {
        return body.slice(0, target.start) + `## ${heading}\n\n${content}\n\n` + body.slice(target.start)
      }
    }
    return body + `\n\n## ${heading}\n\n${content}\n`
  }

  /** Append content at the end of a structural section (creating it at EOF if absent). */
  function appendToSection(body: string, heading: string, content: string): string {
    const section = findSection(body, heading)
    if (!section) return body + `\n\n## ${heading}\n\n${content}\n`
    if (section.end === body.length) return body + '\n' + content + '\n'
    return body.slice(0, section.end) + '\n' + content + body.slice(section.end)
  }

  /**
   * Rename a structural section's heading in place, keeping its content.
   * No-op when the section is absent. Any trailing whitespace on the old
   * heading line is dropped with it.
   */
  function renameSection(body: string, from: string, to: string): string {
    const section = findSection(body, from)
    if (!section) return body
    return body.slice(0, section.start) + `## ${to}` + body.slice(section.headingEnd)
  }

  /**
   * Ensure a structural section exists: no-op when present, otherwise insert
   * an empty section after `opts.after` (when that section exists) or at EOF.
   */
  function ensureSection(body: string, heading: string, opts: { after?: string } = {}): string {
    if (findSection(body, heading)) return body
    const block = `## ${heading}`
    if (opts.after) {
      const anchor = findSection(body, opts.after)
      if (anchor) {
        const before = body.slice(0, anchor.end).replace(/\n+$/, '')
        const after = body.slice(anchor.end).replace(/^\n+/, '')
        return after ? `${before}\n\n${block}\n\n${after}` : `${before}\n\n${block}\n`
      }
    }
    return body.replace(/\n+$/, '') + `\n\n${block}\n`
  }

  /** Insert a formatted session-log entry newest-first (creating the section at EOF if absent). */
  function prependSessionLogEntry(body: string, entry: string): string {
    const section = findSection(body, 'Session Log')
    if (!section) return body + `\n\n## Session Log\n\n${entry}\n`
    const insertPos = section.headingEnd
    return body.slice(0, insertPos) + '\n\n' + entry + '\n' + body.slice(insertPos)
  }

  /** Body up to the real Session Log section — the `summary` read depth. */
  function bodyBeforeSessionLog(body: string): string {
    const section = findSection(body, 'Session Log')
    return section ? body.slice(0, section.start).trim() : body
  }

  /** Entries inside the real Session Log section only — entry-shaped lines
   * elsewhere in the body (e.g. quoted in a Brief) do not count. */
  function countSessionLogEntries(body: string): number {
    const section = findSection(body, 'Session Log')
    if (!section) return 0
    return (section.content.match(/^### \d{4}-\d{2}-\d{2} (?:—|--)/gm) || []).length
  }

  function parseSessionLog(body: string): Array<{
    date: string
    agent: string
    type: SessionLogType
    summary: string
  }> {
    const section = findSection(body, 'Session Log')
    if (!section) return []

    const entries: Array<{ date: string; agent: string; type: SessionLogType; summary: string }> = []
    const lines = section.content.split('\n')

    let current: { date: string; agent: string; type: SessionLogType } | null = null
    let summaryLine: string | null = null

    for (const line of lines) {
      const heading = parseSessionLogHeading(line)
      if (heading) {
        if (current && summaryLine) {
          entries.push({ ...current, summary: summaryLine })
        }
        current = heading
        summaryLine = null
      } else if (current && !summaryLine && line.startsWith('Summary: ')) {
        summaryLine = line.slice('Summary: '.length)
      }
    }
    if (current && summaryLine) {
      entries.push({ ...current, summary: summaryLine })
    }

    return entries
  }

  function extractOldestSessionLogEntry(body: string): { entry: string; remaining: string } | null {
    const section = findSection(body, 'Session Log')
    if (!section) return null

    // Work on the raw slice between the heading and the section's structural
    // end, so the extracted entry can never swallow a following section
    // (e.g. an auto-appended Related) into the archive.
    const contentStart = section.headingEnd
    const region = body.slice(contentStart, section.end)
    const entryStarts = [...region.matchAll(/^### \d{4}-\d{2}-\d{2} (?:—|--)/gm)]
    if (entryStarts.length < 2) return null

    // Entries are newest-first in the file, so the oldest is the last match
    const oldestStart = entryStarts[entryStarts.length - 1].index!
    const entry = region.slice(oldestStart).trim()
    const remaining = body.slice(0, contentStart) + region.slice(0, oldestStart) + body.slice(section.end)

    return { entry, remaining }
  }

  /**
   * Remove a section (heading + content) from body, cleaning up extra whitespace.
   */
  function removeSection(body: string, heading: string): string {
    const section = findSection(body, heading)
    if (!section) return body

    const before = body.slice(0, section.start)
    const after = body.slice(section.end)

    // Clean up: avoid triple+ newlines at the splice point
    const trimmedBefore = before.replace(/\n+$/, '')
    const trimmedAfter = after.replace(/^\n+/, '')

    if (!trimmedBefore) return trimmedAfter
    if (!trimmedAfter) return trimmedBefore
    return trimmedBefore + '\n\n' + trimmedAfter
  }

  /**
   * Insert a new section before a target heading, or at EOF.
   * `before` is an array of headings to try inserting before (first found wins).
   */
  function insertSectionBefore(body: string, heading: string, content: string, before: string[]): string {
    const sectionBlock = `## ${heading}\n\n${content}`

    for (const target of before) {
      const targetSection = findSection(body, target)
      if (targetSection) {
        const insertPoint = targetSection.start
        const textBefore = body.slice(0, insertPoint).replace(/\n+$/, '')
        const textAfter = body.slice(insertPoint)

        if (!textBefore) return sectionBlock + '\n\n' + textAfter
        return textBefore + '\n\n' + sectionBlock + '\n\n' + textAfter
      }
    }

    // No target found — append at EOF
    const trimmed = body.replace(/\n+$/, '')
    return trimmed + '\n\n' + sectionBlock
  }

  /**
   * Insert a new section after a target heading (and its content), or fall back to inserting before fallbacks.
   */
  function insertSectionAfter(body: string, heading: string, content: string, after: string, beforeFallbacks: string[]): string {
    const afterSection = findSection(body, after)
    if (afterSection) {
      const insertPoint = afterSection.end
      const textBefore = body.slice(0, insertPoint).replace(/\n+$/, '')
      const textAfter = body.slice(insertPoint).replace(/^\n+/, '')
      const sectionBlock = `## ${heading}\n\n${content}`

      if (!textAfter) return textBefore + '\n\n' + sectionBlock
      return textBefore + '\n\n' + sectionBlock + '\n\n' + textAfter
    }

    // After-target not found — fall back to insertBefore logic
    return insertSectionBefore(body, heading, content, beforeFallbacks)
  }

  /**
   * Match an action by case-insensitive substring against unchecked items.
   * Throws on 0 or >1 matches.
   */
  function matchAction(body: string, query: string): string {
    const section = findSection(body, 'Next Actions')
    if (!section) throw new Error(`No matching action for "${query}"`)

    const normalizedQuery = normalizeForMatch(query).toLowerCase()
    const matches: string[] = []
    const allActions: string[] = []

    let m: RegExpExecArray | null
    const re = new RegExp(UNCHECKED_RE.source, 'gm')
    while ((m = re.exec(section.content)) !== null) {
      allActions.push(m[1])
      if (normalizeForMatch(m[1]).toLowerCase().includes(normalizedQuery)) {
        matches.push(m[1])
      }
    }

    if (matches.length === 0) {
      throw new Error(`No matching action for "${query}". Actions: ${JSON.stringify(allActions)}`)
    }
    if (matches.length > 1) throw new Error(`Ambiguous match for "${query}": ${matches.join(', ')}`)
    return matches[0]
  }

  // --- Brief functions ---

  function getBrief(body: string): string | null {
    const section = findSection(body, 'Brief')
    if (!section) return null
    return section.content || null
  }

  function setBrief(body: string, content: string): string {
    const existing = findSection(body, 'Brief')
    if (existing) {
      // Replace existing brief content
      const updated = removeSection(body, 'Brief')
      return setBrief(updated, content)
    }

    // Insert before: Next Actions > Current State > Session Log > EOF
    return insertSectionBefore(body, 'Brief', content, ['Next Actions', 'Current State', 'Session Log'])
  }

  function removeBrief(body: string): string {
    return removeSection(body, 'Brief')
  }

  // --- Next Actions functions ---

  function getNextActions(body: string): string[] {
    const section = findSection(body, 'Next Actions')
    if (!section) return []

    const actions: string[] = []
    let m: RegExpExecArray | null
    const re = new RegExp(UNCHECKED_RE.source, 'gm')
    while ((m = re.exec(section.content)) !== null) {
      actions.push(m[1])
    }
    return actions
  }

  function addNextAction(body: string, action: string): string {
    const section = findSection(body, 'Next Actions')
    if (section) {
      // Add the new item at the end of unchecked items (before any checked items)
      const lines = section.content.split('\n')
      const lastUncheckedIdx = lines.reduce((last, line, i) => line.startsWith('- [ ] ') ? i : last, -1)
      const insertIdx = lastUncheckedIdx === -1 ? 0 : lastUncheckedIdx + 1
      lines.splice(insertIdx, 0, `- [ ] ${action}`)

      const newContent = lines.join('\n')
      const before = body.slice(0, section.start).replace(/\n+$/, '')
      const after = body.slice(section.end).replace(/^\n+/, '')

      const sectionBlock = `## Next Actions\n\n${newContent}`
      const parts = [before, sectionBlock, after].filter(Boolean)
      return parts.join('\n\n')
    }

    // No section — insert after Brief if present, otherwise before Session Log
    return insertSectionAfter(body, 'Next Actions', `- [ ] ${action}`, 'Brief', ['Session Log'])
  }

  /**
   * Edit the matched action's line inside the Next Actions section only.
   * Matching was always section-scoped; editing must be too — an identical
   * checkbox line quoted elsewhere in the body (a Brief restating a blocker)
   * is authored content, not an action. Works on the section's raw slice and
   * on whole lines, so action text is never interpreted as a replacement
   * pattern ($&, $', $1 survive byte-identical).
   */
  function editActionLine(body: string, matched: string, edit: (lines: string[], idx: number) => void): string {
    const section = findSection(body, 'Next Actions')
    if (!section) return body
    const lines = body.slice(section.headingEnd, section.end).split('\n')
    const idx = lines.indexOf(`- [ ] ${matched}`)
    if (idx === -1) return body
    edit(lines, idx)
    return body.slice(0, section.headingEnd) + lines.join('\n') + body.slice(section.end)
  }

  function completeNextAction(body: string, query: string): { matched: string; body: string } {
    const matched = matchAction(body, query)

    // Replace the unchecked item with checked
    const updatedBody = editActionLine(body, matched, (lines, i) => { lines[i] = `- [x] ${matched}` })

    // Check if any unchecked items remain
    const remaining = getNextActions(updatedBody)
    if (remaining.length === 0) {
      return { matched, body: clearNextActions(updatedBody) }
    }

    return { matched, body: updatedBody }
  }

  function removeNextAction(body: string, query: string): { matched: string; body: string } {
    const matched = matchAction(body, query)

    // Remove the line
    const updatedBody = editActionLine(body, matched, (lines, i) => { lines.splice(i, 1) })

    // Check if any unchecked items remain
    const remaining = getNextActions(updatedBody)
    if (remaining.length === 0) {
      return { matched, body: clearNextActions(updatedBody) }
    }

    return { matched, body: updatedBody }
  }

  function clearNextActions(body: string): string {
    return removeSection(body, 'Next Actions')
  }

  // --- Related section sync ---

  function syncRelatedSection(
    body: string,
    frontmatter: { parent?: string; related?: string[] }
  ): string {
    const targets: Array<{ slug: string; label?: string }> = []
    if (frontmatter.parent) targets.push({ slug: frontmatter.parent, label: 'parent' })
    for (const slug of frontmatter.related ?? []) targets.push({ slug })

    if (targets.length === 0) {
      // No frontmatter links — remove Related section if present
      const existing = findSection(body, 'Related')
      if (!existing) return body
      const before = body.slice(0, existing.start).replace(/\n+$/, '')
      const after = body.slice(existing.end).replace(/^\n+/, '')
      return [before, after].filter(Boolean).join('\n\n')
    }

    // Strip existing Related section before checking coverage
    let authoredBody = body
    const existingRelated = findSection(body, 'Related')
    if (existingRelated) {
      const before = body.slice(0, existingRelated.start)
      const after = body.slice(existingRelated.end)
      authoredBody = (before + after).replace(/\n{3,}/g, '\n\n')
    }

    // Find which targets are NOT mentioned in authored body
    const mentionedSlugs = new Set<string>()
    let match: RegExpExecArray | null
    const re = new RegExp(WIKI_LINK_RE.source, 'g')
    while ((match = re.exec(authoredBody)) !== null) {
      mentionedSlugs.add(match[1])
    }

    const uncovered = targets.filter(t => !mentionedSlugs.has(t.slug))
    if (uncovered.length === 0) {
      // All covered inline — return body without Related section
      return authoredBody.replace(/\n+$/, '')
    }

    // Build Related section
    const lines = uncovered.map(t =>
      t.label ? `- [[${t.slug}]] (${t.label})` : `- [[${t.slug}]]`
    )
    const section = `## Related\n\n${lines.join('\n')}`

    // Append at end
    return authoredBody.replace(/\n+$/, '') + '\n\n' + section
  }

  return {
    findNextStructuralHeading,
    findSection,
    splitStructural,
    setSection,
    appendToSection,
    renameSection,
    ensureSection,
    prependSessionLogEntry,
    bodyBeforeSessionLog,
    countSessionLogEntries,
    parseSessionLog,
    extractOldestSessionLogEntry,
    getBrief,
    setBrief,
    removeBrief,
    getNextActions,
    addNextAction,
    completeNextAction,
    removeNextAction,
    clearNextActions,
    syncRelatedSection,
  }
}

// --- Entity-bound convenience exports (public API) ---
// getBrief / getNextActions / parseSessionLog are read-only accessors on
// entity bodies; they bind the entity Document (Brief, Next Actions, and
// Session Log only exist on entity kinds).

const ENTITY_UNION_DOC = documentFor({ kind: 'entity' })

export function getBrief(body: string): string | null {
  return ENTITY_UNION_DOC.getBrief(body)
}

export function getNextActions(body: string): string[] {
  return ENTITY_UNION_DOC.getNextActions(body)
}

export function parseSessionLog(body: string): Array<{ date: string; agent: string; type: SessionLogType; summary: string }> {
  return ENTITY_UNION_DOC.parseSessionLog(body)
}

export function countSessionLogEntries(body: string): number {
  return ENTITY_UNION_DOC.countSessionLogEntries(body)
}

// --- Summary derivation ---

/**
 * One-line summary for a doc: frontmatter description first, then the first
 * non-empty line of the kind's primary section (entity: Brief; knowledge:
 * Synthesis, falling back to Goal for plans; session: Summary).
 * Shared by the vault index and the OKF export so the two surfaces agree.
 */
export function deriveSummary(kind: 'entity' | 'knowledge' | 'session', fm: Record<string, any>, body: string): string {
  if (fm.description) return fm.description
  const doc = documentFor({ kind })
  if (kind === 'entity') return firstNonEmptyLine(doc.getBrief(body))
  if (kind === 'knowledge') {
    const synthesis = doc.findSection(body, 'Synthesis')
    if (synthesis?.content) return firstNonEmptyLine(synthesis.content)
    return firstNonEmptyLine(doc.findSection(body, 'Goal')?.content)
  }
  return firstNonEmptyLine(doc.findSection(body, 'Summary')?.content)
}
