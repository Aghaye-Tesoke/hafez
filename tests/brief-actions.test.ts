// tests/brief-actions.test.ts
// Brief / Next Actions logic against the in-memory Journal — zero git in setup.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createHafez } from '../src/index.js'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createMemoryJournal } from './helpers/memory-journal.js'
import { getBrief, getNextActions } from '../src/document.js'

const TMP = join(tmpdir(), 'hafez-test-brief-actions-' + Date.now())
const VAULT = join(TMP, 'vault')

beforeAll(() => {
  mkdirSync(join(VAULT, 'entities'), { recursive: true })
  mkdirSync(join(VAULT, 'knowledge'), { recursive: true })
})

afterAll(() => rmSync(TMP, { recursive: true, force: true }))

function makeOS() {
  return createHafez({ vaultPath: VAULT, persistence: createMemoryJournal() })
}

describe('Brief via update()', () => {
  it('sets a brief on an entity', async () => {
    const os = makeOS()
    await os.create('entity', 'Brief Test Project', { type: 'project', purpose: 'Testing' })
    await os.update('brief-test-project', { brief: 'This is the handoff context.\nMultiple lines.' })

    const { body } = await os.read('brief-test-project', 'full')
    expect(body).toContain('## Brief')
    expect(body).toContain('This is the handoff context.')
    expect(body.indexOf('## Brief')).toBeLessThan(body.indexOf('## Session Log'))
  })

  it('replaces an existing brief', async () => {
    const os = makeOS()
    await os.update('brief-test-project', { brief: 'Updated brief.' })
    const { body } = await os.read('brief-test-project', 'full')
    expect(body).toContain('Updated brief.')
    expect(body).not.toContain('This is the handoff context.')
  })

  it('removes brief when set to null', async () => {
    const os = makeOS()
    await os.update('brief-test-project', { brief: null })
    const { body } = await os.read('brief-test-project', 'full')
    expect(body).not.toContain('## Brief')
  })

  it('brief appears in summary depth', async () => {
    const os = makeOS()
    await os.update('brief-test-project', { brief: 'Visible in summary.' })
    const { body } = await os.read('brief-test-project', 'summary')
    expect(body).toContain('Visible in summary.')
  })
})

describe('Next Actions via update()', () => {
  it('adds a next action', async () => {
    const os = makeOS()
    await os.create('entity', 'Actions Test Project', { type: 'project' })
    await os.update('actions-test-project', { add_action: 'Deploy to VPS @dev' })

    const { body } = await os.read('actions-test-project', 'full')
    expect(body).toContain('## Next Actions')
    expect(body).toContain('- [ ] Deploy to VPS @dev')
  })

  it('adds multiple actions', async () => {
    const os = makeOS()
    await os.update('actions-test-project', { add_action: 'Test /start command @simorgh' })
    const { body } = await os.read('actions-test-project', 'full')
    expect(body).toContain('Deploy to VPS @dev')
    expect(body).toContain('Test /start command @simorgh')
  })

  it('completes an action by substring', async () => {
    const os = makeOS()
    const result = await os.update('actions-test-project', { complete_action: 'Deploy' })
    expect(result).toStrictEqual({ completed_action: 'Deploy to VPS @dev' })
    const { body } = await os.read('actions-test-project', 'full')
    expect(body).not.toContain('- [ ] Deploy to VPS @dev')
    expect(body).toContain('Test /start command @simorgh')
  })

  it('removes an action', async () => {
    const os = makeOS()
    const result = await os.update('actions-test-project', { remove_action: '/start' })
    expect(result).toStrictEqual({ removed_action: 'Test /start command @simorgh' })
    const { body } = await os.read('actions-test-project', 'full')
    expect(body).not.toContain('## Next Actions') // last item removed, section gone
  })

  it('complete_action leaves an action line quoted in the Brief untouched', async () => {
    const os = makeOS()
    await os.create('entity', 'Quoted Action Project', { type: 'project' })
    await os.update('quoted-action-project', { add_action: 'Ship the release @dev' })
    await os.update('quoted-action-project', { add_action: 'Keep me @dev' })
    await os.update('quoted-action-project', { brief: 'Blocked on:\n- [ ] Ship the release @dev' })

    const result = await os.update('quoted-action-project', { complete_action: 'Ship the release' })
    expect(result.completed_action).toBe('Ship the release @dev')

    const { body } = await os.read('quoted-action-project', 'full')
    expect(getBrief(body)).toBe('Blocked on:\n- [ ] Ship the release @dev')
    expect(getNextActions(body)).toEqual(['Keep me @dev'])
    expect(body).toContain('- [x] Ship the release @dev')
  })

  it('remove_action deletes only the Next Actions line, not the Brief copy', async () => {
    const os = makeOS()
    const result = await os.update('quoted-action-project', { remove_action: 'Keep me' })
    expect(result.removed_action).toBe('Keep me @dev')

    const { body } = await os.read('quoted-action-project', 'full')
    expect(getBrief(body)).toBe('Blocked on:\n- [ ] Ship the release @dev')
  })

  it('clear_actions removes entire section', async () => {
    const os = makeOS()
    await os.update('actions-test-project', { add_action: 'Action 1 @dev' })
    await os.update('actions-test-project', { add_action: 'Action 2 @dev' })
    await os.update('actions-test-project', { clear_actions: true })
    const { body } = await os.read('actions-test-project', 'full')
    expect(body).not.toContain('## Next Actions')
  })
})

// The five Next Actions fields all touch one section, so their order within
// an op is their meaning: prune, tick, add. Queries see the pre-op list;
// added lines land last. (#22, #23)
describe('Next Actions fields composing in one update()', () => {
  it('clear_actions then add_actions in one op yields only the new list', async () => {
    const os = makeOS()
    await os.create('entity', 'Compose Project', { type: 'project' })
    await os.update('compose-project', { add_actions: ['Old 1 @dev', 'Old 2 @dev'] })
    await os.update('compose-project', { clear_actions: true, add_actions: ['New 1 @dev', 'New 2 @dev'] })
    const { body } = await os.read('compose-project', 'full')
    expect(getNextActions(body)).toEqual(['New 1 @dev', 'New 2 @dev'])
  })

  it('remove_action never matches a line the same op adds', async () => {
    // The query overlaps the replacement text: matched against the post-add
    // list it would have hit the new line (and been ambiguous, or worse, the
    // only match).
    const os = makeOS()
    await os.update('compose-project', { clear_actions: true, add_actions: ['Ship it @dev'] })
    const result = await os.update('compose-project', { remove_action: 'Ship', add_actions: ['Ship the fix @dev'] })
    expect(result).toStrictEqual({ removed_action: 'Ship it @dev' })
    const { body } = await os.read('compose-project', 'full')
    expect(getNextActions(body)).toEqual(['Ship the fix @dev'])
  })

  it('completing the last open line and adding the next one edits the section in place', async () => {
    // The tick empties the open list, but the section is pruned only after
    // the add — so it is never removed and recreated: the checked line stays
    // and the section keeps its slot above Current State.
    const os = makeOS()
    await os.update('compose-project', { current_state: 'Mid-flight' })
    const result = await os.update('compose-project', { complete_action: 'the fix', add_action: 'Announce @dev' })
    expect(result).toStrictEqual({ completed_action: 'Ship the fix @dev' })
    const { body } = await os.read('compose-project', 'full')
    expect(getNextActions(body)).toEqual(['Announce @dev'])
    expect(body).toContain('- [x] Ship the fix @dev')
    expect(body.indexOf('## Next Actions')).toBeLessThan(body.indexOf('## Current State'))
  })

  it('remove_action and complete_action naming the same line is an error, not an overwrite', async () => {
    const os = makeOS()
    const before = (await os.read('compose-project', 'full')).body
    await expect(os.update('compose-project', { remove_action: 'Announce', complete_action: 'announce' }))
      .rejects.toThrow(/both match "Announce @dev"/)
    expect((await os.read('compose-project', 'full')).body).toBe(before)
  })

  // #131: a misuse, so VALIDATION_FAILED (exit 2, the CLI's Footer), and
  // localised to its op in a batch like the other query errors.
  it('the same-line collision is VALIDATION_FAILED, op-localised in a batch', async () => {
    const os = makeOS()
    const before = (await os.read('compose-project', 'full')).body
    await expect(os.update('compose-project', { remove_action: 'Announce', complete_action: 'announce' }))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    await expect(os.batch([{ op: 'update', slug: 'compose-project', fields: { remove_action: 'Announce', complete_action: 'announce' } }]))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: expect.stringMatching(/^op\[0\] \(update compose-project\): remove_action and complete_action both match "Announce @dev"/) })
    expect((await os.read('compose-project', 'full')).body).toBe(before)
  })

  it('complete_action is matched against the pre-op list, not the post-remove one', async () => {
    // 'Announce' + 'Announce again': removing the second first would leave
    // 'Announce' unique, ticking a line the caller never named. Pre-op the
    // query is ambiguous, so the op is rejected and nothing is written.
    const os = makeOS()
    await os.update('compose-project', { add_action: 'Announce again @dev' })
    const before = (await os.read('compose-project', 'full')).body
    await expect(os.update('compose-project', { remove_action: 'again', complete_action: 'Announce' }))
      .rejects.toThrow(/Ambiguous match for "Announce"/)
    expect((await os.read('compose-project', 'full')).body).toBe(before)
    await os.update('compose-project', { remove_action: 'again' })
  })

  it('complete_action and remove_action on distinct lines each report their own match', async () => {
    const os = makeOS()
    await os.update('compose-project', { add_actions: ['Tick me @dev', 'Prune me @dev'] })
    const result = await os.update('compose-project', { complete_action: 'Tick', remove_action: 'Prune' })
    expect(result).toStrictEqual({ completed_action: 'Tick me @dev', removed_action: 'Prune me @dev' })
    const { body } = await os.read('compose-project', 'full')
    expect(getNextActions(body)).toEqual(['Announce @dev'])
    expect(body).toContain('- [x] Tick me @dev')
    expect(body).not.toContain('Prune me')
  })

  it('clear_actions with a query field is rejected before anything is written', async () => {
    const os = makeOS()
    const before = (await os.read('compose-project', 'full')).body
    await expect(os.update('compose-project', { clear_actions: true, remove_action: 'Announce' }))
      .rejects.toThrow(/clear_actions empties the list before remove_action/)
    await expect(os.update('compose-project', { clear_actions: true, complete_action: 'Announce', remove_action: 'x' }))
      .rejects.toThrow(/before remove_action and complete_action/)
    expect((await os.read('compose-project', 'full')).body).toBe(before)
  })

  it('the clear+query rejection is not stacked on a target that cannot hold the fields', async () => {
    // On a knowledge note the fields themselves are rejected; a second error
    // about their order would be noise about a section the note cannot have.
    const os = makeOS()
    await os.create('knowledge', 'Compose Note', {})
    const { operations: [v] } = await os.validateBatch([{ op: 'update', slug: 'compose-note', fields: { clear_actions: true, complete_action: 'x' } }])
    expect(v.errors).toHaveLength(1)
    expect(v.errors[0]).toMatch(/entity-only fields/)
  })

  it('a query result carries no key for the query that was not sent', async () => {
    const os = makeOS()
    const result = await os.update('compose-project', { add_action: 'Plain add @dev' })
    expect(result).toStrictEqual({})
  })

  // #158: the array forms of the two query fields.
  describe('complete_actions / remove_actions', () => {
    it('apply every query against the pre-op list and report each match in query order', async () => {
      const os = makeOS()
      await os.create('entity', 'Arrays Project', { type: 'project', add_actions: ['A1', 'B2', 'C3', 'D4', 'E5', 'F6'] })
      const result = await os.update('arrays-project', { remove_action: 'E5', remove_actions: ['D4', 'A1'], complete_actions: ['C3', 'B2'] })
      expect(result).toStrictEqual({ removed_action: 'E5', removed_actions: ['D4', 'A1'], completed_actions: ['C3', 'B2'] })
      const { body } = await os.read('arrays-project', 'full')
      expect(getNextActions(body)).toEqual(['F6'])
      expect(body.match(/^- \[x\] .*$/gm)?.map(l => l.replace(/ \(added .*\)$/, ''))).toEqual(['- [x] B2', '- [x] C3'])
    })

    it('batch accepts them; a field outside the shape is still rejected', async () => {
      const os = makeOS()
      await os.create('entity', 'Arrays Batch', { type: 'project', add_actions: ['Keep', 'Go', 'Done'] })
      await os.batch([{ op: 'update', slug: 'arrays-batch', fields: { remove_actions: ['Go'], complete_actions: ['Done'] } }])
      const { body } = await os.read('arrays-batch', 'full')
      expect(getNextActions(body)).toEqual(['Keep'])
      expect(body).toContain('- [x] Done')
      await expect(os.update('arrays-batch', { complete_action_list: ['Keep'] } as never)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    })

    it('an update of the array forms alone writes no mechanised session log entry', async () => {
      const os = makeOS()
      await os.create('entity', 'Arrays Unlogged', { type: 'project', add_actions: ['One', 'Two', 'Three'] })
      const before = (await os.read('arrays-unlogged', 'full')).body.match(/^### /gm)?.length ?? 0
      await os.update('arrays-unlogged', { complete_actions: ['One'], remove_actions: ['Two'] })
      const after = (await os.read('arrays-unlogged', 'full')).body.match(/^### /gm)?.length ?? 0
      expect(after).toBe(before)
    })

    const COLLISIONS: Array<[string, Record<string, unknown>, RegExp]> = [
      ['inside one array', { remove_actions: ['Alpha', 'alpha'] }, /remove_actions matches "Alpha line" twice/],
      ['across singular and array', { complete_action: 'Alpha', complete_actions: ['alpha'] }, /complete_action and complete_actions both match "Alpha line"/],
      ['across remove and complete arrays', { remove_actions: ['Alpha'], complete_actions: ['alpha'] }, /remove_actions and complete_actions both match "Alpha line"/],
    ]
    for (const [what, fields, error] of COLLISIONS) {
      it(`two queries naming one line ${what} fail and write nothing`, async () => {
        const os = makeOS()
        const slug = await os.create('entity', `Arrays Collide ${what}`, { type: 'project', add_actions: ['Alpha line', 'Beta line'] })
        const before = (await os.read(slug, 'full')).body
        await expect(os.update(slug, fields)).rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: expect.stringMatching(error) })
        expect((await os.read(slug, 'full')).body).toBe(before)
      })
    }

    it('clear_actions with an array query field is rejected', async () => {
      const os = makeOS()
      await os.create('entity', 'Arrays Clear', { type: 'project', add_actions: ['Keep'] })
      await expect(os.update('arrays-clear', { clear_actions: true, remove_actions: ['Keep'] }))
        .rejects.toThrow(/clear_actions empties the list before remove_actions/)
      await expect(os.update('arrays-clear', { clear_actions: true, remove_action: 'a', remove_actions: ['b'], complete_actions: ['c'] }))
        .rejects.toThrow(/before remove_action, remove_actions and complete_actions would run/)
    })

    it('an empty array is rejected by the shape, not committed as a no-op', async () => {
      const os = makeOS()
      await os.create('entity', 'Arrays Empty', { type: 'project', add_actions: ['Keep'] })
      const before = (await os.read('arrays-empty', 'full')).body
      for (const fields of [{ complete_actions: [] }, { remove_actions: [] }, { clear_actions: true, remove_actions: [] }]) {
        await expect(os.update('arrays-empty', fields)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
      }
      expect((await os.read('arrays-empty', 'full')).body).toBe(before)
    })
  })
})

describe('Next Actions on create (add_actions parity with update)', () => {
  // Seeding a project with N actions used to force create + follow-up
  // update, because create only accepted single add_action.
  it('create() accepts add_actions array', async () => {
    const os = makeOS()
    await os.create('entity', 'Seeded Project', {
      type: 'project',
      add_actions: ['First task @dev', 'Second task @dev', 'Third task @dev'],
    })
    const { body } = await os.read('seeded-project', 'full')
    expect(body).toContain('- [ ] First task @dev')
    expect(body).toContain('- [ ] Second task @dev')
    expect(body).toContain('- [ ] Third task @dev')
  })

  it('batch create accepts add_actions array', async () => {
    const os = makeOS()
    await os.batch([
      { op: 'create', kind: 'entity', name: 'Batch Seeded Project', fields: {
        type: 'project',
        add_action: 'Single one @dev',
        add_actions: ['Array one @dev', 'Array two @dev'],
      } },
    ])
    const { body } = await os.read('batch-seeded-project', 'full')
    expect(body).toContain('- [ ] Single one @dev')
    expect(body).toContain('- [ ] Array one @dev')
    expect(body).toContain('- [ ] Array two @dev')
  })
})

describe('Query with body-parsed next actions', () => {
  it('query returns first unchecked action and count', async () => {
    const os = makeOS()
    await os.create('entity', 'Query Actions Test', { type: 'project' })
    await os.update('query-actions-test', { add_action: 'First action @dev' })
    await os.update('query-actions-test', { add_action: 'Second action @simorgh' })

    const { items: results } = await os.query({ filter: 'active', type: 'project' })
    const item = results.find(r => r.slug === 'query-actions-test')
    expect(item).toBeDefined()
    expect(item!.next_action).toBe('First action @dev')
    expect(item!.next_action_count).toBe(2)
  })

  it('query returns null next_action when no actions section', async () => {
    const os = makeOS()
    await os.create('entity', 'No Actions Entity', { type: 'project' })
    const { items: results } = await os.query({ filter: 'active', type: 'project' })
    const item = results.find(r => r.slug === 'no-actions-entity')
    expect(item).toBeDefined()
    expect(item!.next_action).toBeNull()
    expect(item!.next_action_count).toBe(0)
  })
})

describe('Brief and Next Actions via create()', () => {
  it('creates entity with brief', async () => {
    const os = makeOS()
    await os.create('entity', 'Create Brief Test', { type: 'project', brief: 'Initial handoff context.' })
    const { body } = await os.read('create-brief-test', 'full')
    expect(body).toContain('## Brief')
    expect(body).toContain('Initial handoff context.')
  })

  it('creates entity with add_action', async () => {
    const os = makeOS()
    await os.create('entity', 'Create Action Test', { type: 'project', add_action: 'First task @dev' })
    const { body } = await os.read('create-action-test', 'full')
    expect(body).toContain('## Next Actions')
    expect(body).toContain('- [ ] First task @dev')
  })

  it('creates entity with both brief and add_action', async () => {
    const os = makeOS()
    await os.create('entity', 'Create Both Test', { type: 'project', brief: 'Context here.', add_action: 'Do something @dev' })
    const { body } = await os.read('create-both-test', 'full')
    expect(body).toContain('## Brief')
    expect(body).toContain('Context here.')
    expect(body).toContain('## Next Actions')
    expect(body).toContain('- [ ] Do something @dev')
    // Brief should come before Next Actions
    expect(body.indexOf('## Brief')).toBeLessThan(body.indexOf('## Next Actions'))
  })
})

describe('Batch with Brief and Next Actions', () => {
  it('batch update sets brief and adds action', async () => {
    const os = makeOS()
    await os.create('entity', 'Batch Test', { type: 'project' })
    await os.batch([
      { op: 'update', slug: 'batch-test', fields: { brief: 'Batch brief content.' } },
      { op: 'update', slug: 'batch-test', fields: { add_action: 'Batch action @dev' } },
    ])
    const { body } = await os.read('batch-test', 'full')
    expect(body).toContain('## Brief')
    expect(body).toContain('Batch brief content.')
    expect(body).toContain('- [ ] Batch action @dev')
  })

  it('batch create with brief and add_action persists both', async () => {
    const os = makeOS()
    await os.batch([
      { op: 'create', kind: 'entity', name: 'Batch Create Fields', fields: {
        type: 'project', brief: 'Batch brief.', add_action: 'Batch task @dev',
      } },
    ])
    const { body } = await os.read('batch-create-fields', 'full')
    expect(body).toContain('## Brief')
    expect(body).toContain('Batch brief.')
    expect(body).toContain('- [ ] Batch task @dev')
  })

  it('batch create then update same entity in one batch', async () => {
    const os = makeOS()
    await os.batch([
      { op: 'create', kind: 'entity', name: 'Batch Chain Test', fields: { type: 'project' } },
      { op: 'update', slug: 'batch-chain-test', fields: { add_action: 'Chained action @dev' } },
    ])
    const { body } = await os.read('batch-chain-test', 'full')
    expect(body).toContain('- [ ] Chained action @dev')
  })

  it('batch returns results with created slugs', async () => {
    const os = makeOS()
    const results = await os.batch([
      { op: 'create', kind: 'entity', name: 'Result Test One', fields: { type: 'entity' } },
      { op: 'update', slug: 'result-test-one', fields: { brief: 'Updated.' } },
    ])
    expect(results).toHaveLength(2)
    expect(results[0]).toEqual({ op: 'create', slug: 'result-test-one', status: 'ok', created: true })
    expect(results[1]).toEqual({ op: 'update', slug: 'result-test-one', status: 'ok' })
  })
})
