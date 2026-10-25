// tests/surfaces.test.ts
//
// Drift checks 1 and 2 of the Agent Contract (docs/agent-contract/README.md,
// "Drift checks"). Check 1: every committed surface file equals a re-render
// from the one source — the Block, the two skill files, every sample under
// tests/fixtures/surfaces/ (the command functions against the fixture vault in
// tests/helpers/surface-samples.ts, on the sample day), `help --agent`, and
// the contract README's owner table.
// Check 2: the typed Item table — every Item has an Owner and an evidence
// pointer, and is placed once in its Owner and at most once in its declared
// fallback, nowhere else. Re-render with `npx tsx scripts/render-surfaces.ts`.

import { describe, it, expect, beforeAll } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { ITEMS, type Item } from '../src/surfaces/items.js'
import {
  SURFACES,
  contentHash,
  itemProblems,
  renderAgentHelp,
  renderBlock,
  renderHafezSkill,
  renderHafezSaveSkill,
  renderOwnerTable,
  spliceOwnerTable,
  OWNER_TABLE_BEGIN,
  OWNER_TABLE_END,
} from '../src/surfaces/surfaces.js'
import { SURFACE_FILES, renderSurfaceFiles, type SurfaceFile } from './helpers/surface-samples.js'

// The contract lives under docs/, which never ships (tools/overlay.sh
// PRIVATE_PATHS): its owner-table check runs only where the file exists.
const CONTRACT = 'docs/agent-contract/README.md'

describe('drift check 1: every committed surface file equals its render', () => {
  let rendered: Record<SurfaceFile, string>
  beforeAll(async () => {
    rendered = await renderSurfaceFiles()
  }, 30_000)

  it.each(SURFACE_FILES)('%s', path => {
    expect(rendered[path]).toBe(readFileSync(path, 'utf-8'))
  })

  it('help --agent is the hafez skill body: the text after the frontmatter, less the blank line that parts them', () => {
    const skill = readFileSync('skill/hafez/SKILL.md', 'utf-8')
    const body = skill.slice(skill.indexOf('\n---\n', 4) + '\n---\n'.length)
    expect(`\n${renderAgentHelp()}\n`).toBe(body)
  })

  it.skipIf(!existsSync(CONTRACT))('the contract README owner table sits between markers and equals the render', () => {
    const readme = readFileSync(CONTRACT, 'utf-8')
    expect(readme).toContain(OWNER_TABLE_BEGIN)
    expect(readme).toContain(OWNER_TABLE_END)
    expect(spliceOwnerTable(readme)).toBe(readme)
  })
})

describe('hash rules', () => {
  it('the Block marker hashes the text between the two marker lines', () => {
    const block = renderBlock()
    const [first, ...rest] = block.split('\n')
    const inner = rest.join('\n').replace(/<!-- hafez:end -->\n$/, '')
    expect(first).toBe(`<!-- hafez:begin ${contentHash(inner)} -->`)
    expect(contentHash(inner)).toMatch(/^[0-9a-f]{12}$/)
  })

  it('a skill file hashes everything after the closing --- of its frontmatter', () => {
    for (const skill of [renderHafezSkill(), renderHafezSaveSkill()]) {
      const close = skill.indexOf('\n---\n', 4)
      const body = skill.slice(close + '\n---\n'.length)
      expect(skill.slice(0, close)).toContain(`\nhash: ${contentHash(body)}`)
    }
  })
})

describe('owner table render', () => {
  it('has one row per Item, in table order', () => {
    const rows = renderOwnerTable().trimEnd().split('\n').slice(2)
    expect(rows).toHaveLength(Object.keys(ITEMS).length)
    expect(rows[0]).toContain(ITEMS.loadTriggers.label)
  })

  it('splicing replaces only the marked region', () => {
    const doc = `before\n${OWNER_TABLE_BEGIN}\nstale\n${OWNER_TABLE_END}\nafter\n`
    expect(spliceOwnerTable(doc)).toBe(
      `before\n${OWNER_TABLE_BEGIN}\n${renderOwnerTable()}${OWNER_TABLE_END}\nafter\n`,
    )
  })
})

describe('drift check 2: the typed Item table', () => {
  it('the shipped table has no problems', () => {
    expect(itemProblems(ITEMS, SURFACES)).toEqual([])
  })

  it('every Item the binary renders has a render function', () => {
    for (const [id, item] of Object.entries(ITEMS) as Array<[string, Item]>) {
      const binary = SURFACES[item.owner].compose === undefined
      // Two binary Items carry neither text nor render: the session log on
      // update is behaviour, and `schema` output is the Op Spec's own.
      if (binary && !['sessionLogOnUpdate', 'opShape'].includes(id)) {
        expect(typeof item.render, `${id} has no render`).toBe('function')
      }
    }
  })

  const base: Item = {
    label: 'x', owner: 'block', invokeOnly: 'same', evidence: 'L1', text: 'x',
  }
  const blockOnly = (compose: (place: (id: string) => string) => string) => ({
    block: { label: 'Block', compose },
    hafezSkillBody: { label: '`hafez` skill body', compose: () => '' },
  })

  it('fails an Item with no Owner', () => {
    const items = { x: { ...base, owner: undefined as unknown as Item['owner'] } }
    expect(itemProblems(items, blockOnly(p => p('x')))).toContainEqual(expect.stringMatching(/x: no owner/))
  })

  it('fails an Item with no evidence pointer', () => {
    const items = { x: { ...base, evidence: ' ' } }
    expect(itemProblems(items, blockOnly(p => p('x')))).toContainEqual(expect.stringMatching(/x: no evidence/))
  })

  it('fails an Item placed twice in its Owner', () => {
    expect(itemProblems({ x: base }, blockOnly(p => p('x') + p('x'))))
      .toContainEqual(expect.stringMatching(/x: placed 2 times in block/))
  })

  it('fails an Item placed in a surface that is neither its Owner nor its fallback', () => {
    const surfaces = {
      block: { label: 'Block', compose: (p: (id: string) => string) => p('x') },
      hafezSkillBody: { label: '`hafez` skill body', compose: (p: (id: string) => string) => p('x') },
    }
    expect(itemProblems({ x: base }, surfaces))
      .toContainEqual(expect.stringMatching(/x: placed in hafezSkillBody, which is neither its owner nor its fallback/))
  })

  it('allows the Owner plus one declared fallback placement', () => {
    const surfaces = {
      block: { label: 'Block', compose: (p: (id: string) => string) => p('x') },
      hafezSkillBody: { label: '`hafez` skill body', compose: (p: (id: string) => string) => p('x') },
    }
    expect(itemProblems({ x: { ...base, fallback: 'hafezSkillBody' } }, surfaces)).toEqual([])
  })

  it('fails an Item its static fallback never places', () => {
    expect(itemProblems({ x: { ...base, fallback: 'hafezSkillBody' } }, blockOnly(p => p('x'))))
      .toContainEqual(expect.stringMatching(/x: not placed in its fallback hafezSkillBody/))
  })

  it('fails on duplicated owner table markers', () => {
    const region = `${OWNER_TABLE_BEGIN}\n${OWNER_TABLE_END}\n`
    expect(() => spliceOwnerTable(region + region)).toThrow(/more than once/)
  })

  it('fails an Item its Owner never places', () => {
    expect(itemProblems({ x: base }, blockOnly(() => ''))).toContainEqual(expect.stringMatching(/x: not placed in its owner block/))
  })
})

describe('the read miss render', () => {
  it('places the Block\'s create Item render, filled with the miss as a name', () => {
    const out = ITEMS.slugMissRecovery.render({ slug: 'Auth Refactor', closest: [] })
    expect(out.split('\n').at(-1)).toBe(ITEMS.createLines.render('auth refactor'))
    expect(renderBlock()).toContain(ITEMS.createLines.render('<name>'))
  })

  it('names the miss as typed, and searches and creates under its slug words', () => {
    expect(ITEMS.slugMissRecovery.render({ slug: 'Auth Refactor', closest: [] }).split('\n').slice(0, 2)).toEqual([
      "Error: no entity or knowledge note 'Auth Refactor'.",
      'hafez search "auth refactor"',
    ])
  })

  it('a miss with no word in it is the miss line alone', () => {
    expect(ITEMS.slugMissRecovery.render({ slug: '!!!', closest: [] })).toBe("Error: no entity or knowledge note '!!!'.")
  })
})

describe('the parent description render', () => {
  it('is the slug with the description in brackets, or the slug alone', () => {
    expect(ITEMS.parentDescription.render({ slug: 'platform', description: 'Shared services' })).toBe('platform (Shared services)')
    expect(ITEMS.parentDescription.render({ slug: 'platform', description: null })).toBe('platform')
  })
})

describe('the workstream fact line render', () => {
  it('states the open count and the family, a fact and not a command', () => {
    expect(ITEMS.workstreamLine.render({ prefix: 'QUEUE', open_actions: 7 })).toBe('workstream: 7 open actions with `QUEUE`; no child named it')
    expect(ITEMS.workstreamLine.render({ prefix: 'CHECK', open_actions: 1 })).toBe('workstream: 1 open action with `CHECK`; no child named it')
  })
})

describe('the health procedure (#248)', () => {
  it('is in the rendered hafez skill: run with --json, propose by kind, apply nothing unconfirmed', () => {
    const skill = renderHafezSkill()
    const text = ITEMS.healthProcedure.text
    expect(skill).toContain(text)
    expect(text).toContain('hafez health --json')
    expect(text).toContain('hafez batch')
    expect(text).toMatch(/Apply nothing until the user/)
  })
  it('the skill description names the vault check', () => {
    expect(renderHafezSkill().split('\n---\n')[0]).toContain('check the vault')
  })
})
