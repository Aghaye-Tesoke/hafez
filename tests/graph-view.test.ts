// tests/graph-view.test.ts
// The page's view state (#279, spec #270 stories 76-79, Testing seam 3): a
// pure client module run in node. Focus and scope round-trip through the
// URL's query, and Esc steps back one level: the selection, then the
// overview, which Esc frames again.
import { describe, expect, it } from 'vitest'
import { escStep, parseView, viewSearch, type ViewParams } from '../src/graph/client/view.js'

const DEFAULT: ViewParams = { focus: null, scope: 'live' }

describe('the view in the URL', () => {
  it('reads an empty query as the default view: the Live scope, nothing selected', () => {
    expect(parseView('')).toEqual(DEFAULT)
  })

  it('round-trips focus and scope', () => {
    const views: ViewParams[] = [
      DEFAULT,
      { focus: 'simorgh', scope: 'live' },
      { focus: 'simorgh', scope: 'all' },
      { focus: null, scope: 'all' },
      { focus: 'a-b_c', scope: 'live' },
    ]
    for (const view of views) expect(parseView(viewSearch('', view))).toEqual(view)
  })

  it('writes a readable query, and the default view as no params at all', () => {
    expect(viewSearch('', { focus: 'simorgh', scope: 'all' })).toBe('?focus=simorgh&scope=all')
    expect(viewSearch('?focus=simorgh&scope=all', DEFAULT)).toBe('')
  })

  it('changes only the params it is given and keeps any other param', () => {
    expect(viewSearch('?scope=all&focus=x&other=1', { focus: 'y' })).toBe('?scope=all&focus=y&other=1')
    expect(viewSearch('?scope=all&focus=x', { focus: null })).toBe('?scope=all')
  })

  it('drops values it cannot hold, and the params the 2D page wrote', () => {
    expect(parseView('?focus=&scope=done')).toEqual(DEFAULT)
    expect(parseView('?focus=x&depth=2&highlight=tag:infra')).toEqual({ ...DEFAULT, focus: 'x' })
  })
})

describe('escStep', () => {
  it('steps back one level: the selection, then the overview', () => {
    expect(escStep({ selected: true })).toBe('selection')
    expect(escStep({ selected: false })).toBe('overview')
  })

  it('closes the selection, then frames the overview on every press after', () => {
    const view = { selected: true }
    const steps: string[] = []
    for (let press = 0; press < 3; press++) {
      const step = escStep(view)
      steps.push(step)
      if (step === 'selection') view.selected = false
    }
    expect(steps).toEqual(['selection', 'overview', 'overview'])
  })
})
