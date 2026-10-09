// tests/cli-create-near-match.test.ts
// Near-match on `create knowledge` (#92, decision #60), at the command seam:
// a near-match refuses — nothing written, the slug-exists code, the existing
// note's name and description, a ready `update` line and the original create
// line with `--new`. `--new` writes anyway. A weaker resemblance writes, then
// prints one relate line. `create entity` and `capture` never near-match.
// `batch` writes and warns, never refuses.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHafez } from '../src/index.js'
import { HafezError, type Hafez } from '../src/types.js'
import { cmdCreate, cmdCapture, cmdBatch } from '../src/cli/commands.js'
import { exitCodeFor } from '../src/cli/index.js'
import { mkdirSync, rmSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createMemoryJournal } from './helpers/memory-journal.js'

let TMP: string
let VAULT: string
let os: Hafez

beforeEach(async () => {
  TMP = join(tmpdir(), `hafez-test-near-match-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  VAULT = join(TMP, 'vault')
  mkdirSync(join(VAULT, 'entities'), { recursive: true })
  mkdirSync(join(VAULT, 'knowledge'), { recursive: true })
  os = createHafez({ vaultPath: VAULT, persistence: createMemoryJournal() })
  await os.create('knowledge', 'Webhook retry budget', {
    synthesis: 'Retries share one budget per endpoint.',
    description: 'Retries share one budget per endpoint.',
  })
})
afterEach(() => rmSync(TMP, { recursive: true, force: true }))

const knowledgeFiles = () => readdirSync(join(VAULT, 'knowledge')).sort()

async function refusal(p: Promise<unknown>): Promise<HafezError> {
  const err = await p.then(() => null, e => e)
  expect(err).toBeInstanceOf(HafezError)
  return err as HafezError
}

describe('create knowledge on a near-match refuses', () => {
  it('writes nothing, exits slug-exists, and prints the existing note, the update line and the --new line', async () => {
    const before = knowledgeFiles()
    const err = await refusal(cmdCreate(os, [
      'knowledge', 'Webhook retry budget design', '--synthesis', 'Budgets reset hourly.', '--confidence', 'observation',
    ]))
    expect(knowledgeFiles()).toEqual(before)
    expect(err.code).toBe('SLUG_EXISTS')
    expect(exitCodeFor(err)).toBe(5)
    expect(err.message).toBe([
      '"Webhook retry budget design" near-matches an existing knowledge note. Nothing was written.',
      '',
      'Use it instead:',
      '',
      'Webhook retry budget (webhook-retry-budget): Retries share one budget per endpoint.',
      '```',
      'hafez update webhook-retry-budget --add-evidence "Budgets reset hourly."',
      '```',
      '',
      'A different note after all: create it anyway.',
      '```',
      'hafez create knowledge "Webhook retry budget design" --synthesis "Budgets reset hourly." --confidence observation --new',
      '```',
    ].join('\n'))
  })

  it('applies to plans too, offering the status line for a plan match', async () => {
    await cmdCreate(os, ['knowledge', 'Migrate billing to ledger', '--subtype', 'plan', '--description', 'Move billing onto the ledger.'])
    const err = await refusal(cmdCreate(os, ['knowledge', 'Migrate billing to the new ledger', '--subtype', 'plan']))
    expect(err.message).toContain('Migrate billing to ledger (migrate-billing-to-ledger): Move billing onto the ledger.')
    expect(err.message).toContain('hafez update migrate-billing-to-ledger --status <active|done>')
    expect(err.message).toContain('hafez create knowledge "Migrate billing to the new ledger" --subtype plan --new')
  })

  it('with no synthesis the update line carries a placeholder', async () => {
    const err = await refusal(cmdCreate(os, ['knowledge', 'Webhook retry budget design']))
    expect(err.message).toContain('hafez update webhook-retry-budget --add-evidence "<evidence>"')
  })

  it('lists up to three near-matches, then the single --new line', async () => {
    for (const n of ['Webhook retry budget caps', 'Webhook retry budget jitter', 'Webhook retry budget regions']) {
      await os.create('knowledge', n, {})
    }
    const err = await refusal(cmdCreate(os, ['knowledge', 'Webhook retry budget design']))
    expect(err.message).toMatch(/^"Webhook retry budget design" near-matches 3 existing knowledge notes\. Nothing was written\.\n\nUse one of them instead:/)
    expect(err.message.match(/hafez update /g)).toHaveLength(3)
    expect(err.message.match(/--new/g)).toHaveLength(1)
  })

  it('an invalid create is rejected for what is wrong with it, not refused as a near-match', async () => {
    const err = await refusal(cmdCreate(os, ['knowledge', 'Webhook retry budget design', '--status', 'done']))
    expect(err.code).toBe('VALIDATION_FAILED')
    expect(err.message).not.toContain('near-matches')
  })

  it('an exact name collision is the plain slug-exists error, with no dead-end --new line', async () => {
    const err = await refusal(cmdCreate(os, ['knowledge', 'Webhook retry budget']))
    expect(err.code).toBe('SLUG_EXISTS')
    expect(err.message).not.toContain('--new')
  })

  it('--insight counts as the synthesis, and quoting survives shell specials', async () => {
    const err = await refusal(cmdCreate(os, ['knowledge', 'Webhook retry budget design', '--insight', 'Costs "$5" a `call`']))
    expect(err.message).toContain('--add-evidence "Costs \\"\\$5\\" a \\`call\\`"')
    expect(err.message).toContain('--insight "Costs \\"\\$5\\" a \\`call\\`" --new')
  })
})

describe('--new overrides the refusal', () => {
  it('writes the note', async () => {
    const slug = (await cmdCreate(os, ['knowledge', 'Webhook retry budget design', '--new'])).split('\n')[0]
    expect(slug).toBe('webhook-retry-budget-design')
    expect(knowledgeFiles()).toContain('webhook-retry-budget-design.md')
  })

  it('offers the near-matches it overrode as the relate line', async () => {
    const out = await cmdCreate(os, ['knowledge', 'Webhook retry budget design', '--new'])
    expect(out.split('\n')[1]).toBe('Optional, it resembles webhook-retry-budget: hafez update webhook-retry-budget-design --related webhook-retry-budget')
  })

  it('is rejected on create entity rather than dropped', async () => {
    await expect(cmdCreate(os, ['entity', 'Webhook retry budget design', '--type', 'project', '--new'])).rejects.toThrow(/--new/)
  })
})

describe('a weaker resemblance writes, then offers one relate line', () => {
  it('prints the relate line after the slug', async () => {
    const out = await cmdCreate(os, ['knowledge', 'Webhook retry jitter', '--synthesis', 'Jitter spreads retries.'])
    expect(out).toBe([
      'webhook-retry-jitter',
      'Optional, it resembles webhook-retry-budget: hafez update webhook-retry-jitter --related webhook-retry-budget',
    ].join('\n'))
    expect(knowledgeFiles()).toContain('webhook-retry-jitter.md')
  })

  it('keeps the related links the create already wrote', async () => {
    await os.create('knowledge', 'Gardening', {})
    const out = await cmdCreate(os, ['knowledge', 'Webhook retry jitter', '--related', 'gardening'])
    expect(out.split('\n')[1]).toBe('Optional, it resembles webhook-retry-budget: hafez update webhook-retry-jitter --related gardening,webhook-retry-budget')
  })

  it('never suggests a note the create already relates to', async () => {
    expect(await cmdCreate(os, ['knowledge', 'Webhook retry jitter', '--related', 'webhook-retry-budget'])).toBe('webhook-retry-jitter')
  })

  it('prints nothing more when nothing resembles', async () => {
    expect(await cmdCreate(os, ['knowledge', 'Sourdough starter'])).toBe('sourdough-starter')
  })
})

describe('entities and captures never near-match', () => {
  it('create entity writes and prints only the slug', async () => {
    expect(await cmdCreate(os, ['entity', 'Webhook retry budget design', '--type', 'project'])).toBe('webhook-retry-budget-design')
  })

  it('capture writes and prints only the slug', async () => {
    expect(await cmdCapture(os, ['Webhook retry budget design'])).toBe('webhook-retry-budget-design')
  })
})

describe('batch warns on a near-match and never refuses', () => {
  it('writes the note and prints a warning line', async () => {
    const payload = join(TMP, 'ops.json')
    writeFileSync(payload, JSON.stringify([
      { op: 'create', kind: 'knowledge', name: 'Webhook retry budget design', fields: { synthesis: 'Budgets reset hourly.' } },
    ]))
    const out = await cmdBatch(os, ['--file', payload])
    expect(knowledgeFiles()).toContain('webhook-retry-budget-design.md')
    expect(out).toBe([
      'Batch complete: 1 operations (created: webhook-retry-budget-design)',
      'Warning: op[0] create knowledge "Webhook retry budget design" near-matches webhook-retry-budget; batch writes it anyway.',
    ].join('\n'))
  })

  it('warns on a near-match between two creates in the same batch', async () => {
    const payload = join(TMP, 'ops.json')
    writeFileSync(payload, JSON.stringify([
      { op: 'create', kind: 'knowledge', name: 'Sourdough starter feeding schedule', fields: {} },
      { op: 'create', kind: 'knowledge', name: 'Sourdough starter feeding ratios', fields: {} },
    ]))
    expect(await cmdBatch(os, ['--file', payload])).toContain(
      'Warning: op[1] create knowledge "Sourdough starter feeding ratios" near-matches sourdough-starter-feeding-schedule; batch writes it anyway.',
    )
  })

  it('--dry-run prints the same warning', async () => {
    const payload = join(TMP, 'ops.json')
    writeFileSync(payload, JSON.stringify([
      { op: 'create', kind: 'knowledge', name: 'Webhook retry budget design', fields: {} },
    ]))
    expect(await cmdBatch(os, ['--dry-run', '--file', payload])).toContain(
      'Warning: op[0] create knowledge "Webhook retry budget design" near-matches webhook-retry-budget; batch writes it anyway.',
    )
    expect(knowledgeFiles()).not.toContain('webhook-retry-budget-design.md')
  })
})
