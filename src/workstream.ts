// src/workstream.ts
// Workstream (see CONTEXT.md): a prefix family on an entity's Next Actions
// with no Child or Related entity carrying it, Number A of the
// workstream-signal research (#230, #240). The reference definition is
// tools/research/ws_caps_prefix.py; the Health pass shares this module.
//
// A line's family is its leading run of ALL-CAPS tokens (two or more
// characters; digits, hyphen, apostrophe allowed; a `WS4`/`WS-A` code is one
// such token), minus a trailing step id (`A3`, `B1`); a lone step id is not
// a family; a trailing possessive `'S` is stripped from a token. A family
// fires at three or more lines, open or ticked; it stops once an entity
// whose `parent` or `related` names this one carries a family token among
// the word tokens of its slug or name. A code family (`WS4`, `WS-A`) stops
// on its whole code only — a segment of the slug (`ws-a-dynamics`) or a
// word of the name (`WS-A dynamics`) — never on `ws` or `a` alone. The
// count reported is the family's OPEN lines — what is left to split — so a
// family with none does not render at all.

import { getActionItems } from './document.js'

const TOKEN = "[A-Z][A-Z0-9'’\\-]+"
const PREFIX_RE = new RegExp(`^((?:${TOKEN})(?: ${TOKEN})*)(?=[,:;]|\\s[—–-]\\s|\\s|$)`)
const STEP_RE = /^[A-Z]\d+$/
const POSSESSIVE_RE = /['’]S$/
const CODE_RE = /^WS(\d+|-[A-Z])$/

/** The family lines fire at: Number A's threshold. */
export const FAMILY_MIN_LINES = 3

/** The family a Next Actions line opens with, or null. */
export function familyOf(text: string): string | null {
  const m = PREFIX_RE.exec(text)
  if (!m) return null
  const toks = m[1].split(' ').map(t => t.replace(POSSESSIVE_RE, ''))
  while (toks.length > 1 && STEP_RE.test(toks[toks.length - 1])) toks.pop()
  const fam = toks.join(' ')
  if (STEP_RE.test(fam)) return null
  return fam.length >= 2 ? fam : null
}

/** One firing family and its open-line count, as `read --json` gives it. */
export interface Workstream {
  prefix: string
  open_actions: number
}

/** The `[a-z0-9]+` word tokens of a slug and name, lowercased. */
export const wordTokens = (text: string): Set<string> => new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? [])

/** Whether the entity carries the whole lowercased code: as a segment of
 * its slug, or as a word of its name (hyphen kept). */
function carriesCode(e: { slug: string; name: string }, code: string): boolean {
  return `-${e.slug.toLowerCase()}-`.includes(`-${code}-`)
    || (e.name.toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? []).some(w => w === code)
}

/** The families an entity body carries unsplit, in first-appearance order,
 * against the entities whose `parent` or `related` names it (`naming`). */
export function workstreams(body: string, naming: Array<{ slug: string; name: string }>): Workstream[] {
  const families = new Map<string, { lines: number; open: number }>()
  for (const item of getActionItems(body)) {
    const fam = familyOf(item.text)
    if (fam === null) continue
    const f = families.get(fam) ?? { lines: 0, open: 0 }
    f.lines++
    if ('handle' in item) f.open++
    families.set(fam, f)
  }
  const named = naming.map(e => wordTokens(`${e.slug} ${e.name}`))
  const out: Workstream[] = []
  for (const [prefix, f] of families) {
    if (f.lines < FAMILY_MIN_LINES || f.open === 0) continue
    if (CODE_RE.test(prefix)) {
      if (naming.some(e => carriesCode(e, prefix.toLowerCase()))) continue
    } else {
      const tokens = Array.from(wordTokens(prefix))
      if (named.some(set => tokens.some(t => set.has(t)))) continue
    }
    out.push({ prefix, open_actions: f.open })
  }
  return out
}
