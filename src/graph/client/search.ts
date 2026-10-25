// src/graph/client/search.ts
// The `/` search (#256, #279): a combobox in the header over every note,
// hidden ones included, and the tags and domains (find.ts says what it
// finds). Each note result carries its cues: kind shape, status, Stale and a
// "hidden" mark; a tag or domain result applies its Highlight. The list says
// how many matched beyond what it shows. Enter (or a click) picks the active
// option; Esc clears the box and leaves it, and goes no further, so an open
// panel stays open. `/` focuses it from anywhere but a text field, a control
// included (C5). A listbox of options with `aria-activedescendant` (K3).
import type { DrawNode } from './state.js'
import type { Facet } from './sidebar.js'
import { find, foundSummary, type Found, type NoteHit } from './find.js'
import { el } from './shell.js'

/** What search reaches and what a pick does, handed over by main.ts. */
export interface SearchHooks {
  /** Every note the page holds, hidden ones included. */
  notes(): DrawNode[]
  /** The Highlight chips the Graph holds. */
  facets(): Facet[]
  /** Whether the view draws a note now. */
  shows(node: DrawNode): boolean
  /** Select a note by id, revealing it when hidden. */
  pick(id: string): void
  /** Apply a tag or domain's Highlight, by its id. */
  highlight(id: string): void
}

const LIST_ID = 'search-list'

type Option = { note: NoteHit<DrawNode> } | { facet: Facet }

export function mountSearch(host: HTMLElement, hooks: SearchHooks): void {
  const input = el('input', {
    class: 'input', type: 'search', placeholder: 'Search notes, tags, domains  ( / )', 'aria-label': 'Search notes, tags and domains',
    spellcheck: 'false', autocomplete: 'off', role: 'combobox', 'aria-expanded': 'false', 'aria-controls': LIST_ID, 'aria-autocomplete': 'list',
  })
  const list = el('ul', { id: LIST_ID, role: 'listbox', 'aria-label': 'Search results' })
  const total = el('p', { class: 'total', role: 'status' })
  const box = el('div', { class: 'results popover', hidden: '' }, list, total)
  host.append(input, box)

  let options: Option[] = []
  let on = 0

  function render(found: Found<DrawNode> | null): void {
    options = found ? [...found.notes.map(note => ({ note })), ...found.facets.map(facet => ({ facet }))] : []
    list.replaceChildren(...options.map((o, i) => {
      const item = 'note' in o ? noteOption(o.note) : facetOption(o.facet)
      item.id = `${LIST_ID}-${i}`
      // mousedown, not click: it lands before the input's blur empties the list.
      item.addEventListener('mousedown', event => {
        event.preventDefault()
        choose(o)
      })
      return item
    }))
    total.textContent = found ? foundSummary(found) : ''
    box.hidden = found === null || (options.length === 0 && !input.value.trim())
    input.setAttribute('aria-expanded', String(!box.hidden))
    mark()
  }

  /** The active option: marked, scrolled into view and named to assistive tech. */
  function mark(): void {
    for (const [i, item] of [...list.children].entries()) item.setAttribute('aria-selected', String(i === on))
    const active = list.children[on]
    if (active) {
      input.setAttribute('aria-activedescendant', active.id)
      active.scrollIntoView({ block: 'nearest' })
    } else input.removeAttribute('aria-activedescendant')
  }

  function reset(): void {
    input.value = ''
    render(null)
    input.blur()
  }

  function choose(o: Option): void {
    // Picked while the box still has focus: the panel takes it, and gives it back on close.
    if ('note' in o) hooks.pick(o.note.node.id)
    else hooks.highlight(o.facet.id)
    reset()
  }

  function search(): void {
    on = 0
    render(input.value.trim() ? find(input.value, hooks.notes(), hooks.facets(), hooks.shows) : null)
  }
  input.addEventListener('input', search)
  input.addEventListener('focus', search)
  input.addEventListener('keydown', event => {
    // The box's keys stay in the box: Esc here must not also close the panel.
    event.stopPropagation()
    if (event.key === 'Escape') reset()
    else if (event.key === 'Enter' && options[on]) choose(options[on])
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!options.length) return
      on = (on + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length
      mark()
    }
  })
  input.addEventListener('blur', () => render(null))

  document.addEventListener('keydown', event => {
    if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return
    if (typing(event.target)) return
    event.preventDefault()
    input.focus()
    input.select()
  })
}

/** A note option: its mark, name, slug and cues. */
function noteOption(hit: NoteHit<DrawNode>): HTMLElement {
  const { node } = hit
  const cues = [el('span', { class: `cue ${hit.status}` }, hit.status)]
  if (hit.stale) cues.push(el('span', { class: 'cue stale' }, 'stale'))
  if (hit.hidden) cues.push(el('span', { class: 'cue hidden', title: 'Hidden by the current view: picking it shows it' }, 'hidden'))
  const cls = ['opt', 'note', hit.status, hit.stale ? 'is-stale' : '', hit.hidden ? 'is-hidden' : ''].filter(Boolean).join(' ')
  return el('li', { class: cls, role: 'option', title: node.id },
    el('span', { class: `mark ${hit.shape}`, 'aria-hidden': 'true' }),
    el('span', { class: 'name' }, node.name),
    el('span', { class: 'cues' }, ...cues),
    el('span', { class: 'slug' }, node.id))
}

/** A tag or domain option: picking it applies its Highlight. */
function facetOption(f: Facet): HTMLElement {
  return el('li', { class: `opt facet ${f.kind}`, role: 'option', title: `Highlight the ${f.count} notes carrying this ${f.kind}` },
    el('span', { class: 'mark facet', 'aria-hidden': 'true' }, '#'),
    el('span', { class: 'name' }, `Highlight ${f.name}`),
    el('span', { class: 'cues' }, el('span', { class: 'cue' }, f.kind)),
    el('span', { class: 'slug' }, `${f.count} note${f.count === 1 ? '' : 's'}`))
}

/** Input types that take a click or a pick, not text: `/` there is the shortcut. */
const NOT_TEXT = new Set(['button', 'checkbox', 'radio', 'range', 'color', 'file', 'submit', 'reset', 'image'])

/** Whether a key on this element types text, so `/` is a character, not the shortcut. */
function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true
  return target instanceof HTMLInputElement && !NOT_TEXT.has(target.type)
}
