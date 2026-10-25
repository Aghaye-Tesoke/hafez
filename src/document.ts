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

import { createHash } from 'crypto'
import { HafezError, type SessionLogEntry, type SessionLogType } from './types.js'
import { ALL_CONTRACTS, SUBTYPE_SECTIONS, SESSION_SECTIONS, getContract } from './contracts.js'
import { localDay } from './dates.js'

// One checkbox line of Next Actions, tested line by line. `m` so a CRLF
// line's trailing \r is not taken as action text.
const OPEN_ACTION_RE = /^- \[ \] (.+)$/m
export const ACTION_RE = /^- \[([ xX])\] (.+)$/m

// --- Next-action added-date stamp ---
// Adding an action stamps its line `(added YYYY-MM-DD)` with the local day
// (Apply does the stamping — every add path goes through it). The stamp is
// file format only: every reader of action text — the index, query, matching,
// export, merge identity — works on the unstamped text.

const ACTION_STAMP_RE = /\s*\(added (\d{4}-\d{2}-\d{2})\)\s*$/

/** The action text without its trailing added-date stamp, if any. */
export function stripActionStamp(text: string): string {
  return text.replace(ACTION_STAMP_RE, '')
}

/** The day an action's stamp names; null when the line is undated. */
export function actionAdded(text: string): string | null {
  return ACTION_STAMP_RE.exec(text)?.[1] ?? null
}

/** Stamp an action with its added date; text that already ends in a stamp is
 * returned as is, so a carried-over line is never double-stamped. */
export function stampAction(text: string, day: string): string {
  return ACTION_STAMP_RE.test(text) ? text : `${text.trimEnd()} (added ${day})`
}

// --- Next-action Handles ---
// `read` renders a Handle in front of each open action so an agent can tick
// or drop a line without quoting its text. Derived at read time, never stored.

const HANDLE_MIN_LENGTH = 4
/** A query that may name a line by Handle: lowercase hex, at least the minimum. */
const HANDLE_QUERY_RE = new RegExp(`^[0-9a-f]{${HANDLE_MIN_LENGTH},}$`)

/** The full hashes Handles are cut from, one per open action line, in order:
 * bare hex of the SHA-256 of the normalised, unstamped text. A repeated text
 * hashes with its occurrence number, so identical lines get distinct hashes. */
function actionHashes(lines: string[]): string[] {
  const seen = new Map<string, number>()
  return lines.map(line => {
    const text = normalizeForMatch(stripActionStamp(line))
    const n = seen.get(text) ?? 0
    seen.set(text, n + 1)
    return createHash('sha256').update(n === 0 ? text : `${text}\0${n}`).digest('hex')
  })
}

/** The Handles of a list of open action lines, in order: each line's hash cut
 * to the shortest prefix (at least four) that no other line's hash shares. */
function actionHandles(lines: string[]): string[] {
  const hashes = actionHashes(lines)
  return hashes.map((hash, i) => {
    let length = HANDLE_MIN_LENGTH
    hashes.forEach((other, j) => {
      // Capped at the full hash: two identical hashes share every prefix.
      while (j !== i && length < hash.length && other.startsWith(hash.slice(0, length))) length++
    })
    return hash.slice(0, length)
  })
}

/** One checkbox line of Next Actions as a reader sees it: unstamped text, and
 * a Handle and added day (null when undated) when the line is open. */
export type ActionItem =
  | { handle: string; text: string; added: string | null }
  | { handle?: undefined; text: string }

/** The open action a query named: its line's position within the Next
 * Actions section, and its unstamped text. Editing by position rather than
 * re-matching the text keeps a Handle-named line unambiguous when its text
 * is a substring of another line's, or a duplicate of one. */
export interface ActionMatch {
  line: number
  text: string
}

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

export function escapeRegex(s: string): string {
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
  getActionItems(body: string): ActionItem[]
  renderActionHandles(body: string, mark?: (added: string | null) => string): string
  addNextAction(body: string, action: string): string
  matchNextAction(body: string, query: string): ActionMatch
  completeNextAction(body: string, action: string | ActionMatch): { matched: string; body: string }
  removeNextAction(body: string, action: string | ActionMatch): { matched: string; line: string; body: string }
  actionLines(body: string): string[]
  extractOldestTickedActions(body: string, keep: number): { lines: string[]; body: string }
  pruneNextActions(body: string): string
  clearNextActions(body: string): string
  stripNextActionStamps(body: string): string
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

  /** The Next Actions section's raw lines (from the heading's line end to the
   * section end) — the line positions an ActionMatch counts in. */
  function actionSectionLines(body: string): string[] {
    const section = findSection(body, 'Next Actions')
    return section ? body.slice(section.headingEnd, section.end).split('\n') : []
  }

  /** A section line as it leaves the file (archive): without a CRLF line's \r. */
  function withoutCR(line: string): string {
    return line.replace(/\r$/, '')
  }

  /** Where the action at `lines[i]` ends: past every line it carries (sub-
   * bullets, notes — anything up to the next checkbox line), trailing blank
   * lines left out. The item rule merge.ts parses by; whatever moves the
   * action moves these with it. */
  function actionEnd(lines: string[], i: number): number {
    let end = i + 1
    for (let j = i + 1; j < lines.length && !ACTION_RE.test(lines[j]); j++) {
      if (lines[j].trim()) end = j + 1
    }
    return end
  }

  /** The action at `lines[i]` and the lines it carries, as they leave the file. */
  function actionBlock(lines: string[], i: number): string {
    return lines.slice(i, actionEnd(lines, i)).map(withoutCR).join('\n')
  }

  /** Every open line of Next Actions: its position and raw text, stamp included. */
  function openActions(body: string): Array<{ line: number; raw: string }> {
    return actionSectionLines(body).flatMap((l, line) => {
      const m = OPEN_ACTION_RE.exec(l)
      return m ? [{ line, raw: m[1] }] : []
    })
  }

  /**
   * Find the open action a query names. Four or more lowercase hex that
   * prefix exactly one open line's hash name that line, so a Handle from an
   * earlier read still works after a sibling changed its rendered length;
   * prefixing two or more is ambiguous. Anything else is text: a
   * case-insensitive substring of the unstamped text, the query's own stamp
   * (copied from a read) ignored. Throws on 0 or >1 matches; error text
   * lists the unstamped actions.
   */
  function matchAction(body: string, query: string): ActionMatch {
    if (!findSection(body, 'Next Actions')) throw new HafezError('VALIDATION_FAILED', `No matching action for "${query}"`)
    const open = openActions(body)
    const toMatch = (a: { line: number; raw: string }): ActionMatch => ({ line: a.line, text: stripActionStamp(a.raw) })

    const ambiguous = (matches: Array<{ raw: string }>) =>
      new HafezError('VALIDATION_FAILED', `Ambiguous match for "${query}": ${matches.map(a => stripActionStamp(a.raw)).join(', ')}`)

    if (HANDLE_QUERY_RE.test(query)) {
      const hashes = actionHashes(open.map(a => a.raw))
      const byHandle = open.filter((_, i) => hashes[i].startsWith(query))
      if (byHandle.length === 1) return toMatch(byHandle[0])
      if (byHandle.length > 1) throw ambiguous(byHandle)
    }

    // A query that is only a stamp keeps it, so it cannot strip to '' and match every line.
    const normalizedQuery = normalizeForMatch(stripActionStamp(query) || query).toLowerCase()
    const matches = open.filter(a => normalizeForMatch(stripActionStamp(a.raw)).toLowerCase().includes(normalizedQuery))

    if (matches.length === 0) {
      throw new HafezError('VALIDATION_FAILED', `No matching action for "${query}". Actions: ${JSON.stringify(open.map(a => stripActionStamp(a.raw)))}`)
    }
    if (matches.length > 1) throw ambiguous(matches)
    return toMatch(matches[0])
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
    return openActions(body).map(a => stripActionStamp(a.raw))
  }

  /** Every checkbox line of Next Actions in file order, open lines with their Handle. */
  function getActionItems(body: string): ActionItem[] {
    const handles = actionHandles(openActions(body).map(a => a.raw))
    let open = 0
    return actionSectionLines(body).flatMap(l => {
      const m = ACTION_RE.exec(l)
      if (!m) return []
      const text = stripActionStamp(m[2])
      return [m[1] === ' ' ? { handle: handles[open++], text, added: actionAdded(m[2]) } : { text }]
    })
  }

  /** The body with each open Next Actions line rendered `- [ ] <handle>  <text>`
   * plus whatever `mark` gives for its added day — what `read` shows. Ticked
   * lines and everything outside the section are left as they are. */
  function renderActionHandles(body: string, mark: (added: string | null) => string = () => ''): string {
    const open = openActions(body)
    if (open.length === 0) return body
    const handles = actionHandles(open.map(a => a.raw))
    return editActionLines(body, lines => open.forEach((a, i) => { lines[a.line] = `- [ ] ${handles[i]}  ${a.raw}${mark(actionAdded(a.raw))}` }))
  }

  function addNextAction(body: string, action: string): string {
    const section = findSection(body, 'Next Actions')
    if (section) {
      // Add the new item at the end of unchecked items (before any checked items)
      const lines = section.content.split('\n')
      const lastUncheckedIdx = lines.reduce((last, line, i) => line.startsWith('- [ ] ') ? i : last, -1)
      const insertIdx = lastUncheckedIdx === -1 ? 0 : actionEnd(lines, lastUncheckedIdx)
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
   * Edit the Next Actions section's raw lines, and nothing outside it. An
   * identical checkbox line quoted elsewhere in the body (a Brief restating
   * a blocker) is authored content, not an action. Works on whole lines, so
   * action text is never interpreted as a replacement pattern ($&, $', $1
   * survive byte-identical).
   */
  function editActionLines(body: string, edit: (lines: string[]) => void): string {
    const section = findSection(body, 'Next Actions')
    if (!section) return body
    const lines = body.slice(section.headingEnd, section.end).split('\n')
    edit(lines)
    return body.slice(0, section.headingEnd) + lines.join('\n') + body.slice(section.end)
  }

  // complete / remove edit one line and nothing else. They do not collapse
  // an emptied section — that is pruneNextActions, run once by the caller
  // after every edit of the op, so a tick that empties the open list and an
  // add in the same op never remove-then-recreate the section (which lost
  // the checked lines and re-homed the section below Current State).
  // Each takes a query, or a match resolved earlier against this same body.
  // `matched` is reported unstamped; the line edited keeps its stamp.
  function completeNextAction(body: string, action: string | ActionMatch): { matched: string; body: string } {
    const match = typeof action === 'string' ? matchAction(body, action) : action
    return { matched: match.text, body: editActionLines(body, lines => { lines[match.line] = lines[match.line].replace('- [ ] ', '- [x] ') }) }
  }

  // `line` is the removed line as the file held it, stamp included, with the
  // lines it carries — what the archive log keeps.
  function removeNextAction(body: string, action: string | ActionMatch): { matched: string; line: string; body: string } {
    const match = typeof action === 'string' ? matchAction(body, action) : action
    const section = actionSectionLines(body)
    const end = actionEnd(section, match.line)
    return { matched: match.text, line: actionBlock(section, match.line), body: editActionLines(body, lines => { lines.splice(match.line, end - match.line) }) }
  }

  /** Every checkbox line of Next Actions, open and ticked, as the file holds
   * them — each with the lines it carries. */
  function actionLines(body: string): string[] {
    const section = actionSectionLines(body)
    return section.flatMap((l, i) => ACTION_RE.test(l) ? [actionBlock(section, i)] : [])
  }

  /** Take the oldest ticked lines out of Next Actions until at most `keep`
   * remain. Lines are added in order and ticked in place, so file order is
   * age order. `lines` are the taken lines as the file held them, oldest
   * first, each with the lines it carries. */
  function extractOldestTickedActions(body: string, keep: number): { lines: string[]; body: string } {
    const section = actionSectionLines(body)
    const ticked = section.flatMap((l, i) => ACTION_RE.exec(l)?.[1].trim() ? [i] : [])
    const oldest = ticked.slice(0, Math.max(0, ticked.length - keep))
    if (oldest.length === 0) return { lines: [], body }
    const taken = new Set(oldest.flatMap(i => Array.from({ length: actionEnd(section, i) - i }, (_, k) => i + k)))
    return {
      lines: oldest.map(i => actionBlock(section, i)),
      body: editActionLines(body, lines => { lines.splice(0, lines.length, ...lines.filter((_, i) => !taken.has(i))) }),
    }
  }

  /** The body with the stamp stripped from every checkbox line (open and
   * ticked) of Next Actions — for surfaces that carry action text but not the
   * vault's file format (export). Nothing outside the section is touched. */
  function stripNextActionStamps(body: string): string {
    const section = findSection(body, 'Next Actions')
    if (!section) return body
    const content = body.slice(section.headingEnd, section.end)
      .split('\n')
      .map(line => /^- \[[ xX]\] /.test(line) ? stripActionStamp(line) : line)
      .join('\n')
    return body.slice(0, section.headingEnd) + content + body.slice(section.end)
  }

  /** Remove the section once no open item remains (appear-on-write, removed when emptied). */
  function pruneNextActions(body: string): string {
    if (!findSection(body, 'Next Actions')) return body
    return getNextActions(body).length === 0 ? clearNextActions(body) : body
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
    getActionItems,
    renderActionHandles,
    addNextAction,
    matchNextAction: matchAction,
    completeNextAction,
    removeNextAction,
    actionLines,
    extractOldestTickedActions,
    pruneNextActions,
    clearNextActions,
    stripNextActionStamps,
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

export function getActionItems(body: string): ActionItem[] {
  return ENTITY_UNION_DOC.getActionItems(body)
}

export function renderActionHandles(body: string, mark?: (added: string | null) => string): string {
  return ENTITY_UNION_DOC.renderActionHandles(body, mark)
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
