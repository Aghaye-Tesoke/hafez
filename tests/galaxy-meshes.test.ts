import { describe, expect, it } from 'vitest'
import type { GraphNode } from '../src/types.js'
import { bodyStyle, makeBody, updateBody } from '../src/graph/client/galaxy/meshes.js'
import { GALAXY } from '../src/graph/client/tokens.js'
import { starRadius, temperatureColor } from '../src/graph/client/galaxy/temperature.js'

const today = '2026-10-25'
const project = (fields: Partial<GraphNode> = {}): GraphNode =>
  ({ id: 'p', kind: 'entity', name: 'P', type: 'project', status: 'active', ...fields }) as GraphNode

describe('bodyStyle', () => {
  it('a hot star: temperature colour, glow from heat, no alarm', () => {
    const node = project({ last_active: today, heat: 1, heat_source: 'hours', open_actions: 2 })
    const s = bodyStyle(node, 'star', today)
    expect(s.radius).toBe(starRadius(node))
    expect(s.color).toBe(temperatureColor(0))
    expect(s.glow.intensity).toBeCloseTo(0.5)
    expect(s.alarm).toBe(false)
    expect(s.estimated).toBe(false)
    expect(s.label).toBe('P')
  })
  it('a cold star with open actions alarms; estimated heat is flagged', () => {
    const node = project({ last_active: '2026-08-01', heat: 0, heat_source: 'touches', open_actions: 3 })
    const s = bodyStyle(node, 'star', today)
    expect(s.color).toBe(temperatureColor(Infinity))
    expect(s.alarm).toBe(true)
    expect(s.estimated).toBe(true)
  })
  it('a nebula uses the nebula colour and no glow', () => {
    const s = bodyStyle(project({ status: 'done' }), 'nebula', today)
    expect(s.color).toBe(GALAXY.nebula[0])
    expect(s.glow).toEqual({ intensity: 0, reach: 0 })
    expect(s.estimated).toBe(false)
  })
  it('a ringed planet is 2.6 wide in the ringed colour', () => {
    const s = bodyStyle({ id: 'k', kind: 'knowledge', name: 'K' } as GraphNode, 'planet-ringed', today)
    expect(s.radius).toBe(2.6)
    expect(s.color).toBe(GALAXY.planet.ringed)
    expect(s.alarm).toBe(false)
  })
  it('updateBody rescales the sphere in place and keeps the build radius', () => {
    const s = bodyStyle(project({ last_active: today, heat: 1 }), 'star', today)
    const group = makeBody(s)
    updateBody(group, { ...s, radius: s.radius * 2 })
    expect(group.getObjectByName('sphere')!.scale.x).toBeCloseTo(2)
    expect(group.userData.radius).toBe(s.radius)
  })
})
