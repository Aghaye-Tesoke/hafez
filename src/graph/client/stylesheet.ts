// src/graph/client/stylesheet.ts
// The page's one stylesheet (#272), built from the token sheet: the tokens
// become custom properties on :root, and every rule below reads them through
// var(). main.ts adds it once; no other module adds a <style> or inline CSS.
import { FONTS } from '../fonts.js'
import { COLOR, FONT, GALAXY, MOTION, RADIUS, SPACE, TYPE } from './tokens.js'

/** `gold` → `--gold`, `text2` → `--text2`, `scrollbarHover` → `--scrollbar-hover`. */
const prop = (name: string): string => `--${name.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`

function root(): string {
  const vars = [
    ...Object.entries(COLOR).map(([k, v]) => `${prop(k)}: ${v};`),
    ...Object.entries(FONT).map(([k, v]) => `${prop(k)}: ${v};`),
    ...Object.entries(TYPE).map(([k, v]) => `--fs-${k}: ${v}px;`),
    ...Object.entries(RADIUS).map(([k, v]) => `--r-${k}: ${v}px;`),
    `--s: ${SPACE}px;`,
    `--fast: ${MOTION.fast}ms;`,
    `--normal: ${MOTION.normal}ms;`,
    `--ease: ${MOTION.ease};`,
  ]
  return `:root { ${vars.join(' ')} }`
}

const fontFaces = (): string => FONTS.map(f =>
  `@font-face { font-family: '${f.family}'; src: url(/fonts/${f.file}) format('woff2'); font-weight: 100 900; font-style: normal; font-display: swap; }`,
).join('\n')

/** A tone at a share over transparent: Simorgh's `bg-x/10`. */
const mix = (v: string, pct: number): string => `color-mix(in srgb, var(--${v}) ${pct}%, transparent)`

const RULES = `
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; overflow: hidden; background: var(--root); color: var(--text);
  font: var(--fs-base)/1.5 var(--sans); -webkit-font-smoothing: antialiased; }
button, input, select { font: inherit; color: inherit; }
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-thumb { background: var(--scrollbar); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--scrollbar-hover); }
:focus-visible { outline: 2px solid ${mix('gold', 80)}; outline-offset: 2px; }
[hidden] { display: none !important; }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none !important; animation: none !important; } }

/* Shared recipes */
.label { font: 600 var(--fs-label) var(--display); text-transform: uppercase; letter-spacing: .15em; color: var(--muted); }
.mono { font-family: var(--mono); font-variant-numeric: tabular-nums; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.btn { display: inline-flex; align-items: center; gap: calc(var(--s) * 1.5); height: 28px; padding: 0 calc(var(--s) * 2.5);
  border-radius: var(--r-md); border: 1px solid var(--border); background: var(--surface); color: var(--text2);
  font: 600 var(--fs-label) var(--display); text-transform: uppercase; letter-spacing: .12em; white-space: nowrap; cursor: pointer;
  transition: color var(--fast) var(--ease), background var(--fast) var(--ease), border-color var(--fast) var(--ease); }
.btn:hover, .btn[aria-pressed=true], .btn[aria-expanded=true] { color: var(--gold); border-color: ${mix('gold', 30)}; background: ${mix('gold', 10)}; }
.btn.icon { width: 28px; padding: 0; justify-content: center; font-size: var(--fs-body); letter-spacing: 0; }
.btn .swatch { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.input { height: 30px; width: 100%; padding: 0 calc(var(--s) * 2.5); border-radius: var(--r-md); border: 1px solid var(--border);
  background: var(--surface); color: var(--text); font: var(--fs-body) var(--sans); outline: none; }
.input:focus { border-color: ${mix('gold', 40)}; }
.input::placeholder { color: var(--muted); }
.select { height: 26px; padding: 0 var(--s); border-radius: var(--r-sm); border: 1px solid var(--border); background: var(--root); color: var(--text2); }
.popover { background: var(--popover); border: 1px solid var(--border); border-radius: var(--r-lg); box-shadow: 0 12px 32px var(--shadow); }
.code { flex: 1; min-width: 0; padding: calc(var(--s) * 1.5) var(--s) calc(var(--s) * 1.5) calc(var(--s) * 2); background: var(--inset);
  border: 1px solid var(--border); border-radius: var(--r-md); font: var(--fs-base) var(--mono); color: var(--text2);
  white-space: nowrap; overflow-x: auto; user-select: all; }

/* The shell: header, left sidebar, canvas, right sidebar */
#app { position: fixed; inset: 0; display: grid; grid-template-rows: 52px minmax(0, 1fr);
  grid-template-columns: var(--left) 6px minmax(0, 1fr) 6px var(--right); }
#head { grid-column: 1 / -1; display: flex; align-items: center; gap: calc(var(--s) * 3); padding: 0 calc(var(--s) * 3.5);
  border-bottom: 1px solid var(--border); background: var(--root); min-width: 0; }
#head .brand { font: 700 14px var(--display); letter-spacing: .18em; color: var(--gold); white-space: nowrap; }
#head .brand span { margin-left: calc(var(--s) * 2); font-size: var(--fs-label); font-weight: 600; letter-spacing: .15em; color: var(--muted); }
#scope { display: flex; gap: calc(var(--s) * 1.5); min-width: 0; }
#search { position: relative; flex: 1 1 auto; min-width: 140px; max-width: 440px; margin: 0 auto; }
#tools { position: relative; display: flex; gap: calc(var(--s) * 1.5); }
.side { min-width: 0; min-height: 0; overflow: auto; background: var(--root); }
.grip { cursor: col-resize; border-left: 1px solid var(--border); transition: background var(--fast) var(--ease); touch-action: none; }
.grip:hover, .grip.drag { background: ${mix('gold', 18)}; }
#canvas { position: relative; min-width: 0; min-height: 0; overflow: hidden; background: ${GALAXY.space}; }
#counts { font-size: var(--fs-label); color: var(--muted); white-space: nowrap; }
#hint { position: absolute; bottom: calc(var(--s) * 3); left: 50%; transform: translateX(-50%); z-index: 5; margin: 0; pointer-events: none;
  font-size: var(--fs-base); color: var(--muted); white-space: nowrap; }

/* The canvas with no graph to draw: an empty Vault, a failed load (states.ts) */
#state { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 10; width: min(420px, calc(100% - 32px));
  display: flex; flex-direction: column; align-items: flex-start; gap: calc(var(--s) * 3); padding: calc(var(--s) * 5) calc(var(--s) * 5.5); }
#state h2 { margin: 0; }
#state p { margin: 0; color: var(--text2); font-size: var(--fs-body); overflow-wrap: anywhere; }
#state .hint { color: var(--muted); font-size: var(--fs-base); }
#state .code { flex: none; align-self: stretch; }

/* A ?focus= that names no note, and the closest notes (miss.ts) */
#miss { margin: calc(var(--s) * 4) calc(var(--s) * 4) 0; padding: calc(var(--s) * 4) calc(var(--s) * 4.5); display: flex; flex-direction: column; gap: calc(var(--s) * 2);
  border: 1px solid ${mix('amber', 30)}; border-radius: var(--r-lg); background: ${mix('amber', 6)}; }
#miss h2 { margin: 0; color: var(--amber); }
#miss p { margin: 0; color: var(--text2); font-size: var(--fs-body); }
#miss code { color: var(--text); }
#miss ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
#miss .choice { all: unset; box-sizing: border-box; display: flex; gap: calc(var(--s) * 2); align-items: baseline; width: 100%;
  padding: calc(var(--s) * 1.25) calc(var(--s) * 2); border-radius: var(--r-md); color: var(--text); font-size: var(--fs-body); cursor: pointer; }
#miss .choice:hover { background: var(--hover); color: var(--gold); }
#miss .choice:focus-visible { outline: 2px solid ${mix('gold', 80)}; outline-offset: -2px; }
#miss .slug { margin-left: auto; max-width: 45%; overflow: hidden; text-overflow: ellipsis; font: var(--fs-label) var(--mono); color: var(--muted); white-space: nowrap; }

/* One section-header recipe for every left-sidebar section */
.sec { border-bottom: 1px solid var(--border); }
.sec > h2 { margin: 0; }
.sec-head { all: unset; box-sizing: border-box; display: flex; width: 100%; align-items: center; gap: calc(var(--s) * 2);
  padding: calc(var(--s) * 3) calc(var(--s) * 4); cursor: pointer; }
.sec-head:focus-visible { outline: 2px solid ${mix('gold', 80)}; outline-offset: -2px; }
.sec-head .label { flex: 1; }
.sec-head:hover .label { color: var(--text2); }
.sec-head .count { font: var(--fs-label) var(--mono); color: var(--muted); }
.sec-head .chev { color: var(--muted); font-size: var(--fs-micro); transition: transform var(--fast) var(--ease); }
.sec-head[aria-expanded=false] .chev { transform: rotate(-90deg); }
.sec-body { padding: 0 calc(var(--s) * 2) calc(var(--s) * 3); max-height: 38vh; overflow: auto; }

/* Search: a combobox over notes, tags and domains (search.ts) */
#search .results { position: absolute; left: 0; right: 0; top: 34px; z-index: 20; padding: var(--s); }
#search ul { list-style: none; margin: 0; padding: 0; max-height: min(400px, calc(100vh - 120px)); overflow: auto; }
#search li { display: flex; gap: calc(var(--s) * 2); align-items: center; padding: calc(var(--s) * 1.25) calc(var(--s) * 2);
  border-radius: calc(var(--r-md) - 2px); cursor: pointer; color: var(--text2); font-size: var(--fs-body); white-space: nowrap; overflow: hidden; }
#search li:hover { background: var(--hover); color: var(--text); }
#search li[aria-selected=true] { background: var(--hover); color: var(--text); box-shadow: inset 0 0 0 1px ${mix('gold', 60)}; }
#search li .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
#search li .slug { max-width: 38%; overflow: hidden; text-overflow: ellipsis; font: var(--fs-label) var(--mono); color: var(--muted); }
#search li .cues { display: flex; gap: var(--s); flex: none; }
#search .cue { padding: 0 calc(var(--s) * 1.25); border-radius: var(--r-sm); border: 1px solid var(--border); font: 600 var(--fs-micro) var(--display);
  text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
#search .cue.active { color: var(--gold); border-color: ${mix('gold', 35)}; }
#search .cue.knowledge, #search .cue.plan { color: var(--wisdom); border-color: ${mix('wisdom', 35)}; }
#search .cue.stale { color: var(--amber); border-color: ${mix('amber', 40)}; }
#search .cue.hidden { border-style: dashed; }
#search li.is-hidden .name { color: var(--muted); }
#search .mark { flex: none; width: 9px; height: 9px; }
#search .mark.disc { border-radius: 50%; background: var(--gold); }
#search li.paused .mark.disc { background: ${mix('gold', 55)}; }
#search li.done .mark.disc { background: ${mix('gold', 25)}; }
#search li.is-stale .mark.disc { box-shadow: 0 0 0 1.5px var(--root), 0 0 0 3px var(--amber); }
#search .mark.diamond, #search .mark.hollow { width: 8px; height: 8px; margin: 0 0.5px; transform: rotate(45deg); background: var(--wisdom); }
#search .mark.hollow { background: none; border: 1.5px solid var(--wisdom); }
#search .total { margin: var(--s) calc(var(--s) * 2) 0; font: var(--fs-label) var(--mono); color: var(--muted); }
#search .total:empty { display: none; }
.input:focus-visible { outline: 2px solid ${mix('gold', 80)}; outline-offset: 1px; }

/* A notice over the canvas (notice.ts) */
#notice { position: absolute; top: calc(var(--s) * 3); left: 50%; transform: translateX(-50%); z-index: 15; max-width: min(560px, calc(100% - 32px));
  padding: calc(var(--s) * 2) calc(var(--s) * 3.5); color: var(--text); font-size: var(--fs-body); border-color: ${mix('gold', 35)}; }

/* Legend */
#legend { position: absolute; top: 38px; right: 0; z-index: 30; width: 320px; max-height: calc(100vh - 64px); overflow: auto; padding: calc(var(--s) * 3.5); }
#legend .label { margin-bottom: calc(var(--s) * 2.5); }
#legend dl { display: grid; grid-template-columns: 22px 1fr; gap: calc(var(--s) * 1.5) calc(var(--s) * 2); align-items: center; margin: 0; }
#legend dt { display: flex; }
#legend dd { margin: 0; color: var(--text2); }
#legend .swatches { list-style: none; display: flex; flex-wrap: wrap; gap: calc(var(--s) * 1.5) calc(var(--s) * 3); margin: 0; padding: 0; }
#legend .swatches li { display: flex; align-items: center; gap: var(--s); color: var(--text2); font-size: var(--fs-base); white-space: nowrap; }
#legend .sentence { margin: calc(var(--s) * 3) 0; color: var(--text); font-size: var(--fs-body); }

/* Live work and Unlinked (sections.ts) */
#left .hint { margin: 0 calc(var(--s) * 2) calc(var(--s) * 2); color: var(--muted); font-size: var(--fs-base); }
#left .sub { margin: calc(var(--s) * 2) calc(var(--s) * 2) calc(var(--s) * 0.5); font: 600 var(--fs-micro) var(--display);
  text-transform: uppercase; letter-spacing: .12em; color: var(--muted); }
#left .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: var(--gold); }
#left .paused .dot { background: ${mix('gold', 55)}; }
#left .done .dot { background: ${mix('gold', 25)}; }
#left .knowledge .dot { background: var(--wisdom); }
#left .stale .dot { background: var(--amber); }
#live .row { all: unset; box-sizing: border-box; display: grid; grid-template-columns: 8px minmax(0, 1fr) auto; gap: 1px calc(var(--s) * 2.5);
  align-items: center; width: 100%; padding: calc(var(--s) * 1.5) calc(var(--s) * 2); border-radius: var(--r-md); cursor: pointer; }
#live .row:hover { background: var(--hover); }
#live .row.on { background: ${mix('gold', 8)}; }
#live .row:focus-visible { outline: 2px solid ${mix('gold', 80)}; outline-offset: -2px; }
#live .row .dot { grid-column: 1; grid-row: 1 / 3; }
#live .row .nm { grid-column: 2; grid-row: 1; font-size: var(--fs-body); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#live .row .sub { grid-column: 2; grid-row: 2; margin: 0; font: var(--fs-label) var(--mono); text-transform: none; letter-spacing: 0;
  color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#live .row .st { color: var(--amber); }
#live .row .cnt { grid-column: 3; grid-row: 1 / 3; font: 600 var(--fs-body) var(--display); color: var(--text2); font-variant-numeric: tabular-nums; }
#unlinked .un { padding: calc(var(--s) * 1.5) calc(var(--s) * 2); border-radius: var(--r-md); }
#unlinked .un:hover { background: var(--hover); }
#unlinked .un.done { opacity: .55; }
#unlinked .name { all: unset; display: flex; align-items: center; gap: calc(var(--s) * 1.5); font-size: var(--fs-body); cursor: pointer; }
#unlinked .name:hover { color: var(--gold); }
#unlinked .name:focus-visible { outline: 2px solid ${mix('gold', 80)}; outline-offset: 2px; }
#unlinked .line { display: flex; gap: calc(var(--s) * 1.5); align-items: center; margin-top: var(--s); }
#unlinked .line .code { padding: var(--s) calc(var(--s) * 1.5); font-size: var(--fs-label); overflow: hidden; text-overflow: ellipsis; }
#unlinked .line .btn { height: 24px; padding: 0 calc(var(--s) * 2); font-size: var(--fs-micro); }

/* Activity */
#activity .follow { margin: 0 calc(var(--s) * 2) calc(var(--s) * 2); height: 24px; font-size: var(--fs-micro); }
#activity ol { list-style: none; margin: 0; padding: 0 calc(var(--s) * 2); }
#activity .entry { display: flex; gap: calc(var(--s) * 2); align-items: baseline; width: 100%; padding: calc(var(--s) * 0.75) 0;
  background: none; border: 0; color: var(--text2); text-align: left; white-space: nowrap; cursor: pointer; }
#activity .entry:hover { color: var(--text); }
#activity .entry:disabled { cursor: default; opacity: .6; }
#activity .entry .what { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
#activity .entry .times { color: var(--text); font-size: var(--fs-label); }
#activity .entry .agent { max-width: 40%; overflow: hidden; text-overflow: ellipsis; color: var(--muted); font-size: var(--fs-label); }
#activity .entry .ago { flex: none; min-width: 3ch; text-align: right; color: var(--muted); font-size: var(--fs-label); }
#activity[data-connection=live] .sec-head .count { color: var(--teal); }
#activity[data-connection=reconnecting] .sec-head .count, #activity[data-connection=offline] .sec-head .count { color: var(--amber); }
#activity .mark { width: 7px; height: 7px; border-radius: 50%; flex: none; transform: translateY(-1px); }
#activity .mark.create { background: var(--create); }
#activity .mark.update { background: var(--update); }
#activity .mark.delete { background: var(--delete); }
#activity .empty { color: var(--muted); }

/* The right sidebar: the panel or its empty state */
#empty { padding: calc(var(--s) * 5) calc(var(--s) * 5.5); display: flex; flex-direction: column; gap: calc(var(--s) * 3); }
#empty p { margin: 0; color: var(--text2); font-size: var(--fs-body); }
#panel { position: relative; padding-bottom: calc(var(--s) * 6); font-size: var(--fs-body); }
#panel:focus { outline: none; }
#panel .head { position: relative; padding: calc(var(--s) * 4.5) calc(var(--s) * 5.5) calc(var(--s) * 3.5); border-bottom: 1px solid var(--border); }
#panel h2 { margin: 0 calc(var(--s) * 8) var(--s) 0; font: 700 var(--fs-title)/1.25 var(--display); word-break: break-word; }
#panel .close { position: absolute; top: calc(var(--s) * 3); right: calc(var(--s) * 3); }
#panel .badges { display: flex; flex-wrap: wrap; gap: calc(var(--s) * 1.25); margin: 0 calc(var(--s) * 8) calc(var(--s) * 2) 0; }
#panel .badge { padding: 1px calc(var(--s) * 1.5); border-radius: var(--r-sm); border: 1px solid; font: 600 var(--fs-micro) var(--display);
  text-transform: uppercase; letter-spacing: .12em; white-space: nowrap; }
#panel .badge.tone-gold { color: var(--gold); border-color: ${mix('gold', 35)}; background: ${mix('gold', 10)}; }
#panel .badge.tone-wisdom { color: var(--wisdom); border-color: ${mix('wisdom', 35)}; background: ${mix('wisdom', 10)}; }
#panel .badge.tone-amber { color: var(--amber); border-color: ${mix('amber', 40)}; background: ${mix('amber', 10)}; }
#panel .badge.tone-muted { color: var(--text2); border-color: var(--border); background: var(--surface); }
#panel .desc { margin: 0 0 calc(var(--s) * 2); color: var(--text2); }
#panel .facts { display: flex; flex-wrap: wrap; gap: var(--s) calc(var(--s) * 3.5); color: var(--muted); font-size: var(--fs-base); }
#panel .facts b { color: var(--text2); font-weight: 500; font-family: var(--mono); }
#panel .muted { margin: 0 0 calc(var(--s) * 1.5); color: var(--muted); font-size: var(--fs-base); }
#panel .facts + .muted { margin: calc(var(--s) * 2) 0 0; }
#panel .kind { margin: 0 0 var(--s); }
#panel .state { margin: 0 0 var(--s); color: var(--text); }
#panel .temp { display: flex; align-items: center; gap: calc(var(--s) * 1.5); margin: 0 0 calc(var(--s) * 2); color: var(--text2); }
#panel .temp .label { margin-right: var(--s); }
#panel .sec { padding: calc(var(--s) * 3.5) calc(var(--s) * 5.5); border-bottom: 1px solid var(--border); }
#panel .sec:last-child { border-bottom: 0; }
#panel h3 { display: flex; justify-content: space-between; align-items: baseline; margin: 0 0 calc(var(--s) * 2); }
#panel h3 .count { font: var(--fs-label) var(--mono); letter-spacing: 0; color: var(--muted); }
#panel .place { background: ${mix('gold', 5)}; border-left: 2px solid var(--gold); }
#panel ul { margin: 0; padding-left: calc(var(--s) * 4.5); }
#panel ul.actions, #panel ul.log, #panel ul.rows { list-style: none; padding: 0; }
#panel .actions li { display: flex; gap: calc(var(--s) * 2); align-items: baseline; padding: var(--s) 0; }
#panel .actions .md { flex: 1; min-width: 0; }
#panel .actions .age { font: var(--fs-label) var(--mono); color: var(--muted); white-space: nowrap; }
#panel .actions .stale .age { color: var(--amber); }
#panel .log li { position: relative; padding: var(--s) 0 calc(var(--s) * 1.5) calc(var(--s) * 3.5); color: var(--text2); }
#panel .log li::before { content: ''; position: absolute; left: 2px; top: 10px; width: 5px; height: 5px; border-radius: 50%; background: var(--muted); }
#panel .log li.decision::before { background: var(--gold); }
#panel .log li.blocker::before { background: var(--delete); }
#panel .log .when { display: block; font: var(--fs-label) var(--mono); color: var(--muted); }
#panel .log .summary { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; cursor: pointer; }
#panel .log .summary.open { display: block; cursor: auto; }
#panel .log + .muted, #panel .line + .muted { margin-top: calc(var(--s) * 3); }
#panel .row { all: unset; box-sizing: border-box; display: flex; align-items: center; gap: calc(var(--s) * 2); width: 100%;
  padding: var(--s) calc(var(--s) * 1.5); margin: 0 calc(var(--s) * -1.5); border-radius: calc(var(--r-md) - 2px); cursor: pointer; color: var(--text2); }
#panel .row:hover { background: var(--hover); color: var(--text); }
#panel .row:focus-visible { outline: 2px solid ${mix('gold', 80)}; outline-offset: -2px; }
#panel .row .dot { width: 7px; height: 7px; border-radius: 50%; flex: none; background: var(--gold); }
#panel .row.knowledge .dot { background: var(--wisdom); }
#panel .row.stale .dot { background: var(--amber); }
#panel .row.done .dot { background: ${mix('gold', 25)}; }
#panel .row.paused .dot { background: ${mix('gold', 55)}; }
#panel .row .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#panel .row .sub { font: var(--fs-label) var(--mono); color: var(--muted); white-space: nowrap; }
#panel .row.hidden .nm { color: var(--muted); }
#panel .row.hidden .dot { background: none; border: 1px dashed var(--muted); }
#panel .more { all: unset; margin-top: var(--s); color: var(--muted); font-size: var(--fs-base); cursor: pointer; }
#panel .more:hover, #panel .more:focus-visible { color: var(--gold); }
#panel .md { overflow-wrap: anywhere; color: var(--text2); }
#panel .md.clamp { position: relative; max-height: 220px; overflow: hidden; }
#panel .md.clamp::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 56px; background: linear-gradient(transparent, var(--root)); }
#panel .md h1, #panel .md h2, #panel .md h3, #panel .md h4 { display: block; margin: calc(var(--s) * 3.5) 0 var(--s); font: 600 var(--fs-body) var(--sans); color: var(--text);
  text-transform: none; letter-spacing: 0; }
#panel .md > :first-child { margin-top: 0; }
#panel .md > :last-child { margin-bottom: 0; }
#panel .md h1 { font-size: 15px; }
#panel .md p, #panel .md ul, #panel .md ol, #panel .md pre, #panel .md table, #panel .md blockquote { margin: 0 0 calc(var(--s) * 2); }
#panel .md ol { padding-left: calc(var(--s) * 4.5); }
#panel .md code { padding: 0 3px; background: var(--inset); border: 1px solid var(--border); border-radius: var(--r-sm); font: var(--fs-base) var(--mono); }
#panel .md pre { padding: calc(var(--s) * 1.5) calc(var(--s) * 2); background: var(--inset); border: 1px solid var(--border); border-radius: var(--r-md); overflow-x: auto; }
#panel .md pre code { padding: 0; border: 0; background: none; white-space: pre; }
#panel .md table { display: block; overflow-x: auto; border-collapse: collapse; font-size: var(--fs-base); }
#panel .md th, #panel .md td { padding: 3px calc(var(--s) * 1.5); border: 1px solid var(--border); text-align: left; vertical-align: top; overflow-wrap: normal; min-width: 72px; }
#panel .md th { color: var(--text); }
#panel .md hr { margin: calc(var(--s) * 3) 0; border: 0; border-top: 1px solid var(--border); }
#panel .md blockquote { padding-left: calc(var(--s) * 2.5); border-left: 2px solid var(--border); color: var(--muted); }
#panel a.wiki, #panel .md a { color: var(--gold); text-decoration: none; border-bottom: 1px dotted ${mix('gold', 50)}; }
#panel .line { display: flex; gap: calc(var(--s) * 1.5); align-items: center; }
#panel .finish .warn { color: var(--amber); }
#panel .finish p { margin: 0 0 var(--s); }
#panel .finish .caption { margin-top: calc(var(--s) * 2); }
#panel .finish .row { display: flex; gap: calc(var(--s) * 1.5); margin-top: calc(var(--s) * 1.5); }
#panel .finish .slug { display: block; width: 100%; margin-top: var(--s); padding: calc(var(--s) * 1.5) calc(var(--s) * 2); background: var(--inset);
  border: 1px solid var(--border); border-radius: var(--r-md); font: var(--fs-base) var(--mono); color: var(--text2); outline: none; }
#panel .finish .slug:focus { border-color: ${mix('gold', 40)}; }
#panel .finish .btn:disabled { opacity: 0.4; cursor: default; }
`

/** The page's one stylesheet. */
export function stylesheet(): string {
  return [fontFaces(), root(), RULES].join('\n')
}
