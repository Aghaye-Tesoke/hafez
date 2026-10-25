// src/graph/client/sections.ts
// The left sidebar's working sections (#277): Live work, Unlinked and
// Highlight, drawn from sidebar.ts's lists into the shell's sections.
// - Live work: Stale / Active / Paused rows; hovering or focusing a row
//   lights its family on the canvas (hoverFamily), a click selects it;
// - Unlinked: each Unlinked note the scope shows (the canvas's frame) with
//   its placing line and Copy;
// - Highlight: a chip per domain and tag; picking one highlights the notes
//   carrying it, picking it again clears it; search's tag and domain
//   results pick one the same way. It is held in the URL's `highlight`
//   param (`tag:<t>` or `domain:<d>`).
// render() redraws all three from the Graph held, after every load;
// rescope() redraws Unlinked after a change of scope or of the Knowledge toggle.
import { state } from './state.js'
import { localDay } from '../../dates.js'
import { el, type Section, type SectionId } from './shell.js'
import { highlight, hoverFamily } from './highlight.js'
import { placingLine } from './note-view.js'
import { lineRow } from './panel.js'
import { facetTest, facets, liveGroups, liveRow, unlinkedNotes, type Facet } from './sidebar.js'
import { readView, writeView } from './url.js'
import { scopeShows } from './scope.js'
import type { GraphNode } from '../../types.js'

export interface Sections {
  /** Draw the three sections again from the Graph held. */
  render(): void
  /** Draw Unlinked again for the scope now. */
  rescope(): void
  /** Mark the row of the selected note; null when none is. */
  markSelected(id: string | null): void
  /** Pick a chip by its id (`tag:<t>`, `domain:<d>`), as a search pick does. */
  highlight(id: string): void
}

export function mountSections(sections: Record<SectionId, Section>, select: (id: string) => void): Sections {
  const { live, unlinked, highlight: chips } = sections
  let picked = readView().highlight
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
    // A keyboard focus lights the family as a hover does; a click's focus does not linger.
    b.addEventListener('mouseenter', () => hoverFamily(n.id))
    b.addEventListener('focus', () => { if (b.matches(':focus-visible')) hoverFamily(n.id) })
    for (const off of ['mouseleave', 'blur']) b.addEventListener(off, () => hoverFamily(null))
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

  function renderHighlight(): void {
    const all = facets(state.nodes, state.links)
    // A chip the Vault no longer holds (or a hand-edited URL) is dropped.
    if (picked !== null && !all.some(f => f.id === picked)) pick(null)
    const group = (kind: Facet['kind'], title: string): HTMLElement[] => {
      const of = all.filter(f => f.kind === kind)
      if (!of.length) return []
      return [el('h3', { class: 'sub' }, `${title} · ${of.length}`), el('div', { class: 'chips' }, ...of.map(chip))]
    }
    chips.body.replaceChildren(
      el('p', { class: 'hint' }, all.length ? 'A chip lights the notes carrying it; search finds the rest.' : 'No note carries a tag or a domain.'),
      ...group('domain', 'Domains'), ...group('tag', 'Tags'))
    chips.setCount(String(all.length))
    chips.show()
    apply()
  }

  function chip(f: Facet): HTMLElement {
    const b = el('button', { class: `btn chip ${f.kind}`, type: 'button', 'aria-pressed': String(f.id === picked), title: `${f.kind} · ${f.count} notes` },
      f.name, el('span', { class: 'n' }, String(f.count)))
    b.dataset.id = f.id
    b.addEventListener('click', () => {
      pick(picked === f.id ? null : f.id)
      apply()
    })
    return b
  }

  function pick(id: string | null): void {
    picked = id
    writeView({ highlight: id })
    for (const c of chips.body.querySelectorAll<HTMLElement>('.chip')) c.setAttribute('aria-pressed', String(c.dataset.id === picked))
  }

  /** The highlight for the picked chip, over the links held now. */
  function apply(): void {
    highlight(picked === null ? null : facetTest(picked, state.links))
  }

  return {
    render() {
      const today = localDay()
      renderLive(today)
      renderUnlinked()
      renderHighlight()
    },
    rescope: renderUnlinked,
    highlight(id) {
      pick(id)
      apply()
    },
    markSelected(id) {
      rows.get(selected ?? '')?.classList.remove('on')
      selected = id
      rows.get(id ?? '')?.classList.add('on')
    },
  }
}
