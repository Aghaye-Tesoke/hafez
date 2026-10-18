// tests/read-footer.test.ts
// The read Footer (#90): every `read` ends with one filled-in Write Line
// against its slug, rendered per kind, type and subtype; `--json` carries it
// as a `writes` op object. Asserted at the command-function seam over a
// memory-Journal factory (the string `read` returns), and by drift check 3:
// the Footer's fields against the Op Spec update shape. The four read samples
// are checked whole in tests/surfaces.test.ts.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createHafez, removeTemp } from './helpers/hafez.js'
import { createMemoryJournal } from './helpers/memory-journal.js'
import { cmdQuery, cmdRead, cmdSearch, cmdUpdate, UPDATE_FLAGS } from '../src/cli/commands.js'
import { ITEMS, footerOp } from '../src/surfaces/items.js'
import { UpdateFieldsSchema } from '../src/batch-ops.js'
import { validateKindFields } from '../src/apply.js'
import { ALIAS_KEYS, getContract, WRITE_LINE_FIELDS, WRITE_LINE_OMITS, type DocTarget } from '../src/contracts.js'
import { detectAgent } from '../src/harness.js'
import type { Hafez, ReadDepth } from '../src/types.js'

const TMP = join(tmpdir(), 'hafez-test-read-footer-' + Date.now())
const VAULT = join(TMP, 'vault')

let os: Hafez

beforeAll(() => {
  mkdirSync(join(VAULT, 'entities'), { recursive: true })
  mkdirSync(join(VAULT, 'knowledge'), { recursive: true })
  os = createHafez({ vaultPath: VAULT, persistence: createMemoryJournal() })
})
afterAll(() => removeTemp(TMP))

const DEPTHS: ReadDepth[] = ['frontmatter', 'summary', 'full']
const FOOTER_START = '\n\n---\n'
/** Everything from the blank line before the rule: the Footer portion. */
const footerOf = (out: string) => out.slice(out.lastIndexOf(FOOTER_START) + 1)
const lastLineOf = (out: string) => out.trimEnd().split('\n').at(-2)
const OPEN_LINE = /^- \[ \] ([0-9a-f]+) {2}/m

let seq = 0
const named = (base: string) => `${base} ${++seq}`

describe('read ends with the Footer', () => {
  it('a project: the full Write Line, --complete-action showing its first open Handle', async () => {
    const slug = await os.create('entity', named('Footer Project'), { type: 'project', add_actions: ['Migrate the mobile client', 'Remove the cookie fallback'] })
    const out = await cmdRead(os, [slug])
    const handle = OPEN_LINE.exec(out)![1]
    expect(footerOf(out)).toBe([
      '',
      '---',
      'Write back with one command. Keep the flags you need, drop the rest:',
      '',
      '```',
      `hafez update ${slug} --log "<progress|decision|blocker|research>: <one line>" --body "<detail>" --complete-action ${handle} --remove-action <handle> --add-action "<text>" --brief "<text>" --current-state "<text>" --related <slug> --parent <slug>`,
      '```',
    ].join('\n'))
  })

  it('is identical at --depth frontmatter, summary and full', async () => {
    const slug = await os.create('entity', named('Footer Depths'), { type: 'entity', add_action: 'Ship it' })
    await os.update(slug, { session_log: { type: 'progress', summary: 'Started', agent: 'claude' } })
    const footers = await Promise.all(DEPTHS.map(async d => footerOf(await cmdRead(os, [slug, '--depth', d]))))
    expect(footers[0]).toContain('--complete-action ')
    expect(new Set(footers).size).toBe(1)
  })

  it('a blank line and a rule line follow the body, never a heading', async () => {
    const slug = await os.create('entity', named('Footer Shape'), { type: 'entity' })
    for (const depth of DEPTHS) {
      const out = await cmdRead(os, [slug, '--depth', depth])
      const footer = footerOf(out)
      expect(out.endsWith(footer)).toBe(true)
      expect(out.slice(0, -footer.length).endsWith('\n')).toBe(true)
      expect(out.slice(0, -footer.length).endsWith('\n\n')).toBe(false)
      expect(footer).not.toMatch(/^#/m)
    }
  })

  it('an entity with no open action has no --complete-action', async () => {
    const none = await os.create('entity', named('Footer No Actions'), { type: 'entity' })
    const ticked = await os.create('entity', named('Footer All Ticked'), { type: 'project', add_action: 'Done already' })
    await os.update(ticked, { complete_action: 'Done already' })
    for (const slug of [none, ticked]) {
      const line = lastLineOf(await cmdRead(os, [slug]))
      expect(line).toBe(`hafez update ${slug} --log "<progress|decision|blocker|research>: <one line>" --body "<detail>" --remove-action <handle> --add-action "<text>" --brief "<text>" --current-state "<text>" --related <slug> --parent <slug>`)
    }
  })

  it('an insight: evidence, source, synthesis, confidence, domain, related', async () => {
    const slug = await os.create('knowledge', named('Footer Insight'), { synthesis: 'Tokens expire.' })
    expect(lastLineOf(await cmdRead(os, [slug]))).toBe(
      `hafez update ${slug} --add-evidence "<what you saw>" --add-source "<url or citation>" --synthesis "<the whole insight, rewritten>" --confidence <observation|pattern|principle> --domain <domain> --related <slug>`)
  })

  it('a plan: status, domain and related only', async () => {
    const slug = await os.create('knowledge', named('Footer Plan'), { subtype: 'plan', status: 'active' })
    expect(lastLineOf(await cmdRead(os, [slug]))).toBe(`hafez update ${slug} --status <active|done> --domain <domain> --related <slug>`)
  })

  it('a capture: the promote line', async () => {
    const slug = await os.capture(named('Footer Capture'), 'A thought')
    const out = await cmdRead(os, [slug])
    expect(footerOf(out)).toBe([
      '',
      '---',
      'A capture waits to be sorted. Once you can tell what it is, one command:',
      '',
      '```',
      `hafez promote ${slug} <entity|project|knowledge>`,
      '```',
    ].join('\n'))
  })
})

describe('read --json carries the Footer as `writes`', () => {
  it('an entity: the update op object, at every depth', async () => {
    const slug = await os.create('entity', named('Footer Json'), { type: 'project', add_action: 'Ship it' })
    const handle = OPEN_LINE.exec(await cmdRead(os, [slug]))![1]
    for (const depth of DEPTHS) {
      const out = JSON.parse(await cmdRead(os, [slug, '--depth', depth], { json: true }))
      expect(out.writes).toEqual({
        op: 'update',
        slug,
        fields: {
          session_log: { type: '<progress|decision|blocker|research>', summary: '<one line>', body: '<detail>', agent: detectAgent() },
          complete_action: handle,
          remove_action: '<handle>',
          add_actions: ['<text>'],
          brief: '<text>',
          current_state: '<text>',
          related: ['<slug>'],
          parent: '<slug>',
        },
      })
    }
  })

  it('a plan, an insight and a capture', async () => {
    const plan = await os.create('knowledge', named('Footer Json Plan'), { subtype: 'plan' })
    const insight = await os.create('knowledge', named('Footer Json Insight'))
    const capture = await os.capture(named('Footer Json Capture'))
    const writes = async (slug: string) => JSON.parse(await cmdRead(os, [slug], { json: true })).writes
    expect(await writes(plan)).toEqual({ op: 'update', slug: plan, fields: { status: '<active|done>', domain: ['<domain>'], related: ['<slug>'] } })
    expect(await writes(insight)).toEqual({
      op: 'update',
      slug: insight,
      fields: {
        add_evidence: '<what you saw>',
        add_source: '<url or citation>',
        synthesis: '<the whole insight, rewritten>',
        confidence: '<observation|pattern|principle>',
        domain: ['<domain>'],
        related: ['<slug>'],
      },
    })
    expect(await writes(capture)).toEqual({ op: 'promote', slug: capture, target: '<entity|project|knowledge>' })
  })

  it('prose output carries no `writes`, and JSON output no prose Footer', async () => {
    const slug = await os.create('entity', named('Footer Json Prose'), { type: 'entity' })
    expect(await cmdRead(os, [slug])).not.toContain('writes')
    expect(await cmdRead(os, [slug], { json: true })).not.toContain('Write back')
  })
})

describe('search and query carry no Footer', () => {
  it('neither prints a rule line nor a Write Line', async () => {
    const slug = await os.create('entity', named('Footer Absent Zebra'), { type: 'entity', brief: 'zebra crossing' })
    for (const out of [
      await cmdSearch(os, ['zebra']),
      await cmdQuery(os, ['--filter', 'active']),
      await cmdQuery(os, ['--kind', 'all', '--filter', 'all']),
    ]) {
      expect(out).toContain(slug)
      expect(out).not.toMatch(/^---$/m)
      expect(out).not.toContain('hafez update')
    }
  })
})

// --- Drift check 3: vocabulary parity ---

const ALL_UPDATE_FIELDS = Object.keys(UpdateFieldsSchema.shape)

/** The update fields a document of this shape accepts, by the real gate,
 * after the Op Spec's alias normalisation. */
function acceptedFields(target: DocTarget): string[] {
  const aliases: Record<string, string> = ALIAS_KEYS
  return ALL_UPDATE_FIELDS.filter(field => {
    const canonical = aliases[`update.fields.${field}`] ?? field
    try {
      validateKindFields(target.kind, { [canonical]: canonical === 'status' ? 'active' : 'x' }, target.kind === 'knowledge' ? target.subtype : undefined)
      return true
    } catch { return false }
  })
}

/** The field a Write Line flag writes: the batch field with dashes; the log
 * and its body compose `session_log`; a repeated action flag is the list. */
function fieldOfFlag(flag: string): string {
  if (flag === 'log' || flag === 'body') return 'session_log'
  if (flag === 'add-action') return 'add_actions'
  return flag.replace(/-/g, '_')
}

/** Every disagreement between one contract's Footer and the Op Spec. */
function parityProblems(target: DocTarget, shown: string[], omitted: string[], line: string): string[] {
  const problems: string[] = []
  const accepted = acceptedFields(target)
  for (const f of shown) if (!accepted.includes(f)) problems.push(`Footer shows ${f}, which the update shape does not accept here`)
  for (const f of shown) if (omitted.includes(f)) problems.push(`${f} is both shown and omitted`)
  for (const f of accepted) if (!shown.includes(f) && !omitted.includes(f)) problems.push(`${f} is accepted but neither shown nor omitted with a reason`)
  for (const f of omitted) if (!accepted.includes(f)) problems.push(`omits ${f}, which the update shape does not accept here`)
  const flags = [...line.matchAll(/ --([a-z-]+)/g)].map(m => m[1])
  for (const flag of flags) {
    if (!(flag in UPDATE_FLAGS)) problems.push(`--${flag} is not an update flag`)
    if (!shown.includes(fieldOfFlag(flag))) problems.push(`--${flag} maps to no Footer field`)
  }
  for (const f of shown) if (!flags.some(flag => fieldOfFlag(flag) === f)) problems.push(`${f} has no flag in the Write Line`)
  return problems
}

const CONTRACTS = [
  ['entity', { kind: 'entity', type: 'entity' }],
  ['entity', { kind: 'entity', type: 'project' }],
  ['insight', { kind: 'knowledge', subtype: 'insight' }],
  ['plan', { kind: 'knowledge', subtype: 'plan' }],
] as const

describe('drift check 3: the Footer\'s fields equal the Op Spec update shape', () => {
  it.each(CONTRACTS)('%s (%j): shown plus omitted equals accepted, and every flag maps to a field', (contract, target) => {
    const input = { slug: 's', target, handle: 'abcd', agent: 'claude' }
    const op = footerOp(input)
    if (op.op !== 'update') throw new Error('expected an update op')
    expect(Object.keys(op.fields)).toEqual([...WRITE_LINE_FIELDS[contract]])
    expect(parityProblems(target, Object.keys(op.fields), Object.keys(WRITE_LINE_OMITS[contract]), lastLineOf(ITEMS.writeLine.render(input) + '\n')!)).toEqual([])
  })

  it('every omission states its reason', () => {
    for (const omits of Object.values(WRITE_LINE_OMITS)) {
      for (const reason of Object.values(omits)) expect(reason?.trim()).toBeTruthy()
    }
  })

  it('catches a Footer field the update shape lacks, an unmapped flag, and an accepted field left unstated', () => {
    const target = { kind: 'knowledge', subtype: 'plan' } as const
    expect(parityProblems(target, ['status', 'domain', 'related', 'brief'], Object.keys(WRITE_LINE_OMITS.plan), 'hafez update s --status <a> --domain d --related r --brief "<text>"'))
      .toContain('Footer shows brief, which the update shape does not accept here')
    expect(parityProblems(target, ['status', 'domain', 'related'], Object.keys(WRITE_LINE_OMITS.plan), 'hafez update s --status <a> --domain d --related r --tag t'))
      .toEqual(['--tag is not an update flag', '--tag maps to no Footer field'])
    expect(parityProblems(target, ['status', 'domain'], Object.keys(WRITE_LINE_OMITS.plan), 'hafez update s --status <a> --domain d'))
      .toEqual(['related is accepted but neither shown nor omitted with a reason'])
  })

  it('a capture\'s Footer promotes to exactly what its contract can promote to', () => {
    const op = footerOp({ slug: 's', target: { kind: 'entity', type: 'capture' }, agent: 'claude' })
    expect(op).toEqual({ op: 'promote', slug: 's', target: `<${getContract('capture').canPromoteTo.join('|')}>` })
  })
})

// --- The Write Line runs as shown ---

/** Shell words of a Write Line: bare words and double-quoted strings. */
const words = (line: string) => [...line.matchAll(/"((?:[^"\\]|\\.)*)"|(\S+)/g)].map(m => m[1] ?? m[2])

/** The Write Line with every placeholder filled the way an agent would. */
function filled(line: string, fill: { slug: string; handle?: string }): string[] {
  return words(line).slice(2).map(w => w
    .replace(/<([a-z]+)\|[^>]*>/g, '$1')
    .replace(/<slug>/g, fill.slug)
    .replace(/<handle>/g, fill.handle ?? 'x')
    .replace(/<[^>]+>/g, 'filled'))
}

describe('the Write Line, placeholders filled, is accepted by update as shown', () => {
  it('an entity: every flag at once', async () => {
    const other = await os.create('entity', named('Footer Run Other'), { type: 'project' })
    const slug = await os.create('entity', named('Footer Run'), { type: 'entity', add_actions: ['First line', 'Second line'] })
    const handles = [...(await cmdRead(os, [slug])).matchAll(/^- \[ \] ([0-9a-f]+) {2}/gm)].map(m => m[1])
    const argv = filled(lastLineOf(await cmdRead(os, [slug]))!, { slug: other, handle: handles[1] })
    expect(await cmdUpdate(os, argv)).toContain(`Updated ${slug}`)
    const after = await cmdRead(os, [slug, '--depth', 'full'])
    expect(after).toMatch(/- \[x\] First line/)
    expect(after).not.toContain('Second line')
    expect(after).toContain(`parent: ${other}`)
  })

  it('an insight and a plan', async () => {
    const other = await os.create('entity', named('Footer Run Target'), { type: 'entity' })
    for (const slug of [
      await os.create('knowledge', named('Footer Run Insight'), { synthesis: 'Something.' }),
      await os.create('knowledge', named('Footer Run Plan'), { subtype: 'plan' }),
    ]) {
      const argv = filled(lastLineOf(await cmdRead(os, [slug]))!, { slug: other })
      expect(await cmdUpdate(os, argv)).toContain(`Updated ${slug}`)
      expect(await cmdRead(os, [slug])).toContain(`related: ${other}`)
    }
  })
})
