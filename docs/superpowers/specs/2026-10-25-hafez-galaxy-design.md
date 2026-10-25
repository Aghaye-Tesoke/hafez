# Hafez Galaxy: a 3D view of the vault

Design document, 2026-10-25. Written from a brainstorm with Aryan; his decisions are marked **(Aryan)**, the builder-side calls I made are marked **(my call)**, and what is left open is listed at the end.

## Intent

Replace the flat 2D force graph that `hafez graph` serves with a 3D galaxy you can orbit, zoom and fly through. The first three seconds must answer two questions without a click: which project group is alive and which one needs attention. Everything else is detail you fly in for.

The view is not decoration. Each visual law maps to one vault fact, so the picture is a reading of the vault, not an illustration of it.

## Goals

- From a distance: see each galaxy (project group) and tell at a glance whether it burns or has gone quiet.
- Up close: see each project as a star whose heat is the time Aryan gave it recently, and spot the star that is cooling while it still owes him work.
- Finished projects stay visible as history, not as clutter.
- Live: the page updates when the vault changes, as the current graph already does.
- Keep today's click panel (name, vitals, summary, recent log) and add exactly one action: mark finished.

## Non-goals

- Editing notes, ticking actions, or any vault write other than mark finished.
- Exact hours accounting. The hours signal is a relative heat reading, never a timesheet.
- Mobile, VR, multi-user, or a hosted version. This is `127.0.0.1` for one person, as today.
- Replacing the panel's content or the search. They carry over.
- Changing the vault's data model beyond one optional sidecar (see Hours).

## Anti-goals (a build that does these has failed even if it runs)

- Needs a legend you must study. Six shapes, each answering one question, is the ceiling.
- Looks busy. **(Aryan)** Pitch-black, realistic space, Eve Online in spirit but simple. No nebula wallpaper, no lens flares everywhere, no particle snow.
- Asks Aryan to log time by hand. Heat must come from what already gets written as a side effect of working.
- Slow. The current graph opens instantly; the galaxy opens in under two seconds on this machine with the current vault (about 50 notes).
- Animation that never rests. Idle must be calm: slow drift, no pulsing except the alarm.

## The universe

### Galaxies **(Aryan)**

A galaxy is a parent entity with children. Today: AUTOMAZON (five children) and caDBase war-plan (five children). The parent entity itself is the galactic core, a bright diffuse mass at the center; its children orbit it as stars. Membership comes from `parent` edges; no line is drawn for them, the orbit says it.

**(my call)** the hierarchy rules, so deeper or mixed trees have one answer each:

- Any node with children is a core, whatever its type. A core that is a project is also a star: it has its own hours, its own hue and glow, and can raise the alarm. The diffuse mass is drawn around it.
- A core that itself has a parent orbits its parent's core with its own satellites around it: a sub-system inside a galaxy, not a second galaxy.
- Children become what their kind says: project to star, other entity to moon, knowledge to planet. A core whose children are all moons is a small system, drawn the same way, just dimmer.
- Layout is an orbit tree for everything with a parent; only rogue bodies and the galaxies themselves are placed by a force simulation.

### Rogue stars **(Aryan)**

A project with no parent (ADAGENT, Master Modeler, Voice Check-in, SMT Paid Exit, Comfy Mat, PowerNext and others) is a rogue star drifting in the dark between galaxies. It is not grouped, not boxed, not pushed to the edge. A rogue star burning hot is itself a signal: a new galaxy wants to form.

### Stars are projects **(Aryan)**

Every entity of type `project` is a star. Two properties, two visual channels:

- **Temperature = time since Aryan's last hour on it.** This is the cooling clock and it sets the hue. The scale **(Aryan)**: active this week burns white-blue; two weeks out it is yellow; three weeks out it is orange; at four weeks it has settled into a red dwarf, small, dim, red. Beyond four weeks nothing changes further: cold is cold. **(my call)** the clock reads the last day with active minutes in the transcripts; where a project has no folder mapping it falls back to the vault's `last_touched`.
- **Luminosity = recent hours.** How much fuel the star is burning: the decayed sum of active minutes over the last 28 days sets the glow's intensity and reach. **(my call)** this is a second channel, separate from hue, so a project given twenty minutes yesterday is white-blue but faint, and one given thirty hours last week blazes. Hue says *when*, glow says *how much*. Both come from the same transcript data; neither needs a timesheet.
- **Size = weight.** How much the project carries. **(my call)** radius grows with `open_actions` (plus `stale_actions`), capped so one giant does not dwarf the rest; the current 2D rule (`4 + 1.8 * sqrt(min(open_actions, 12))`) is the starting point. Log-entry count is not used, so the payload needs no new field for size.

### The alarm **(Aryan)**

A red dwarf with open actions is the cry for help: cooling while it still owes work. It gets the only idle animation in the universe. **(my call)** a slow-pulsing ring of debris around it, amber, the same tone the 2D graph uses for `stale`. A red dwarf with zero open actions is dormant and gets nothing; it is allowed to sleep.

**(my call)** the alarm fires on exactly two conditions: the galaxy's own clock says red dwarf (28 days or more since the last active day) and `open_actions > 0`, on an `active` project. The vault's `stale` flag and per-entity `staleness_days` do not drive it; Aryan set one clock for the whole sky. `stale` stays visible in the panel as text.

**(my call)** a `paused` project cools and glows like any other star but never raises the alarm: pausing is a deliberate act, not neglect. It has no seventh look.

### Supernova **(Aryan)**

When a project's status becomes `done` the star goes supernova: one burst of light, then a remnant nebula that stays forever where the star was, so each galaxy visibly carries what it has shipped. The burst plays once, the first time the graph is opened (or live-updated) after the project was finished, and never again. The nebula is the permanent state.

**(my call)** on first-ever load, every already-done project is recorded as seen and shown as a nebula with no burst; the burst is only for transitions the client witnesses. The record of what has already burst lives in the browser (`localStorage`), not in the vault: it is a visual moment, not a fact about the project.

### Planets are knowledge **(Aryan: not stars; my call: the rest)**

Knowledge notes are not projects and are not stars. They are planets orbiting the star(s) they are `related` to. Three planet styles, one per confidence level, Saturn-like where it earns it:

1. **Ringed planet** (Saturn): a `principle`.
2. **Banded gas giant**, no ring: a `pattern`.
3. **Small rocky planet**: an `observation`.

A knowledge note related to several stars orbits the one it was created against (first `related`), and keeps faint lines to the others.

**(my call)** one host rule for every planet and moon: the host is the first linked body, taking `parent` first, then `related`, then `mention`, whatever kind that body is. A planet may therefore orbit a core, a star, or another planet; that is fine, moons orbit planets in real skies too. A body with no link at all is `unlinked` in the payload and goes to the belt; nothing else does. A note with only `mention` edges orbits what it mentions.

### Captures and tasks **(my call)**

Entities that are not projects (captures, one-off tasks like "upload the beta exe") are moons: tiny, plain, orbiting their parent if they have one, otherwise in the belt. They never get heat; they are too small to have a temperature.

### The belt **(Aryan: unlinked items visible; my call: the form)**

Notes with `unlinked: true` form an outer asteroid belt around the whole universe: small grey bodies on a wide, slightly tilted ring, slowly turning. No box, no label block. Hover or click still names them. The belt is the visible cost of not filing things.

### Edges **(my call)**

`related` and `mention` edges are faint lines, dimmer than today's, visible mainly when you are near one of their ends. `parent` is shown by orbit, not a line. `tag`, `domain` and `session` layers are off by default and remain togglable as today.

### Six shapes, total

Galactic core, star (four heat states, one shape), nebula remnant, three planets, moon, belt body. A newcomer should be able to read the sky after one sentence of explanation: "stars are projects, hot means you worked on it, red means you have not, exploded means finished, the belt is what you never filed."

## Interaction

- **Camera** **(Aryan: rotate, zoom, go inside)**: orbit, zoom, and free fly. **(my call)** mouse drag orbits, wheel zooms, right-drag pans, and WASD plus mouse look flies when a key is held; double-click a body flies the camera to it. Escape returns to the overview.
- **Labels** **(my call)**: galaxy and star names always on at overview distance, planets and moons only when near or hovered. Labels face the camera and never overlap a body.
- **Click a body**: the existing panel, with the content it has today (name, meta line, properties, brief, open actions with ages, log fold, children, sessions), fetched from the existing `/note/:slug` route. **(Aryan)** plus one new control on a project: **Mark finished**.
- **Mark finished** **(Aryan)**: a triple confirmation. **(my call)** three distinct steps, not the same dialog three times: (1) a button "Mark finished", (2) a confirmation naming the project and its open action count, "This star will go supernova. It cannot un-explode.", (3) a typed confirmation of the project's slug. Then the status write happens, the live channel delivers the change, and the burst plays.
- **Search**: carries over from the 2D client; a hit flies the camera to the body.

**(my call)** what happens to the rest of the 2D client's features:

- **Kept**: the panel, search, layer toggles, the activity feed and its live commit pulses (a pulse becomes a brief flare on the body), the notice, and reduced-motion handling (with reduced motion the burst is skipped and the nebula simply appears). The legend survives as one line of text, naming the six shapes.
- **Changed**: the Live scope that hides done work no longer hides nebulae. Finished projects always stay in the sky; that is the point of the remnant. The scope may still hide done captures and done knowledge.
- **Dropped in this version**: the local graph and depth controls, and the sidebar facets. Flying to a body replaces local view. They can return later if missed.

## Where the data comes from

Everything except heat already exists in the graph payload the server serves at `/graph`: `id`, `kind`, `type`, `status`, `last_touched`, `open_actions`, `stale`, `stale_actions`, `staleness_days`, `unlinked`, `confidence`, plus `parent` / `related` / `mention` edges. The live channel `/events` (SSE, a `commit` event meaning "refetch") already fires on every vault change. The 3D client reads the same feed and the same event; the server's payload code does not change for any of it.

### Hours

Nothing in the vault records duration. Recon on 2026-10-25 established:

- Claude Code transcripts under `~/.claude/projects/<folder>/*.jsonl` carry per-event timestamps. Summing gaps under 15 minutes gives active time per working folder. Only about five weeks of transcripts are retained on this machine, which happens to cover the four-week cooling curve exactly. The figure is inflated by long autonomous runs and is a relative heat reading, not a timesheet. Rankings are stable across gap thresholds of 5 to 30 minutes.
- The vault maps an entity to a folder through its free-text `resource` field (a path, a URL, sometimes with a branch note, mixed separators). About a third of entities have a path there today. The ADAGENT entity has none.

**(my call)** the design for heat:

1. A **collector** scans the transcripts, aggregates active minutes per folder per day, maps folders to entity slugs through `resource` (normalise separators and case; a transcript folder matches an entity if its path equals or lies under the resource path; the two spellings of the Amazon folder merge this way), and writes a sidecar `hours.json` under the hafez config dir, keyed by slug, holding per-day active minutes for the last 35 days. Never into the vault, never a commit: heat changes every session and must not pollute the history.
2. The graph **server** reads the sidecar at each `rebuild()` and adds two optional fields per project node: `last_active` (ISO date of the last day with active minutes; drives hue) and `heat` in `[0, 1]` (drives glow). **(my call)** `heat = clamp(sum over days of minutes_d * 2^(-age_d / 7) / H, 0, 1)` where `H` is a fixed normaliser chosen so one solid working week of recent time saturates. A project with no folder mapping gets `last_active` from the vault's `last_touched` and heat from vault touches instead (commits in the window, same decay, scaled by rank), so no star is missing a temperature; the builder may mark such stars subtly as estimated. These two fields are the only change to the payload.
3. The collector runs when the graph server starts and again every 10 minutes while it runs. No new hooks, nothing installed.
4. **Environment** (answered by this machine, 2026-10-25): hafez runs natively on Windows here, not under WSL. The binary is `C:\Users\aryan\nodejs\node.exe`, the config lives at `C:\Users\aryan\.config\hafez\`, the vault at `C:\Users\aryan\vault`, and the transcripts at `C:\Users\aryan\.claude\projects\`. The collector resolves the transcript root from the user's home on whichever OS it runs, normalises both `\` and `/` and drive-letter case, and treats `/mnt/<x>/` as `<X>:\` so a WSL-hosted run still maps Windows resource paths. The repo's POSIX build script runs under Git Bash on this machine, as the existing toolchain already does.

The hours law only becomes true for a project once its `resource` points at its folder. Completing that mapping is a vault chore, not a build task; ADAGENT's is `D:\CLAUDE\Think-CAD\google-ads`.

### The one server write

`Mark finished` needs a write route the server does not have today. **(my call)** one `POST /note/:slug/finish`, guarded by the same Host check as the rest plus an Origin check (the request must come from the page the server itself served; a cross-site form POST carries a valid Host and must be refused), which calls the library's update with `status: done`. Nothing else becomes writable.

## How it gets made **(my call unless marked)**

- **Home**: a fork of `shrvn-r/hafez` under Aryan's GitHub account. The fork does not exist yet; the checkout at `C:\Users\aryan\sandbox\hafez` is the upstream, which grants him pull only. Creating the fork is the plan's first step and needs Aryan's go, since it is an outward action on his account. The galaxy replaces the 2D graph client in the fork; the 2D client stays in git history and upstream, so upstreaming later remains possible. No flag keeps both clients alive.
- **Renderer**: three.js, bundled by the existing esbuild step into the same `dist/graph/client.js`, as a devDependency like `force-graph` today, keeping the repo's no-runtime-dependency rule. Layout: 3D force simulation (`d3-force-3d`, or `3d-force-graph` which wraps it and three.js and mirrors the current `force-graph` API; the builder picks). Custom star material: a small shader giving temperature colour and glow; planets are textured spheres with a ring mesh where called for; the nebula is a sprite cloud. No post-processing stack beyond one bloom pass.
- **Reuse**: the pure encoding modules (`signals.ts`, `style.ts`, `tokens.ts`) carry over as the single source of size, staleness and tone rules, extended with heat. The panel, search and `/note` fetching carry over. `main.ts`, `draw.ts`, `layout.ts`, `labels.ts` are replaced.
- **Tests**: the bundle-boundary test and the 2D drawing tests get rewritten for the 3D client; the server tests gain the `heat` field and the finish route; the collector gets unit tests on fixture transcripts (timestamps only, never content).
- **Budget**: bundle under 1.5 MB minified; first paint under two seconds; 60 fps idle on this machine with 50 bodies, graceful at 500.

## Constraints

- Transcripts are private. The collector reads only `timestamp` and `cwd`, never message content, and the sidecar holds only minutes per slug per day.
- The server stays bound to `127.0.0.1` with the existing Host check.
- Node 22, TypeScript, esbuild, Vitest, as the repo has them.
- The vault's data model is untouched except for the optional, uncommitted sidecar.

## Left to the builder

Exact colour ramp values, star shader, ring geometry, camera speeds, label font sizes, bloom strength, the belt's radius and tilt, the burst's duration, fly-to easing, the fallback marking for estimated heat, and the collector's schedule granularity. All of these are tunable without changing what gets built.

## Open questions for Aryan

None block the plan. The builder check on 2026-10-25 raised eight; seven are settled above as my calls, one was answered by this machine's environment. The one call that touches the heart of the idea, and that Aryan should check: hue comes from *when* he last worked on a project (the four-week clock) and glow comes from *how much* he worked on it recently. His original sentence named hours as temperature; splitting the two keeps a light touch this week from rendering as a dead star.

Settled by default, open to veto: planet styles follow confidence (the vault's own field), not kind of knowledge; a plan note is a planet like any other.

## Appendix: brief for Claude Design

Use this as the prompt when mocking the look.

> Design a 3D galaxy visualisation of a personal project vault, viewed in a browser on a dark desktop. Pitch-black realistic space, restrained, in the spirit of the Eve Online star map but far simpler. Two galaxies, each a bright diffuse core with five stars orbiting; eight rogue stars drifting alone between them; a faint, tilted outer asteroid belt of about fifteen small grey bodies around everything. Stars are projects. Their colour is temperature: white-blue (worked on this week), yellow (two weeks ago), orange (three weeks), red dwarf (four weeks or more, small and dim). One red dwarf has a slow-pulsing amber debris ring: it is cooling while it still has open work. One star has already exploded: show a glowing nebula remnant where it was. Small planets orbit some stars: a ringed Saturn-like planet, a banded gas giant, and a small rocky one. A few tiny plain moons. Faint lines connect a handful of related bodies. Labels: galaxy and star names always visible at overview distance, small, clean sans-serif; planet names only on hover. Show three frames: (1) the overview as it opens, (2) the camera flown inside one galaxy near a hot star with a planet in the foreground, (3) the click panel open beside a selected star, showing name, status, last touched, open actions, a short summary, and a "Mark finished" button. Six body types total; a stranger should read the sky after one sentence of explanation.
