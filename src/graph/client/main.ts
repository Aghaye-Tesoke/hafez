// src/graph/client/main.ts
// The page's entry point, bundled by esbuild into dist/graph/client.js. While
// the 2D drawing is out and the 3D sky not yet in: the stylesheet, the shell
// and its sidebars over the Graph loaded, with no canvas drawing.
import { applyGraph, state } from './state.js'
import { stylesheet } from './stylesheet.js'
import { mountShell } from './shell.js'
import { mountLegend } from './legend.js'
import { fetchGraph, mountStates } from './states.js'
import { mountSections } from './sections.js'

document.head.append(Object.assign(document.createElement('style'), { textContent: stylesheet() }))
const shell = mountShell()
const showState = mountStates(shell.canvas, () => void load())
const sections = mountSections(shell.sections, () => {})
mountLegend(shell.tools.legend, shell.legend)

async function load(): Promise<void> {
  const loaded = await fetchGraph()
  showState(loaded)
  if (!('graph' in loaded)) return
  applyGraph(loaded.graph)
  sections.render()
  shell.counts.textContent = `${state.nodes.length} notes`
}
void load()
