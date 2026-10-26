// src/graph/client/galaxy/camera.ts
// Camera logic for the galaxy: fly to a body, frame the whole vault, and free
// flight (F toggles, WASD + drag to look, Escape returns to orbit; keys
// typed into a field never fly). The two
// position functions are pure; mountCamera is the thin 3d-force-graph wiring.
// Escape belongs to the camera only in free flight; otherwise the page owns it.
// Under reduced motion every move is instant.
import { Vector3 } from 'three'
import { FlyControls } from 'three/examples/jsm/controls/FlyControls.js'
import type { ForceGraph3DInstance } from '3d-force-graph'
import { reducedMotion } from '../motion.js'
import type { Vec3 } from './orbits.js'

export interface Bounds {
  center: Vec3
  radius: number
}

export interface Camera {
  flyTo(target: Vec3, radius: number, ms: number): void
  overview(bounds: Bounds, ms: number): void
  distanceTo(p: Vec3): number
  setFly(on: boolean): void
  /** Whether free flight is on. */
  isFlying(): boolean
  /** Remove the window listeners and leave fly mode. */
  dispose(): void
}

export const FLY = { speed: 120, roll: 0.6 }

/** `from` moved to `dist` from `to`, keeping the direction `to`→`from` (+z if they coincide). */
const along = (from: Vec3, to: Vec3, dist: number): Vec3 => {
  let dx = from.x - to.x
  let dy = from.y - to.y
  let dz = from.z - to.z
  let len = Math.hypot(dx, dy, dz)
  if (len === 0) {
    dx = 0
    dy = 0
    dz = 1
    len = 1
  }
  const k = dist / len
  return { x: to.x + dx * k, y: to.y + dy * k, z: to.z + dz * k }
}

/** Where the camera goes to look at a body of `radius`: 3.5·radius + 20 out, along the current view direction. */
export const flyPosition = (from: Vec3, target: Vec3, radius: number): Vec3 =>
  along(from, target, 3.5 * radius + 20)

/** How far from the centre the camera frames `bounds`: 2.2·radius + 40. */
export const overviewDistance = (bounds: Bounds): number => bounds.radius * 2.2 + 40

/** Where the camera goes to frame `bounds`: overviewDistance out from the centre. */
export const overviewPosition = (from: Vec3, bounds: Bounds): Vec3 =>
  along(from, bounds.center, overviewDistance(bounds))

const typing = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null
  if (!el || typeof el.tagName !== 'string') return false
  return /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable === true
}

export function mountCamera(graph: ForceGraph3DInstance, canvas: HTMLElement): Camera {
  void canvas // fly controls read the renderer's own element, which is the page's canvas
  let lastBounds: Bounds | null = null
  let fly: FlyControls | null = null
  let flying = false
  let frame = 0
  let last = 0

  const ms = (n: number): number => (reducedMotion() ? 0 : n)

  const tick = (now: number): void => {
    if (!flying || !fly) return
    // FlyControls listens on the window: keys typed into a field must not move the camera.
    if (!typing(document.activeElement)) fly.update((now - last) / 1000)
    last = now
    frame = requestAnimationFrame(tick)
  }

  const setFly = (on: boolean): void => {
    if (on === flying) return
    const controls = graph.controls() as {
      enabled: boolean
      update?: () => void
      target?: { set?: (x: number, y: number, z: number) => void }
    }
    flying = on
    if (on) {
      controls.enabled = false
      if (!fly) {
        fly = new FlyControls(graph.camera(), graph.renderer().domElement)
        fly.dragToLook = true
        fly.movementSpeed = FLY.speed
        fly.rollSpeed = FLY.roll
      }
      last = performance.now()
      frame = requestAnimationFrame(tick)
    } else {
      cancelAnimationFrame(frame)
      fly?.dispose()
      fly = null
      controls.enabled = true
      // Re-pivot ahead of the camera so update() keeps where the user flew to.
      const cam = graph.camera()
      const t = controls.target
      if (t && typeof t.set === 'function') {
        const old = t as unknown as Vec3
        const d = Math.hypot(cam.position.x - old.x, cam.position.y - old.y, cam.position.z - old.z) || 200
        const f = cam.getWorldDirection(new Vector3())
        t.set(cam.position.x + f.x * d, cam.position.y + f.y * d, cam.position.z + f.z * d)
      }
      controls.update?.()
    }
  }

  const overview = (bounds: Bounds, ms_: number): void => {
    lastBounds = bounds
    graph.cameraPosition(overviewPosition(graph.camera().position, bounds), bounds.center, ms(ms_))
  }

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      // Out of flight, Escape is the page's (it closes the panel, then frames the overview).
      if (!flying) return
      setFly(false)
      if (lastBounds) overview(lastBounds, 800)
    } else if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey && !typing(e.target)) {
      if (e.repeat) return
      e.preventDefault()
      setFly(!flying)
    }
  }
  window.addEventListener('keydown', onKey)

  return {
    flyTo(target, radius, ms_) {
      graph.cameraPosition(flyPosition(graph.camera().position, target, radius), target, ms(ms_))
    },
    overview,
    distanceTo(p) {
      const c = graph.camera().position
      return Math.hypot(c.x - p.x, c.y - p.y, c.z - p.z)
    },
    setFly,
    isFlying: () => flying,
    dispose() {
      window.removeEventListener('keydown', onKey)
      setFly(false)
    },
  }
}
