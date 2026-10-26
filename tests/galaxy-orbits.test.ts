import { describe, expect, it } from 'vitest'
import type { GraphEdge, GraphNode } from '../src/types.js'
import { ORBIT, beltOf, orbitsOf, positionAt, resolvePositions, type Orbit, type Vec3 } from '../src/graph/client/galaxy/orbits.js'

const entity = (id: string, fields: Partial<GraphNode> = {}): GraphNode =>
  ({ id, kind: 'entity', name: id, type: 'project', status: 'active', ...fields }) as GraphNode
const knowledge = (id: string, fields: Partial<GraphNode> = {}): GraphNode =>
  ({ id, kind: 'knowledge', name: id, ...fields }) as GraphNode
const edge = (source: string, target: string, relation: GraphEdge['relation']): GraphEdge => ({ source, target, relation })

const nodes: GraphNode[] = [
  entity('c'),
  entity('s1'),
  entity('s2'),
  entity('s3'),
  knowledge('p1'),
  knowledge('p2'),
  entity('m1', { type: 'capture' }),
  knowledge('b1', { unlinked: true }),
  knowledge('b2', { unlinked: true }),
  knowledge('b3', { unlinked: true }),
  knowledge('pb'),
]
const edges: GraphEdge[] = [
  edge('s1', 'c', 'parent'),
  edge('s2', 'c', 'parent'),
  edge('s3', 'c', 'parent'),
  edge('m1', 's1', 'parent'),
  edge('p1', 's1', 'related'),
  edge('p2', 's1', 'related'),
  edge('pb', 'b1', 'related'),
]
const roots = new Map<string, Vec3>([['c', { x: 0, y: 0, z: 0 }]])
const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

describe('orbitsOf', () => {
  const orbits = orbitsOf(nodes, edges)
  it('spaces sibling stars by radius and phase', () => {
    expect(['s1', 's2', 's3'].map((id) => orbits.get(id)!.radius)).toEqual([28, 37, 46])
    const phases = ['s1', 's2', 's3'].map((id) => orbits.get(id)!.phase)
    expect(phases[0]).toBe(0)
    expect(phases[1]).toBeCloseTo((2 * Math.PI) / 3, 6)
    expect(phases[2]).toBeCloseTo((4 * Math.PI) / 3, 6)
    expect(orbits.get('s1')!.host).toBe('c')
  })
  it('keeps planets inside any star radius', () => {
    expect(orbits.get('p1')!.radius).toBe(7)
    expect(orbits.get('p2')!.radius).toBe(10)
    expect(orbits.get('p1')!.radius).toBeLessThan(28)
    expect(orbits.get('m1')!.radius).toBe(4)
  })
  it('gives roots and belt bodies no entry', () => {
    expect(orbits.has('c')).toBe(false)
    expect(orbits.has('b1')).toBe(false)
  })
  it('tilt is deterministic and bounded', () => {
    const again = orbitsOf(nodes, edges)
    for (const [id, o] of orbits) {
      expect(again.get(id)!.tilt).toBe(o.tilt)
      expect(Math.abs(o.tilt)).toBeLessThanOrEqual(0.25)
    }
  })
})

describe('positionAt', () => {
  it('is periodic', () => {
    const o = orbitsOf(nodes, edges).get('s2')!
    const h = { x: 1, y: 2, z: 3 }
    const a = positionAt(o, h, 0)
    const b = positionAt(o, h, (2 * Math.PI) / o.speed)
    expect(b.x).toBeCloseTo(a.x, 6)
    expect(b.y).toBeCloseTo(a.y, 6)
    expect(b.z).toBeCloseTo(a.z, 6)
  })
})

describe('belt and resolvePositions', () => {
  const all = new Map<string, Orbit>([...orbitsOf(nodes, edges), ...beltOf(['b1', 'b2', 'b3'])])
  it('places belt bodies 320 from the origin', () => {
    const pos = resolvePositions(all, roots, 123)
    for (const id of ['b1', 'b2', 'b3']) expect(dist(pos.get(id)!, { x: 0, y: 0, z: 0 })).toBeCloseTo(320, 6)
  })
  it('hangs a planet on a belt body', () => {
    const pos = resolvePositions(all, roots, 50)
    expect(dist(pos.get('pb')!, pos.get('b1')!)).toBeLessThanOrEqual(ORBIT.planet.base + 1e-6)
  })
  it('resolves moons through their star to the core', () => {
    const pos = resolvePositions(all, roots, 10)
    expect(dist(pos.get('m1')!, pos.get('s1')!)).toBeCloseTo(4, 6)
  })
  it('puts an unknown host at the origin without throwing', () => {
    const orphan = new Map<string, Orbit>([['x', { host: 'ghost', radius: 5, phase: 1, speed: 0.1, tilt: 0.1 }]])
    const pos = resolvePositions(orphan, roots, 7)
    expect(dist(pos.get('x')!, { x: 0, y: 0, z: 0 })).toBeLessThanOrEqual(5 + 1e-6)
  })
})
