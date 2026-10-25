// tests/graph-layout.test.ts
// The graph page's layout (#275, spec #270 "Forces (Q3)", stories 22-31,
// Testing seam 3): pure client modules over plain node data, run in node.
// Seeded positions, the force configuration, territories and the Unlinked
// frame; no DOM and no force-graph.
import { describe, expect, it } from 'vitest'
import { charge, fitView, FORCES, FRAME, gravity, link, seed, territories, unlinkedFrame, type Placed } from '../src/graph/client/layout.js'
import type { GraphNode } from '../src/types.js'

const node = (id: string, fields: Partial<Placed> = {}): Placed => ({ id, ...fields })

describe('seed', () => {
  it('puts a root at a place its slug alone decides', () => {
    const a = [node('alpha'), node('beta'), node('gamma')]
    const b = [node('gamma'), node('delta'), node('alpha')]
    seed(a, new Map())
    seed(b, new Map())
    expect(a[0].x).toBeTypeOf('number')
    expect([b[2].x, b[2].y]).toEqual([a[0].x, a[0].y])
    expect([b[0].x, b[0].y]).toEqual([a[2].x, a[2].y])
    expect([a[0].x, a[0].y]).not.toEqual([a[1].x, a[1].y])
  })

  it('puts a root on a ring round the origin', () => {
    const roots = Array.from({ length: 50 }, (_, i) => node(`note-${i}`))
    seed(roots, new Map())
    for (const r of roots) {
      const d = Math.hypot(r.x!, r.y!)
      expect(d).toBeGreaterThanOrEqual(120)
      expect(d).toBeLessThanOrEqual(640)
    }
  })

  it('puts a child beside its parent, a grandchild beside the child, whatever the order', () => {
    const nodes = [node('grandchild'), node('child'), node('parent')]
    seed(nodes, new Map([['grandchild', 'child'], ['child', 'parent']]))
    const [grandchild, child, parent] = nodes
    expect(Math.hypot(child.x! - parent.x!, child.y! - parent.y!)).toBeCloseTo(30)
    expect(Math.hypot(grandchild.x! - child.x!, grandchild.y! - child.y!)).toBeCloseTo(30)
  })

  it('puts a child beside a parent already placed, and leaves placed nodes where they are', () => {
    const parent = node('parent', { x: 500, y: -200 })
    const child = node('child')
    seed([parent, child], new Map([['child', 'parent']]))
    expect([parent.x, parent.y]).toEqual([500, -200])
    expect(Math.hypot(child.x! - 500, child.y! + 200)).toBeCloseTo(30)
  })

  it('seeds a child whose parent is not among the nodes as a root', () => {
    const child = node('child')
    seed([child], new Map([['child', 'gone']]))
    expect(Math.hypot(child.x!, child.y!)).toBeGreaterThanOrEqual(120)
  })

  it('survives a parent cycle', () => {
    const nodes = [node('a'), node('b')]
    seed(nodes, new Map([['a', 'b'], ['b', 'a']]))
    for (const n of nodes) expect(Number.isFinite(n.x)).toBe(true)
  })
})

describe('the forces (spec #270 "Forces (Q3)")', () => {
  const entity = (fields: Partial<GraphNode> = {}): GraphNode => ({ id: 'e', kind: 'entity', name: 'E', status: 'active', ...fields })

  it('pulls a child hard and short to its parent, and barely along any other edge', () => {
    expect(link({ relation: 'parent' })).toEqual({ distance: 26, strength: 0.7 })
    expect(link({ relation: 'related' })).toEqual({ distance: 70, strength: 0.04 })
    expect(link({ relation: 'mention' })).toEqual({ distance: 70, strength: 0.04 })
  })

  it('in the local graph, pulls a neighbourhood together along every edge (#279, S2)', () => {
    expect(link({ relation: 'parent' }, true)).toEqual({ distance: 26, strength: 0.7 })
    expect(link({ relation: 'related' }, true)).toEqual({ distance: 50, strength: 0.5 })
    expect(link({ relation: 'mention' }, true)).toEqual({ distance: 50, strength: 0.5 })
  })

  it('pushes live work apart twice as hard as the rest, and a pinned Unlinked note not at all', () => {
    expect(charge(entity())).toBe(-70)
    expect(charge(entity({ status: 'paused' }))).toBe(-35)
    expect(charge(entity({ status: 'done' }))).toBe(-35)
    expect(charge({ id: 'k', kind: 'knowledge', name: 'K' })).toBe(-35)
    expect(charge(entity({ unlinked: true }))).toBe(0)
    expect(FORCES.chargeDistanceMax).toBe(380)
  })

  it('settles in 220 warm-up ticks and a 2.5 s cooldown', () => {
    expect(FORCES).toMatchObject({ warmupTicks: 220, cooldownMs: 2500, alphaDecay: 0.03, velocityDecay: 0.35 })
  })

  it('has a weak gravity toward the origin that leaves a pinned node alone', () => {
    const free = { x: 100, y: -50, vx: 0, vy: 0 }
    const pinned = { x: 100, y: -50, vx: 0, vy: 0, fx: 100, fy: -50 }
    const force = gravity()
    force.initialize([free, pinned])
    force(1)
    expect(free.vx).toBeCloseTo(-100 * 0.012)
    expect(free.vy).toBeCloseTo(50 * 0.012)
    expect([pinned.vx, pinned.vy]).toEqual([0, 0])
    force(0.5)
    expect(free.vx).toBeCloseTo(-100 * 0.012 * 1.5)
  })
})

describe('unlinkedFrame', () => {
  const note = (id: string, fields: Partial<GraphNode> = {}): GraphNode => ({ id, kind: 'entity', name: id, status: 'active', unlinked: true, ...fields })
  const linked: Placed[] = [node('a', { x: -300, y: -100 }), node('b', { x: 200, y: 400 }), node('c', { x: 50, y: 0 })]

  it('holds every Unlinked note in a slot inside one frame, right of the linked graph', () => {
    const unlinked = Array.from({ length: 23 }, (_, i) => note(`u-${i}`, i % 3 ? {} : { kind: 'knowledge' }))
    const frame = unlinkedFrame(unlinked, linked)!
    expect(frame.count).toBe(23)
    expect(frame.slots.size).toBe(23)
    expect(frame.x).toBeGreaterThan(200)
    const seen = new Set<string>()
    for (const u of unlinked) {
      const slot = frame.slots.get(u.id)!
      expect(slot.x).toBeGreaterThan(frame.x)
      expect(slot.x).toBeLessThan(frame.x + frame.w)
      expect(slot.y).toBeGreaterThan(frame.y)
      expect(slot.y).toBeLessThan(frame.y + frame.h)
      seen.add(`${slot.x},${slot.y}`)
    }
    expect(seen.size).toBe(23)
    // Beside the graph: its middle level with the graph's.
    expect(frame.y + frame.h / 2).toBeCloseTo(150)
  })

  it('gives each note the same slot whatever order the notes come in', () => {
    const unlinked = [note('zeta'), note('alpha', { kind: 'knowledge' }), note('mu', { status: 'done' })]
    const one = unlinkedFrame(unlinked, linked)!
    const two = unlinkedFrame([...unlinked].reverse(), linked)!
    for (const u of unlinked) expect(two.slots.get(u.id)).toEqual(one.slots.get(u.id))
  })

  it('keeps every note\'s slot when the Unlinked set changes: a new note takes a freed slot, then the next free one (story 31)', () => {
    const before = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => note(`n-${id}`))
    const one = unlinkedFrame(before, linked)!
    // A live write links n-b and leaves three new notes Unlinked; the linked graph moved meanwhile.
    const after = [...before.filter(n => n.id !== 'n-b'), note('n-aa'), note('n-g'), note('n-h')]
    const moved = linked.map(n => ({ ...n, x: n.x! + 1000 }))
    const two = unlinkedFrame(after, moved, one)!
    for (const id of ['n-a', 'n-c', 'n-d', 'n-e', 'n-f']) expect(two.slots.get(id), id).toEqual(one.slots.get(id))
    expect(two.slots.get('n-aa')).toEqual(one.slots.get('n-b'))
    // Four rows: n-g and n-h take the next column's third and fourth slots, after n-e and n-f.
    const fifth = one.slots.get('n-e')!
    expect(two.slots.get('n-g')).toMatchObject({ x: fifth.x, y: fifth.y + 2 * FRAME.row })
    expect(two.slots.get('n-h')).toMatchObject({ x: fifth.x, y: fifth.y + 3 * FRAME.row })
    expect(two.count).toBe(8)
    for (const slot of two.slots.values()) {
      expect(slot.x).toBeGreaterThan(two.x)
      expect(slot.x).toBeLessThan(two.x + two.w)
      expect(slot.y).toBeGreaterThan(two.y)
      expect(slot.y).toBeLessThan(two.y + two.h)
    }
  })

  it('is null with no Unlinked note, and sits at the origin with nothing linked', () => {
    expect(unlinkedFrame([], linked)).toBeNull()
    const alone = unlinkedFrame([note('u')], [])!
    expect(Math.hypot(alone.x + alone.w / 2, alone.y + alone.h / 2)).toBeLessThan(100)
  })
})

describe('territories', () => {
  type Drawn = GraphNode & Placed
  const at = (id: string, x: number, y: number, fields: Partial<GraphNode> = {}): Drawn =>
    ({ id, kind: 'entity', name: id.toUpperCase(), status: 'paused', x, y, ...fields })

  it('draws one circle per top-level family, round all its generations, named for its root', () => {
    const nodes = [at('root', 0, 0), at('kid', 40, 0), at('grandkid', 80, 0), at('other', 0, 50), at('lone', 500, 500)]
    const parentOf = new Map([['kid', 'root'], ['grandkid', 'kid'], ['other', 'root']])
    const [t, ...rest] = territories(nodes, parentOf)
    expect(rest).toEqual([])
    expect(t).toMatchObject({ root: 'root', name: 'ROOT', members: 4 })
    for (const n of nodes.slice(0, 4)) expect(Math.hypot(n.x! - t.x, n.y! - t.y)).toBeLessThan(t.r)
    expect(Math.hypot(500 - t.x, 500 - t.y)).toBeGreaterThan(t.r)
  })

  it('is gold when the family holds live work, and plain when it does not', () => {
    const parentOf = new Map([['a1', 'a'], ['a2', 'a'], ['b1', 'b'], ['b2', 'b']])
    const nodes = [
      at('a', 0, 0, { status: 'done' }), at('a1', 10, 0, { status: 'active' }), at('a2', 0, 10, { status: 'done' }),
      at('b', 300, 0), at('b1', 310, 0, { status: 'done' }), at('b2', 300, 10),
    ]
    const live = Object.fromEntries(territories(nodes, parentOf).map(t => [t.root, t.live]))
    expect(live).toEqual({ a: true, b: false })
  })

  it('gives every family with a child one, a parent and one child included; a lone note none (story 23)', () => {
    const nodes = [at('p', 0, 0), at('c', 10, 0), at('lone', 500, 500)]
    expect(territories(nodes, new Map([['c', 'p']]))).toMatchObject([{ root: 'p', members: 2 }])
  })

  it('makes the topmost drawn ancestor the root when the true root is not drawn', () => {
    const nodes = [at('mid', 0, 0), at('k1', 10, 0), at('k2', 0, 10)]
    const parentOf = new Map([['mid', 'hidden'], ['k1', 'mid'], ['k2', 'mid']])
    expect(territories(nodes, parentOf).map(t => t.root)).toEqual(['mid'])
  })
})

describe('fitView', () => {
  const VIEW = { w: 800, h: 600 }
  const PAD = 40
  const dot = (id: string, x: number, y: number) => ({ id, x, y, r: 5 })
  /** A graph point on screen, for a camera centred at (cx, cy) with zoom k. */
  const screen = (cam: { x: number; y: number; k: number }, x: number, y: number) =>
    ({ x: VIEW.w / 2 + (x - cam.x) * cam.k, y: VIEW.h / 2 + (y - cam.y) * cam.k })
  const inside = (p: { x: number; y: number }) =>
    p.x >= PAD - 1e-6 && p.x <= VIEW.w - PAD + 1e-6 && p.y >= PAD - 1e-6 && p.y <= VIEW.h - PAD + 1e-6

  it('centres the nodes and fills the view as far as the tighter side allows', () => {
    const cam = fitView([dot('a', -100, -50), dot('b', 300, 150)], null, { w: 0, above: 0, below: 0 }, VIEW, PAD)
    expect(cam.x).toBeCloseTo(100)
    expect(cam.y).toBeCloseTo(50)
    expect(cam.k).toBeCloseTo(Math.min(720 / 410, 520 / 210))
  })

  it("keeps the Unlinked frame's title and caption on screen, though they run past its edge", () => {
    const nodes = [dot('a', -400, -300), dot('b', 400, 300), dot('u', 480, 0)]
    const frame = { x: 470, y: -20, w: 30, h: 40, rows: 4, count: 1, slots: new Map() }
    const text = { w: 180, above: 20, below: 20 }
    const cam = fitView(nodes, frame, text, VIEW, PAD)
    for (const n of nodes) {
      expect(inside(screen(cam, n.x - n.r, n.y - n.r))).toBe(true)
      expect(inside(screen(cam, n.x + n.r, n.y + n.r))).toBe(true)
    }
    const corner = screen(cam, frame.x, frame.y)
    expect(inside({ x: corner.x + text.w, y: corner.y - text.above })).toBe(true)
    const bottom = screen(cam, frame.x, frame.y + frame.h)
    expect(inside({ x: bottom.x + text.w, y: bottom.y + text.below })).toBe(true)
    // And still fills it: the text's reach is the tight side.
    expect(corner.x + text.w).toBeCloseTo(VIEW.w - PAD)
  })
})
