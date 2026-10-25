// src/graph/client/layout.ts
// The layout (#275, spec #270 "Forces (Q3)"): where nodes start, what pulls
// them, and the shapes drawn under them. Pure: plain node data in, positions
// and geometry out, no DOM and no force-graph; main.ts hands these to the
// simulation and draw.ts draws what they return.
import type { GraphEdge, GraphNode } from '../../types.js'
import { isLive } from './signals.js'

/** A node as the layout sees it: its id, and the position the simulation keeps on it. */
export interface Placed {
  id: string
  x?: number
  y?: number
}

/** The force configuration: one deliberate choice, not library defaults
 * (story 102). The values are the prototype's (#267, variant D):
 * - links: a child is held hard and short to its parent, so every parent
 *   anchors its family (story 22); related and mention edges barely pull;
 * - charge: live work pushes twice as hard as the rest, so it gets room; an
 *   Unlinked note is pinned in its frame and pushes nothing;
 * - no centre force: d3's drags every node by the layout's offset each tick;
 *   a weak gravity keeps families from drifting off instead;
 * - 220 warm-up ticks run before the first frame, so it looks settled
 *   (story 25); the engine then stops on alphaMin (d3's own default, which
 *   force-graph leaves at 0), well inside the 2.5 s cooldown. Stopping on a
 *   tick count rather than the clock is what makes two loads alike (story 26);
 * - in the local graph (#279), a neighbourhood of a few dozen notes, related
 *   and mention edges pull too, so it lays out compactly around its centre
 *   instead of where the overview had each note (S2).
 * No sliders (story 30). */
export const FORCES = {
  parentLink: { distance: 26, strength: 0.7 },
  otherLink: { distance: 70, strength: 0.04 },
  localLink: { distance: 50, strength: 0.5 },
  charge: { live: -70, rest: -35 },
  chargeDistanceMax: 380,
  gravity: 0.012,
  warmupTicks: 220,
  cooldownMs: 2500,
  alphaDecay: 0.03,
  alphaMin: 0.001,
  velocityDecay: 0.35,
} as const

/** A link's distance and strength; `local` in the local graph. */
export const link = (edge: Pick<GraphEdge, 'relation'>, local = false): { distance: number; strength: number } =>
  edge.relation === 'parent' ? FORCES.parentLink : local ? FORCES.localLink : FORCES.otherLink

/** A node's charge. */
export const charge = (node: GraphNode): number =>
  node.unlinked ? 0 : isLive(node) ? FORCES.charge.live : FORCES.charge.rest

/** A body the simulation moves: its position, velocity and pin. */
interface Body { x?: number; y?: number; vx?: number; vy?: number; fx?: number; fy?: number }

/** The weak gravity: every free node is pulled toward the origin in
 * proportion to its distance and the heat. A d3 force (initialize, then
 * called with alpha each tick). */
export function gravity(): ((alpha: number) => void) & { initialize(nodes: Body[]): void } {
  let bodies: Body[] = []
  return Object.assign((alpha: number) => {
    for (const n of bodies) {
      if (n.fx !== undefined) continue
      n.vx = (n.vx ?? 0) - (n.x ?? 0) * FORCES.gravity * alpha
      n.vy = (n.vy ?? 0) - (n.y ?? 0) * FORCES.gravity * alpha
    }
  }, { initialize(nodes: Body[]) { bodies = nodes } })
}

/** Seeding (L5): a root sits on a ring at a radius and an angle hashed from
 * its slug, a child this far from its parent. */
export const SEED = { ringMin: 120, ringSpread: 520, child: 30 } as const

const TAU = Math.PI * 2

/** A slug's hash in [0, 1): FNV-1a. The same slug lands in the same place on every load. */
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967296
}

/** Give every node without a position a seeded one, parents before their
 * children: a root on the ring, a child beside its parent (`parentOf` maps
 * a child's id to its parent's). A node already placed keeps its place. */
export function seed(nodes: Placed[], parentOf: Map<string, string>): void {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const visiting = new Set<string>()
  const place = (n: Placed): void => {
    if (n.x !== undefined && n.y !== undefined) return
    visiting.add(n.id)
    const angle = hash(n.id) * TAU
    const parentId = parentOf.get(n.id)
    const parent = parentId === undefined || visiting.has(parentId) ? undefined : byId.get(parentId)
    if (parent) place(parent)
    if (parent?.x !== undefined && parent.y !== undefined) {
      n.x = parent.x + Math.cos(angle) * SEED.child
      n.y = parent.y + Math.sin(angle) * SEED.child
    } else {
      const r = SEED.ringMin + hash(`${n.id}r`) * SEED.ringSpread
      n.x = Math.cos(angle) * r
      n.y = Math.sin(angle) * r
    }
    visiting.delete(n.id)
  }
  for (const n of nodes) place(n)
}

/** The Unlinked frame (L1): a grid of slots this far apart, inset from the
 * frame's edge, the frame this far right of the linked graph. */
export const FRAME = { gap: 90, col: 20, row: 16, insetX: 14, insetY: 12, minRows: 4 } as const

/** Where the Unlinked notes sit: the frame's box in graph units, its rows,
 * and each note's slot in it (`cell`: its place in the grid, column by column). */
export interface Frame {
  x: number
  y: number
  w: number
  h: number
  rows: number
  count: number
  slots: Map<string, { x: number; y: number; cell: number }>
}

/** Entities first, done last, then by name: the order the frame's slots fill in. */
const frameOrder = (a: GraphNode, b: GraphNode): number =>
  a.kind.localeCompare(b.kind)
  || Number(a.status === 'done') - Number(b.status === 'done')
  || a.name.localeCompare(b.name)
  || a.id.localeCompare(b.id)

/** Lay the Unlinked notes out in one frame beside the linked graph (story
 * 24): a grid, Entities first, filled column by column, its middle level
 * with the graph's. Null when there is none. Given the `previous` frame (a
 * live write changed the Unlinked set, story 31), the frame stays where it
 * was, every note in it keeps its slot, and a new note takes the first free
 * slot, a freed one before a new one; without it (a load, a Re-layout) the
 * slots are sorted afresh. */
export function unlinkedFrame(unlinked: GraphNode[], linked: Placed[], previous: Frame | null = null): Frame | null {
  if (unlinked.length === 0) return null
  const rows = previous?.rows ?? Math.max(FRAME.minRows, Math.ceil(Math.sqrt(unlinked.length * 2.2)))
  const cells = new Map<string, number>()
  const order = [...unlinked].sort(frameOrder)
  for (const n of order) {
    const kept = previous?.slots.get(n.id)
    if (kept) cells.set(n.id, kept.cell)
  }
  const taken = new Set(cells.values())
  let free = 0
  for (const n of order) {
    if (cells.has(n.id)) continue
    while (taken.has(free)) free++
    cells.set(n.id, free)
    taken.add(free)
  }
  const last = Math.max(...taken)
  const w = Math.floor(last / rows) * FRAME.col + FRAME.insetX * 2
  const h = (Math.min(rows, last + 1) - 1) * FRAME.row + FRAME.insetY * 2
  let { x, y } = previous ?? { x: 0, y: 0 }
  if (!previous) {
    const xs = linked.map(n => n.x ?? 0)
    const ys = linked.map(n => n.y ?? 0)
    const middle = ys.length > 0 ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0
    x = xs.length > 0 ? Math.max(...xs) + FRAME.gap : -w / 2
    y = middle - h / 2
  }
  const slots = new Map<string, { x: number; y: number; cell: number }>()
  for (const [id, cell] of cells) {
    slots.set(id, { x: x + FRAME.insetX + Math.floor(cell / rows) * FRAME.col, y: y + FRAME.insetY + (cell % rows) * FRAME.row, cell })
  }
  return { x, y, w, h, rows, count: unlinked.length, slots }
}

/** Territories (story 23): every family of at least `min` drawn notes, a
 * parent and one child, gets a circle this far outside its outermost member. */
export const TERRITORY = { min: 2, pad: 14 } as const

/** A top-level family's circle, named for its root; `live` when it holds live work. */
export interface Territory {
  root: string
  name: string
  x: number
  y: number
  r: number
  live: boolean
  members: number
}

/** The territories of the drawn nodes: each top-level family (a root and
 * every drawn generation under it) as a circle round its centroid. The root
 * is the topmost drawn ancestor: one the view hides does not split its family. */
export function territories(drawn: Array<GraphNode & Placed>, parentOf: Map<string, string>): Territory[] {
  const byId = new Map(drawn.map(n => [n.id, n]))
  const families = new Map<string, Array<GraphNode & Placed>>()
  for (const n of drawn) {
    let root = n
    const seen = new Set([n.id])
    for (let p = byId.get(parentOf.get(root.id) ?? ''); p && !seen.has(p.id); p = byId.get(parentOf.get(root.id) ?? '')) {
      seen.add(p.id)
      root = p
    }
    const family = families.get(root.id)
    if (family) family.push(n)
    else families.set(root.id, [n])
  }
  const out: Territory[] = []
  for (const [root, members] of families) {
    if (members.length < TERRITORY.min) continue
    let x = 0
    let y = 0
    for (const m of members) {
      x += m.x ?? 0
      y += m.y ?? 0
    }
    x /= members.length
    y /= members.length
    let r = 0
    for (const m of members) r = Math.max(r, Math.hypot((m.x ?? 0) - x, (m.y ?? 0) - y))
    out.push({ root, name: byId.get(root)!.name, x, y, r: r + TERRITORY.pad, live: members.some(isLive), members: members.length })
  }
  return out
}

/** The camera that fits the drawn graph in a view of `view` px with `padding`
 * px to spare (stories 27-28): its centre in graph units and its zoom. The
 * Unlinked frame's title and caption are drawn at a fixed size on screen and
 * run past the frame's right edge (`text`: their width, and how far they reach
 * above and below it, in px), so they are fitted too: a plain bounding-box
 * fit would cut them off at the edge of the canvas. */
export function fitView(
  nodes: Array<Placed & { r: number }>,
  frame: Frame | null,
  text: { w: number; above: number; below: number },
  view: { w: number; h: number },
  padding: number,
): { x: number; y: number; k: number } {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const n of nodes) {
    minX = Math.min(minX, (n.x ?? 0) - n.r)
    maxX = Math.max(maxX, (n.x ?? 0) + n.r)
    minY = Math.min(minY, (n.y ?? 0) - n.r)
    maxY = Math.max(maxY, (n.y ?? 0) + n.r)
  }
  if (frame) {
    minX = Math.min(minX, frame.x)
    maxX = Math.max(maxX, frame.x + frame.w)
    minY = Math.min(minY, frame.y)
    maxY = Math.max(maxY, frame.y + frame.h)
  }
  if (minX > maxX) return { x: 0, y: 0, k: 1 }
  const room = { w: view.w - padding * 2, h: view.h - padding * 2 }
  // Each span is graph units (zoomed) plus screen px (not): span·k + px ≤ room.
  const spansX: Array<[number, number]> = [[maxX - minX, 0]]
  const spansY: Array<[number, number]> = [[maxY - minY, 0]]
  if (frame) {
    const bottom = frame.y + frame.h
    spansX.push([frame.x - minX, text.w])
    spansY.push([maxY - frame.y, text.above], [bottom - minY, text.below], [frame.h, text.above + text.below])
  }
  let k = Infinity
  for (const [spans, size] of [[spansX, room.w], [spansY, room.h]] as const) {
    for (const [span, px] of spans) if (span > 0) k = Math.min(k, Math.max(size - px, 1) / span)
  }
  if (!Number.isFinite(k)) k = 1
  const right = frame ? Math.max(maxX, frame.x + text.w / k) : maxX
  const top = frame ? Math.min(minY, frame.y - text.above / k) : minY
  const bottom = frame ? Math.max(maxY, frame.y + frame.h + text.below / k) : maxY
  return { x: (minX + right) / 2, y: (top + bottom) / 2, k }
}
