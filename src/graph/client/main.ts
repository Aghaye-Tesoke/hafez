// src/graph/client/main.ts
// The page's entry point, bundled by esbuild into dist/graph/client.js: the
// one stylesheet and the shell, one force-graph instance in the shell's canvas
// with its callbacks and forces set once (layout.ts), then the Graph loaded
// from the server. Pan, zoom and drag are force-graph's own.
import ForceGraph from 'force-graph'
import { applyGraph, state, type DrawLink, type DrawNode } from './state.js'
import { drawLabels, drawNode, drawUnder, fontsLoaded, framePre, frameTextReach, linkColor, linkDash, linkWidth, paintPointerArea } from './draw.js'
import { BACKGROUND } from './style.js'
import { charge, fitView, FORCES, gravity, link, unlinkedFrame, type Frame } from './layout.js'
import { isNote, mountScope, reveal, scopeShows } from './scope.js'
import { bindHighlight } from './highlight.js'
import { visibleGraph } from './visible.js'
import { hoverNode, markSelection } from './focus.js'
import { bindPanel, closePanel, selectNode } from './panel.js'
import { drawPulses, followCommits } from './live.js'
import { depthControl, initialFocus, localDepth, localOn, setCentre, setDepth } from './local.js'
import { mountSearch } from './search.js'
import { bindActivity, drawGhosts } from './activity.js'
import { stylesheet } from './stylesheet.js'
import { mountShell } from './shell.js'
import { mountLegend } from './legend.js'
import { fetchGraph, mountStates } from './states.js'
import { clearMiss, offerClosest } from './miss.js'
import { mountSections } from './sections.js'
import { facets } from './sidebar.js'
import { escStep, type Depth } from './view.js'
import { mountNotice } from './notice.js'
import { motion } from './motion.js'

/** How long the camera takes to reach a selected node, and the zoom it reaches
 * at least: past the parents' labels (labels.ts), short of live work's, so
 * the selection's neighbourhood and the parents are labelled, not every node
 * in view. */
const EASE_MS = 600
const FOCUS_ZOOM = 2
/** Fit: how long the camera takes, and the margin it leaves, in px. */
const FIT_MS = 400
const FIT_PADDING = 40
/** The local graph's fit zooms in no further than this: a lone note or a
 * small neighbourhood is not blown up to fill the canvas. */
const LOCAL_MAX_ZOOM = 4

document.head.append(Object.assign(document.createElement('style'), { textContent: stylesheet() }))
const shell = mountShell()

/** Nodes held in place while the simulation settles the ones a view change brought in. */
const pinned = new Set<DrawNode>()
/** The nodes a view change brought in, free until the simulation settles: a
 * second show() before then must not pin them where they were seeded. */
const settling = new Set<DrawNode>()

/** The Unlinked notes pinned in the frame, and the ids it was laid out for:
 * a view change that draws other Unlinked notes lays it out again. */
const framed = new Set<DrawNode>()
let frameKey: string | null = null
/** The frame a data refresh lays the Unlinked notes out against, so each
 * keeps its slot (story 31); null lays the frame out afresh. */
let frameBase: Frame | null = null
/** Fit the camera on the next tick: the first after a load's, a Re-layout's
 * or a local graph's warm-up, when the layout has settled (V2). */
let fitPending = true
/** Every node's place in the overview, kept while the local graph lays its
 * neighbourhood out afresh: leaving the local graph puts them back. */
let overview: Map<DrawNode, Pick<DrawNode, 'x' | 'y' | 'fx' | 'fy'>> | null = null
/** After leaving the local graph: ease to the selection instead of fitting. */
let easeAfterFit = false
state.local = localOn()

/** A node to select once the simulation has placed it (the URL's focus, or a
 * search match the local graph only now brings in); with `settle`, the camera
 * eases to it again when the layout has settled. */
let pendingSelect: string | null = initialFocus
let settle = initialFocus !== null

/** The first tick after a warm-up runs before that frame is drawn: the frame
 * is laid out and the camera fitted there, so the first frame shows both.
 * The engine's stop does the same, should it come without a tick. */
function afterWarmup(): void {
  // The engine also runs on the empty graph force-graph starts with.
  if (graph.graphData().nodes.length === 0) return
  if (frameKey === null) placeFrame()
  if (fitPending) {
    fitPending = false
    if (easeAfterFit && state.selected) ease(state.selected)
    else fit(0)
    easeAfterFit = false
  }
}

function onTick(): void {
  afterWarmup()
  const id = pendingSelect
  if (id === null || !graph.graphData().nodes.some(n => n.id === id)) return
  pendingSelect = null
  selectNode(id)
}

function onStop(): void {
  afterWarmup()
  for (const n of pinned) {
    n.fx = undefined
    n.fy = undefined
  }
  pinned.clear()
  settling.clear()
  if (settle && state.selected?.id === initialFocus) ease(state.selected)
  settle = false
}

// `.backgroundColor(` first: the evidence harness finds the instance by it.
const graph = new ForceGraph<DrawNode, DrawLink>(shell.canvas)
  .backgroundColor(BACKGROUND)
  .width(shell.canvas.clientWidth)
  .height(shell.canvas.clientHeight)
  .nodeCanvasObjectMode(() => 'replace')
  .nodeCanvasObject(drawNode)
  .nodePointerAreaPaint(paintPointerArea)
  .onRenderFramePre(beforeFrame)
  .onRenderFramePost(afterFrame)
  .linkColor(linkColor)
  .linkWidth(linkWidth)
  .linkLineDash(linkDash)
  .onEngineStop(onStop)
  .onEngineTick(onTick)
  .nodeLabel(noTooltip)
  .onNodeHover(onHover)
  .onNodeClick(onClick)
  .warmupTicks(FORCES.warmupTicks)
  .cooldownTime(FORCES.cooldownMs)
  .d3AlphaDecay(FORCES.alphaDecay)
  .d3AlphaMin(FORCES.alphaMin)
  .d3VelocityDecay(FORCES.velocityDecay)

// The forces (layout.ts): parents anchor their children, live work gets room,
// a weak gravity in place of d3's centring force.
graph.d3Force('link')!.distance((l: DrawLink) => link(l, state.local).distance).strength((l: DrawLink) => link(l, state.local).strength)
graph.d3Force('charge')!.strength(charge).distanceMax(FORCES.chargeDistanceMax)
graph.d3Force('center', null)
graph.d3Force('gravity', gravity())

// The camera settles on the URL's focus only while the user has not moved it.
// Captured: d3-zoom stops these events from bubbling past the canvas.
for (const type of ['wheel', 'pointerdown', 'touchstart']) {
  shell.canvas.addEventListener(type, () => { settle = false }, { capture: true, passive: true })
}

// Territories and the Unlinked frame go under the nodes; labels, pulses and
// ghosts over them.
function beforeFrame(ctx: CanvasRenderingContext2D, scale: number): void {
  framePre(ctx, scale)
  drawUnder(ctx, scale, graph.graphData().nodes)
}

function afterFrame(ctx: CanvasRenderingContext2D, scale: number): void {
  drawLabels(ctx, scale, graph.graphData().nodes)
  drawPulses(ctx, scale)
  drawGhosts(ctx, scale)
}

// Labels name the hovered neighbourhood on the canvas: the tooltip would repeat it.
function noTooltip(): string { return '' }

// Re-setting a callback to itself is how force-graph is told to draw one more
// frame once the simulation has cooled: hover and selection change no data.
function redraw(): void { graph.linkColor(linkColor) }

function onHover(node: DrawNode | null): void {
  hoverNode(node, graph.graphData().links)
  redraw()
}

function onClick(node: DrawNode): void { selectNode(node.id) }

/** Bring a node to the middle of the canvas. Not in the local graph: a
 * selection there re-centres it, and the new neighbourhood is fitted. */
function ease(node: DrawNode): void {
  if (state.local || node.x === undefined || node.y === undefined) return
  const zoom = Math.max(graph.zoom(), FOCUS_ZOOM)
  graph.centerAt(node.x, node.y, motion(EASE_MS))
  graph.zoom(zoom, motion(EASE_MS))
}

bindPanel(shell.note, {
  ease,
  redraw,
  drawn: () => graph.graphData(),
  // The selection is the local graph's centre and the URL's focus.
  selected: node => {
    if (node) clearMiss()
    sections.markSelected(node?.id ?? null)
    const moved = setCentre(node?.id ?? null)
    // No local mode with nothing selected: closing the panel leaves it.
    if (!node && localOn()) changeDepth(null)
    else if (moved && localOn()) show('free')
  },
  focus: focusNode,
  depthControl: () => depthControl(changeDepth),
  reload,
})

/** Turn the local graph on, change its depth, or leave it (null). On, the
 * neighbourhood is laid out afresh and fitted (S2); leaving it puts every
 * node back where the overview had it, and the camera goes back to the
 * selection, or fits the overview when nothing is selected. */
function changeDepth(next: Depth | null): void {
  const was = localDepth()
  if (next === was || (next !== null && !state.selected)) return
  setDepth(next)
  state.local = next !== null
  if (was === null) overview = new Map(state.nodes.map(n => [n, { x: n.x, y: n.y, fx: n.fx, fy: n.fy }]))
  if (next !== null) {
    show('free')
    return
  }
  restoreOverview()
  easeAfterFit = state.selected !== null
  show('restore')
}

/** Every node back in its overview place; a node the overview never placed
 * is unplaced, so it is seeded again if it is drawn. */
function restoreOverview(): void {
  for (const n of state.nodes) {
    const at = overview?.get(n)
    const node = n as DrawNode & { vx?: number; vy?: number }
    delete node.vx
    delete node.vy
    node.x = at?.x
    node.y = at?.y
    node.fx = at?.fx
    node.fy = at?.fy
  }
  overview = null
}

/** Esc steps back one level (C4): the local graph, then the selection (the
 * panel closes and the overview is fitted), then, at the overview, it fits
 * again. The search box and the legend keep their own Esc. */
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || event.defaultPrevented) return
  const step = escStep({ depth: localDepth(), selected: state.selected !== null })
  if (step === 'local') changeDepth(null)
  else {
    if (step === 'selection') closePanel()
    fit(motion(FIT_MS))
  }
})

/** Select a node by id, whether drawn or not: a note the scope or the
 * Knowledge toggle hides is revealed, a node the local graph leaves out
 * becomes its new centre, and it is selected once it has been placed. */
function focusNode(id: string): void {
  if (selectNode(id)) return
  const node = state.nodes.find(n => n.id === id)
  if (!node) return
  revealSaying(node)
  if (localOn() && setCentre(id)) show('free')
  else show()
  pendingSelect = id
}

/** Reveal a note the view hides, and say what was widened to show it. */
function revealSaying(node: DrawNode): void {
  const widened = reveal(node)
  if (widened === 'knowledge') say(`Knowledge turned back on to show ${node.name}.`)
  else if (widened === 'scope') say(`Everything turned on to show ${node.name}: Live work hides done work.`)
}

// The canvas follows its grid cell: the window, and either sidebar's drag or collapse.
new ResizeObserver(() => graph.width(shell.canvas.clientWidth).height(shell.canvas.clientHeight)).observe(shell.canvas)
// Labels are drawn in Geist and Outfit: measure and draw once more when they have loaded.
void document.fonts.ready.then(() => {
  fontsLoaded()
  redraw()
})

/** Draw the visible graph. Handing force-graph new data reheats its simulation,
 * so every node already on screen is pinned until it settles again: only the
 * nodes the change brought in move, and a data refresh never restarts the
 * layout (story 31). The Unlinked frame is laid out again when the view draws
 * other Unlinked notes: afresh on a view change, and on a data `refresh` with
 * every note it already held kept in its slot. `free` (a local graph centred
 * or deepened) pins nothing, so the neighbourhood is laid out afresh, then
 * fitted; `restore` (leaving it) pins every node back in its overview place. */
function show(mode: 'keep' | 'free' | 'restore' = 'keep', refresh = false): void {
  const drawn = new Set(graph.graphData().nodes)
  // Restoring, the nodes the overview had placed: visibleGraph seeds the rest.
  const placed = new Set(mode === 'restore' ? state.nodes.filter(n => n.x !== undefined) : drawn)
  if (mode !== 'keep') {
    for (const n of pinned) {
      n.fx = undefined
      n.fy = undefined
    }
    pinned.clear()
    settling.clear()
    fitPending = true
  }
  const next = visibleGraph()
  for (const n of next.nodes) {
    if (mode === 'free') continue
    if (!placed.has(n)) settling.add(n)
    else if (n.fx === undefined && !settling.has(n)) {
      n.fx = n.x
      n.fy = n.y
      pinned.add(n)
    }
  }
  if (unlinkedKey(next.nodes) !== frameKey) {
    frameKey = null
    frameBase = refresh ? state.frame : null
  }
  graph.graphData(next)
  sections.rescope()
  // A panel on a node the new view hides would describe nothing on screen.
  if (state.selected && !next.nodes.includes(state.selected)) closePanel()
  else markSelection(state.selected, next.links)
}

/** The message over the canvas when a load draws nothing (states.ts). */
const showState = mountStates(shell.canvas, () => void load())

/** Fetch the Graph and draw it; false, with the failure on the canvas, when it did not load. */
async function load(): Promise<boolean> {
  const loaded = await fetchGraph()
  showState(loaded)
  if (!('graph' in loaded)) return false
  applyGraph(loaded.graph)
  sections.render()
  show('keep', true)
  // A focus the scope or the Knowledge toggle hides is revealed; one not in
  // the Vault is dropped, and the closest notes are offered in its place.
  const pending = pendingSelect
  if (pending === null || graph.graphData().nodes.some(n => n.id === pending)) return true
  const node = state.nodes.find(n => n.id === pending)
  if (node) {
    revealSaying(node)
    show()
  } else {
    pendingSelect = null
    setCentre(null)
    void offerClosest(shell.note, pending, focusNode)
  }
  return true
}

mountScope(shell.scope, shell.tools.knowledge, show)
// Live work, Unlinked and Highlight: a row or a name selects as search does.
const sections = mountSections(shell.sections, focusNode)
bindHighlight(redraw)
const say = mountNotice(shell.canvas)
// Search reaches every note, hidden ones included: picking one reveals it,
// and the local graph re-centres on a match outside it. A tag or domain
// result picks its Highlight chip.
mountSearch(shell.search, {
  notes: () => state.nodes.filter(isNote),
  facets: () => facets(state.nodes, state.links),
  shows: scopeShows,
  pick: focusNode,
  highlight: id => sections.highlight(id),
})
bindActivity(shell.sections.activity, { ease, redraw, select: focusNode })
mountLegend(shell.tools.legend, shell.legend)
shell.tools.fit.addEventListener('click', () => fit(motion(FIT_MS)))
shell.tools.relayout.addEventListener('click', relayout)

/** Fit the camera to the drawn graph, the Unlinked frame's text included
 * (layout.ts); a node's reach is its radius, a diamond's half-diagonal. */
function fit(ms: number): void {
  const nodes = graph.graphData().nodes.map(n => ({ id: n.id, x: n.x, y: n.y, r: n.style.radius * 1.25 }))
  if (nodes.length === 0) return
  const camera = fitView(nodes, state.frame, frameTextReach(), { w: graph.width(), h: graph.height() }, FIT_PADDING)
  graph.centerAt(camera.x, camera.y, ms)
  graph.zoom(state.local ? Math.min(camera.k, LOCAL_MAX_ZOOM) : camera.k, ms)
}

/** Re-layout (story 29): every node unpinned and unplaced, hidden ones too,
 * then the drawn graph seeded and warmed up as on a load, the frame laid out
 * and the camera fitted again. */
function relayout(): void {
  for (const n of state.nodes) {
    for (const key of ['x', 'y', 'vx', 'vy', 'fx', 'fy'] as const) delete (n as DrawNode & { vx?: number; vy?: number })[key]
  }
  pinned.clear()
  settling.clear()
  framed.clear()
  frameKey = null
  frameBase = null
  fitPending = true
  // In the local graph, the overview it goes back to is laid out again too.
  if (overview) overview = new Map()
  graph.graphData(visibleGraph())
}

/** The drawn Unlinked notes' ids, as one key. */
const unlinkedKey = (nodes: DrawNode[]): string => nodes.filter(n => n.unlinked).map(n => n.id).join('\n')

/** Pin the drawn Unlinked notes in their frame beside the linked graph
 * (layout.ts), and free a note that is no longer Unlinked or no longer drawn. */
function placeFrame(): void {
  const nodes = graph.graphData().nodes
  frameKey = unlinkedKey(nodes)
  const frame = unlinkedFrame(nodes.filter(n => n.unlinked), nodes.filter(n => !n.unlinked), frameBase)
  for (const n of framed) {
    if (frame?.slots.has(n.id)) continue
    n.fx = undefined
    n.fy = undefined
    framed.delete(n)
  }
  for (const n of nodes) {
    const slot = frame?.slots.get(n.id)
    if (!slot) continue
    n.fx = n.x = slot.x
    n.fy = n.y = slot.y
    framed.add(n)
  }
  state.frame = frame
}
void load()

/** A commit's reload: the new Graph merged in and drawn, and an open panel
 * following the new data (closed if its note is gone or hidden). The camera
 * stays put: Follow (activity.ts) is what moves it on a commit. */
async function reload(): Promise<void> {
  if (!await load()) return
  if (state.selected && !selectNode(state.selected.id, false)) closePanel()
}

followCommits(() => graph.graphData().nodes, reload)
