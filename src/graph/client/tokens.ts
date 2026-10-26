// src/graph/client/tokens.ts
// The token sheet (#272): the one place the page keeps a colour or a font.
// Simorgh's dark tokens (#263) and the Ledger's tones; the stylesheet's
// custom properties (stylesheet.ts) and the canvas colours (CANVAS, below)
// both derive from it. No other client module carries a colour or font literal.
import type { ChangeOp } from '../../types.js'

/** `#rrggbb` at an alpha, as the `rgba()` a canvas context can take. */
export function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

const WHITE = '#ffffff'
const BLACK = '#000000'

/** The palette. Hex hues first, then what derives from them. */
export const COLOR = {
  /** The page and its sidebars. */
  root: '#0e1117',
  /** The canvas: a darker well than the page. */
  well: '#0a0a0f',
  /** The one solid raised surface: popovers, the search list, the legend. */
  popover: '#161b22',
  text: '#e2e8f0',
  text2: '#94a3b8',
  muted: '#7c8da3',
  /** Live work, the primary accent, focus. */
  gold: '#cbaa4b',
  /** Knowledge. */
  wisdom: '#5b9bd5',
  /** Stale. */
  amber: '#fbbf24',
  /** The tag and domain layers. */
  info: '#38bdf8',
  teal: '#14b8a6',
  /** The Ledger's tones: one per write, never used for anything else. */
  create: '#22c55e',
  update: '#f97316',
  delete: '#ef4444',
  surface: alpha(WHITE, 0.04),
  elevated: alpha(WHITE, 0.07),
  border: alpha(WHITE, 0.07),
  hover: alpha(WHITE, 0.05),
  inset: alpha(BLACK, 0.4),
  shadow: alpha(BLACK, 0.5),
  scrollbar: alpha(WHITE, 0.08),
  scrollbarHover: alpha(WHITE, 0.15),
} as const

/** Geist for body text, Outfit for labels and headings, Geist Mono for data:
 * each first family is one of the bundled FONTS (fonts.ts), declared by the stylesheet. */
export const FONT = {
  sans: "'Geist', system-ui, sans-serif",
  display: "'Outfit', system-ui, sans-serif",
  mono: "'Geist Mono', ui-monospace, monospace",
} as const

/** Type sizes in px: a 12 px interface. */
export const TYPE = { micro: 10, label: 11, base: 12, body: 13, title: 16 } as const

/** The 4 px grid, radii and motion. */
export const SPACE = 4
export const RADIUS = { sm: 4, md: 8, lg: 12 } as const
export const MOTION = { fast: 180, normal: 350, ease: 'cubic-bezier(.4, 0, 0, 1)' } as const

/** The Ledger's tone per write. */
export const TONE: Record<ChangeOp, string> = { create: COLOR.create, update: COLOR.update, delete: COLOR.delete }

/** Canvas colours, resolved once here: draw code reads finished strings and
 * never builds a colour per frame (a canvas cannot resolve `var()`). */
export const CANVAS = {
  background: COLOR.well,
  label: COLOR.text2,
  /** A label the pointer or the panel singled out. */
  labelStrong: COLOR.text,
  /** The well-coloured outline a label is drawn on, so it reads over edges. */
  labelHalo: alpha(COLOR.well, 0.85),
  /** The label font for a pixel size. */
  font: (px: number): string => `${px}px ${FONT.sans}`,
  /** Territory names and the Unlinked frame's title, for a pixel size. */
  displayFont: (px: number): string => `600 ${px}px ${FONT.display}`,
  /** A top-level family's territory: gold when it holds live work. */
  territory: {
    live: { fill: alpha(COLOR.gold, 0.045), stroke: alpha(COLOR.gold, 0.14), name: alpha(COLOR.gold, 0.9) },
    plain: { fill: alpha(WHITE, 0.02), stroke: alpha(WHITE, 0.05), name: alpha(COLOR.muted, 0.7) },
  },
  /** The Unlinked frame: a dashed box, its title over it and its caption under it. */
  frame: { fill: alpha(WHITE, 0.025), stroke: alpha(WHITE, 0.09), title: COLOR.muted, caption: alpha(COLOR.muted, 0.7) },
  selectedRing: COLOR.text,
  entity: COLOR.gold,
  knowledge: COLOR.wisdom,
  /** A parent's hollow core: the well showing through. */
  core: COLOR.well,
  /** The Stale ring. */
  stale: COLOR.amber,
  /** Recency's glow round an Entity touched in the last few days: gold fading out. */
  glow: { inner: alpha(COLOR.gold, 0.45), outer: alpha(COLOR.gold, 0) },
  edge: {
    parent: alpha(WHITE, 0.16),
    related: alpha(WHITE, 0.08),
    mention: alpha(COLOR.text2, 0.3),
    /** Any edge with a done end: it fades with its node. */
    done: alpha(WHITE, 0.035),
  },
  /** Outside a hover or a highlight: the edges in this colour. */
  dimEdge: alpha(WHITE, 0.015),
} as const

/** The galaxy's palette (part 2): a black sky, the five temperature anchors
 * (white-blue at day 0 cooling to deep red at day 28), and the bodies. */
export const GALAXY = {
  space: '#000000',
  /** Days 0, 7, 14, 21, 28: white-blue, pale yellow-white, yellow, orange, deep red. */
  anchors: ['#cfe3ff', '#fff4d6', '#ffd23f', '#ff8c1a', '#a1141a'],
  /** A finished star's remnant, its clouds from inner to outer: teal, blue, violet, pink, a warm highlight. */
  nebula: ['#8cd7eb', '#78aae6', '#be6ed2', '#dca0eb', '#ffd9a3'],
  /** The bright point left at a nebula's centre. */
  remnant: WHITE,
  /** A cold star with open actions pulses this. */
  alarm: COLOR.amber,
  planet: { ringed: '#d9b97a', banded: '#c98f6b', bandedAlt: '#8fa9c9', rocky: '#a88f7c' },
  moon: '#9aa0a8',
  belt: '#5a5f66',
  /** The outline of a star whose heat is estimated from touches: opaque, as
   * three.js colours take no alpha; the outline's material sets its opacity. */
  estimated: COLOR.text2,
  core: alpha('#f5f8ff', 0.12),
} as const
