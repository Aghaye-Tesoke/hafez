// src/graph/client/galaxy/meshes.ts
// The six bodies as three.js groups (spec "Stars", "Planets", "The belt", "The
// alarm"). `bodyStyle` is the pure part: a node and its body kind in, the
// look out (radius, colour, glow, alarm, estimated). `makeBody` builds the
// group from a style; `updateBody` retunes it in place so positions and the
// scene reference stay. Unlit: spheres are MeshBasicMaterial, so a colour
// reads exactly as its token. The shared textures are made once, lazily, and
// only when a DOM exists; without one the sprites render untextured.
import * as THREE from 'three'
import type { GraphNode } from '../../../types.js'
import type { Body } from './bodies.js'
import { daysSince, glow, isAlarm, isEstimated, starRadius, temperatureColor } from './temperature.js'
import { GALAXY } from '../tokens.js'

export interface BodyStyle {
  body: Body
  radius: number
  color: string
  glow: { intensity: number; reach: number }
  alarm: boolean
  estimated: boolean
  label: string
}

const isStarLike = (body: Body): boolean => body === 'star' || body === 'core'
/** A halo is never more opaque than this, however hot its star. */
const GLOW_OPACITY_MAX = 0.45
/** A core's wide halo: faint, so the galaxy's middle stays translucent. */
const CORE_HALO = { opacity: 0.08, scale: 10 }
/** A nebula spans this many of its body radii: the remnant of a star, wider than the star was. */
export const NEBULA_SPAN = 6
/** The nebula's five clouds, one hue each from GALAXY.nebula in order (teal,
 * blue, violet, pink, warm): size and offset in nebula radii, the direction
 * of the offset in degrees, fixed so teal sits on one side and violet-pink on
 * the other. Additive, translucent and apart, so the hues stay distinct
 * instead of averaging into one tint. */
const NEBULA_CLOUDS = [
  { size: 0.55, offset: 0.45, angle: 200, opacity: 0.5 },
  { size: 0.8, offset: 0.35, angle: 250, opacity: 0.3 },
  { size: 1.0, offset: 0.5, angle: 20, opacity: 0.5 },
  { size: 0.9, offset: 0.6, angle: 70, opacity: 0.3 },
  { size: 0.7, offset: 0.55, angle: 130, opacity: 0.3 },
]
/** The bright heart, in nebula radii, and the debris: eight specks a pixel or
 * so wide on screen, alternating teal and pink, on fixed angles 0.3 to 1.1 radii out. */
const NEBULA_HEART = { size: 0.16, opacity: 0.9 }
const NEBULA_DEBRIS = { count: 8, from: 0.3, to: 1.1, speck: 0.0018, opacity: 0.6 }
const isPlanet = (body: Body): boolean => body.startsWith('planet-')

function bodyColor(node: GraphNode, body: Body, today: string): string {
  switch (body) {
    case 'star':
    case 'core':
      return temperatureColor(daysSince(node.last_active, today))
    case 'nebula':
      return GALAXY.nebula[0]
    case 'planet-ringed':
      return GALAXY.planet.ringed
    case 'planet-banded':
      return GALAXY.planet.banded
    case 'planet-rocky':
      return GALAXY.planet.rocky
    case 'moon':
      return GALAXY.moon
    case 'belt':
      return GALAXY.belt
  }
}

/** The look of one body today. Pure. */
export function bodyStyle(node: GraphNode, body: Body, today: string): BodyStyle {
  const radius = isPlanet(body) ? 2.6 : body === 'moon' ? 1.6 : body === 'belt' ? 1.2 : starRadius(node)
  return {
    body,
    radius,
    color: bodyColor(node, body, today),
    glow: isStarLike(body) ? glow(node.heat) : { intensity: 0, reach: 0 },
    alarm: isAlarm(node, today),
    estimated: isEstimated(node) && isStarLike(body),
    label: node.name,
  }
}

// Shared textures: one each, made on first use, never disposed per body.
let glowTexture: THREE.Texture | null | undefined
let bandTexture: THREE.Texture | null | undefined

function glowMap(): THREE.Texture | undefined {
  if (glowTexture === undefined) {
    glowTexture = null
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 128
      const ctx = canvas.getContext('2d')
      if (ctx) {
        const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
        g.addColorStop(0, 'rgba(255,255,255,1)')
        g.addColorStop(0.35, 'rgba(255,255,255,0.35)')
        g.addColorStop(1, 'rgba(255,255,255,0)')
        ctx.fillStyle = g
        ctx.fillRect(0, 0, 128, 128)
        glowTexture = new THREE.CanvasTexture(canvas)
      }
    }
  }
  return glowTexture ?? undefined
}

function bandMap(): THREE.Texture | undefined {
  if (bandTexture === undefined) {
    bandTexture = null
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas')
      canvas.width = 8
      canvas.height = 64
      const ctx = canvas.getContext('2d')
      if (ctx) {
        for (let i = 0; i < 8; i++) {
          ctx.fillStyle = i % 2 === 0 ? GALAXY.planet.banded : GALAXY.planet.bandedAlt
          ctx.fillRect(0, i * 8, 8, 8)
        }
        bandTexture = new THREE.CanvasTexture(canvas)
      }
    }
  }
  return bandTexture ?? undefined
}

function sprite(name: string, color: string, opacity: number, scale: number): THREE.Sprite {
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowMap(),
      color: new THREE.Color(color),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity,
    }),
  )
  s.name = name
  s.scale.setScalar(scale)
  return s
}

function alarmRing(radius: number): THREE.Mesh {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius * 2.2, 0.08, 8, 64),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(GALAXY.alarm), transparent: true, opacity: 0.5 }),
  )
  ring.name = 'alarm'
  ring.rotation.x = Math.PI / 2
  return ring
}

function estimatedOutline(radius: number): THREE.LineLoop {
  const points: THREE.Vector3[] = []
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2
    points.push(new THREE.Vector3(Math.cos(a) * radius * 1.5, Math.sin(a) * radius * 1.5, 0))
  }
  const line = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineDashedMaterial({
      color: new THREE.Color(GALAXY.estimated),
      dashSize: radius * 0.2,
      gapSize: radius * 0.15,
      transparent: true,
      opacity: 0.5,
    }),
  )
  line.computeLineDistances()
  line.name = 'estimated'
  return line
}

/** Build the group for one body. */
export function makeBody(style: BodyStyle): THREE.Group {
  const group = new THREE.Group()
  group.userData.body = style.body
  group.userData.radius = style.radius
  const { body, radius } = style

  if (body === 'nebula') {
    const R = radius * NEBULA_SPAN
    const at = (angle: number, distance: number, s: THREE.Object3D) => {
      const a = (angle * Math.PI) / 180
      s.position.set(Math.cos(a) * distance * R, Math.sin(a) * distance * R, Math.sin(a * 2) * distance * R * 0.3)
    }
    const cloud = new THREE.Group()
    cloud.name = 'cloud'
    NEBULA_CLOUDS.forEach(({ size, offset, angle, opacity }, i) => {
      // The sprite's soft disc fades out well inside its square: twice the size reads as `size`.
      const s = sprite('', GALAXY.nebula[i], opacity, 2 * size * R)
      at(angle, offset, s)
      cloud.add(s)
    })
    for (let i = 0; i < NEBULA_DEBRIS.count; i++) {
      const speck = new THREE.Sprite(new THREE.SpriteMaterial({
        color: new THREE.Color(GALAXY.nebula[i % 2 === 0 ? 0 : 3]),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: NEBULA_DEBRIS.opacity,
        // A speck keeps its pixel size at any distance.
        sizeAttenuation: false,
      }))
      speck.scale.setScalar(NEBULA_DEBRIS.speck)
      at(i * (360 / NEBULA_DEBRIS.count) + 15, NEBULA_DEBRIS.from + ((NEBULA_DEBRIS.to - NEBULA_DEBRIS.from) * i) / (NEBULA_DEBRIS.count - 1), speck)
      cloud.add(speck)
    }
    group.add(cloud)
    group.add(sprite('remnant', GALAXY.remnant, NEBULA_HEART.opacity, 2 * NEBULA_HEART.size * R))
  } else {
    const banded = body === 'planet-banded' ? bandMap() : undefined
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 24, 16),
      new THREE.MeshBasicMaterial(banded ? { map: banded } : { color: new THREE.Color(style.color) }),
    )
    sphere.name = 'sphere'
    group.add(sphere)
  }

  if (isStarLike(body)) {
    group.add(sprite('glow', style.color, Math.min(style.glow.intensity, GLOW_OPACITY_MAX), style.glow.reach * radius * 2))
  }
  if (body === 'core') group.add(sprite('core', style.color, CORE_HALO.opacity, radius * CORE_HALO.scale))
  if (body === 'planet-ringed') {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius * 1.6, radius * 2.4, 48),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(style.color), side: THREE.DoubleSide, transparent: true, opacity: 0.7 }),
    )
    ring.name = 'ring'
    ring.rotation.x = 0.4
    group.add(ring)
  }
  if (style.alarm) group.add(alarmRing(radius))
  if (style.estimated) group.add(estimatedOutline(radius))
  return group
}

const materialOf = (o: THREE.Object3D | undefined): THREE.Material | undefined =>
  (o as THREE.Mesh | undefined)?.material as THREE.Material | undefined

function disposeObject(o: THREE.Object3D): void {
  const m = o as THREE.Mesh
  m.geometry?.dispose()
  const mat = m.material as THREE.Material | THREE.Material[] | undefined
  if (Array.isArray(mat)) mat.forEach(x => x.dispose())
  else mat?.dispose()
}

/** Retune a built group to a new style, in place; never rebuilds. */
export function updateBody(group: THREE.Group, style: BodyStyle): void {
  const body = group.userData.body as Body
  const color = new THREE.Color(style.color)
  const sphere = group.getObjectByName('sphere')
  if (sphere && body !== 'planet-banded') (materialOf(sphere) as THREE.MeshBasicMaterial).color.copy(color)
  const halo = group.getObjectByName('glow') as THREE.Sprite | undefined
  if (halo) {
    halo.material.color.copy(color)
    halo.material.opacity = Math.min(style.glow.intensity, GLOW_OPACITY_MAX)
    halo.scale.setScalar(style.glow.reach * style.radius * 2)
  }
  const core = group.getObjectByName('core') as THREE.Sprite | undefined
  if (core) {
    core.material.color.copy(color)
    core.scale.setScalar(style.radius * CORE_HALO.scale)
  }

  // Added children are built at the build radius, then scaled with the rest.
  const built = group.userData.radius as number
  const alarm = group.getObjectByName('alarm')
  if (style.alarm && !alarm) group.add(alarmRing(built))
  else if (!style.alarm && alarm) {
    group.remove(alarm)
    disposeObject(alarm)
  }
  const outline = group.getObjectByName('estimated')
  if (style.estimated && !outline) group.add(estimatedOutline(built))
  else if (!style.estimated && outline) {
    group.remove(outline)
    disposeObject(outline)
  }
  const k = style.radius / built
  for (const name of ['sphere', 'ring', 'alarm', 'estimated']) group.getObjectByName(name)?.scale.setScalar(k)
}

/** The slow amber pulse. */
export function tickAlarm(group: THREE.Group, t: number): void {
  const m = materialOf(group.getObjectByName('alarm'))
  if (m) m.opacity = 0.35 + 0.35 * Math.sin(t * 1.2)
}

/** The supernova shell: one additive sprite in the star's colour. */
export function burstMesh(style: BodyStyle): THREE.Group {
  const group = new THREE.Group()
  group.userData.radius = style.radius
  group.add(sprite('burst', style.color, 1, style.radius * 2))
  return group
}

/** Expand and fade the shell; `progress` runs 0 to 1. */
export function tickBurst(group: THREE.Group, progress: number): void {
  const shell = group.getObjectByName('burst') as THREE.Sprite | undefined
  if (!shell) return
  shell.scale.setScalar((group.userData.radius as number) * 2 * (1 + 14 * progress))
  shell.material.opacity = 1 - progress
}

/** Free each child's geometry and material; the shared textures stay. */
export function disposeBody(group: THREE.Group): void {
  group.traverse(disposeObject)
}
