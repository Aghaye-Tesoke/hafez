// src/graph/client/sections.ts
// The left sidebar's working sections (#277): Live work and Unlinked, drawn
// from sidebar.ts's lists into the shell's sections.
// - Live work: Stale / Active / Paused rows; a click selects the note and
//   flies to it;
// - Unlinked: each Unlinked note the scope shows (the belt) with its placing
//   line and Copy.
// render() redraws both from the Graph held, after every load;
// rescope() redraws Unlinked after a change of scope or of the Knowledge toggle.
import { state } from './state.js'
import { localDay } from '../../dates.js'
import { el, type Section, type SectionId } from './shell.js'
import { placingLine } from './note-view.js'
import { lineRow } from './panel.js'
import { liveGroups, liveRow, unlinkedNotes } from './sidebar.js'
import { scopeShows } from './scope.js'
import type { GraphNode } from '../../types.js'

export interface Sections {
  /** Draw both sections again from the Graph held. */
  render(): void
  /** Draw Unlinked again for the scope now. */
  rescope(): void
  /** Mark the row of the selected note; null when none is. */
  markSelected(id: string | null): void
}

export function mountSections(sections: Record<SectionId, Section>, select: (id: string) => void): Sections {
  const { live, unlinked } = sections
  let selected: string | null = null
  const rows = new Map<string, HTMLElement>()

  const dotClass = (n: GraphNode): string => n.kind === 'knowledge' ? 'knowledge' : n.status ?? 'active'

  function row(n: GraphNode, today: string): HTMLElement {
    const { when, stale, share, open } = liveRow(n, today)
    const b = el('button', { class: `row ${stale ? 'stale' : dotClass(n)}`, type: 'button', title: n.id },
      el('span', { class: 'dot', 'aria-hidden': 'true' }),
      el('span', { class: 'nm' }, n.name),
      el('span', { class: 'sub' }, el('span', { class: stale ? 'when st' : 'when' }, when), ` · ${share}`),
      el('span', { class: 'cnt', title: 'open actions' }, open ? String(open) : ''))
    b.addEventListener('click', () => select(n.id))
    if (n.id === selected) b.classList.add('on')
    rows.set(n.id, b)
    return b
  }

  function renderLive(today: string): void {
    const groups = liveGroups(state.nodes)
    rows.clear()
    const body: HTMLElement[] = []
    for (const [title, nodes] of [['Stale', groups.stale], ['Active', groups.active], ['Paused', groups.paused]] as const) {
      if (!nodes.length) continue
      body.push(el('h3', { class: 'sub' }, `${title} · ${nodes.length}`), ...nodes.map(n => row(n, today)))
    }
    if (!body.length) body.push(el('p', { class: 'hint' }, 'No live or paused work.'))
    live.body.replaceChildren(...body)
    live.setCount(String(groups.stale.length + groups.active.length + groups.paused.length))
    live.show()
  }

  function renderUnlinked(): void {
    const notes = unlinkedNotes(state.nodes.filter(scopeShows))
    unlinked.body.replaceChildren(
      el('p', { class: 'hint' }, notes.length
        ? 'No parent, related or wiki-link either way. Each line places a note beside its closest one.'
        : 'Every note in view is linked.'),
      ...notes.map(n => {
        const name = el('button', { class: `name ${dotClass(n)}`, type: 'button', title: n.id }, el('span', { class: 'dot', 'aria-hidden': 'true' }), n.name)
        name.addEventListener('click', () => select(n.id))
        const line = placingLine(n)!
        const box = lineRow(line)
        box.querySelector('code')!.title = line
        return el('div', { class: n.status === 'done' ? 'un done' : 'un' }, name, box)
      }))
    unlinked.setCount(String(notes.length))
    unlinked.show()
  }

  return {
    render() {
      const today = localDay()
      renderLive(today)
      renderUnlinked()
    },
    rescope: renderUnlinked,
    markSelected(id) {
      rows.get(selected ?? '')?.classList.remove('on')
      selected = id
      rows.get(id ?? '')?.classList.add('on')
    },
  }
}
