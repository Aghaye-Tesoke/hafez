// tests/graph-fields.test.ts
import { describe, expect, it } from 'vitest'
import { GRAPH_HEAT_FIELDS, GRAPH_NODE_FIELDS } from '../src/graph/fields.js'

describe('the Graph node fields', () => {
  it('list the heat fields among the optional fields a refresh may drop', () => {
    expect(GRAPH_HEAT_FIELDS).toEqual(['last_active', 'heat', 'heat_source'])
    for (const f of GRAPH_HEAT_FIELDS) expect(GRAPH_NODE_FIELDS).toContain(f)
  })
})
