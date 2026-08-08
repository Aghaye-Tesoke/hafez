import { describe, it, expect } from 'vitest'
import { getContract, ALL_CONTRACTS, hasCapability, ENTITY_STATUSES, sectionsFor } from '../src/contracts.js'
import { validateEntityFrontmatter, validateKnowledgeFrontmatter } from '../src/schema.js'

describe('contracts', () => {
  it('returns capture contract', () => {
    const c = getContract('capture')
    expect(c.type).toBe('capture')
    expect(c.kind).toBe('item')
    expect(c.validStatuses).toEqual(['active', 'done'])
    expect(c.canPromoteTo).toContain('entity')
    expect(c.canPromoteTo).toContain('project')
    expect(c.canPromoteTo).toContain('knowledge')
  })

  it('returns entity contract', () => {
    const c = getContract('entity')
    expect(c.type).toBe('entity')
    expect(c.kind).toBe('item')
    expect(c.validStatuses).toEqual(['active', 'paused', 'done'])
    expect(c.defaultSections).toContain('Context')
    expect(c.defaultSections).toContain('Session Log')
    expect(c.canPromoteTo).toEqual(['project'])
  })

  it('returns project contract', () => {
    const c = getContract('project')
    expect(c.kind).toBe('item')
    expect(c.defaultSections).toContain('Purpose')
    expect(c.defaultSections).toContain('Goals')
    expect(c.canPromoteTo).toEqual([])
  })

  it('returns knowledge contract', () => {
    const c = getContract('knowledge')
    expect(c.kind).toBe('knowledge')
    expect(c.canPromoteTo).toEqual([])
  })

  it('throws on invalid type', () => {
    expect(() => getContract('thread' as any)).toThrow()
  })

  it('hasCapability checks optional sections', () => {
    expect(hasCapability('entity', 'Next Actions')).toBe(true)
    expect(hasCapability('capture', 'Next Actions')).toBe(true)
    expect(hasCapability('capture', 'Goals')).toBe(false)
    expect(hasCapability('project', 'Goals')).toBe(true)
  })

  it('exports all 4 contracts', () => {
    expect(ALL_CONTRACTS).toHaveLength(4)
    const types = ALL_CONTRACTS.map(c => c.type)
    expect(types).toEqual(['capture', 'entity', 'project', 'knowledge'])
  })
})

// requiredFields/validStatuses are declarative data; schema.ts is the code
// that enforces them. Nothing derives one from the other, so these pin them
// together — a field added to a contract without a validator (or the reverse)
// fails here instead of shipping as a contract the vault does not keep.
describe('contract ↔ validator parity', () => {
  const validEntity = () => ({
    name: 'Thing', type: 'entity', status: 'active',
    created: '2026-01-01', 'last-touched': '2026-01-01',
  })

  it('the entity validator rejects every field the item contracts call required', () => {
    expect(validateEntityFrontmatter(validEntity())).toEqual([])
    for (const field of getContract('entity').requiredFields) {
      const fm = validEntity() as Record<string, any>
      delete fm[field]
      expect(validateEntityFrontmatter(fm).length, `missing ${field} went unreported`).toBeGreaterThan(0)
    }
  })

  it('all three item types declare the same required frontmatter', () => {
    const item = ALL_CONTRACTS.filter(c => c.kind === 'item')
    for (const c of item) expect(c.requiredFields, c.type).toEqual(item[0].requiredFields)
  })

  it('the knowledge validator rejects every field the knowledge contract calls required', () => {
    const valid = { name: 'Note', created: '2026-01-01' }
    expect(validateKnowledgeFrontmatter(valid)).toEqual([])
    for (const field of getContract('knowledge').requiredFields) {
      const fm = { ...valid } as Record<string, any>
      delete fm[field]
      expect(validateKnowledgeFrontmatter(fm).length, `missing ${field} went unreported`).toBeGreaterThan(0)
    }
  })

  it('every item contract status is drawn from the canonical status tuple', () => {
    for (const c of ALL_CONTRACTS.filter(c => c.kind === 'item')) {
      for (const s of c.validStatuses) expect(ENTITY_STATUSES, c.type).toContain(s)
    }
  })

  it('hasCapability and sectionsFor answer from the same section set', () => {
    for (const c of ALL_CONTRACTS) {
      const sections = c.kind === 'knowledge'
        ? sectionsFor({ kind: 'knowledge' })
        : sectionsFor({ kind: 'entity', type: c.type })
      for (const s of sections) expect(hasCapability(c.type, s), `${c.type}/${s}`).toBe(true)
      expect(hasCapability(c.type, 'Nonexistent Section')).toBe(false)
    }
  })
})
