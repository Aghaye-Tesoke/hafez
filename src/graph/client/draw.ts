// src/graph/client/draw.ts
// The draw callbacks. Each is a module-level function handed to force-graph
// exactly once: they read the style resolved onto the object and the frame
// state, and allocate nothing per node per frame (the glow is one sprite,
// drawn once and stamped). Under the nodes, the territories and the Unlinked
// frame; over them, the labels, boxed and placed once per frame so none
// overlaps (labels.ts), each text measured once.
import { state, type DrawLink, type DrawNode } from './state.js'
import { DIM_ALPHA, DIM_EDGE, GLOW_REACH, LABEL_COLOR, SELECTED_RING } from './style.js'
import { CANVAS } from './tokens.js'
import { territories, type Territory } from './layout.js'
import { labelPx, labelText, minPriority, placeLabels, priority, type Focus, type LabelBox } from './labels.js'

const TAU = Math.PI * 2
/** A diamond's half-diagonal per radius: it reads as large as a disc of that radius. */
const DIAMOND = 1.25
/** The glow sprite's side, in px. */
const GLOW_PX = 64

let glowSprite: HTMLCanvasElement | null = null

/** Recency's glow: gold fading out from the centre, drawn once. Static, so
 * there is no glow animation for prefers-reduced-motion to stop. */
function glow(): HTMLCanvasElement {
  if (glowSprite) return glowSprite
  const sprite = document.createElement('canvas')
  sprite.width = sprite.height = GLOW_PX
  const ctx = sprite.getContext('2d')!
  const half = GLOW_PX / 2
  const g = ctx.createRadialGradient(half, half, half * 0.6 / GLOW_REACH, half, half, half)
  g.addColorStop(0, CANVAS.glow.inner)
  g.addColorStop(1, CANVAS.glow.outer)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, GLOW_PX, GLOW_PX)
  return (glowSprite = sprite)
}

export function framePre(_ctx: CanvasRenderingContext2D, scale: number): void {
  state.font = CANVAS.font(labelPx(scale) / scale)
}

/** Whether a node draws dimmed: outside the hovered neighbourhood, else
 * outside a hovered family, else outside a highlight. */
function dimmed(node: DrawNode): boolean {
  if (state.hovered !== null) return !state.focusNodes.has(node)
  const lit = state.family ?? state.lit
  return lit !== null && !lit.has(node)
}

/** The node's outline as the current path. */
function shape(ctx: CanvasRenderingContext2D, node: DrawNode, x: number, y: number, radius: number): void {
  ctx.beginPath()
  if (node.style.shape === 'diamond') {
    const d = radius * DIAMOND
    ctx.moveTo(x, y - d)
    ctx.lineTo(x + d, y)
    ctx.lineTo(x, y + d)
    ctx.lineTo(x - d, y)
    ctx.closePath()
  } else ctx.arc(x, y, radius, 0, TAU)
}

export function drawNode(node: DrawNode, ctx: CanvasRenderingContext2D, scale: number): void {
  const { radius, fill, hollow, core, ring } = node.style
  const x = node.x ?? 0
  const y = node.y ?? 0
  const dim = dimmed(node)
  if (dim) ctx.globalAlpha = DIM_ALPHA
  else if (node.style.glow) {
    const reach = radius * GLOW_REACH
    ctx.drawImage(glow(), x - reach, y - reach, reach * 2, reach * 2)
  }
  shape(ctx, node, x, y, radius)
  if (hollow) {
    ctx.lineWidth = 1.2 / scale
    ctx.strokeStyle = fill
    ctx.stroke()
  } else {
    ctx.fillStyle = fill
    ctx.fill()
  }
  if (core) {
    ctx.beginPath()
    ctx.arc(x, y, radius * 0.38, 0, TAU)
    ctx.fillStyle = CANVAS.core
    ctx.fill()
  }
  if (ring) {
    ctx.beginPath()
    ctx.arc(x, y, radius + 2.2 / scale, 0, TAU)
    ctx.lineWidth = 1.6 / scale
    ctx.strokeStyle = ring
    ctx.stroke()
  }
  const selected = node === state.selected
  if (selected) {
    ctx.beginPath()
    ctx.arc(x, y, radius + 5 / scale, 0, TAU)
    ctx.lineWidth = 1.5 / scale
    ctx.strokeStyle = SELECTED_RING
    ctx.stroke()
  }
  if (dim) ctx.globalAlpha = 1
}

export function paintPointerArea(node: DrawNode, color: string, ctx: CanvasRenderingContext2D): void {
  ctx.beginPath()
  ctx.arc(node.x ?? 0, node.y ?? 0, node.style.radius * DIAMOND + 1, 0, TAU)
  ctx.fillStyle = color
  ctx.fill()
}

/** An edge outside the hovered neighbourhood, or with an end outside a
 * hovered family or a highlight, draws dimmed. */
export function linkColor(link: DrawLink): string {
  if (state.hovered !== null) return state.focusLinks.has(link) ? link.style.color : DIM_EDGE
  const lit = state.family ?? state.lit
  if (lit === null) return link.style.color
  return typeof link.source !== 'string' && typeof link.target !== 'string' && lit.has(link.source) && lit.has(link.target) ? link.style.color : DIM_EDGE
}
export const linkWidth = (link: DrawLink): number => link.style.width
export const linkDash = (link: DrawLink): number[] | null => link.style.dash

/** Territory names show while zoomed out this far; past it, the root's own
 * label (a parent's) names the family. */
const TERRITORY_NAMES_BELOW = 1.1
/** Priorities of the canvas's own text: the frame's always shows; a
 * territory's name gives way to the hovered neighbourhood's labels. */
const FRAME_PRIORITY = 2000
const TERRITORY_PRIORITY = { live: 650, plain: 600 } as const
/** Screen px: territory names, the frame's title and caption, the gap kept between labels. */
const TEXT_PX = { territoryLive: 13, territory: 11, frameTitle: 11, frameCaption: 10.5, pad: 2 } as const
/** A line of text is this many times its size tall; the frame's text sits this many px off it. */
const LINE = 1.25
const FRAME_GAP = 6
const FRAME_CAPTION = 'no parent, related or wiki-link'
const frameTitle = (count: number): string => `UNLINKED · ${count}`
/** The territories drawn this frame, kept for the label pass. */
let drawnTerritories: Territory[] = []

/** onRenderFramePre: each top-level family's territory, and the Unlinked frame. */
export function drawUnder(ctx: CanvasRenderingContext2D, scale: number, nodes: DrawNode[]): void {
  drawnTerritories = territories(nodes, state.parentOf)
  ctx.lineWidth = 1 / scale
  for (const t of drawnTerritories) {
    const tone = t.live ? CANVAS.territory.live : CANVAS.territory.plain
    ctx.beginPath()
    ctx.arc(t.x, t.y, t.r, 0, TAU)
    ctx.fillStyle = tone.fill
    ctx.fill()
    ctx.strokeStyle = tone.stroke
    ctx.stroke()
  }
  const frame = state.frame
  if (!frame) return
  ctx.save()
  ctx.setLineDash([4 / scale, 4 / scale])
  ctx.beginPath()
  ctx.roundRect(frame.x, frame.y, frame.w, frame.h, 10)
  ctx.fillStyle = CANVAS.frame.fill
  ctx.fill()
  ctx.strokeStyle = CANVAS.frame.stroke
  ctx.stroke()
  ctx.restore()
}

/** A text to draw: its box (graph units), where and how it is drawn. */
interface Label extends LabelBox {
  text: string
  /** The anchor fillText is given, and the alignment it is drawn with. */
  ax: number
  ay: number
  align: CanvasTextAlign
  font: string
  color: string
  halo: boolean
}

/** Text widths at 100 px, by font kind and text: a label is measured once,
 * then scaled. Emptied when the bundled fonts finish loading. */
const widths = new Map<string, number>()
export function fontsLoaded(): void { widths.clear() }

let measurer: CanvasRenderingContext2D | null = null

/** How far the frame's title and caption reach, in screen px: right of the
 * frame's left edge, above it and below it. Fit makes room for them. */
export function frameTextReach(): { w: number; above: number; below: number } {
  const frame = state.frame
  if (!frame) return { w: 0, above: 0, below: 0 }
  measurer ??= document.createElement('canvas').getContext('2d')!
  return {
    w: Math.max(width(measurer, 'display', frameTitle(frame.count), TEXT_PX.frameTitle), width(measurer, 'sans', FRAME_CAPTION, TEXT_PX.frameCaption)),
    above: FRAME_GAP + TEXT_PX.frameTitle * LINE,
    below: FRAME_GAP + TEXT_PX.frameCaption * LINE,
  }
}

function width(ctx: CanvasRenderingContext2D, kind: 'sans' | 'display', text: string, px: number): number {
  const key = `${kind}\u0000${text}`
  let w = widths.get(key)
  if (w === undefined) {
    ctx.font = kind === 'sans' ? CANVAS.font(100) : CANVAS.displayFont(100)
    w = ctx.measureText(text).width
    widths.set(key, w)
  }
  return w * px / 100
}

/** The view in graph units, from the context's transform and the canvas's size. */
function viewOf(ctx: CanvasRenderingContext2D): { x: number; y: number; w: number; h: number } {
  const t = ctx.getTransform()
  return { x: -t.e / t.a, y: -t.f / t.d, w: ctx.canvas.width / t.a, h: ctx.canvas.height / t.d }
}

const toIds = (nodes: Set<DrawNode> | null): Set<string> | null => nodes && new Set([...nodes].map(n => n.id))

/** onRenderFramePost: the labels. Every candidate is boxed, the frame's text
 * and the territory names first, and placeLabels keeps the ones that overlap
 * nothing placed before them. A dimmed node is not labelled. */
export function drawLabels(ctx: CanvasRenderingContext2D, scale: number, nodes: DrawNode[]): void {
  const labels: Label[] = []
  const px = labelPx(scale)
  const lineH = px * LINE / scale
  const frame = state.frame
  if (frame) {
    const title = frameTitle(frame.count)
    const th = TEXT_PX.frameTitle * LINE / scale
    const ty = frame.y - FRAME_GAP / scale - th
    labels.push({ text: title, x: frame.x, y: ty, w: width(ctx, 'display', title, TEXT_PX.frameTitle) / scale, h: th, priority: FRAME_PRIORITY + 1, ax: frame.x, ay: ty, align: 'left', font: CANVAS.displayFont(TEXT_PX.frameTitle / scale), color: CANVAS.frame.title, halo: false })
    const cy = frame.y + frame.h + FRAME_GAP / scale
    labels.push({ text: FRAME_CAPTION, x: frame.x, y: cy, w: width(ctx, 'sans', FRAME_CAPTION, TEXT_PX.frameCaption) / scale, h: TEXT_PX.frameCaption * LINE / scale, priority: FRAME_PRIORITY, ax: frame.x, ay: cy, align: 'left', font: CANVAS.font(TEXT_PX.frameCaption / scale), color: CANVAS.frame.caption, halo: false })
  }
  // A territory's name names its root: the root's own label waits for the zoom that hides the names.
  const named = new Set<string>()
  if (scale < TERRITORY_NAMES_BELOW) {
    for (const t of drawnTerritories) {
      named.add(t.root)
      const tpx = t.live ? TEXT_PX.territoryLive : TEXT_PX.territory
      const text = labelText(t.name).toUpperCase()
      const w = width(ctx, 'display', text, tpx) / scale
      const h = tpx * LINE / scale
      const y = t.y - t.r - 3 / scale - h
      labels.push({ text, x: t.x - w / 2, y, w, h, priority: (t.live ? TERRITORY_PRIORITY.live : TERRITORY_PRIORITY.plain) + Math.min(t.members, 49), ax: t.x, ay: y, align: 'center', font: CANVAS.displayFont(tpx / scale), color: t.live ? CANVAS.territory.live.name : CANVAS.territory.plain.name, halo: true })
    }
  }
  const focus: Focus = {
    selected: state.selected?.id ?? null,
    hovered: state.hovered?.id ?? null,
    hoverNear: toIds(state.focusNodes)!,
    selectedNear: state.selectedNear,
    lit: toIds(state.family ?? state.lit),
  }
  const min = state.local ? 0 : minPriority(scale)
  for (const node of nodes) {
    if (dimmed(node)) continue
    const p = priority(node, focus, node.style.core)
    if (p < min || (named.has(node.id) && p < TERRITORY_PRIORITY.plain)) continue
    const text = labelText(node.name)
    const w = width(ctx, 'sans', text, px) / scale
    const x = node.x ?? 0
    const y = (node.y ?? 0) + node.style.radius * (node.style.shape === 'diamond' ? DIAMOND : 1) + 3 / scale
    labels.push({ text, x: x - w / 2, y, w, h: lineH, priority: p, ax: x, ay: y, align: 'center', font: state.font, color: p >= 700 ? CANVAS.labelStrong : LABEL_COLOR, halo: true })
  }
  ctx.save()
  ctx.textBaseline = 'top'
  ctx.lineJoin = 'round'
  ctx.lineWidth = 3 / scale
  ctx.strokeStyle = CANVAS.labelHalo
  for (const l of placeLabels(labels, viewOf(ctx), TEXT_PX.pad / scale)) {
    ctx.font = l.font
    ctx.textAlign = l.align
    if (l.halo) ctx.strokeText(l.text, l.ax, l.ay)
    ctx.fillStyle = l.color
    ctx.fillText(l.text, l.ax, l.ay)
  }
  ctx.restore()
}
