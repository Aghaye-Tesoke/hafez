// tests/sections.test.ts
import { describe, it, expect } from 'vitest'
import { documentFor, documentForFile, structuralSectionsFor, parseSessionLog } from '../src/document.js'
import { ALL_CONTRACTS, SUBTYPE_SECTIONS } from '../src/contracts.js'

// Entity-union binding: these suites exercise entity-side sections (Brief,
// Next Actions, Session Log, Current State). Knowledge-flavored tests bind
// their own doc below.
const { getBrief, setBrief, removeBrief, getNextActions, addNextAction, completeNextAction, removeNextAction, pruneNextActions, clearNextActions, findSection, findNextStructuralHeading } = documentFor({ kind: 'entity' })

describe('Brief', () => {
  const bodyWithBrief = `## Purpose\n\nSome purpose.\n\n## Brief\n\nThis is the brief content.\nMultiple lines here.\n\n## Session Log\n\n### 2026-03-20 — claude [progress]\nSummary: Did something`

  const bodyNoBrief = `## Purpose\n\nSome purpose.\n\n## Session Log\n\n### 2026-03-20 — claude [progress]\nSummary: Did something`

  it('getBrief extracts brief content from body', () => {
    expect(getBrief(bodyWithBrief)).toBe('This is the brief content.\nMultiple lines here.')
  })

  it('getBrief returns null when no Brief section', () => {
    expect(getBrief(bodyNoBrief)).toBeNull()
  })

  it('setBrief replaces existing brief', () => {
    const result = setBrief(bodyWithBrief, 'New brief.')
    expect(getBrief(result)).toBe('New brief.')
    expect(result).toContain('## Purpose')
    expect(result).toContain('## Session Log')
  })

  it('setBrief inserts brief before Session Log when absent', () => {
    const result = setBrief(bodyNoBrief, 'Inserted brief.')
    expect(getBrief(result)).toBe('Inserted brief.')
    expect(result.indexOf('## Brief')).toBeLessThan(result.indexOf('## Session Log'))
  })

  it('setBrief inserts brief before Next Actions if present', () => {
    const bodyWithActions = bodyNoBrief.replace('## Session Log', '## Next Actions\n\n- [ ] Do thing\n\n## Session Log')
    const result = setBrief(bodyWithActions, 'My brief.')
    expect(result.indexOf('## Brief')).toBeLessThan(result.indexOf('## Next Actions'))
  })

  it('removeBrief removes the section entirely', () => {
    const result = removeBrief(bodyWithBrief)
    expect(result).not.toContain('## Brief')
    expect(result).toContain('## Purpose')
    expect(result).toContain('## Session Log')
  })

  it('removeBrief is a no-op when no Brief exists', () => {
    expect(removeBrief(bodyNoBrief)).toBe(bodyNoBrief)
  })

  it('setBrief works on area entity with ## Current State', () => {
    const areaBody = `## Purpose\n\nArea purpose.\n\n## Current State\n\nState info.\n\n## Session Log\n`
    const result = setBrief(areaBody, 'Area brief.')
    expect(result.indexOf('## Brief')).toBeLessThan(result.indexOf('## Current State'))
    expect(result).toContain('## Current State')
    expect(result).toContain('## Session Log')
  })

  it('setBrief works on entity without ## Session Log', () => {
    const noLogBody = `## Purpose\n\nSome purpose.`
    const result = setBrief(noLogBody, 'Brief without log.')
    expect(result).toContain('## Brief')
    expect(result).toContain('Brief without log.')
  })

  it('getBrief finds section regardless of ordering (hand-edited)', () => {
    const reorderedBody = `## Session Log\n\n### entry\n\n## Brief\n\nMisplaced brief.\n\n## Purpose\n`
    expect(getBrief(reorderedBody)).toBe('Misplaced brief.')
  })
})

describe('Next Actions', () => {
  const bodyWithActions = `## Purpose\n\nSome purpose.\n\n## Next Actions\n\n- [ ] Deploy fix to VPS @dev\n- [ ] Test /start command @simorgh\n- [x] Old completed item @dev\n\n## Session Log\n\n### 2026-03-20 — claude [progress]\nSummary: Did something`

  const bodyNoActions = `## Purpose\n\nSome purpose.\n\n## Session Log\n\n### 2026-03-20 — claude [progress]\nSummary: Did something`

  it('getNextActions returns unchecked items', () => {
    const actions = getNextActions(bodyWithActions)
    expect(actions).toEqual([
      'Deploy fix to VPS @dev',
      'Test /start command @simorgh',
    ])
  })

  it('getNextActions returns empty array when no section', () => {
    expect(getNextActions(bodyNoActions)).toEqual([])
  })

  it('addNextAction adds to existing list', () => {
    const result = addNextAction(bodyWithActions, 'New action @parisa')
    const actions = getNextActions(result)
    expect(actions).toContain('New action @parisa')
    expect(actions).toContain('Deploy fix to VPS @dev')
  })

  it('addNextAction creates section when absent', () => {
    const result = addNextAction(bodyNoActions, 'First action @dev')
    expect(result).toContain('## Next Actions')
    expect(getNextActions(result)).toEqual(['First action @dev'])
    expect(result.indexOf('## Next Actions')).toBeLessThan(result.indexOf('## Session Log'))
  })

  it('addNextAction inserts section after Brief if present', () => {
    const bodyWithBrief = bodyNoActions.replace('## Session Log', '## Brief\n\nSome brief.\n\n## Session Log')
    const result = addNextAction(bodyWithBrief, 'Action @dev')
    expect(result.indexOf('## Brief')).toBeLessThan(result.indexOf('## Next Actions'))
    expect(result.indexOf('## Next Actions')).toBeLessThan(result.indexOf('## Session Log'))
  })

  it('completeNextAction marks item [x] and excludes from unchecked list', () => {
    const result = completeNextAction(bodyWithActions, 'Deploy fix')
    expect(result.matched).toBe('Deploy fix to VPS @dev')
    expect(result.body).toContain('- [x] Deploy fix to VPS @dev')
    const actions = getNextActions(result.body)
    expect(actions).not.toContain('Deploy fix to VPS @dev')
    expect(actions).toContain('Test /start command @simorgh')
  })

  it('completeNextAction is case-insensitive', () => {
    const result = completeNextAction(bodyWithActions, 'deploy fix')
    expect(result.matched).toBe('Deploy fix to VPS @dev')
  })

  it('completeNextAction throws on ambiguous match', () => {
    const bodyAmbiguous = `## Next Actions\n\n- [ ] Fix auth @dev\n- [ ] Fix auth flow @dev\n\n## Session Log\n`
    expect(() => completeNextAction(bodyAmbiguous, 'Fix auth')).toThrow('Ambiguous')
  })

  it('completeNextAction throws when no match', () => {
    expect(() => completeNextAction(bodyWithActions, 'nonexistent')).toThrow('No matching')
  })

  it('no-match error includes actual action texts', () => {
    try {
      completeNextAction(bodyWithActions, 'nonexistent')
    } catch (e) {
      const msg = (e as Error).message
      expect(msg).toContain('Actions:')
      expect(msg).toContain('Deploy fix to VPS @dev')
      expect(msg).toContain('Test /start command @simorgh')
    }
  })

  it('matches action with smart quotes via normalization', () => {
    const bodySmartQuotes = `## Next Actions\n\n- [ ] Fix the \u2018auth\u2019 module @dev\n\n## Session Log\n`
    const result = completeNextAction(bodySmartQuotes, "Fix the 'auth' module")
    expect(result.matched).toBe('Fix the \u2018auth\u2019 module @dev')
  })

  it('matches action with em-dash via normalization', () => {
    const bodyEmDash = `## Next Actions\n\n- [ ] Deploy fix \u2014 urgent @dev\n\n## Session Log\n`
    const result = completeNextAction(bodyEmDash, 'Deploy fix - urgent')
    expect(result.matched).toBe('Deploy fix \u2014 urgent @dev')
  })

  it('removeNextAction removes without completing', () => {
    const result = removeNextAction(bodyWithActions, 'Deploy fix')
    expect(result.matched).toBe('Deploy fix to VPS @dev')
    expect(getNextActions(result.body)).not.toContain('Deploy fix to VPS @dev')
  })

  it('clearNextActions removes the entire section', () => {
    const result = clearNextActions(bodyWithActions)
    expect(result).not.toContain('## Next Actions')
    expect(result).toContain('## Purpose')
    expect(result).toContain('## Session Log')
  })

  it('pruneNextActions removes the section once no open item remains', () => {
    const bodySingle = `## Purpose\n\n## Next Actions\n\n- [ ] Only item @dev\n\n## Session Log\n`
    const removed = removeNextAction(bodySingle, 'Only item').body
    expect(removed).toContain('## Next Actions') // the edit alone leaves the section
    expect(pruneNextActions(removed)).not.toContain('## Next Actions')
    const ticked = completeNextAction(bodySingle, 'Only item').body
    expect(pruneNextActions(ticked)).not.toContain('## Next Actions')
    expect(pruneNextActions(bodyWithActions)).toBe(bodyWithActions) // open items → untouched
  })
})

describe('Next Actions edits stay inside the section', () => {
  // A Brief that quotes an action line verbatim. Matching was already
  // section-scoped; editing was not — complete flipped the quoted line and
  // remove deleted every copy body-wide.
  const bodyQuotingBrief = `## Brief\n\nHandoff: the blocker is\n- [ ] Deploy fix to VPS @dev\nwhich nobody has picked up.\n\n## Next Actions\n\n- [ ] Deploy fix to VPS @dev\n- [ ] Test /start command @simorgh\n\n## Session Log\n\n### 2026-03-20 — claude [progress]\nSummary: Did something`

  it('completeNextAction checks the real action and leaves a quoting Brief untouched', () => {
    const result = completeNextAction(bodyQuotingBrief, 'Deploy fix')
    expect(result.matched).toBe('Deploy fix to VPS @dev')
    expect(getBrief(result.body)).toBe(getBrief(bodyQuotingBrief))
    expect(findSection(result.body, 'Next Actions')!.content).toContain('- [x] Deploy fix to VPS @dev')
    expect(findSection(result.body, 'Next Actions')!.content).not.toContain('- [ ] Deploy fix to VPS @dev')
    expect(getNextActions(result.body)).toEqual(['Test /start command @simorgh'])
  })

  it('removeNextAction removes only the matching line inside Next Actions', () => {
    const result = removeNextAction(bodyQuotingBrief, 'Deploy fix')
    expect(result.matched).toBe('Deploy fix to VPS @dev')
    expect(getBrief(result.body)).toBe(getBrief(bodyQuotingBrief))
    expect(findSection(result.body, 'Next Actions')!.content).not.toContain('Deploy fix to VPS @dev')
    expect(getNextActions(result.body)).toEqual(['Test /start command @simorgh'])
  })

  // Action text is data, not a replacement pattern: $&, $', $1 must survive.
  const bodyPatternChars = `## Purpose\n\nSome purpose.\n\n## Next Actions\n\n- [ ] pay $& bill and refund $' plus $1 @dev\n- [ ] Keep me @dev\n\n## Session Log\n`

  it('completeNextAction treats $& / $’ / $1 in action text literally', () => {
    const result = completeNextAction(bodyPatternChars, 'pay')
    expect(result.matched).toBe("pay $& bill and refund $' plus $1 @dev")
    expect(result.body).toBe(
      `## Purpose\n\nSome purpose.\n\n## Next Actions\n\n- [x] pay $& bill and refund $' plus $1 @dev\n- [ ] Keep me @dev\n\n## Session Log\n`
    )
  })

  it('removeNextAction treats $& / $’ / $1 in action text literally', () => {
    const result = removeNextAction(bodyPatternChars, 'pay')
    expect(result.matched).toBe("pay $& bill and refund $' plus $1 @dev")
    expect(result.body).toBe(
      `## Purpose\n\nSome purpose.\n\n## Next Actions\n\n- [ ] Keep me @dev\n\n## Session Log\n`
    )
  })
})

// --- Structural section boundary tests ---

describe('structural section sets (per kind)', () => {
  it('entity union contains the entity-side headings', () => {
    const s = structuralSectionsFor({ kind: 'entity' })
    expect(s.has('Brief')).toBe(true)
    expect(s.has('Next Actions')).toBe(true)
    expect(s.has('Session Log')).toBe(true)
    expect(s.has('Related')).toBe(true)
  })

  it('every contract section is structural under its kind binding', () => {
    const entitySet = structuralSectionsFor({ kind: 'entity' })
    for (const contract of ALL_CONTRACTS.filter(c => c.kind === 'item')) {
      for (const section of [...contract.defaultSections, ...contract.optionalSections]) {
        expect(entitySet.has(section), `missing "${section}" from ${contract.type}`).toBe(true)
      }
    }
    const knowledgeSet = structuralSectionsFor({ kind: 'knowledge' })
    for (const [subtype, sections] of Object.entries(SUBTYPE_SECTIONS)) {
      for (const section of sections) {
        expect(knowledgeSet.has(section), `missing "${section}" from subtype ${subtype}`).toBe(true)
      }
    }
  })

  it('Current State is structural on captures — update writes it type-ungated, so a Brief rewrite must not swallow it', () => {
    const s = structuralSectionsFor({ kind: 'entity' })
    expect(s.has('Current State')).toBe(true)
    const cdoc = documentFor({ kind: 'entity' })
    const body = '## Notes\n\nraw\n\n## Brief\n\nfirst\n\n## Current State\n\nwaiting on X\n'
    expect(cdoc.getBrief(body)).toBe('first')
    const rewritten = cdoc.setBrief(body, 'second')
    expect(rewritten).toContain('## Current State')
    expect(rewritten).toContain('waiting on X')
  })

  it('plan sections survive a synthesis rewrite on any knowledge file — same-kind headings are always boundaries', () => {
    // A plan-shaped note whose subtype was never persisted (create only
    // writes subtype when given; hand edits never do) must not lose its
    // sections to an adjacent rewrite — deletion-safety outranks the
    // stranding a quoted same-kind heading can cause.
    const doc = documentForFile({ kind: 'knowledge' })
    const body = '## Synthesis\n\nintro\n\n## Goal\n\nship it\n\n## Steps\n\n- step one\n'
    const rewritten = doc.setSection(body, 'Synthesis', 'NEW')
    expect(doc.findSection(rewritten, 'Synthesis')!.content).toBe('NEW')
    expect(rewritten).toContain('## Goal')
    expect(rewritten).toContain('ship it')
    expect(rewritten).toContain('- step one')
  })

  it('a session-only heading inside a Brief no longer ends the section (the reported collision)', () => {
    const body = '## Brief\n\nintro\n\n## Decisions\n\nwe decided things\n\n## Session Log\n'
    expect(getBrief(body)).toBe('intro\n\n## Decisions\n\nwe decided things')
    // The same heading IS a boundary inside a session file
    const sdoc = documentFor({ kind: 'session' })
    const sessionBody = '## Summary\n\nintro\n\n## Decisions\n\npicked option B\n'
    expect(sdoc.findSection(sessionBody, 'Summary')!.content).toBe('intro')
    expect(sdoc.findSection(sessionBody, 'Decisions')!.content).toBe('picked option B')
  })

  it('cross-KIND headings are NOT boundaries; same-kind headings always are', () => {
    const entity = structuralSectionsFor({ kind: 'entity' })
    expect(entity.has('Decisions')).toBe(false)  // session-only
    expect(entity.has('Goal')).toBe(false)       // knowledge-only (plan)
    expect(entity.has('Synthesis')).toBe(false)  // knowledge-only
    const knowledge = structuralSectionsFor({ kind: 'knowledge' })
    expect(knowledge.has('Steps')).toBe(true)    // same-kind: a plan heading bounds every knowledge file
    expect(knowledge.has('Brief')).toBe(false)   // entity-only
  })
})

describe('findNextStructuralHeading', () => {
  it('finds a structural heading', () => {
    const body = '## Brief\n\nSome content\n\n## Next Actions\n\n- [ ] Do thing'
    const idx = findNextStructuralHeading(body, '## Brief'.length)
    expect(idx).toBeGreaterThan(0)
    expect(body.slice(idx + 1, idx + 20)).toMatch(/^## Next Actions/)
  })

  it('skips non-structural headings in content', () => {
    const body = '## Brief\n\nContent with\n\n## Stage Map\n\nMore content\n\n## Vision\n\nEven more\n\n## Next Actions\n\n- [ ] Do thing'
    const idx = findNextStructuralHeading(body, '## Brief'.length)
    expect(body.slice(idx + 1).startsWith('## Next Actions')).toBe(true)
  })

  it('returns -1 when no structural heading exists after position', () => {
    const body = '## Brief\n\nContent with\n\n## Random Heading\n\nMore content'
    const idx = findNextStructuralHeading(body, '## Brief'.length)
    expect(idx).toBe(-1)
  })
})

describe('findSection with structural boundaries', () => {
  it('extracts section content correctly', () => {
    const body = '## Brief\n\nHello world\n\n## Next Actions\n\n- [ ] Do thing'
    const section = findSection(body, 'Brief')
    expect(section).not.toBeNull()
    expect(section!.content).toBe('Hello world')
  })

  it('preserves content with ## headings inside', () => {
    const body = [
      '## Brief', '', '### Overview', 'Some overview text', '',
      '## Stage Map', '| Stage | Description |', '| --- | --- |', '| 1 | Planning |', '',
      '## Vision', 'The future is bright', '',
      '## Next Actions', '', '- [ ] Do thing'
    ].join('\n')

    const section = findSection(body, 'Brief')
    expect(section).not.toBeNull()
    expect(section!.content).toContain('## Stage Map')
    expect(section!.content).toContain('## Vision')
    expect(section!.content).toContain('The future is bright')
    expect(section!.content).not.toContain('Next Actions')
  })

  it('handles section at end of file with non-structural headings', () => {
    const body = '## Brief\n\nContent here\n\n## Custom Heading\n\nMore content'
    const section = findSection(body, 'Brief')
    expect(section).not.toBeNull()
    expect(section!.content).toContain('## Custom Heading')
    expect(section!.content).toContain('More content')
  })

  it('Current State section preserves content with non-structural headings', () => {
    const body = [
      '## Current State', '', 'Active work on the parser.', '',
      '## Implementation Details', 'These are internal notes.', '',
      '## Session Log', '', '### 2026-04-08 — Claude [progress]', 'Summary: Working on it',
    ].join('\n')

    const section = findSection(body, 'Current State')
    expect(section).not.toBeNull()
    expect(section!.content).toContain('## Implementation Details')
    expect(section!.content).not.toContain('Session Log')
  })

  it('Synthesis section preserves content with non-structural headings', () => {
    const body = [
      '## Synthesis', '', 'Key insight about the system.', '',
      '## Background Research', 'Supporting details here.', '',
      '## Evidence', '', '- First evidence point',
    ].join('\n')

    const kdoc = documentFor({ kind: 'knowledge' })
    const section = kdoc.findSection(body, 'Synthesis')
    expect(section).not.toBeNull()
    expect(section!.content).toContain('## Background Research')
    expect(section!.content).not.toContain('Evidence')
  })
})

describe('setBrief / getBrief round-trip with structural boundaries', () => {
  it('preserves brief content with internal ## headings', () => {
    const body = '## Next Actions\n\n- [ ] Do thing'
    const briefContent = [
      '### Overview', 'This is a spec.', '',
      '## Architecture', 'Three-layer design.', '',
      '## API Surface', '- endpoint A', '- endpoint B'
    ].join('\n')

    const updated = setBrief(body, briefContent)
    const retrieved = getBrief(updated)
    expect(retrieved).toBe(briefContent)
  })

  it('does not corrupt Next Actions when brief has ## headings', () => {
    const body = '## Next Actions\n\n- [ ] First task\n- [ ] Second task'
    const briefContent = '## Internal Heading\n\nSome content\n\n## Another Heading\n\nMore content'

    const updated = setBrief(body, briefContent)
    expect(getBrief(updated)).toBe(briefContent)

    const naSection = findSection(updated, 'Next Actions')
    expect(naSection).not.toBeNull()
    expect(naSection!.content).toContain('First task')
    expect(naSection!.content).toContain('Second task')
  })
})

describe('parseSessionLog with content headings', () => {
  it('parses session log entries when content contains ## headings', () => {
    const body = [
      '## Brief', '', 'Some brief', '',
      '## Session Log', '',
      '### 2026-04-08 — Simorgh [progress]', 'Summary: Fixed section parsing bug', '',
      '## Architecture Notes', 'Not a structural heading', '',
      '### 2026-04-07 — Claude [research]', 'Summary: Investigated the issue', '',
      '## Related', '', '- [[some-slug]]',
    ].join('\n')

    const entries = parseSessionLog(body)
    expect(entries).toHaveLength(2)
    expect(entries[0].summary).toBe('Fixed section parsing bug')
    expect(entries[1].summary).toBe('Investigated the issue')
  })

  it('stops at the next structural heading after Session Log', () => {
    const body = [
      '## Session Log', '',
      '### 2026-04-08 — Simorgh [progress]', 'Summary: Did something', '',
      '## Next Actions', '', '- [ ] Do thing',
    ].join('\n')

    const entries = parseSessionLog(body)
    expect(entries).toHaveLength(1)
    expect(entries[0].summary).toBe('Did something')
  })
})
