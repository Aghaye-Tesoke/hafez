// src/graph/client/galaxy/orbits.ts
// Which body orbits what, and where everything is at time t (spec "Galaxies",
// "Planets are knowledge", "The belt"). Hosted bodies sit on circular orbits the
// page animates; roots are placed by the force layout and handed in; the belt is
// one tilted ring around the origin. Pure: no DOM, no three.js, no randomness
// (tilt comes from a hash of the id, so a reload never moves a body).
import type { GraphEdge, GraphNode } from '../../../types.js'
import { bodyOf, childrenOf, hostOf, type Body } from './bodies.js'

export interface Vec3 {
  x: number
  y: number
  z: number
}

/** A circular orbit: radius in scene units, speed in radians per second. */
export interface Orbit {
  host: string
  radius: number
  phase: number
  speed: number
  tilt: number
}

/** Radii in scene units. The innermost planet clears a heat-1 star's halo:
 * at least 4x the largest star radius (signals.ts size: 10.2) plus the glow
 * reach (2.2 radii at heat 1, temperature.ts); moons sit just outside that
 * halo, inside the planets; sibling stars round a core leave room for a
 * star's planets; the belt rings everything. */
export const ORBIT = {
  star: { base: 110, step: 40 },
  planet: { base: 44, step: 14 },
  moon: { base: 26, step: 5 },
  belt: { radius: 900, tilt: 0.35, speed: 0.004 },
  speed: { star: 0.02, planet: 0.06, moon: 0.1 },
} as const

const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 }
const MAX_TILT = 0.25

type OrbitClass = 'star' | 'planet' | 'moon'

/** A hosted core is a sub-system and orbits like a star. */
function classOf(body: Body): OrbitClass {
  if (body === 'core' || body === 'star' || body === 'nebula') return 'star'
  if (body === 'moon') return 'moon'
  return 'planet'
}

/** FNV-1a 32-bit, mapped to [-MAX_TILT, MAX_TILT]. */
function tiltOf(id: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return ((h / 0xffffffff) * 2 - 1) * MAX_TILT
}

/** An orbit for every hosted body. Roots and the belt get no entry. */
export function orbitsOf(nodes: GraphNode[], edges: GraphEdge[]): Map<string, Orbit> {
  const children = childrenOf(edges)
  const groups = new Map<string, string[]>()
  const hosts = new Map<string, string>()
  const classes = new Map<string, OrbitClass>()
  for (const node of nodes) {
    const body = bodyOf(node, children.has(node.id))
    // The belt has its own ring (beltOf); an unlinked project is a root.
    if (body === 'belt') continue
    const host = hostOf(node, edges)
    if (host === undefined) continue
    const cls = classOf(body)
    hosts.set(node.id, host)
    classes.set(node.id, cls)
    const key = `${host}\u0000${cls}`
    const list = groups.get(key)
    if (list) list.push(node.id)
    else groups.set(key, [node.id])
  }
  const orbits = new Map<string, Orbit>()
  for (const [id, host] of hosts) {
    const cls = classes.get(id)!
    const siblings = groups.get(`${host}\u0000${cls}`)!
    const i = siblings.indexOf(id)
    orbits.set(id, {
      host,
      radius: ORBIT[cls].base + ORBIT[cls].step * i,
      phase: (2 * Math.PI * i) / siblings.length,
      speed: ORBIT.speed[cls],
      tilt: tiltOf(id),
    })
  }
  return orbits
}

/** The belt: every id on one tilted ring around the origin, evenly spaced. */
export function beltOf(ids: string[]): Map<string, Orbit> {
  const orbits = new Map<string, Orbit>()
  ids.forEach((id, i) => {
    orbits.set(id, {
      host: 'belt',
      radius: ORBIT.belt.radius,
      phase: (2 * Math.PI * i) / ids.length,
      speed: ORBIT.belt.speed,
      tilt: ORBIT.belt.tilt,
    })
  })
  return orbits
}

/** Where an orbiting body is at t seconds: a circle in the xz-plane, tilted
 * about the x axis, centred on its host. */
export function positionAt(orbit: Orbit, hostAt: Vec3, t: number): Vec3 {
  const a = orbit.phase + orbit.speed * t
  const x = orbit.radius * Math.cos(a)
  const z = orbit.radius * Math.sin(a)
  return {
    x: hostAt.x + x,
    y: hostAt.y - z * Math.sin(orbit.tilt),
    z: hostAt.z + z * Math.cos(orbit.tilt),
  }
}

/** Positions of every orbiting body at t. A host is a root position if given,
 * else its own resolved orbit, else the origin (the belt centre, an unknown
 * host, or a cycle). */
export function resolvePositions(orbits: Map<string, Orbit>, roots: Map<string, Vec3>, t: number): Map<string, Vec3> {
  const done = new Map<string, Vec3>()
  const walking = new Set<string>()
  const resolve = (id: string): Vec3 => {
    const root = roots.get(id)
    if (root) return root
    const cached = done.get(id)
    if (cached) return cached
    const orbit = orbits.get(id)
    if (!orbit || walking.has(id)) return ORIGIN
    walking.add(id)
    const at = positionAt(orbit, orbit.host === 'belt' ? ORIGIN : resolve(orbit.host), t)
    walking.delete(id)
    done.set(id, at)
    return at
  }
  for (const id of orbits.keys()) resolve(id)
  return done
}
