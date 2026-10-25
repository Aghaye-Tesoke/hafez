// src/graph/client/miss.ts
// A `?focus=` that names no note (#280): the right sidebar says so and offers
// the closest slugs from `/note`'s 404, each a button that selects its note,
// so a typo in a URL is one click to fix. Gone once any note is selected.
import { state } from './state.js'
import { el } from './shell.js'

let box: HTMLElement | null = null

/** Ask `/note` about `slug` and, on a miss, put the offer at the top of `host`. */
export async function offerClosest(host: HTMLElement, slug: string, choose: (id: string) => void): Promise<void> {
  let closest: string[] = []
  try {
    const res = await fetch(`/note/${encodeURIComponent(slug)}`)
    if (res.status !== 404) return
    closest = ((await res.json()) as { closest?: string[] }).closest ?? []
  } catch { /* the server is gone: the offer still says what happened */ }
  // Only notes the Graph holds: every choice must select something.
  const byId = new Map(state.nodes.map(n => [n.id, n]))
  const choices = closest.flatMap(id => byId.get(id) ?? [])

  clearMiss()
  const name = el('code', { class: 'mono' }, slug)
  box = el('div', { id: 'miss', role: 'status' },
    el('h2', { class: 'label' }, 'No such note'),
    el('p', {}, 'The URL names ', name, ', which is not in the Vault.'))
  if (choices.length) {
    const list = el('ul', {})
    for (const node of choices) {
      const pick = el('button', { class: 'choice', type: 'button', title: node.id }, node.name, el('span', { class: 'slug' }, node.id))
      pick.addEventListener('click', () => {
        clearMiss()
        choose(node.id)
      })
      list.append(el('li', {}, pick))
    }
    box.append(el('p', {}, 'Did you mean:'), list)
  } else {
    box.append(el('p', {}, 'Nothing in the Vault is close to it: search with /.'))
  }
  host.prepend(box)
}

export function clearMiss(): void {
  box?.remove()
  box = null
}
