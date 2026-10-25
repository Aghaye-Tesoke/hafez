# Hafez Galaxy, part 2: The 3D Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 2D force-graph page served by `hafez graph` with a 3D galaxy: project groups as galaxies, projects as stars coloured by time since last work and lit by recent hours, finished projects as supernova remnants, knowledge as planets, unlinked notes as an outer belt, with orbit, zoom and free flight.

**Architecture:** The client keeps its data boundary (`GET /graph`, `GET /events`, `GET /note/:slug`, `POST /note/:slug/finish`) and its pure encoding modules; a new `src/graph/client/galaxy/` folder holds pure rule modules (body kind, host, temperature, orbit positions, supernova memory, label rule) each with a vitest test, and thin three.js modules that turn those rules into meshes, camera moves and a render loop. `main.ts` is rewritten around `3d-force-graph`, which wraps three.js, d3-force-3d and the camera controls and mirrors the `force-graph` API the old page used. The 2D-only modules and their tests are deleted.

**Tech Stack:** `3d-force-graph` ^1.80.1 (devDependency, bundled), `three` ^0.186.1, `three-spritetext` ^1.10.0 for labels, esbuild (existing step, same entry), vitest for the pure modules. No runtime dependency is added.

**Spec:** `docs/superpowers/specs/2026-10-25-hafez-galaxy-design.md`. Depends on part 1 (`2026-10-25-hafez-galaxy-heat.md`) being merged: the payload fields `last_active`, `heat`, `heat_source` and the finish route exist.

## Global Constraints

- Six body shapes and no more: galactic core, star (one shape, continuous temperature), nebula remnant, planet (three styles), moon, belt body.
- Temperature anchors (spec): days since `last_active` 0 → white-blue, 7 → yellow-white, 14 → yellow, 21 → orange, 28 and beyond → red dwarf, interpolated between anchors, clamped after 28. A project with no `last_active` is a red dwarf.
- Glow intensity and reach follow `heat` in [0, 1] and nothing else.
- The alarm: `status` active, `type` project, red dwarf (days ≥ 28 or no `last_active`), `open_actions > 0`. The only idle animation. Paused never alarms. The vault's `stale` flag does not drive it.
- Supernova burst plays once per browser per project, on a witnessed transition to `done`; first-ever load marks every done project seen and bursts none. Memory key in `localStorage`: `hafez.galaxy.seenDone`, a JSON array of slugs. Under `prefers-reduced-motion` the burst is skipped and the nebula simply appears.
- Nebulae (done projects) are always drawn, in both scopes. The Live scope may still hide done captures, done non-project entities and done knowledge.
- Host rule for planets and moons: first edge in order `parent`, then `related`, then `mention`, whatever the target's kind; `unlinked: true` goes to the belt and nothing else does.
- Pitch black background (`#000000`), no starfield wallpaper, one bloom pass, labels in the existing fonts via sprite text.
- Bundle `dist/graph/client.js` under 1.5 MB minified; first paint under two seconds on the current vault (about 50 notes).
- `tests/graph-bundle.test.ts`'s rule stands: client modules import values from outside `client/` only from `dates.ts`, `graph/fields.ts`, `graph/fonts.ts`.
- Commits on branch `galaxy` of `Aghaye-Tesoke/hafez`, each ending `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Run npm scripts from Git Bash on this Windows machine.

## Review Focus

1. A project whose `last_active` is in the future (clock skew between machines) must render as hottest, not throw or go negative. (Task 3)
2. A knowledge note whose first link points at another knowledge note that is itself in the belt must still get a position: it orbits a belt body, it is not lost. (Task 4)
3. A graph refresh that removes a node mid-burst must not leave an orphan mesh or a stuck animation. (Task 6 and Task 9)
4. A node with `heat_source: 'touches'` must look like any other star of its temperature, with the subtle estimated mark only, so the sky never shows a hole where a mapping is missing. (Task 3)
5. `localStorage` unavailable (private window, blocked storage) must degrade to "burst nothing, remember nothing" without an uncaught error. (Task 6)

---

### Task 1: Dependencies and the bundle budget

**Files:**
- Modify: `package.json` (devDependencies; `build` unchanged)
- Modify: `tests/graph-bundle.test.ts` (add the size test)

- [ ] **Step 1: Write the failing test** in `tests/graph-bundle.test.ts`: `it('stays under 1.5 MB minified', () => expect(statSync(resolve(SRC, '..', 'dist', 'graph', 'client.js')).size).toBeLessThan(1.5 * 1024 * 1024))`. It passes today; it is the budget the rest of this plan builds under.
- [ ] **Step 2: `npm install --save-dev 3d-force-graph@^1.80.1 three@^0.186.1 three-spritetext@^1.10.0 @types/three@^0.186.0`** (if the `@types/three` minor is absent on the registry, take the nearest lower minor). Remove `force-graph` from devDependencies only at Task 9, when nothing imports it.
- [ ] **Step 3: Run `npm test`, expect PASS** (nothing imports the new packages yet).
- [ ] **Step 4: Commit** `build: three, 3d-force-graph and sprite text as bundled devDependencies; a 1.5 MB bundle budget`

---

### Task 2: Body kind and host

**Files:**
- Create: `src/graph/client/galaxy/bodies.ts`
- Test: `tests/galaxy-bodies.test.ts`

**Interfaces:**
- Produces: `type Body = 'core' | 'star' | 'nebula' | 'planet-ringed' | 'planet-banded' | 'planet-rocky' | 'moon' | 'belt'`; `childrenOf(edges: GraphEdge[]): Map<string, string[]>` (parent id → child ids, in edge order); `bodyOf(node: GraphNode, hasChildren: boolean): Body` with the rules: `unlinked` → `belt`; `hasChildren` → `core`; entity + project + done → `nebula`; entity + project → `star`; entity (capture or entity type) → `moon`; knowledge by `confidence`: `principle` → `planet-ringed`, `pattern` → `planet-banded`, else `planet-rocky`; tag, domain and session nodes are never passed in. A core that is a done project is still `core` (its satellites keep it); `isNebulaCore(node)` = `core` whose own status is done, for the renderer. `hostOf(node: GraphNode, edges: GraphEdge[]): string | undefined`: for a node that is not `unlinked` and not a root (a root is a core with no parent, a star with no parent, a nebula with no parent): the target of its first `parent` edge, else first `related`, else first `mention`, scanning `edges` in order where `source === node.id`; a core or star with no parent returns `undefined` (it is placed by the force layout).

- [ ] **Step 1: Write the failing tests** covering every branch above with small literal nodes and edges, including: a project with children and a parent is `core`; a knowledge note related to two stars hosts on the first; a capture with a `mention` edge only hosts on the mentioned node; an `unlinked` project is `belt` even if it has type project.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(galaxy): what each note is in the sky, and what it orbits`

---

### Task 3: Temperature, glow and the alarm

**Files:**
- Create: `src/graph/client/galaxy/temperature.ts`
- Modify: `src/graph/client/tokens.ts` (add `GALAXY` palette: `space: '#000000'`, the five temperature anchors as hex, `nebula`, `alarm` = `COLOR.amber`, `planet` tones, `belt` grey, `estimated` outline)
- Test: `tests/galaxy-temperature.test.ts`

**Interfaces:**
- Produces: `COOL_DAYS = 28`; `ANCHORS: ReadonlyArray<{ day: number; hex: string }>` at days 0, 7, 14, 21, 28; `daysSince(last_active: string | undefined, today: string): number` (`Infinity` when undefined; a future day clamps to 0); `temperatureColor(days: number): string` (`#rrggbb`, linear RGB interpolation between anchors, clamped to the last anchor at ≥ 28); `isRedDwarf(days: number): boolean` (≥ 28); `glow(heat: number | undefined): { intensity: number; reach: number }` = `{ 0.15 + 0.85·h, 1.5 + 2.5·h }` with `h = clamp(heat ?? 0, 0, 1)`; `starRadius(node)` = the existing `size(node)` from `signals.ts`; `isAlarm(node: GraphNode, today: string): boolean` per the Global Constraint; `isEstimated(node)` = `heat_source === 'touches'`.

- [ ] **Step 1: Write the failing tests**: `temperatureColor(0)` equals the day-0 anchor and `temperatureColor(28)` and `(400)` equal the day-28 anchor; `temperatureColor(3.5)` is the midpoint of anchors 0 and 7 channel by channel; `daysSince('2099-01-01', TODAY)` is 0; `daysSince(undefined, TODAY)` is `Infinity` and `isRedDwarf` of it is true; `glow(undefined)` is `{ intensity: 0.15, reach: 1.5 }` and `glow(1)` is `{ 1, 4 }`; `isAlarm` true for an active project with `last_active` 30 days ago and `open_actions: 2`, false when paused, false at 27 days, false with 0 open actions, false for type entity; `isAlarm` false for a project 30 days cold whose `stale` is true but `open_actions` 0.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement; add `GALAXY` to `tokens.ts`.** Anchor hexes are the builder's choice within: white-blue, pale yellow, yellow, orange, deep red.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(galaxy): temperature from the cooling clock, glow from heat, the alarm`

---

### Task 4: Orbits and the belt

**Files:**
- Create: `src/graph/client/galaxy/orbits.ts`
- Test: `tests/galaxy-orbits.test.ts`

**Interfaces:**
- Consumes: `Body`, `hostOf`, `childrenOf` (Task 2).
- Produces: `interface Vec3 { x: number; y: number; z: number }`; `interface Orbit { host: string; radius: number; phase: number; speed: number; tilt: number }`; `ORBIT = { star: { base: 28, step: 9 }, planet: { base: 7, step: 3 }, moon: { base: 4, step: 1.5 }, belt: { radius: 320, tilt: 0.35, speed: 0.004 }, speed: { star: 0.02, planet: 0.06, moon: 0.1 } }` (radii in scene units; speeds in radians per second); `orbitsOf(nodes: GraphNode[], edges: GraphEdge[]): Map<string, Orbit>` (every hosted body gets an orbit around its host: the i-th sibling of its body class sits at `base + step·i` with `phase = 2π·i / n` and a small deterministic tilt from a hash of its id; roots get no entry); `beltOf(ids: string[]): Map<string, Orbit>` (host `'belt'`, equal phases around `ORBIT.belt.radius`); `positionAt(orbit: Orbit, hostAt: Vec3, t: number): Vec3` (circular orbit in the plane tilted by `tilt` about the x axis; `t` in seconds); `resolvePositions(orbits, roots: Map<string, Vec3>, t): Map<string, Vec3>` (walks hosts transitively; the belt centre is the origin; a host with no position resolves to the origin).

- [ ] **Step 1: Write the failing tests**: three stars under one core sit at radii 28, 37, 46 and phases 0, 2π/3, 4π/3; planets of a star sit closer than any star of a core; `positionAt` at `t = 0` and `t = 2π/speed` coincide; belt bodies lie at distance 320 from the origin; a planet hosted on a belt body resolves to a point within its planet radius of that belt body's position; a host with no root position resolves to the origin without throwing.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(galaxy): orbit assignment, the belt, and positions over time`

---

### Task 5: Label rule

**Files:**
- Create: `src/graph/client/galaxy/labels.ts`
- Test: `tests/galaxy-labels.test.ts`

**Interfaces:**
- Produces: `LABEL = { always: 900, near: 120 }` (camera distances in scene units); `labelShows(body: Body, distance: number, hovered: boolean, selected: boolean): boolean` (cores and stars and nebulae: always when `distance ≤ LABEL.always`; planets, moons and belt bodies: only when `distance ≤ LABEL.near`, or hovered, or selected); `labelSize(body: Body): number` (core 6, star and nebula 4, the rest 2.5, scene units for sprite text height).

- [ ] **Step 1: Write the failing tests** for each body class at distances 50, 500 and 2000, hovered and not.
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement.** **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(galaxy): which bodies carry a name at which distance`

---

### Task 6: Supernova memory

**Files:**
- Create: `src/graph/client/galaxy/supernova.ts`
- Test: `tests/galaxy-supernova.test.ts`

**Interfaces:**
- Produces: `SEEN_KEY = 'hafez.galaxy.seenDone'`; `interface SeenStore { get(): Set<string>; set(ids: Set<string>): void }`; `storageSeen(storage: Pick<Storage, 'getItem' | 'setItem'> | null): SeenStore` (null or a throwing storage yields a store that returns an empty set and ignores writes); `burstsFor(doneNow: string[], store: SeenStore, firstLoad: boolean): string[]` (on `firstLoad` writes every `doneNow` and returns `[]`; otherwise returns the ids in `doneNow` not in the store, then writes the union); `BURST_MS = 1800`; `burstProgress(startMs: number, nowMs: number, reduced: boolean): number` (0..1; `1` immediately when `reduced`).

- [ ] **Step 1: Write the failing tests** with a `Map`-backed fake storage: first load records three done ids and bursts none; a later call with a fourth bursts only it and records it; a storage whose `getItem` throws yields no bursts and no throw; `burstProgress` is 1 under reduced motion at `nowMs = startMs`.
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement.** **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(galaxy): the supernova plays once per browser, and never on first sight`

---

### Task 7: Meshes

**Files:**
- Create: `src/graph/client/galaxy/meshes.ts`

**Interfaces:**
- Consumes: `Body`, `temperatureColor`, `glow`, `isAlarm`, `isEstimated`, `GALAXY` tokens.
- Produces: `interface BodyStyle { body: Body; radius: number; color: string; glow: { intensity: number; reach: number }; alarm: boolean; estimated: boolean; label: string }`; `bodyStyle(node: GraphNode, body: Body, today: string): BodyStyle`; `makeBody(style: BodyStyle): THREE.Group` (a `SphereGeometry` mesh with `MeshBasicMaterial` in `style.color`; a star adds an additive glow `Sprite` scaled by `reach·radius` at opacity `intensity`; a `planet-ringed` adds a `RingGeometry` mesh tilted 0.4 rad; a `planet-banded` uses a two-tone material from `GALAXY.planet`; a core adds a large soft sprite in its temperature colour at low opacity; a nebula is a cluster of 12 additive sprites in `GALAXY.nebula` with random offsets within 3·radius seeded by the id's hash; an alarm adds a thin amber torus ring named `'alarm'`; an estimated star adds a dashed outline sprite named `'estimated'`); `updateBody(group: THREE.Group, style: BodyStyle): void` (recolour and rescale in place; add or remove the alarm ring); `tickAlarm(group: THREE.Group, t: number): void` (opacity `0.35 + 0.35·sin(t·1.2)` on the ring named `'alarm'`); `burstMesh(style: BodyStyle): THREE.Group` and `tickBurst(group, progress)` (an expanding additive sprite shell: scale `1 + 14·progress`, opacity `1 − progress`).

- [ ] **Step 1: Implement the module.** No unit test: it is three.js scene construction. `npm run typecheck` must pass under `src/graph/client/tsconfig.json`.
- [ ] **Step 2: Commit** `feat(galaxy): the six bodies as three.js groups`

---

### Task 8: Camera

**Files:**
- Create: `src/graph/client/galaxy/camera.ts`

**Interfaces:**
- Produces: `interface Camera { flyTo(target: Vec3, radius: number, ms: number): void; overview(bounds: { center: Vec3; radius: number }, ms: number): void; distanceTo(p: Vec3): number; setFly(on: boolean): void }`; `mountCamera(graph: ForceGraph3DInstance, canvas: HTMLElement): Camera`. `flyTo` uses `graph.cameraPosition({ x, y, z }, target, ms)` placing the camera at `3.5·radius + 20` from the target along the current view direction. `overview` frames the bounds. `setFly(true)` switches `graph.controls()` to fly controls while a key is held: `F` toggles; WASD move, mouse look; `Escape` returns to orbit and calls `overview`. Under `reducedMotion()` every `ms` becomes 0.

- [ ] **Step 1: Implement.** Typecheck passes.
- [ ] **Step 2: Commit** `feat(galaxy): fly-to, overview, and free flight`

---

### Task 9: The page

**Files:**
- Rewrite: `src/graph/client/main.ts`
- Modify: `src/graph/client/scope.ts` (`scopeShows`: a done project entity passes in every scope), `src/graph/client/state.ts` (`DrawNode` gains `z?`, `fz?`, `body: Body`, `bodyStyle: BodyStyle`; `applyGraph` computes `body` via `bodyOf` and `childrenOf` and `bodyStyle`), `src/graph/client/legend.ts` (MARKS become the six bodies with one line each; drawn as small SVG swatches in the body colours), `src/graph/client/live.ts` (`drawPulses` removed; a commit pulse becomes `flare(node)` which sets a 1.6 s emissive boost on its group), `src/graph/client/activity.ts` (ghosts removed; Follow eases via `Camera.flyTo`), `src/graph/client/shell.ts` (drop the `highlight` section and the `relayout` tool; add a `fly` button labelled `Fly (F)`), `src/graph/client/sections.ts` (drop Highlight), `src/graph/client/search.ts` (drop facets from `SearchHooks`), `src/graph/client/panel.ts` (`View.depthControl` removed), `src/graph/client/view.ts` (drop `depth` and `escStep`'s local step; keep `focus`, `scope`), `src/graph/client/stylesheet.ts` (canvas background `GALAXY.space`; drop local and highlight rules).
- Delete: `src/graph/client/draw.ts`, `layout.ts`, `labels.ts`, `local.ts`, `highlight.ts`, `focus.ts` (its `neighbours` moves into `panel.ts`), `visible.ts` (replaced by `visible3d()` inside `main.ts`), `sidebar.ts`'s `facets` and `facetTest` (keep `liveGroups`, `liveRow`, `unlinkedNotes`).
- Delete tests: `tests/graph-layout.test.ts`, `tests/graph-labels.test.ts`; trim `tests/graph-view.test.ts` (no depth, no local step), `tests/graph-sidebar.test.ts` (no facets), `tests/graph-search.test.ts` (no facet hits).
- Modify: `package.json` (remove `force-graph`).

**Interfaces:**
- Consumes: everything in Tasks 2 to 8; `fetchGraph`, `mountStates`, `followCommits`, `bindPanel`, `selectNode`, `closePanel`, `mountSearch`, `mountSections`, `bindActivity`, `mountLegend`, `mountNotice`, `mountShell` as they exist.
- Behaviour of `main.ts`:
  1. `new ForceGraph3D(shell.canvas)` with `backgroundColor(GALAXY.space)`, `nodeThreeObject(n => n.group ??= makeBody(n.bodyStyle))`, `nodeThreeObjectExtend(false)`, `linkOpacity(0.08)`, `linkColor` from `edgeStyle`, parent edges `linkVisibility(false)`, `enableNodeDrag(false)`, `onNodeClick(n => selectNode(n.id))`, double click → `camera.flyTo`, `onNodeHover` sets `state.hovered` for labels.
  2. Forces act on roots only: hosted nodes are pinned each frame (`fx, fy, fz` from `resolvePositions` at `t = performance.now()/1000`); roots keep d3-force-3d defaults with `charge.strength(-120)` and link force off for parent edges.
  3. A render loop (`graph.onEngineTick` plus `requestAnimationFrame`) updates pinned positions, `tickAlarm` on alarm groups, `tickBurst` on bursts in flight, label visibility via `labelShows(body, camera.distanceTo(pos), hovered, selected)`, and label sprites (`three-spritetext`, font `FONT.display`, height `labelSize(body)`, colour `CANVAS.labelStrong` when hovered or selected else `CANVAS.label`).
  4. Bloom: `graph.postProcessingComposer().addPass(new UnrealBloomPass(resolution, 0.9, 0.6, 0.2))` once.
  5. `load()`: `fetchGraph` → `applyGraph` → compute `doneNow` (project nebulae) → `burstsFor(doneNow, storageSeen(safeLocalStorage()), firstLoad)` → for each burst id add `burstMesh` at the body's position and remove it at progress 1 or when its node is gone → `graph.graphData(visible3d())` → `camera.overview(bounds)` on first load only.
  6. `followCommits` reuse: a commit reload calls `load()`; a pulsed node gets `flare`.
  7. `Escape`: selection → `closePanel()` then `camera.overview`; no selection → `camera.overview`.
  8. Search pick and sidebar row: `selectNode` then `camera.flyTo`.

- [ ] **Step 1: Make the deletions and the small modifications listed, run `npm run typecheck`, and fix every reference until it compiles with `main.ts` emptied to a stub.** Commit `refactor(graph): remove the 2D drawing, local graph and facets`.
- [ ] **Step 2: Write the trimmed tests** (`graph-view`, `graph-sidebar`, `graph-search`) so they describe the remaining behaviour; run `npm test`, expect PASS with `main.ts` still a stub.
- [ ] **Step 3: Write `main.ts`** per the behaviour list. `npm run build` must bundle without warnings; `npm test` must stay green including the 1.5 MB budget.
- [ ] **Step 4: Manual verification against a throwaway vault** (a copy of the real one under `--vault`, so Mark finished is safe to try): `node dist/cli.js graph --no-open --port 4800 --vault <copy>`; check in the browser: (a) overview opens on black space with two galaxies, rogue stars between them, a tilted belt; (b) stars are coloured by the clock and one that was worked on today is white-blue; (c) a cold project with open actions pulses amber; (d) done projects are nebulae and no burst plays on this first load; (e) Mark finished on a hot project walks three steps and the burst plays once; reload the page and it does not play again; (f) double click flies to a body; `F` then WASD flies freely; `Escape` returns; (g) labels: stars named at overview, planets named only when near or hovered; (h) the live update: a `hafez update <slug> --log "progress: x"` in a shell flares the node within three seconds; (i) first paint under two seconds (DevTools Performance); (j) `prefers-reduced-motion` emulated: no burst animation, nebula appears. Fix what fails; stop the server.
- [ ] **Step 5: Commit** `feat(galaxy): the 3D page` and push `galaxy`.

---

### Task 10: Docs and release notes

**Files:**
- Modify: `README.md` (the graph section: the sky in one paragraph and the one-sentence legend from the spec)
- Modify: `skill/hafez/SKILL.md` only if it describes the graph's look (check; otherwise untouched)

- [ ] **Step 1: Run `npm test`, expect green.**
- [ ] **Step 2: Write the README paragraph.**
- [ ] **Step 3: Commit** `docs: the galaxy` and push.
- [ ] **Step 4: Update the vault:** `hafez update hafez-galaxy --log "progress: 3D client landed on galaxy branch" --complete-action <handle of the plan action>`.
