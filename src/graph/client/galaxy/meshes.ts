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
const isPlanet = (body: Body): boolean => body.startsWith('planet-')

function bodyColor(node: GraphNode, body: Body, today: string): string {
  switch (body) {
    case 'star':
    case 'core':
      return temperatureColor(daysSince(node.last_active, today))
    case 'nebula':
      return GALAXY.nebula
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

/** A deterministic 32-bit hash (FNV-1a) of a string; the nebula's seed. */
function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

/** A seeded stream of numbers in [0, 1). */
function stream(seed: number): () => number {
  let s = seed || 1
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
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
    const next = stream(hash(style.label))
    const cloud = new THREE.Group()
    cloud.name = 'cloud'
    for (let i = 0; i < 12; i++) {
      const s = sprite('', GALAXY.nebula, 0.12 + next() * 0.13, radius * (2 + next() * 2))
      s.position.set((next() * 2 - 1) * 3 * radius, (next() * 2 - 1) * 3 * radius, (next() * 2 - 1) * 3 * radius)
      cloud.add(s)
    }
    group.add(cloud)
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
    group.add(sprite('glow', style.color, style.glow.intensity, style.glow.reach * radius * 2))
  }
  if (body === 'core') group.add(sprite('core', style.color, 0.18, radius * 14))
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
    halo.material.opacity = style.glow.intensity
    halo.scale.setScalar(style.glow.reach * style.radius * 2)
  }
  const core = group.getObjectByName('core') as THREE.Sprite | undefined
  if (core) {
    core.material.color.copy(color)
    core.scale.setScalar(style.radius * 14)
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
