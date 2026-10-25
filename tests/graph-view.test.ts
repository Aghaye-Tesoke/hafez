// tests/graph-view.test.ts
// The page's view state (#279, spec #270 stories 76-79, Testing seam 3): a
// pure client module run in node. Focus, depth, scope and highlight
// round-trip through the URL's query, and Esc steps back one level: the
// local graph, then the selection, then the fitted overview.
import { describe, expect, it } from 'vitest'
import { escStep, parseView, viewSearch, type ViewParams } from '../src/graph/client/view.js'

const DEFAULT: ViewParams = { focus: null, depth: null, scope: 'live', highlight: null }

describe('the view in the URL', () => {
  it('reads an empty query as the default view: the Live scope, nothing selected', () => {
    expect(parseView('')).toEqual(DEFAULT)
  })

  it('round-trips focus, depth, scope and highlight', () => {
    const views: ViewParams[] = [
      DEFAULT,
      { focus: 'simorgh', depth: null, scope: 'live', highlight: null },
      { focus: 'simorgh', depth: 1, scope: 'live', highlight: null },
      { focus: 'simorgh', depth: 2, scope: 'all', highlight: 'tag:infra' },
      { focus: null, depth: null, scope: 'all', highlight: 'domain:engineering' },
      { focus: 'a-b_c', depth: 2, scope: 'live', highlight: 'tag:x y,z' },
    ]
    for (const view of views) expect(parseView(viewSearch('', view))).toEqual(view)
  })

  it('writes a readable query, and the default view as no params at all', () => {
    expect(viewSearch('', { focus: 'simorgh', depth: 2, scope: 'all', highlight: 'tag:infra' }))
      .toBe('?focus=simorgh&depth=2&scope=all&highlight=tag:infra')
    expect(viewSearch('?focus=simorgh&depth=1', DEFAULT)).toBe('')
  })

  it('changes only the params it is given and keeps any other param', () => {
    expect(viewSearch('?scope=all&depth=1&focus=x&other=1', { depth: 2 })).toBe('?scope=all&depth=2&focus=x&other=1')
    expect(viewSearch('?scope=all&focus=x', { focus: null })).toBe('?scope=all')
  })

  it('has no local mode with nothing selected: a depth without a focus is dropped', () => {
    expect(parseView('?depth=2')).toEqual(DEFAULT)
  })

  it('drops values it cannot hold', () => {
    expect(parseView('?focus=&depth=3&scope=done&highlight=infra')).toEqual(DEFAULT)
    expect(parseView('?focus=x&depth=0')).toEqual({ ...DEFAULT, focus: 'x' })
  })
})

describe('escStep', () => {
  it('steps back one level: local graph, then selection, then the fitted overview', () => {
    expect(escStep({ depth: 2, selected: true })).toBe('local')
    expect(escStep({ depth: 1, selected: true })).toBe('local')
    expect(escStep({ depth: null, selected: true })).toBe('selection')
    expect(escStep({ depth: null, selected: false })).toBe('overview')
  })

  it('leaves local depth 2 for the selection, then the overview; Esc at the overview fits it again', () => {
    const view: { depth: 1 | 2 | null; selected: boolean } = { depth: 2, selected: true }
    const steps: string[] = []
    for (let press = 0; press < 4; press++) {
      const step = escStep(view)
      steps.push(step)
      if (step === 'local') view.depth = null
      if (step === 'selection') view.selected = false
    }
    expect(steps).toEqual(['local', 'selection', 'overview', 'overview'])
  })

  it('has no local mode with nothing selected', () => {
    expect(escStep({ depth: 2, selected: false })).toBe('overview')
  })
})
