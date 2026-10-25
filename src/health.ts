// src/health.ts
// The Health pass (see CONTEXT.md; #239, #244): what placement would change,
// as a typed report. Like the Vault Scan (validate.ts) it reads the vault
// files directly and never the index, so it reports what is on disk. It
// applies nothing. Reference definitions: tools/research/ws_caps_prefix.py
// (through src/workstream.ts), ws_recurring_name.py, ws_leak.py,
// ws_restate.py; (iii) and (v) follow ADR 0002.
import { join, basename } from 'path'
import { existsSync, readFileSync } from 'fs'
import { parseFilePath, scanVaultDir, kindDir, archiveLogPath } from './vault.js'
import { ACTION_RE, actionAdded, documentForFile, escapeRegex, parseSessionLogHeading, splitLogEntries, stripActionStamp, WIKI_LINK_RE } from './document.js'
import { workstreams, wordTokens } from './workstream.js'
import type { HealthReport, HealthWorkstream, HealthRecurringName, HealthLeak, HealthEdge, HealthRestatedDecision } from './types.js'

/** One session-log entry as the replay scripts read it: its day and its
 * text (the Summary line and the body lines, joined with spaces). */
interface LogEntry {
  day: string
  type: string
  /** The Summary line's text. */
  summary: string
  text: string
}

/** One Next Actions line as ws_common.py reads it: open or ticked, the
 * stamp stripped, indented continuation lines folded into the text. */
interface ActionLine {
  text: string
  added: string | null
}

/** What checks (iii), (v) and (vi) read of a note of either kind. A
 * knowledge note has no `parent`. */
interface NoteRecord {
  slug: string
  name: string
  created: string
  parent: string | null
  related: string[]
  body: string
}

interface EntityRecord extends NoteRecord {
  actions: ActionLine[]
  /** The Session Log section's entries, then the archive's. */
  log: LogEntry[]
}

const ENTITY_DOC = documentForFile({ kind: 'entity' })
const KNOWLEDGE_DOC = documentForFile({ kind: 'knowledge' })

function parseActions(body: string): ActionLine[] {
  return ENTITY_DOC.actionLines(body).map(block => {
    const [line, ...carried] = block.split('\n')
    const m = ACTION_RE.exec(line)!
    const folded = carried.filter(l => l.startsWith('  ') && l.trim()).map(l => l.trim())
    return { text: [stripActionStamp(m[2]), ...folded].join(' '), added: actionAdded(m[2]) }
  })
}

/** The entries of a Session Log section or an archive, as ws_common.py
 * reads them: the summary is the first `Summary:` line anywhere in the
 * entry. */
function parseLog(content: string): LogEntry[] {
  return splitLogEntries(content).map(block => {
    const [heading, ...rest] = block.split('\n')
    const head = parseSessionLogHeading(heading)!
    const lines = rest.map(l => l.trim()).filter(Boolean)
    const at = lines.findIndex(l => l.startsWith('Summary:'))
    const summary = at === -1 ? '' : lines[at].slice(8).trim()
    const text = lines.map((l, i) => i === at ? summary : l).join(' ')
    return { day: head.date, type: head.type, summary, text }
  })
}

function loadLog(vaultPath: string, slug: string, body: string): LogEntry[] {
  const section = ENTITY_DOC.findSection(body, 'Session Log')?.content ?? ''
  const archive = archiveLogPath(vaultPath, slug)
  return [...parseLog(section), ...(existsSync(archive) ? parseLog(readFileSync(archive, 'utf-8')) : [])]
}

/** Every parseable entity, slug order. A file that fails to parse is
 * `validate`'s to report, not this pass's. */
function loadEntities(vaultPath: string): EntityRecord[] {
  const out: EntityRecord[] = []
  for (const filePath of scanVaultDir(join(vaultPath, kindDir('entity'))).sort()) {
    const slug = basename(filePath, '.md')
    let fm: Record<string, any>, body: string
    try { ({ frontmatter: fm, body } = parseFilePath(filePath)) } catch { continue }
    out.push({
      slug,
      name: String(fm.name ?? slug),
      created: String(fm.created ?? ''),
      parent: typeof fm.parent === 'string' ? fm.parent : null,
      related: Array.isArray(fm.related) ? fm.related.map(String) : [],
      body,
      actions: parseActions(body),
      log: loadLog(vaultPath, slug, body),
    })
  }
  return out
}

/** Every parseable knowledge note, slug order. */
function loadKnowledge(vaultPath: string): NoteRecord[] {
  const out: NoteRecord[] = []
  for (const filePath of scanVaultDir(join(vaultPath, kindDir('knowledge'))).sort()) {
    const slug = basename(filePath, '.md')
    let fm: Record<string, any>, body: string
    try { ({ frontmatter: fm, body } = parseFilePath(filePath)) } catch { continue }
    out.push({
      slug,
      name: String(fm.name ?? slug),
      created: String(fm.created ?? ''),
      parent: null,
      related: Array.isArray(fm.related) ? fm.related.map(String) : [],
      body,
    })
  }
  return out
}

/** Check (i): the family module over each entity, against the entities
 * whose `parent` or `related` name it. */
function checkWorkstreams(entities: EntityRecord[]): HealthWorkstream[] {
  return entities.flatMap(e => {
    const naming = entities.filter(o => o.parent === e.slug || o.related.includes(e.slug))
    return workstreams(e.body, naming).map(w => ({ entity: e.slug, ...w }))
  })
}

// --- Check (ii): ws_recurring_name.py ---

/** The threshold a recurring name lists at (#239). */
export const RECURRING_MIN_UNITS = 10
const SLUGISH_RE = /(?<![\w/.])([a-z][a-z0-9]*(?:-[a-z0-9]+)+)(?![\w/])/g
const CAPWORD = '[A-Z][a-zA-Z0-9]+'
const PROPER_RE = new RegExp(`(?<![.!?:;]\\s)(?<!^)(?<!\\n)\\b(${CAPWORD}(?: ${CAPWORD})?)\\b`, 'g')
const FAMILY_RE = /\b(WS\d+|WS-[A-Z])\b/g
const DATE_LIKE_RE = /^\d{4}-\d{2}-\d{2}$|^\d+-\d+$/
const SLUGISH_SKIP_HEADS = new Set(['add', 'dry', 'read', 'auto'])
/** The script's list minus the owner's first name (a leak pattern in the public
 * tree): months, weekdays, agents, function
 * words, number words, acronyms, products, pronouns, quantifiers. */
const RECURRING_STOP = new Set(`January February March April May June July August September October November December
Jan Feb Mar Apr Jun Jul Aug Sep Sept Oct Nov Dec Monday Tuesday Wednesday Thursday Friday Saturday Sunday
Claude Codex Summary Decision Decisions Next Step Steps Phase Session Sessions Day Week Workshop
The A An And Or But Not No Yes For From With Into Over Under Then Now Done Open Owner Owned Fix Fixed
Also New Old One Two Three Four Five Six Seven Eight Nine Ten First Second Third Last Final Draft
PR PRs CI API URL CLI SDK UK US ID MD JSON YAML CSV PDF HTML SQL FTS SHA IP UI UX QA DAX
Notion GitHub Google Windows Linux WSL Python Node Power BI Excel Teams Outlook Slack Telegram
If When Where What Which Who Why How This That These Those It Its He His Him She Her They Them We Our
Still Both Either Neither Each Every Any Some Most Many Few Such Same Other Another Only Just Even
Before After Since Until While Because So Than Too Very Here There`.split(/\s+/))

const isUpper = (w: string) => w === w.toUpperCase() && w !== w.toLowerCase()

/** The terms of one unit's text: slug-shaped names that are no note's slug,
 * capitalised words or bigrams not at a sentence start (minus the stop set,
 * the entity's own name tokens and all-caps runs, which are check (i)), and
 * `WS` family codes. */
function termsIn(text: string, ownTokens: Set<string>, slugs: Set<string>): Set<string> {
  const terms = new Set<string>()
  for (const m of text.matchAll(SLUGISH_RE)) {
    const s = m[1]
    if (slugs.has(s) || DATE_LIKE_RE.test(s) || s.length < 6) continue
    if (s.startsWith('http') || s.startsWith('www') || SLUGISH_SKIP_HEADS.has(s.split('-')[0])) continue
    terms.add(s)
  }
  for (const m of text.matchAll(PROPER_RE)) {
    const words = m[1].split(' ')
    if (words.some(w => RECURRING_STOP.has(w) || ownTokens.has(w.toLowerCase()))) continue
    if (words.every(isUpper)) continue
    terms.add(m[1])
  }
  for (const m of text.matchAll(FAMILY_RE)) terms.add(m[1])
  return terms
}

/** Check (ii): a term in RECURRING_MIN_UNITS or more units (log entries and
 * action lines) of one entity across two or more days; an undated action
 * line counts as a unit but not as a day. */
function checkRecurringNames(entities: EntityRecord[], slugs: Set<string>): HealthRecurringName[] {
  const out: HealthRecurringName[] = []
  for (const e of entities) {
    const own = wordTokens(`${e.name} ${e.slug}`)
    const units = new Map<string, Array<string | null>>()
    const add = (text: string, day: string | null) => {
      for (const t of termsIn(text, own, slugs)) units.set(t, [...(units.get(t) ?? []), day])
    }
    for (const entry of e.log) add(entry.text, entry.day)
    for (const a of e.actions) add(a.text, a.added)
    const rows: HealthRecurringName[] = []
    for (const [term, days] of units) {
      const distinct = [...new Set(days.filter((d): d is string => d !== null))].sort()
      if (days.length >= RECURRING_MIN_UNITS && distinct.length >= 2) rows.push({ entity: e.slug, term, units: days.length, days: distinct })
    }
    out.push(...rows.sort((a, b) => b.units - a.units || a.term.localeCompare(b.term)))
  }
  return out
}

// --- Check (iv): ws_leak.py ---

/** The child's slug, or its name when longer than three characters, as a
 * whole word (ws_leak.py `mentions`). */
function mentionsRe(c: EntityRecord): RegExp {
  const pats = [escapeRegex(c.slug)]
  if (c.name.length > 3) pats.push(escapeRegex(c.name))
  return new RegExp(`(?<![\\w-])(?:${pats.join('|')})(?![\\w-])`, 'i')
}

/** Check (iv): for each child C and each P that is C's parent or an entity
 * in C's related, P's log entries dated on or after C's `created` naming C.
 * Pairs with no hit are left out. */
function checkLeakage(entities: EntityRecord[]): HealthLeak[] {
  const bySlug = new Map(entities.map(e => [e.slug, e]))
  const out: HealthLeak[] = []
  for (const c of entities) {
    const parents = [...(c.parent ? [c.parent] : []), ...c.related.filter(r => r !== c.parent)]
    const rx = mentionsRe(c)
    for (const p of parents) {
      const P = bySlug.get(p)
      if (!P) continue
      const after = P.log.filter(e => e.day >= c.created)
      const hits = after.filter(e => rx.test(e.text)).length
      if (hits === 0) continue
      out.push({ parent: p, child: c.slug, relation: p === c.parent ? 'parent' : 'related', hits, entries: after.length })
    }
  }
  return out
}

// --- Checks (iii) and (v): ADR 0002 ---

const WIKI_LINK_ALL_RE = new RegExp(WIKI_LINK_RE.source, 'g')

/** A parent and its child are never `related` (parent subsumes related):
 * the link line for such a pair would be rejected, so neither check lists it. */
const parentBound = (a: NoteRecord, b: NoteRecord) => a.parent === b.slug || b.parent === a.slug

/** Check (iii): a same-kind `related` edge with one end. A target that is
 * not a note of the kind is a cross-kind edge or a broken slug, neither
 * this check's. */
function checkOneWayEdges(notes: NoteRecord[]): HealthEdge[] {
  const bySlug = new Map(notes.map(n => [n.slug, n]))
  const out: HealthEdge[] = []
  for (const a of notes) {
    for (const b of a.related) {
      const B = bySlug.get(b)
      if (B && b !== a.slug && !B.related.includes(a.slug) && !parentBound(a, B)) out.push({ from: a.slug, to: b })
    }
  }
  return out
}

/** Check (v): a `[[slug]]` in a note's body naming another note of the
 * kind, with no `related` edge either way; a pair mentioned from both sides
 * lists once, from the first in slug order. */
function checkUnlinkedMentions(notes: NoteRecord[]): HealthEdge[] {
  const bySlug = new Map(notes.map(n => [n.slug, n]))
  const seen = new Set<string>()
  const out: HealthEdge[] = []
  for (const a of notes) {
    for (const m of a.body.matchAll(WIKI_LINK_ALL_RE)) {
      const b = m[1]
      const B = bySlug.get(b)
      if (!B || b === a.slug || a.related.includes(b) || B.related.includes(a.slug) || parentBound(a, B)) continue
      const pair = [a.slug, b].sort().join('\0')
      if (seen.has(pair)) continue
      seen.add(pair)
      out.push({ from: a.slug, to: b })
    }
  }
  return out
}

// --- Check (vi): ws_restate.py ---

/** The share of a decision's summary tokens a note must carry. */
export const RESTATE_SHARE = 0.5
/** The script's own stop list, verbatim; not src/stopwords.ts. */
const RESTATE_STOP = new Set(`the a an and or but not of to in on for with by from at as is are was were be been being it its
this that these those we our you your they their he she his her them us i me my if then than so no yes
do does did done has have had having can could will would should may might must into over under out up
down off about after before between through during per via one two three four five six seven eight nine
ten first second third new old now here there when where which who whom whose what why how all any each
every some such same other another only also just even still both either neither own very more most less
few many much see entry entries issue map ticket pr`.split(/\s+/))

function restateTokens(text: string): Set<string> {
  const out = new Set<string>()
  for (const m of text.toLowerCase().matchAll(/[a-z0-9][a-z0-9'’\-]*/g)) {
    if (m[0].length >= 3 && !RESTATE_STOP.has(m[0])) out.add(m[0])
  }
  return out
}

/** Check (vi): for each `decision` entry on an entity, each knowledge note
 * created on the entry's day and `related` to the entity whose name plus
 * Synthesis carries RESTATE_SHARE or more of the entry's summary tokens. */
function checkRestatedDecisions(entities: EntityRecord[], knowledge: NoteRecord[]): HealthRestatedDecision[] {
  const out: HealthRestatedDecision[] = []
  for (const e of entities) {
    const notes = knowledge.filter(n => n.related.includes(e.slug))
    if (!notes.length) continue
    for (const entry of e.log) {
      if (entry.type !== 'decision') continue
      const st = restateTokens(entry.summary)
      if (!st.size) continue
      for (const n of notes) {
        if (n.created !== entry.day) continue
        const nt = restateTokens(`${n.name} ${KNOWLEDGE_DOC.findSection(n.body, 'Synthesis')?.content ?? ''}`)
        const share = [...st].filter(t => nt.has(t)).length / st.size
        if (share >= RESTATE_SHARE) out.push({ day: entry.day, entity: e.slug, note: n.slug, share, summary: entry.summary })
      }
    }
  }
  return out
}

/** Every note's slug, every kind: a slug-shaped name that is a note is not
 * a recurring name. */
function allSlugs(vaultPath: string): Set<string> {
  const kinds = ['entity', 'knowledge', 'session'] as const
  return new Set(kinds.flatMap(k => scanVaultDir(join(vaultPath, kindDir(k))).map(f => basename(f, '.md'))))
}

export function healthReport(vaultPath: string): HealthReport {
  const entities = loadEntities(vaultPath)
  const knowledge = loadKnowledge(vaultPath)
  return {
    workstreams: checkWorkstreams(entities),
    recurring_names: checkRecurringNames(entities, allSlugs(vaultPath)),
    leakage: checkLeakage(entities),
    one_way_edges: [...checkOneWayEdges(entities), ...checkOneWayEdges(knowledge)],
    unlinked_mentions: [...checkUnlinkedMentions(entities), ...checkUnlinkedMentions(knowledge)],
    restated_decisions: checkRestatedDecisions(entities, knowledge),
  }
}
