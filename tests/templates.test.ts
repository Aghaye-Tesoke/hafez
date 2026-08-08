import { describe, it, expect } from 'vitest'
import { bodyTemplate, knowledgeBodyTemplate, sessionBodyTemplate } from '../src/templates.js'
import { ALL_CONTRACTS, SUBTYPE_SECTIONS, SESSION_SECTIONS, getContract, sectionsFor } from '../src/contracts.js'
import type { EntityType, KnowledgeSubtype } from '../src/types.js'

const headings = (body: string) =>
  body.split('\n').filter(l => l.startsWith('## ')).map(l => l.slice(3))

describe('bodyTemplate', () => {
  it('capture: renders Notes section', () => {
    const result = bodyTemplate('capture')
    expect(result).toContain('## Notes')
  })

  it('capture: injects notes field content', () => {
    const result = bodyTemplate('capture', { notes: 'quick thought' })
    expect(result).toContain('## Notes')
    expect(result).toContain('quick thought')
  })

  it('entity: renders Context and Session Log sections', () => {
    const result = bodyTemplate('entity')
    expect(result).toContain('## Context')
    expect(result).toContain('## Session Log')
  })

  it('entity: does not inject notes into Context', () => {
    const result = bodyTemplate('entity', { notes: 'should not appear' })
    expect(result).not.toContain('should not appear')
  })

  it('project: renders Purpose, Goals, Session Log sections', () => {
    const result = bodyTemplate('project')
    expect(result).toContain('## Purpose')
    expect(result).toContain('## Goals')
    expect(result).toContain('## Session Log')
  })

  it('project: injects purpose field content', () => {
    const result = bodyTemplate('project', { purpose: 'to build something great' })
    expect(result).toContain('## Purpose')
    expect(result).toContain('to build something great')
  })

  it('project: sections appear in order: Purpose, Goals, Session Log', () => {
    const result = bodyTemplate('project')
    const purposeIdx = result.indexOf('## Purpose')
    const goalsIdx = result.indexOf('## Goals')
    const logIdx = result.indexOf('## Session Log')
    expect(purposeIdx).toBeLessThan(goalsIdx)
    expect(goalsIdx).toBeLessThan(logIdx)
  })
})

describe('knowledgeBodyTemplate', () => {
  it('defaults to insight subtype when none given', () => {
    const result = knowledgeBodyTemplate()
    expect(result).toContain('## Synthesis')
    expect(result).toContain('## Evidence')
    expect(result).toContain('## Sources')
  })

  it('insight: renders Synthesis, Evidence, and Sources sections', () => {
    const result = knowledgeBodyTemplate('insight')
    expect(result).toContain('## Synthesis')
    expect(result).toContain('## Evidence')
    expect(result).toContain('## Sources')
  })

  it('insight: does not render ## Insight heading', () => {
    const result = knowledgeBodyTemplate('insight')
    expect(result).not.toContain('## Insight')
  })

  it('produces Synthesis section for insight subtype', () => {
    const body = knowledgeBodyTemplate('insight', { synthesis: 'Test content' })
    expect(body).toContain('## Synthesis')
    expect(body).toContain('Test content')
    expect(body).not.toContain('## Insight')
  })

  it('produces Sources section for insight subtype', () => {
    const body = knowledgeBodyTemplate('insight')
    expect(body).toContain('## Sources')
  })

  it('insight: injects synthesis field content', () => {
    const result = knowledgeBodyTemplate('insight', { synthesis: 'key learning here' })
    expect(result).toContain('## Synthesis')
    expect(result).toContain('key learning here')
  })

  it('session subtype throws error', () => {
    expect(() => knowledgeBodyTemplate('session' as any)).toThrow("subtype 'session' is no longer supported")
  })

  it('plan: renders Goal, Steps, Dependencies sections', () => {
    const result = knowledgeBodyTemplate('plan')
    expect(result).toContain('## Goal')
    expect(result).toContain('## Steps')
    expect(result).toContain('## Dependencies')
  })
})

// The templates render the contracts' section lists rather than restating
// them. These lock that in both directions: a contract change must move the
// template, and a template change must not invent a section no contract has.
describe('template ↔ contract parity', () => {
  it('every item template is exactly its contract defaultSections, in order', () => {
    for (const contract of ALL_CONTRACTS.filter(c => c.kind === 'item')) {
      const rendered = headings(bodyTemplate(contract.type as EntityType))
      expect(rendered, `template for ${contract.type}`).toEqual(contract.defaultSections)
    }
  })

  it('every knowledge template is exactly its subtype section list, in order', () => {
    for (const [subtype, sections] of Object.entries(SUBTYPE_SECTIONS)) {
      const rendered = headings(knowledgeBodyTemplate(subtype as KnowledgeSubtype))
      expect(rendered, `template for subtype ${subtype}`).toEqual(sections)
    }
    // The no-subtype default renders the insight body
    expect(headings(knowledgeBodyTemplate())).toEqual(SUBTYPE_SECTIONS.insight)
  })

  it('no template renders a section its contract does not declare', () => {
    for (const contract of ALL_CONTRACTS.filter(c => c.kind === 'item')) {
      const declared = sectionsFor({ kind: 'entity', type: contract.type })
      for (const h of headings(bodyTemplate(contract.type as EntityType))) {
        expect(declared, `${contract.type} renders undeclared "${h}"`).toContain(h)
      }
    }
    for (const subtype of Object.keys(SUBTYPE_SECTIONS) as KnowledgeSubtype[]) {
      const declared = sectionsFor({ kind: 'knowledge', subtype })
      for (const h of headings(knowledgeBodyTemplate(subtype))) {
        expect(declared, `subtype ${subtype} renders undeclared "${h}"`).toContain(h)
      }
    }
  })

  it('the session template is exactly SESSION_SECTIONS, in order', () => {
    expect(headings(sessionBodyTemplate())).toEqual([...SESSION_SECTIONS])
  })

  it('session: injects synthesis under Summary', () => {
    const body = sessionBodyTemplate({ synthesis: 'what happened' })
    expect(body).toContain('## Summary')
    expect(body.indexOf('what happened')).toBeGreaterThan(body.indexOf('## Summary'))
    expect(body.indexOf('what happened')).toBeLessThan(body.indexOf('## Entities Touched'))
  })

  it('knowledge contract defaultSections still match the insight subtype body', () => {
    // getContract('knowledge') is the kind-level contract; the insight subtype
    // is the one it describes, and document.ts reads both.
    expect(getContract('knowledge').defaultSections).toEqual(SUBTYPE_SECTIONS.insight)
  })
})
