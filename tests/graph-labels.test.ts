// tests/graph-labels.test.ts
// The graph page's labels (#275, spec #270 stories 33-35, Testing seam 3):
// which names show, in what order, at what size, and that no two drawn ones
// overlap. A pure client module over plain data, run in node.
import { describe, expect, it } from 'vitest'
import { labelPx, labelText, minPriority, placeLabels, priority, type Focus, type LabelBox } from '../src/graph/client/labels.js'
import type { GraphNode } from '../src/types.js'

const VIEW = { x: -1000, y: -1000, w: 2000, h: 2000 }
const box = (id: string, x: number, y: number, priority: number, w = 40, h = 10): LabelBox & { id: string } =>
  ({ id, x, y, w, h, priority })
const overlap = (a: LabelBox, b: LabelBox): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

describe('placeLabels', () => {
  it('never places two overlapping labels', () => {
    // A dense pile, as round a well-connected note.
    let s = 7
    const rand = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648)
    const pile = Array.from({ length: 400 }, (_, i) => box(`n${i}`, rand() * 300, rand() * 300, Math.floor(rand() * 1000), 20 + rand() * 60, 8 + rand() * 4))
    const placed = placeLabels(pile, VIEW)
    expect(placed.length).toBeGreaterThan(20)
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) expect(overlap(placed[i], placed[j]), `${placed[i].id} / ${placed[j].id}`).toBe(false)
    }
  })

  it('gives a collision to the higher priority, and a tie to the earlier label', () => {
    const placed = placeLabels([box('low', 0, 0, 10), box('high', 5, 2, 900), box('tie-a', 200, 0, 50), box('tie-b', 205, 0, 50)], VIEW)
    expect(placed.map(p => p.id)).toEqual(['high', 'tie-a'])
  })

  it('keeps a gap between labels', () => {
    const placed = placeLabels([box('a', 0, 0, 2), box('b', 41, 0, 1)], VIEW, 2)
    expect(placed.map(p => p.id)).toEqual(['a'])
  })

  it('leaves out a label outside the view or running past its edge, so it takes no room', () => {
    const placed = placeLabels([box('off', 5000, 0, 999), box('cut', 990, 0, 998), box('on', 0, 0, 1)], VIEW)
    expect(placed.map(p => p.id)).toEqual(['on'])
  })
})

describe('priority', () => {
  const entity = (id: string, fields: Partial<GraphNode> = {}): GraphNode => ({ id, kind: 'entity', name: id, status: 'active', ...fields })
  const none: Focus = { selected: null, hovered: null, hoverNear: new Set(), selectedNear: new Set(), lit: null }

  it('ranks the selection, the hovered note, its neighbours, parents, then liveness', () => {
    const focus: Focus = { ...none, selected: 'sel', hovered: 'hov', hoverNear: new Set(['hov', 'near']), selectedNear: new Set(['sel', 'selnear']) }
    const ranked = [
      entity('sel'), entity('hov'), entity('near'), entity('selnear'),
      entity('parent', { status: 'paused' }), entity('busy', { open_actions: 9 }), entity('idle'),
      entity('paused', { status: 'paused' }), { id: 'k', kind: 'knowledge', name: 'k' } as GraphNode, entity('done', { status: 'done' }),
    ]
    const parents = new Set(['parent'])
    const scores = ranked.map(n => priority(n, focus, parents.has(n.id)))
    expect([...scores].sort((a, b) => b - a)).toEqual(scores)
    expect(new Set(scores).size).toBe(scores.length)
  })

  it('lifts the notes a highlight lights over the rest', () => {
    const lit = { ...none, lit: new Set(['lit']) }
    expect(priority(entity('lit', { status: 'done' }), lit, false)).toBeGreaterThan(priority(entity('parent'), lit, true))
  })

  it('ranks a done parent with the parents: over live work, under a live parent (story 33)', () => {
    const doneParent = priority(entity('p', { status: 'done' }), none, true)
    expect(doneParent).toBeGreaterThan(priority(entity('busy', { open_actions: 12 }), none, false))
    expect(doneParent).toBeLessThan(priority(entity('live parent'), none, true))
  })
})

describe('labels with zoom', () => {
  const entity = (id: string, fields: Partial<GraphNode> = {}): GraphNode => ({ id, kind: 'entity', name: id, status: 'active', ...fields })
  const none: Focus = { selected: null, hovered: null, hoverNear: new Set(), selectedNear: new Set(), lit: null }
  const shown = (n: GraphNode, scale: number, parent = false, focus = none) => priority(n, focus, parent) >= minPriority(scale)

  it('names only the selection, the hovered neighbourhood and live parents when zoomed far out', () => {
    expect(shown(entity('p', { status: 'paused' }), 0.4, true)).toBe(false)
    expect(shown(entity('live', { open_actions: 12 }), 0.4)).toBe(false)
    expect(shown(entity('p'), 0.4, true)).toBe(true)
    expect(shown(entity('s'), 0.4, false, { ...none, selected: 's' })).toBe(true)
    expect(shown(entity('n'), 0.4, false, { ...none, hovered: 'h', hoverNear: new Set(['h', 'n']) })).toBe(true)
  })

  it('brings parents in first, then live work, then everything', () => {
    const order = [0.5, 1, 1.5, 2, 3, 4, 6, 10]
    const firstShown = (n: GraphNode, parent = false) => order.find(s => shown(n, s, parent))!
    expect(firstShown(entity('p'), true)).toBeLessThan(firstShown(entity('paused parent', { status: 'paused' }), true))
    expect(firstShown(entity('paused parent', { status: 'paused' }), true)).toBeLessThan(firstShown(entity('live', { open_actions: 3 })))
    expect(firstShown(entity('live', { open_actions: 3 }))).toBeLessThan(firstShown(entity('done', { status: 'done' })))
    expect(shown(entity('done', { status: 'done' }), 10)).toBe(true)
  })

  it('sizes labels with zoom, within bounds', () => {
    expect(labelPx(0.05)).toBe(labelPx(0.2))
    expect(labelPx(40)).toBe(labelPx(100))
    expect(labelPx(0.05)).toBeGreaterThanOrEqual(10)
    expect(labelPx(100)).toBeLessThanOrEqual(14)
    expect(labelPx(2)).toBeGreaterThan(labelPx(1))
  })

  it('shortens a long name', () => {
    expect(labelText('Short name')).toBe('Short name')
    const long = 'A very long knowledge note name that goes on and on'
    expect(labelText(long).length).toBeLessThanOrEqual(34)
    expect(labelText(long).endsWith('…')).toBe(true)
  })
})
