// src/graph/client/main.ts
// The page's entry point, bundled by esbuild into dist/graph/client.js: the
// composition root of the galaxy. The stylesheet and the shell, one
// 3d-force-graph instance in the shell's canvas with its callbacks and forces
// set once, one bloom pass, the camera (galaxy/camera.ts), then the Graph
// loaded from the server. The modules hold the rules; this file wires them:
// - what is drawn: visible3d(), the notes the scope shows and the links
//   between them, with every orbit worked out over them (galaxy/orbits.ts);
// - where: the force simulation places the roots only (a charge, and the
//   links between roots); every hosted body is pinned on its orbit each tick;
// - how it looks over time: one render loop for the alarm pulse, bursts in
//   flight, commit flares (live.ts) and the label sprites.
import ForceGraph3D, { type ForceGraph3DInstance } from '3d-force-graph'
import { Vector2, Vector3, type Group } from 'three'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import SpriteText from 'three-spritetext'
import { applyGraph, endId, state, type DrawLink, type DrawNode } from './state.js'
import { isNote, mountScope, reveal, scopeShows } from './scope.js'
import { bindPanel, closePanel, selectNode } from './panel.js'
import { followCommits, tickFlares } from './live.js'
import { mountSearch } from './search.js'
import { bindActivity } from './activity.js'
import { stylesheet } from './stylesheet.js'
import { mountShell } from './shell.js'
import { mountLegend } from './legend.js'
import { fetchGraph, mountStates } from './states.js'
import { clearMiss, offerClosest } from './miss.js'
import { mountSections } from './sections.js'
import { escStep } from './view.js'
import { readView, writeView } from './url.js'
import { mountNotice } from './notice.js'
import { reducedMotion } from './motion.js'
import { alpha, CANVAS, FONT, GALAXY } from './tokens.js'
import { isNebulaCore } from './galaxy/bodies.js'
import { beltOf, ORBIT, orbitsOf, resolvePositions, type Orbit, type Vec3 } from './galaxy/orbits.js'
import { labelShows, labelSize } from './galaxy/labels.js'
import { burstProgress, burstsFor, storageSeen } from './galaxy/supernova.js'
import { burstMesh, disposeBody, makeBody, NEBULA_SPAN, tickAlarm, tickBurst, updateBody, type BodyStyle } from './galaxy/meshes.js'
import { mountCamera, type Bounds } from './galaxy/camera.js'

/** The simulation: the roots' charge, the ticks run before the first frame,
 * and how many ticks the bodies already placed stay pinned after a view
 * change while the simulation settles the ones it brought in. */
const FORCES = { charge: -800, warmupTicks: 200, settleTicks: 300 }
/** The one bloom pass: strength, radius, threshold. */
// The threshold keeps mid-grey labels and planets out of it; only hot discs bloom.
const BLOOM = { strength: 0.35, radius: 0.5, threshold: 0.75 }
/** Camera moves, in ms (galaxy/camera.ts makes them instant under reduced motion). */
const FLY_MS = 900
const OVERVIEW_MS = 800
/** Two clicks on one body this close together, in ms, are a double click. */
const DOUBLE_CLICK_MS = 400
/** Behind every label, so it reads over glow. */
const LABEL_BACKDROP = alpha(GALAXY.space, 0.55)
/** Labels keep one size on screen at any distance: px per unit of labelSize,
 * with a floor so the smallest names still read; the backdrop's padding and
 * corner, in label heights. */
const LABEL_PX = { perUnit: 2.4, min: 11, padding: 1 / 3 }
/** A star or core is never drawn smaller than this radius on screen, in px:
 * far off, its group is scaled up (its label is scaled back down). */
const MIN_BODY_PX = 3
/** The belt rings the roots this far beyond the farthest one. */
const BELT_MARGIN = 1.3
/** The overview looks down on the sky from this elevation, so orbits read as rings, not lines. */
const OVERVIEW_ELEVATION = 0.6
/** Every link draws at this opacity, in its relation's hue. */
const LINK_OPACITY = 0.08

document.head.append(Object.assign(document.createElement('style'), { textContent: stylesheet() }))
const shell = mountShell()

/** What is drawn now, and the orbit of every hosted body in it. */
let drawn: { nodes: DrawNode[]; links: DrawLink[] } = { nodes: [], links: [] }
let orbits = new Map<string, Orbit>()
/** The roots already placed that a view change pinned, and the ticks until they are let go. */
const settling = new Set<DrawNode>()
let settleTicks = 0
/** Frame the whole sky on the next tick (the first load's). */
let overviewPending = false
/** A body to fly to once the simulation has placed it. */
let flyPending: DrawNode | null = null
/** Supernovae in flight, by node id. */
const bursts = new Map<string, { group: Group; start: number }>()
let lastClick: { id: string; at: number } | null = null
/** The belt's bodies, its radius now, and whether it is sized again on the next tick (each load's). */
let beltIds: string[] = []
let beltRadius: number = ORBIT.beltMin
let beltPending = false
/** The render loop's one scratch vector: no allocation per body per frame. */
const scratch = new Vector3()

/** The library types its constructor's node and link types on the default export's interface. */
const Galaxy3D = ForceGraph3D as unknown as new (host: HTMLElement) => ForceGraph3DInstance<DrawNode, DrawLink>

// `.backgroundColor(` first: the evidence harness finds the instance by it.
const graph = new Galaxy3D(shell.canvas)
  .backgroundColor(GALAXY.space)
  .width(shell.canvas.clientWidth)
  .height(shell.canvas.clientHeight)
  .showNavInfo(false)
  // Labels are sprites in the sky: no tooltip repeats them.
  .nodeLabel(() => '')
  .nodeThreeObject(bodyObject)
  .nodeThreeObjectExtend(false)
  .linkOpacity(LINK_OPACITY)
  .linkColor(l => opaque(l.style.color))
  .linkVisibility(l => l.relation !== 'parent')
  .enableNodeDrag(false)
  .onNodeClick(onClick)
  .onNodeHover(node => { state.hovered = node })
  .onEngineTick(onTick)
  .warmupTicks(FORCES.warmupTicks)
  // The engine never stops: hosted bodies move along their orbits every
  // tick, and their links follow them.
  .cooldownTime(Infinity)
  .d3AlphaMin(0)

// Forces act on roots only: a hosted body neither repels nor pulls.
graph.d3Force('charge')!.strength((n: DrawNode) => orbits.has(n.id) ? 0 : FORCES.charge)
const linkForce = graph.d3Force('link')!
const linkStrength = linkForce.strength() as (l: DrawLink, i: number, links: DrawLink[]) => number
linkForce.strength((l: DrawLink, i: number, links: DrawLink[]) =>
  l.relation === 'parent' || orbits.has(endId(l.source)) || orbits.has(endId(l.target)) ? 0 : linkStrength(l, i, links))

graph.postProcessingComposer().addPass(new UnrealBloomPass(new Vector2(shell.canvas.clientWidth, shell.canvas.clientHeight), BLOOM.strength, BLOOM.radius, BLOOM.threshold))

// The graph empties its host when it mounts: everything over the canvas comes after.
const camera = mountCamera(graph as unknown as ForceGraph3DInstance, shell.canvas)
const showState = mountStates(shell.canvas, () => void load())
const say = mountNotice(shell.canvas)
shell.canvas.append(shell.hint)

/** An edge colour at full alpha: LINK_OPACITY is the one opacity a link has. */
function opaque(color: string): string {
  const m = /^rgba\((\d+),\s*(\d+),\s*(\d+)/.exec(color)
  return m ? `rgb(${m[1]}, ${m[2]}, ${m[3]})` : color
}

const position = (n: DrawNode): Vec3 => ({ x: n.x ?? 0, y: n.y ?? 0, z: n.z ?? 0 })
/** Orbit time in seconds; held at 0 under reduced motion, so nothing drifts. */
const orbitTime = (now: number): number => reducedMotion() ? 0 : now / 1000

/** A node's body: built once, with its label sprite, and kept on the node. */
function bodyObject(n: DrawNode): Group {
  if (!n.group) {
    n.group = makeBody(n.bodyStyle)
    const label = new SpriteText(n.name, 1, CANVAS.label)
    label.fontFace = FONT.display
    // A dark backdrop, so a name reads over a halo or a nebula.
    label.backgroundColor = LABEL_BACKDROP
    label.name = 'label'
    label.visible = false
    label.material.depthWrite = false
    // One size on screen at any distance; hung from its top edge, under the body.
    label.material.sizeAttenuation = false
    label.center.set(0.5, 1)
    // A galaxy's name stays on top of its stars and their names, always strong.
    if (n.body === 'core') {
      label.renderOrder = 10
      label.material.depthTest = false
      label.color = CANVAS.labelStrong
    }
    sizeLabel(n, label)
    // Hidden or not, a label is never picked: clicks and hover reach the bodies only.
    label.raycast = () => {}
    n.group.add(label)
    placeLabel(n)
  }
  return n.group
}

/** The label hangs just under its body, clear of it. */
function placeLabel(n: DrawNode): void {
  n.group?.getObjectByName('label')?.position.set(0, -n.bodyStyle.radius * 1.15, 0)
}

/** A label's height in the units an unattenuated sprite takes (a share of the
 * view's height), for its body's size on screen; padding and corner follow. */
function sizeLabel(n: DrawNode, label: SpriteText): void {
  const fov = ((graph.camera() as { fov?: number }).fov ?? 40) * Math.PI / 180
  const px = Math.max(LABEL_PX.min, labelSize(n.body) * LABEL_PX.perUnit)
  const height = px * 2 * Math.tan(fov / 2) / Math.max(1, shell.canvas.clientHeight)
  if (Math.abs(label.textHeight - height) >= 1e-9) {
    label.textHeight = height
    label.padding = height * LABEL_PX.padding
    label.borderRadius = height * LABEL_PX.padding
  }
  redrawn(label)
}

/** A label just redrew its canvas and set its own scale: keep it as the scale
 * the render loop divides by its body's minimum-size factor. */
function redrawn(label: SpriteText): void {
  label.userData.width = label.scale.x
  label.userData.height = label.scale.y
}

/** What a label says: a hovered planet or moon names what it belongs to. */
function labelText(n: DrawNode, hovered: boolean): string {
  const planet = n.body.startsWith('planet-')
  if (!hovered || !(planet || n.body === 'moon')) return n.name
  const host = n.host ? state.nodes.find(h => h.id === n.host) : undefined
  return `${n.name} · ${planet ? 'planet' : 'moon'}${host ? ` · part of ${host.name}` : ''}`
}

/** The notes the scope shows and the links between them; every hosted body's
 * orbit is worked out again over them, the belt's too. */
function visible3d(): { nodes: DrawNode[]; links: DrawLink[] } {
  const nodes = state.nodes.filter(scopeShows)
  const ids = new Set(nodes.map(n => n.id))
  const links = state.links.filter(l => ids.has(endId(l.source)) && ids.has(endId(l.target)))
  const edges = links.map(l => ({ source: endId(l.source), target: endId(l.target), relation: l.relation }))
  beltIds = nodes.filter(n => n.body === 'belt').map(n => n.id)
  orbits = new Map([...orbitsOf(nodes, edges), ...beltOf(beltIds, beltRadius)])
  beltPending = true
  return { nodes, links }
}

/** Size the belt to the sky: BELT_MARGIN beyond the root farthest from the
 * origin (the belt's centre, where the centring force keeps the roots'
 * centroid), never under ORBIT.beltMin. False until the roots are placed. */
function sizeBelt(): boolean {
  let farthest = 0
  let placed = false
  for (const n of drawn.nodes) {
    if (orbits.has(n.id) || n.x === undefined) continue
    placed = true
    farthest = Math.max(farthest, Math.hypot(n.x, n.y ?? 0, n.z ?? 0))
  }
  if (!placed) return false
  beltRadius = Math.max(ORBIT.beltMin, BELT_MARGIN * farthest)
  for (const [id, orbit] of beltOf(beltIds, beltRadius)) orbits.set(id, orbit)
  return true
}

/** Pin every hosted body where its orbit has it at `t`, around where the roots are now. */
function placeHosted(t: number): void {
  const roots = new Map<string, Vec3>()
  for (const n of drawn.nodes) if (!orbits.has(n.id) && n.x !== undefined) roots.set(n.id, position(n))
  const at = resolvePositions(orbits, roots, t)
  for (const n of drawn.nodes) {
    const p = at.get(n.id)
    if (!p) continue
    n.fx = n.x = p.x
    n.fy = n.y = p.y
    n.fz = n.z = p.z
  }
}

function unpin(n: DrawNode): void {
  delete n.fx
  delete n.fy
  delete n.fz
}

/** Each simulation tick, before the bodies are moved: the orbits, the
 * settling pins, then what waited for a placed body. */
function onTick(): void {
  if (drawn.nodes.length === 0) return
  if (beltPending && sizeBelt()) beltPending = false
  placeHosted(orbitTime(performance.now()))
  if (settleTicks > 0 && --settleTicks === 0) {
    for (const n of settling) if (!orbits.has(n.id)) unpin(n)
    settling.clear()
  }
  if (overviewPending) {
    overviewPending = false
    const { center } = bounds()
    graph.cameraPosition({ x: center.x, y: center.y + OVERVIEW_ELEVATION, z: center.z + 1 }, center, 0)
    camera.overview(bounds(), 0)
  }
  if (flyPending?.x !== undefined) {
    const n = flyPending
    flyPending = null
    flyTo(n)
  }
}

/** The sphere round every drawn body but the belt's: the overview frames the
 * galaxies and rogue stars, with the belt just outside. */
function bounds(): Bounds {
  const points = drawn.nodes.filter(n => n.x !== undefined && n.body !== 'belt').map(position)
  if (points.length === 0) return { center: { x: 0, y: 0, z: 0 }, radius: 100 }
  const k = 1 / points.length
  const center = points.reduce((c, p) => ({ x: c.x + p.x * k, y: c.y + p.y * k, z: c.z + p.z * k }), { x: 0, y: 0, z: 0 })
  const radius = Math.max(...points.map(p => Math.hypot(p.x - center.x, p.y - center.y, p.z - center.z)))
  return { center, radius: Math.max(radius, 40) }
}

function overview(): void {
  camera.overview(bounds(), OVERVIEW_MS)
}

/** Fly to a body, or, while the simulation has not placed it yet, as soon as it has. */
function flyTo(n: DrawNode): void {
  if (n.x === undefined) {
    flyPending = n
    return
  }
  camera.flyTo(position(n), frameRadius(n), FLY_MS)
}

/** How much to frame when flying to a body: the body, or the bodies orbiting
 * it out to the farthest (0.75 of an orbit's radius puts it in view at the
 * camera's fly-to distance). */
function frameRadius(n: DrawNode): number {
  let reach = n.body === 'nebula' ? n.bodyStyle.radius * NEBULA_SPAN : n.bodyStyle.radius
  for (const o of orbits.values()) if (o.host === n.id) reach = Math.max(reach, o.radius * 0.75)
  return reach
}

/** A click selects; a second click on the same body soon after flies to it. */
function onClick(n: DrawNode): void {
  const now = performance.now()
  const double = lastClick?.id === n.id && now - lastClick.at < DOUBLE_CLICK_MS
  lastClick = double ? null : { id: n.id, at: now }
  selectNode(n.id, false)
  if (double) flyTo(n)
}

/** The render loop: the alarm pulse, bursts in flight, flares and labels. */
function frame(now: number): void {
  const reduced = reducedMotion()
  // World units per screen px at distance 1: a body's radius r at distance d spans r / (d * perPx) px.
  const fov = ((graph.camera() as { fov?: number }).fov ?? 40) * Math.PI / 180
  const perPx = 2 * Math.tan(fov / 2) / Math.max(1, shell.canvas.clientHeight)
  for (const n of drawn.nodes) {
    const group = n.group
    if (!group) continue
    // Under reduced motion the alarm ring holds still at its built opacity.
    if (n.bodyStyle.alarm && !reduced) tickAlarm(group, now / 1000)
    const distance = camera.distanceTo(scratch.set(n.x ?? 0, n.y ?? 0, n.z ?? 0))
    const starLike = n.body === 'star' || n.body === 'core'
    const k = starLike ? Math.max(1, MIN_BODY_PX * distance * perPx / n.bodyStyle.radius) : 1
    if (group.scale.x !== k) group.scale.setScalar(k)
    const label = group.getObjectByName('label') as SpriteText | undefined
    if (!label) continue
    const hovered = state.hovered === n
    const selected = state.selected === n
    label.visible = labelShows(n.body, distance, hovered, selected, orbits.has(n.id))
    if (!label.visible) continue
    const text = labelText(n, hovered)
    if (label.text !== text) {
      label.text = text
      redrawn(label)
    }
    const color = hovered || selected || n.body === 'core' ? CANVAS.labelStrong : CANVAS.label
    if (label.color !== color) {
      label.color = color
      redrawn(label)
    }
    // The label keeps its own size on screen, whatever its body's scale.
    label.scale.set(label.userData.width / k, label.userData.height / k, 1)
  }
  for (const [id, burst] of bursts) {
    const n = drawn.nodes.find(d => d.id === id)
    const progress = burstProgress(burst.start, now, reduced)
    if (!n || progress >= 1) {
      graph.scene().remove(burst.group)
      disposeBody(burst.group)
      bursts.delete(id)
      continue
    }
    burst.group.position.set(n.x ?? 0, n.y ?? 0, n.z ?? 0)
    tickBurst(burst.group, progress)
  }
  tickFlares(now)
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)

/** localStorage, or null where reading it throws (blocked site data). */
function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** Draw the visible graph. The roots already placed stay pinned while the
 * simulation settles the ones the change brought in, so a reload or a toggle
 * never reshuffles the sky. */
function show(): void {
  for (const n of settling) unpin(n)
  settling.clear()
  drawn = visible3d()
  for (const n of drawn.nodes) {
    if (orbits.has(n.id)) continue
    if (n.x === undefined) unpin(n)
    else {
      n.fx = n.x
      n.fy = n.y
      n.fz = n.z
      settling.add(n)
    }
  }
  settleTicks = FORCES.settleTicks
  placeHosted(orbitTime(performance.now()))
  graph.graphData(drawn)
  sections.rescope()
  // A panel on a node the new view hides would describe nothing on screen.
  if (state.selected && !drawn.nodes.includes(state.selected)) closePanel()
}

/** Select a node by id and fly to it, whether drawn or not: a note the scope
 * or the Knowledge toggle hides is revealed first. */
function focusNode(id: string): void {
  if (selectNode(id)) return
  const node = state.nodes.find(n => n.id === id)
  if (!node) return
  revealSaying(node)
  show()
  selectNode(id)
}

/** Reveal a note the view hides, and say what was widened to show it. */
function revealSaying(node: DrawNode): void {
  const widened = reveal(node)
  if (widened === 'knowledge') say(`Knowledge turned back on to show ${node.name}.`)
  else if (widened === 'scope') say(`Everything turned on to show ${node.name}: Live work hides done work.`)
}

bindPanel(shell.note, {
  ease: flyTo,
  // The render loop draws every frame: a selection needs no extra one.
  redraw: () => {},
  drawn: () => drawn,
  // The selection is the URL's focus.
  selected: node => {
    if (node) clearMiss()
    sections.markSelected(node?.id ?? null)
    writeView({ focus: node?.id ?? null })
  },
  focus: focusNode,
  reload,
})

/** Esc steps back one level: the selection closes and the camera returns to
 * the overview; at the overview it frames it again. The search box, the
 * legend and the finish flow keep their own Esc; in free flight Esc is the
 * camera's alone (it leaves flight and frames the overview, the panel stays). */
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || event.defaultPrevented || camera.isFlying()) return
  if (escStep({ selected: state.selected !== null }) === 'selection') closePanel()
  overview()
})

mountScope(shell.scope, shell.tools.knowledge, show)
// Live work and Unlinked: a row selects and flies as search does.
const sections = mountSections(shell.sections, focusNode)
// Search reaches every note, hidden ones included: picking one reveals it.
mountSearch(shell.search, { notes: () => state.nodes.filter(isNote), shows: scopeShows, pick: focusNode })
bindActivity(shell.sections.activity, { flyTo, select: focusNode })
mountLegend(shell.tools.legend, shell.legend)
shell.tools.fit.addEventListener('click', overview)

const markFly = (): void => shell.tools.fly.setAttribute('aria-pressed', String(camera.isFlying()))
shell.tools.fly.addEventListener('click', () => {
  camera.setFly(!camera.isFlying())
  markFly()
})
// After the camera's own F and Esc: it listens first.
window.addEventListener('keydown', markFly)

// The canvas follows its grid cell: the window, and either sidebar's drag or collapse.
new ResizeObserver(() => {
  graph.width(shell.canvas.clientWidth).height(shell.canvas.clientHeight)
  // Labels keep their size on screen: a taller canvas needs smaller sprite heights.
  for (const n of state.nodes) {
    const label = n.group?.getObjectByName('label') as SpriteText | undefined
    if (label) sizeLabel(n, label)
  }
}).observe(shell.canvas)
// Labels are drawn in Outfit: draw each once more when it has loaded.
void document.fonts.ready.then(() => {
  for (const n of state.nodes) {
    const label = n.group?.getObjectByName('label') as SpriteText | undefined
    if (!label) continue
    label.fontFace = FONT.display
    redrawn(label)
  }
})

/** The URL's focus, selected once the first load has drawn the sky. */
let initialFocus = readView().focus
let loadedOnce = false

/** Fetch the Graph and draw it; false, with the failure on the canvas, when it did not load. */
async function load(): Promise<boolean> {
  const loaded = await fetchGraph()
  showState(loaded)
  if (!('graph' in loaded)) return false
  const before = new Map(state.nodes.map(n => [n.id, n.bodyStyle]))
  applyGraph(loaded.graph)
  restyle()
  sections.render()
  counts()
  show()
  supernovae(before)
  if (!loadedOnce) {
    loadedOnce = true
    overviewPending = true
    const focus = initialFocus
    initialFocus = null
    // A focus the view hides is revealed; one not in the Vault is dropped,
    // and the closest notes are offered in its place.
    if (focus !== null && state.nodes.some(n => n.id === focus)) focusNode(focus)
    else if (focus !== null) {
      writeView({ focus: null })
      void offerClosest(shell.note, focus, focusNode)
    }
  }
  return true
}

/** Each body retuned to its style today; one that became another kind of
 * body (a star finished into a nebula) is built again. */
function restyle(): void {
  let rebuilt = false
  for (const n of state.nodes) {
    const group = n.group
    if (!group) continue
    if (group.userData.body === n.body) {
      updateBody(group, n.bodyStyle)
      placeLabel(n)
    } else {
      // The graph frees the old group when it lets go of it below.
      n.group = undefined
      rebuilt = true
    }
  }
  // A new accessor has the graph take every body again: the kept groups come back as they are.
  if (rebuilt) graph.nodeThreeObject(n => bodyObject(n))
}

/** The header's counts: projects, galaxies (cores) and finished (nebulae). */
function counts(): void {
  const notes = state.nodes.filter(isNote)
  const projects = notes.filter(n => n.kind === 'entity' && n.type === 'project').length
  const galaxies = notes.filter(n => n.body === 'core').length
  const finished = notes.filter(n => n.body === 'nebula').length
  shell.counts.textContent = `${projects} projects · ${galaxies} galaxies · ${finished} finished`
}

/** A burst for each project this browser sees finish (galaxy/supernova.ts),
 * in the colour the star had; under reduced motion none: the nebula simply appears. */
function supernovae(before: Map<string, BodyStyle>): void {
  const doneNow = state.nodes.filter(isNebulaCore).map(n => n.id)
  const now = performance.now()
  for (const id of burstsFor(doneNow, storageSeen(safeLocalStorage()))) {
    const n = drawn.nodes.find(d => d.id === id)
    if (!n || bursts.has(id) || burstProgress(now, now, reducedMotion()) >= 1) continue
    const group = burstMesh(before.get(id) ?? n.bodyStyle)
    group.position.set(n.x ?? 0, n.y ?? 0, n.z ?? 0)
    graph.scene().add(group)
    bursts.set(id, { group, start: now })
  }
}
void load()

/** A commit's reload: the new Graph merged in and drawn, and an open panel
 * following the new data (closed if its note is gone or hidden). The camera
 * stays put: Follow (activity.ts) is what moves it on a commit. */
async function reload(): Promise<void> {
  if (!await load()) return
  if (state.selected && !selectNode(state.selected.id, false)) closePanel()
}

followCommits(() => drawn.nodes, reload)
