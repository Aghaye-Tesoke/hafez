// src/graph/client/legend.ts
// The legend (#272): a dropdown under the header's `?` naming every mark the
// canvas draws. Each swatch is drawn from the canvas's own styles (style.ts),
// so the legend cannot drift from the encoding: a change to what the canvas
// draws is a change to MARKS. A click elsewhere or Esc closes it.
import type { GraphEdge, GraphNode } from '../../types.js'
import { localDay } from '../../dates.js'
import { edgeStyle, GLOW_REACH, nodeStyle } from './style.js'
import { CANVAS, TONE } from './tokens.js'
import { el } from './shell.js'

const SVG = 'http://www.w3.org/2000/svg'

function svg(...shapes: Array<Record<string, string | number>>): SVGSVGElement {
  const root = document.createElementNS(SVG, 'svg')
  for (const [k, v] of Object.entries({ width: 22, height: 18, viewBox: '0 0 22 18', 'aria-hidden': 'true' })) root.setAttribute(k, String(v))
  for (const { tag, ...attrs } of shapes) {
    const shape = document.createElementNS(SVG, String(tag))
    for (const [k, v] of Object.entries(attrs)) shape.setAttribute(k, String(v))
    root.append(shape)
  }
  return root
}

type Shape = Record<string, string | number>

const sample = (fields: Partial<GraphNode>): GraphNode => ({ id: '', kind: 'entity', name: '', status: 'active', ...fields })
const today = localDay()
/** Touched today, so glowing; and long ago, so faded. */
const RECENT = { last_touched: today }
const LONG_AGO = { last_touched: '2000-01-01' }

/** A node of the canvas's own style; `r` overrides its radius, `scale` scales it. */
function node(fields: Partial<GraphNode>, opts: { r?: number; scale?: number; cx?: number; parent?: boolean } = {}): Shape[] {
  const style = nodeStyle(sample(fields), today, opts.parent ?? false)
  const r = opts.r ?? style.radius * (opts.scale ?? 1)
  const cx = opts.cx ?? 11
  const paint: Shape = style.hollow ? { fill: 'none', stroke: style.fill, 'stroke-width': 1.2 } : { fill: style.fill }
  const shapes: Shape[] = []
  if (style.glow) shapes.push({ tag: 'circle', cx, cy: 9, r: Math.min(8.5, r * GLOW_REACH / 2), fill: CANVAS.glow.inner })
  if (style.shape === 'diamond') {
    const d = r * 1.25
    shapes.push({ tag: 'polygon', points: `${cx},${9 - d} ${cx + d},9 ${cx},${9 + d} ${cx - d},9`, ...paint })
  } else shapes.push({ tag: 'circle', cx, cy: 9, r, ...paint })
  if (style.core) shapes.push({ tag: 'circle', cx, cy: 9, r: r * 0.38, fill: CANVAS.core })
  if (style.ring) shapes.push({ tag: 'circle', cx, cy: 9, r: r + 2, fill: 'none', stroke: style.ring, 'stroke-width': 1.5 })
  return shapes
}

function edge(relation: GraphEdge['relation'], done = false): Shape {
  const { color, width, dash } = edgeStyle({ source: '', target: '', relation }, done)
  // Drawn wider than on the canvas, where an edge is seen against many.
  return { tag: 'line', x1: 2, y1: 9, x2: 20, y2: 9, stroke: color, 'stroke-width': Math.max(1.5, width * 2), 'stroke-dasharray': dash?.join(' ') ?? 'none' }
}

const pulse = (color: string): Shape[] => [{ tag: 'circle', cx: 11, cy: 9, r: 3.5, fill: color }, { tag: 'circle', cx: 11, cy: 9, r: 7, fill: 'none', stroke: color, 'stroke-width': 1.5 }]

/** Every mark the canvas draws, in reading order; `group` starts a new run. */
const MARKS: Array<{ label: string; swatch: () => SVGSVGElement; group?: boolean }> = [
  { label: 'Entity: a gold disc', swatch: () => svg(...node({}, { r: 4.5 })) },
  { label: 'Knowledge note: a blue diamond', swatch: () => svg(...node({ kind: 'knowledge' }, { r: 4 })) },
  { label: 'Plan: a hollow diamond', swatch: () => svg(...node({ kind: 'knowledge', subtype: 'plan' }, { r: 4 })) },
  { label: 'Parent: a hollow core', swatch: () => svg(...node({}, { r: 5.5, parent: true })) },
  { label: 'Size: open actions, up to 12; active work keeps a floor', swatch: () => svg(...node({ open_actions: 0 }, { scale: 0.75, cx: 5 }), ...node({ open_actions: 9 }, { scale: 0.75, cx: 14 })), group: true },
  { label: 'Glow: touched in the last 3 days', swatch: () => svg(...node(RECENT, { r: 4 })) },
  { label: "Faded: untouched past its staleness-days", swatch: () => svg(...node(LONG_AGO, { r: 4.5 })) },
  { label: 'Amber ring: Stale, active and untouched past its staleness-days', swatch: () => svg(...node({ ...LONG_AGO, stale: true }, { r: 4.5 })) },
  { label: 'Paused: recency only, no size or ring', swatch: () => svg(...node({ status: 'paused' })) },
  { label: 'Done: faint, its links too (shown under Everything)', swatch: () => svg(...node({ status: 'done' }, { r: 4.5 })) },
  { label: 'Selected', swatch: () => svg(...node({}, { r: 4.5 }), { tag: 'circle', cx: 11, cy: 9, r: 7.5, fill: 'none', stroke: CANVAS.selectedRing, 'stroke-width': 1.5 }) },
  { label: 'Territory: a top-level family, gold when it holds live work', swatch: () => svg({ tag: 'circle', cx: 11, cy: 9, r: 7.5, fill: CANVAS.territory.live.fill, stroke: CANVAS.territory.live.stroke }), group: true },
  { label: 'Unlinked: no parent, related or wiki-link, gathered in one frame', swatch: () => svg({ tag: 'rect', x: 3, y: 3, width: 16, height: 12, rx: 3, fill: CANVAS.frame.fill, stroke: CANVAS.frame.stroke, 'stroke-dasharray': '2 2' }) },
  { label: 'Parent link', swatch: () => svg(edge('parent')), group: true },
  { label: 'Related link', swatch: () => svg(edge('related')) },
  { label: 'Wiki-link (dashed)', swatch: () => svg(edge('mention')) },
  { label: 'Link to done work (faint)', swatch: () => svg(edge('related', true)) },
  { label: 'Pulse: a note just created', swatch: () => svg(...pulse(TONE.create)), group: true },
  { label: 'Pulse: a note just updated', swatch: () => svg(...pulse(TONE.update)) },
  { label: 'Pulse: a note just deleted, fading out', swatch: () => svg(...pulse(TONE.delete)) },
]

/** Fill the legend popover and bind its `?` button. */
export function mountLegend(toggle: HTMLButtonElement, popover: HTMLElement): void {
  const list = el('dl')
  for (const { label, swatch, group } of MARKS) {
    list.append(el('dt', group ? { class: 'group' } : {}, swatch()), el('dd', group ? { class: 'group' } : {}, label))
  }
  popover.append(el('div', { class: 'label' }, 'Legend'), list)

  const open = (on: boolean) => {
    popover.hidden = !on
    toggle.setAttribute('aria-expanded', String(on))
  }
  toggle.addEventListener('click', () => open(popover.hidden))
  document.addEventListener('pointerdown', event => {
    const target = event.target as Node
    if (!popover.hidden && !popover.contains(target) && !toggle.contains(target)) open(false)
  })
  // Captured, so the legend's Esc closes the legend and nothing else (not the panel).
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || popover.hidden) return
    event.stopImmediatePropagation()
    open(false)
    toggle.focus()
  }, { capture: true })
}
