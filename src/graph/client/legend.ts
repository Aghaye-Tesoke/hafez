// src/graph/client/legend.ts
// The legend (#272, spec "Labels", "The six bodies"): a dropdown under the
// header's `?`. First the sky in one row of swatches (the cooling clock, open
// work, finished, planet and belt) and the one sentence that reads it, then
// the six bodies, one line each. Every swatch is a small SVG drawn in the
// body colours of the token sheet (GALAXY), so the legend cannot drift from
// what the sky draws: a change to the bodies is a change to BODIES. A click
// elsewhere or Esc closes it.
import { GALAXY } from './tokens.js'
import { el } from './shell.js'

const SVG = 'http://www.w3.org/2000/svg'

type Shape = Record<string, string | number>

function svg(...shapes: Shape[]): SVGSVGElement {
  const root = document.createElementNS(SVG, 'svg')
  for (const [k, v] of Object.entries({ width: 22, height: 18, viewBox: '0 0 22 18', 'aria-hidden': 'true' })) root.setAttribute(k, String(v))
  for (const { tag, ...attrs } of shapes) {
    const shape = document.createElementNS(SVG, String(tag))
    for (const [k, v] of Object.entries(attrs)) shape.setAttribute(k, String(v))
    root.append(shape)
  }
  return root
}

const disc = (fill: string, r: number, extra: Shape = {}): Shape => ({ tag: 'circle', cx: 11, cy: 9, r, fill, ...extra })
/** A star: its disc in a faint halo of its own colour. */
const star = (fill: string, r = 3.5): Shape[] => [disc(fill, r * 2.2, { opacity: 0.18 }), disc(fill, r)]
/** A nebula: soft overlapping clouds in the remnant's hues, outer first, and its bright point. */
const cloud = (hues: readonly string[]): Shape[] => [
  disc(hues[3], 8, { opacity: 0.18 }), disc(hues[2], 6, { opacity: 0.25, cx: 13, cy: 8 }),
  disc(hues[1], 5, { opacity: 0.3, cx: 9, cy: 10 }), disc(hues[0], 3.5, { opacity: 0.4, cx: 11, cy: 8 }), disc(GALAXY.remnant, 1, { opacity: 0.9 }),
]

/** The sky in one row: the clock's four temperatures (days 0, 7, 14, 28), then the rest. */
const SWATCHES: Array<{ label: string; swatch: () => SVGSVGElement }> = [
  { label: 'this week', swatch: () => svg(...star(GALAXY.anchors[0])) },
  { label: '2 weeks', swatch: () => svg(...star(GALAXY.anchors[1])) },
  { label: '3 weeks', swatch: () => svg(...star(GALAXY.anchors[2])) },
  { label: '4 weeks +', swatch: () => svg(...star(GALAXY.anchors[4], 2.5)) },
  { label: 'open work', swatch: () => svg(disc(GALAXY.anchors[4], 2.5), disc('none', 6.5, { stroke: GALAXY.alarm, 'stroke-width': 1.2 })) },
  { label: 'finished', swatch: () => svg(...cloud(GALAXY.nebula)) },
  { label: 'planet · part', swatch: () => svg(disc(GALAXY.planet.ringed, 3.5)) },
  { label: 'belt · loose ideas', swatch: () => svg(disc(GALAXY.belt, 1.6, { cx: 5 }), disc(GALAXY.belt, 1.6, { cx: 11, cy: 7 }), disc(GALAXY.belt, 1.6, { cx: 17 })) },
]

const SENTENCE = 'Every star is a project — the hotter its colour, the more recently you worked on it.'

/** The six bodies the sky draws, one line each. */
const BODIES: Array<{ label: string; swatch: () => SVGSVGElement }> = [
  { label: 'Galaxy core: a project with parts; what belongs to it orbits it', swatch: () => svg(disc(GALAXY.anchors[0], 8, { opacity: 0.12 }), ...star(GALAXY.anchors[0], 3)) },
  { label: 'Star: a project, white-blue when worked on this week, a red dwarf after four', swatch: () => svg(...star(GALAXY.anchors[1])) },
  { label: 'Nebula: a finished project, kept in the sky in both scopes', swatch: () => svg(...cloud(GALAXY.nebula)) },
  { label: 'Planet: knowledge; ringed a principle, banded a pattern, rocky an observation', swatch: () => svg(disc(GALAXY.planet.ringed, 3.5), { tag: 'ellipse', cx: 11, cy: 9, rx: 8, ry: 2.4, fill: 'none', stroke: GALAXY.planet.ringed, 'stroke-width': 1, opacity: 0.7 }) },
  { label: 'Moon: a task, capture or other entity orbiting what it belongs to', swatch: () => svg(disc(GALAXY.moon, 2.2)) },
  { label: 'Belt: loose ideas, linked to nothing, on one tilted ring', swatch: () => svg(disc(GALAXY.belt, 1.6, { cx: 5 }), disc(GALAXY.belt, 1.6, { cx: 11, cy: 7 }), disc(GALAXY.belt, 1.6, { cx: 17 })) },
]

/** Fill the legend popover and bind its `?` button. */
export function mountLegend(toggle: HTMLButtonElement, popover: HTMLElement): void {
  const row = el('ul', { class: 'swatches' })
  for (const { label, swatch } of SWATCHES) row.append(el('li', {}, swatch(), el('span', {}, label)))
  const list = el('dl')
  for (const { label, swatch } of BODIES) list.append(el('dt', {}, swatch()), el('dd', {}, label))
  popover.append(el('div', { class: 'label' }, 'Legend'), row, el('p', { class: 'sentence' }, SENTENCE), list)

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
