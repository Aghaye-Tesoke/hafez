// tests/graph-live-flare.test.ts
// A commit's flare (live.ts): for 1.6 s every colour of the body's group is
// lifted, eased back each frame, and restored exactly once the flare has run.
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { FLARE_MS, flare, tickFlares } from '../src/graph/client/live.js'
import type { DrawNode } from '../src/graph/client/state.js'

function body(hex: string): { node: DrawNode; material: THREE.MeshBasicMaterial } {
  const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(hex) })
  const group = new THREE.Group()
  group.add(new THREE.Mesh(new THREE.SphereGeometry(1), material))
  return { node: { id: 'x', kind: 'entity', name: 'x', group } as unknown as DrawNode, material }
}

describe('flare', () => {
  it('lifts the body\'s colours, eases them back, and restores them when it has run', () => {
    const { node, material } = body('#406080')
    const base = material.color.clone()
    flare(node, 1000)
    tickFlares(1000)
    const start = material.color.r
    tickFlares(1000 + FLARE_MS / 2)
    const mid = material.color.r
    expect(start).toBeGreaterThan(mid)
    expect(mid).toBeGreaterThan(base.r)
    tickFlares(1000 + FLARE_MS)
    expect(material.color.equals(base)).toBe(true)
  })

  it('a flare started over keeps the body\'s own colours as its base', () => {
    const { node, material } = body('#204060')
    const base = material.color.clone()
    flare(node, 0)
    tickFlares(100)
    flare(node, 100)
    tickFlares(100 + FLARE_MS)
    expect(material.color.equals(base)).toBe(true)
  })

  it('does nothing for a node with no body yet', () => {
    expect(() => flare({ id: 'y' } as DrawNode, 0)).not.toThrow()
  })
})
