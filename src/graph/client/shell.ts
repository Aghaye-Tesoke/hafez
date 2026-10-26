// src/graph/client/shell.ts
// The page's shell (#272): a header, the left sidebar, the canvas and the
// right sidebar, in that DOM order so the tab order follows the layout. The
// shell owns layout only; every other module mounts into one of its named
// slots and never appends to <body> itself.
//
// - header: brand and the `counts` line (projects, galaxies, finished),
//   `scope` (the Live work / Everything switch), `search`, then `tools`
//   (Knowledge, Fit all, Fly (F) and the `?` legend);
// - left sidebar: one Section per slot, Live work, Unlinked and Activity,
//   each hidden until a module fills it (`section.show()`);
// - `canvas`: the 3D graph's host, and `hint`, the line on how to move
//   about, which main.ts puts over it once the graph has taken the host;
// - right sidebar: `note` (the panel).
// Both sidebars resize by dragging their grip and collapse or restore on a
// double-click of it.

export type SectionId = 'live' | 'unlinked' | 'activity'

export interface Section {
  root: HTMLElement
  /** Where the section's content goes; it caps its height and scrolls. */
  body: HTMLElement
  /** The figure beside the label: a count, or a short state. */
  setCount(text: string): void
  /** Sections start hidden: the module that fills one shows it. */
  show(): void
}

export interface Shell {
  scope: HTMLElement
  search: HTMLElement
  /** `N projects · M galaxies · K finished`, set by main.ts on each load. */
  counts: HTMLElement
  tools: { knowledge: HTMLButtonElement; fit: HTMLButtonElement; fly: HTMLButtonElement; legend: HTMLButtonElement }
  /** The legend popover under `?`: legend.ts fills it. */
  legend: HTMLElement
  sections: Record<SectionId, Section>
  canvas: HTMLElement
  /** How to move about the sky: main.ts appends it to the canvas after the graph mounts. */
  hint: HTMLElement
  note: HTMLElement
}

const SECTIONS: Array<[SectionId, string]> = [
  ['live', 'Live work'],
  ['unlinked', 'Unlinked'],
  ['activity', 'Activity'],
]

/** Sidebar widths in px: the default is a share of the window within bounds. */
const WIDTH = {
  left: { share: 0.21, min: 220, max: 300 },
  right: { share: 0.28, min: 280, max: 420 },
}
/** A drag below this collapses the sidebar; no drag goes past MAX_WIDTH. */
const COLLAPSE_BELOW = 160
const MAX_WIDTH = 640

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: Array<Node | string>): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v
    else node.setAttribute(k, v)
  }
  node.append(...kids)
  return node
}

function section(id: SectionId, title: string): Section {
  const bodyId = `sec-${id}`
  const count = el('span', { class: 'count' })
  const head = el('button', { class: 'sec-head', type: 'button', 'aria-expanded': 'true', 'aria-controls': bodyId },
    el('span', { class: 'label' }, title), count, el('span', { class: 'chev', 'aria-hidden': 'true' }, '▾'))
  const body = el('div', { class: 'sec-body', id: bodyId })
  head.addEventListener('click', () => {
    const open = head.getAttribute('aria-expanded') !== 'true'
    head.setAttribute('aria-expanded', String(open))
    body.hidden = !open
  })
  const root = el('section', { class: 'sec', id, hidden: '' }, el('h2', {}, head), body)
  return {
    root,
    body,
    setCount: text => { count.textContent = text },
    show: () => { root.hidden = false },
  }
}

const button = (text: string, attrs: Record<string, string> = {}): HTMLButtonElement =>
  el('button', { class: 'btn', type: 'button', ...attrs }, text)

export function mountShell(): Shell {
  const app = el('div', { id: 'app' })

  const scope = el('div', { id: 'scope', role: 'group', 'aria-label': 'Scope' })
  const search = el('div', { id: 'search' })
  const tools = {
    knowledge: button('Knowledge', { 'aria-pressed': 'true', title: 'Show or hide Knowledge notes' }),
    fit: button('Fit all', { title: 'Frame the whole sky' }),
    fly: button('Fly (F)', { 'aria-pressed': 'false', title: 'Fly freely: WASD to move, drag to look, Esc to come back' }),
    legend: button('?', { class: 'btn icon', 'aria-label': 'Legend', 'aria-expanded': 'false', 'aria-controls': 'legend', title: 'Legend' }),
  }
  const legend = el('div', { id: 'legend', class: 'popover', role: 'dialog', 'aria-label': 'Legend', hidden: '' })
  const counts = el('div', { id: 'counts', class: 'mono' })
  const head = el('header', { id: 'head' },
    el('div', { class: 'brand' }, 'HAFEZ', el('span', {}, 'GRAPH')),
    counts, scope, search,
    el('div', { id: 'tools' }, tools.knowledge, tools.fit, tools.fly, tools.legend, legend))

  const sections = Object.fromEntries(SECTIONS.map(([id, title]) => [id, section(id, title)])) as Record<SectionId, Section>
  const left = el('nav', { id: 'left', class: 'side', 'aria-label': 'Vault' }, ...SECTIONS.map(([id]) => sections[id].root))
  const canvas = el('main', { id: 'canvas', 'aria-label': 'Galaxy' })
  const hint = el('p', { id: 'hint' }, 'Scroll to fly · drag to look around · click a star for details')
  const note = el('div', { id: 'note' })
  const right = el('aside', { id: 'right', class: 'side', 'aria-label': 'Note' }, note)

  const widths = { left: defaultWidth('left'), right: defaultWidth('right') }
  const restore = { ...widths }
  const setWidths = () => {
    app.style.setProperty('--left', `${widths.left}px`)
    app.style.setProperty('--right', `${widths.right}px`)
    // A collapsed sidebar keeps its place in the grid but leaves the tab order.
    left.inert = widths.left === 0
    right.inert = widths.right === 0
  }
  const grip = (side: 'left' | 'right') => {
    const g = el('div', { class: 'grip', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': `Resize the ${side} sidebar`, title: 'Drag to resize · double-click to collapse or restore' })
    g.addEventListener('pointerdown', down => {
      g.setPointerCapture(down.pointerId)
      g.classList.add('drag')
      const x0 = down.clientX
      const w0 = widths[side]
      const move = (e: PointerEvent) => {
        const w = Math.min(MAX_WIDTH, Math.max(0, w0 + (side === 'left' ? e.clientX - x0 : x0 - e.clientX)))
        widths[side] = w < COLLAPSE_BELOW ? 0 : w
        setWidths()
      }
      const up = () => {
        g.removeEventListener('pointermove', move)
        g.classList.remove('drag')
        if (widths[side]) restore[side] = widths[side]
      }
      g.addEventListener('pointermove', move)
      g.addEventListener('pointerup', up, { once: true })
    })
    g.addEventListener('dblclick', () => {
      widths[side] = widths[side] ? 0 : restore[side]
      setWidths()
    })
    return g
  }

  app.append(head, left, grip('left'), canvas, grip('right'), right)
  setWidths()
  document.body.append(app)
  return { counts, scope, search, tools, legend, sections, canvas, hint, note }
}

function defaultWidth(side: 'left' | 'right'): number {
  const { share, min, max } = WIDTH[side]
  return Math.round(Math.min(max, Math.max(min, window.innerWidth * share)))
}
