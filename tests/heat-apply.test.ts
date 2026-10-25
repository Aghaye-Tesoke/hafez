// tests/heat-apply.test.ts
// withHeat: heat merged into a Graph's project nodes, purely.
import { describe, it, expect } from 'vitest'
import { withHeat } from '../src/graph/heat/apply.js'
import { emptySidecar } from '../src/graph/heat/sidecar.js'
import type { Graph } from '../src/types.js'

const TODAY = '2026-10-25'
const THREE_DAYS_AGO = '2026-10-22'

function graph(): Graph {
  return {
    nodes: [
      { id: 'hot', kind: 'entity', name: 'Hot', type: 'project', last_touched: TODAY },
      { id: 'cold-touched', kind: 'entity', name: 'Cold', type: 'project', last_touched: THREE_DAYS_AGO },
      { id: 'bare', kind: 'entity', name: 'Bare', type: 'project' },
      { id: 'a-capture', kind: 'entity', name: 'Capture', type: 'capture' },
      { id: 'an-insight', kind: 'knowledge', name: 'Insight' },
    ],
    edges: [],
  }
}

describe('withHeat', () => {
  const sidecar = { ...emptySidecar(), days: { hot: { [TODAY]: 1800 } } }
  const touches = new Map([['cold-touched', [THREE_DAYS_AGO, '2026-10-21']]])

  it('gives a project with sidecar hours its heat, last_active and the hours source', () => {
    const hot = withHeat(graph(), sidecar, touches, TODAY).nodes.find(n => n.id === 'hot')
    expect(hot).toMatchObject({ heat: 1, last_active: TODAY, heat_source: 'hours' })
  })

  it('falls back to touches for a project with no hours, last_active from last_touched', () => {
    const cold = withHeat(graph(), sidecar, touches, TODAY).nodes.find(n => n.id === 'cold-touched')!
    expect(cold.heat_source).toBe('touches')
    expect(cold.last_active).toBe(THREE_DAYS_AGO)
    expect(cold.heat).toBeGreaterThan(0)
    expect(cold.heat).toBeLessThan(0.1)
  })

  it('a project with neither is cold with no last_active', () => {
    const bare = withHeat(graph(), sidecar, touches, TODAY).nodes.find(n => n.id === 'bare')!
    expect(bare).toMatchObject({ heat: 0, heat_source: 'touches' })
    expect('last_active' in bare).toBe(false)
  })

  it('leaves every other node alone, and does not mutate its input', () => {
    const input = graph()
    const before = JSON.stringify(input)
    const out = withHeat(input, sidecar, touches, TODAY)
    for (const id of ['a-capture', 'an-insight']) {
      const node = out.nodes.find(n => n.id === id)!
      expect(node).not.toHaveProperty('heat')
      expect(node).not.toHaveProperty('last_active')
      expect(node).not.toHaveProperty('heat_source')
    }
    expect(JSON.stringify(input)).toBe(before)
  })
})
