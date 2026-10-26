import { describe, expect, it, vi } from 'vitest'

// motion.ts queries matchMedia at import time and camera.ts imports it; no DOM here.
vi.stubGlobal('matchMedia', () => ({ matches: false }))
const { flyPosition, overviewPosition } = await import('../src/graph/client/galaxy/camera.js')

const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

describe('flyPosition', () => {
  const target = { x: 10, y: -5, z: 3 }
  it('lands 3.5·radius + 20 from the target', () => {
    const p = flyPosition({ x: 100, y: 40, z: -70 }, target, 6)
    expect(Math.abs(dist(p, target) - (3.5 * 6 + 20))).toBeLessThan(1e-9)
  })
  it('keeps the direction from the target to the camera', () => {
    const from = { x: 100, y: 40, z: -70 }
    const p = flyPosition(from, target, 6)
    const a = { x: from.x - target.x, y: from.y - target.y, z: from.z - target.z }
    const b = { x: p.x - target.x, y: p.y - target.y, z: p.z - target.z }
    const la = Math.hypot(a.x, a.y, a.z)
    const lb = Math.hypot(b.x, b.y, b.z)
    expect(a.x / la).toBeCloseTo(b.x / lb, 9)
    expect(a.y / la).toBeCloseTo(b.y / lb, 9)
    expect(a.z / la).toBeCloseTo(b.z / lb, 9)
  })
  it('falls back to +z when the camera is at the target', () => {
    const p = flyPosition(target, target, 2)
    expect(p.x).toBeCloseTo(target.x, 9)
    expect(p.y).toBeCloseTo(target.y, 9)
    expect(p.z).toBeCloseTo(target.z + 27, 9)
  })
})

describe('overviewPosition', () => {
  it('sits 2.2·radius + 40 from the centre', () => {
    const bounds = { center: { x: 1, y: 2, z: 3 }, radius: 300 }
    const p = overviewPosition({ x: -50, y: 80, z: 900 }, bounds)
    expect(Math.abs(dist(p, bounds.center) - (2.2 * 300 + 40))).toBeLessThan(1e-9)
  })
})
