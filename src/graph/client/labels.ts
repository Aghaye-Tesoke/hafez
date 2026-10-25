// src/graph/client/labels.ts
// Labels (#275, spec #270 stories 33-35, critique V3/V4): which names the
// canvas draws. Prioritised (the selection, the hovered note and its
// neighbours, parents, then liveness), never overlapping, and coming in with
// zoom at a size held within bounds. Pure: boxes and plain node data in, the
// boxes to draw out; draw.ts measures and draws them.
import type { GraphNode } from '../../types.js'
import { isDone, isLive } from './signals.js'

/** What the pointer and the panel have singled out, by id (focus.ts and
 * highlight.ts keep it on `state`). */
export interface Focus {
  selected: string | null
  hovered: string | null
  /** The hovered note and its drawn neighbours. */
  hoverNear: Set<string>
  /** The selected note's drawn neighbours. */
  selectedNear: Set<string>
  /** The notes a highlight or a hovered family lights; null when none is on. */
  lit: Set<string> | null
}

/** Priority tiers, highest first. Within the parent and live tiers, more
 * open actions rank higher (ACTION each, up to SIZE_CLAMP's 12), and a live
 * parent above a paused or done one. */
const TIER = { selected: 1000, hovered: 950, hoverNear: 800, selectedNear: 700, lit: 500, parent: 300, live: 200, paused: 100, plan: 55, knowledge: 50, done: 10 } as const
const ACTION = 4
const LIVE_PARENT = 60

/** A note's label priority; `parent` when an Entity names it as its parent. */
export function priority(node: GraphNode, focus: Focus, parent: boolean): number {
  if (node.id === focus.selected) return TIER.selected
  if (node.id === focus.hovered) return TIER.hovered
  if (focus.hoverNear.has(node.id)) return TIER.hoverNear
  if (focus.selectedNear.has(node.id)) return TIER.selectedNear
  if (focus.lit?.has(node.id)) return TIER.lit
  const actions = Math.min(node.open_actions ?? 0, 12) * ACTION
  // Parents before liveness: a done parent still names its family.
  if (parent) return TIER.parent + (isLive(node) ? LIVE_PARENT : 0) + actions
  if (node.kind === 'knowledge') return node.subtype === 'plan' ? TIER.plan : TIER.knowledge
  if (isDone(node)) return TIER.done
  return isLive(node) ? TIER.live + actions : TIER.paused
}

/** Labels come in with zoom (story 35): below each scale, only labels of at
 * least this priority are drawn. Zoomed far out, the territories name the
 * families, and only the selection, the hover, a highlight and the live
 * parents are named; then every parent, live work, and the rest. */
const ZOOM_STEPS: Array<[scale: number, min: number]> = [[1.1, TIER.parent + LIVE_PARENT], [1.8, TIER.parent], [2.8, TIER.live], [4, TIER.knowledge]]

export function minPriority(scale: number): number {
  for (const [below, min] of ZOOM_STEPS) if (scale < below) return min
  return 0
}

/** A label's size on screen, in px: it grows with zoom, held within bounds (V4). */
export const LABEL_SIZE = { base: 11, min: 10.5, max: 13.5 } as const

export function labelPx(scale: number): number {
  return Math.min(LABEL_SIZE.max, Math.max(LABEL_SIZE.min, LABEL_SIZE.base * Math.sqrt(scale)))
}

/** A name as its label: past MAX_CHARS it is cut with an ellipsis. */
const MAX_CHARS = 34

export function labelText(name: string): string {
  return name.length > MAX_CHARS ? `${name.slice(0, MAX_CHARS - 2)}…` : name
}

/** A label's box in graph units (top-left corner, size) and its priority. */
export interface LabelBox {
  x: number
  y: number
  w: number
  h: number
  priority: number
}

/** The view, in graph units. */
export interface View { x: number; y: number; w: number; h: number }

/** The labels to draw, highest priority first: every box wholly in the view
 * that overlaps no box placed before it, nor comes within `pad` of one. Equal
 * priorities keep their input order. Boxes are bucketed on a grid, so a
 * frame costs about one check per neighbour, not per label. */
export function placeLabels<T extends LabelBox>(boxes: T[], view: View, pad = 0): T[] {
  const inView = boxes.filter(b => b.x >= view.x && b.x + b.w <= view.x + view.w && b.y >= view.y && b.y + b.h <= view.y + view.h)
  inView.sort((a, b) => b.priority - a.priority)
  const cell = Math.max(1, ...inView.slice(0, 32).map(b => Math.max(b.w, b.h))) + pad
  const grid = new Map<string, T[]>()
  const placed: T[] = []
  for (const b of inView) {
    const x0 = Math.floor((b.x - pad) / cell)
    const x1 = Math.floor((b.x + b.w + pad) / cell)
    const y0 = Math.floor((b.y - pad) / cell)
    const y1 = Math.floor((b.y + b.h + pad) / cell)
    let clear = true
    for (let gx = x0; gx <= x1 && clear; gx++) {
      for (let gy = y0; gy <= y1 && clear; gy++) {
        for (const o of grid.get(`${gx},${gy}`) ?? []) {
          if (b.x < o.x + o.w + pad && o.x < b.x + b.w + pad && b.y < o.y + o.h + pad && o.y < b.y + b.h + pad) {
            clear = false
            break
          }
        }
      }
    }
    if (!clear) continue
    placed.push(b)
    for (let gx = x0; gx <= x1; gx++) {
      for (let gy = y0; gy <= y1; gy++) {
        const key = `${gx},${gy}`
        const bucket = grid.get(key)
        if (bucket) bucket.push(b)
        else grid.set(key, [b])
      }
    }
  }
  return placed
}
