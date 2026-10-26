import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
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

describe('a done core', () => {
  const node = project({ status: 'done', last_active: today, heat: 1, heat_source: 'touches', open_actions: 3 })
  const s = bodyStyle(node, 'core', today)
  it('keeps the core body (it still hosts) and takes the nebula look: no clock colour, glow, alarm or estimate', () => {
    expect(s.body).toBe('core')
    expect(s.nebula).toBe(true)
    expect(s.color).toBe(GALAXY.nebula[0])
    expect(s.glow).toEqual({ intensity: 0, reach: 0 })
    expect(s.alarm).toBe(false)
    expect(s.estimated).toBe(false)
  })
  it('is built as the clouds and remnant round a dim sphere, with no halo', () => {
    const group = makeBody(s)
    expect(group.userData.nebula).toBe(true)
    expect(group.getObjectByName('cloud')).toBeDefined()
    expect(group.getObjectByName('remnant')).toBeDefined()
    const sphere = group.getObjectByName('sphere') as THREE.Mesh
    const color = (sphere.material as THREE.MeshBasicMaterial).color
    expect(color.r).toBeLessThan(new THREE.Color(GALAXY.nebula[0]).r)
    for (const name of ['glow', 'core', 'alarm', 'estimated']) expect(group.getObjectByName(name), name).toBeUndefined()
  })
  it('a live core and a star are not nebulae', () => {
    expect(bodyStyle(project({ last_active: today }), 'core', today).nebula).toBe(false)
    expect(bodyStyle(project({ status: 'done' }), 'nebula', today).nebula).toBe(true)
    expect(bodyStyle(project({ last_active: today }), 'star', today).nebula).toBe(false)
  })
})

describe('picking', () => {
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10000)
  camera.position.set(0, 0, 500)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  /** The named parts a ray from the camera through (x, y) on the body's plane hits. */
  const hits = (group: THREE.Group, x: number, y: number): string[] => {
    group.updateMatrixWorld(true)
    const ray = new THREE.Raycaster()
    ray.camera = camera
    ray.set(camera.position, new THREE.Vector3(x, y, 0).sub(camera.position).normalize())
    return ray.intersectObject(group, true).map(i => i.object.name || '(unnamed)')
  }
  it('a star is picked by its sphere only: its halo lets a click through', () => {
    const s = bodyStyle(project({ last_active: today, heat: 1 }), 'star', today)
    const group = makeBody(s)
    expect(hits(group, 0, 0)).toEqual(['sphere'])
    // Inside the halo's quad, outside the sphere: nothing.
    expect(hits(group, s.radius * 1.5, 0)).toEqual([])
  })
  it('a live core: its wide halo lets a click through', () => {
    const s = bodyStyle(project({ last_active: today, heat: 1 }), 'core', today)
    expect(hits(makeBody(s), s.radius * 3, 0)).toEqual([])
  })
  it('a nebula is picked by its remnant; its clouds and debris let a click through', () => {
    const s = bodyStyle(project({ status: 'done' }), 'nebula', today)
    const group = makeBody(s)
    expect(hits(group, 0, 0)).toEqual(['remnant'])
    const cloud = group.getObjectByName('cloud')!
    expect(cloud.children.length).toBeGreaterThan(0)
    for (const c of cloud.children) expect(hits(group, c.position.x, c.position.y).filter(n => n !== 'remnant')).toEqual([])
  })
  it('a done core is picked by its sphere and remnant', () => {
    const s = bodyStyle(project({ status: 'done' }), 'core', today)
    expect(hits(makeBody(s), 0, 0).sort()).toEqual(['remnant', 'sphere'])
  })
})
