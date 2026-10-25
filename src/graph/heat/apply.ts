// src/graph/heat/apply.ts
// Heat merged into a Graph: each project entity node gains last_active, heat
// and heat_source. A project the sidecar holds hours for is heated by them; any
// other by its vault touches, one hour a day touched. Pure: the input graph is
// never changed, and only the nodes that gain fields are copied.
import type { Graph } from '../../types.js'
import { heatOf, touchesAsMinutes } from './heat.js'
import type { Sidecar } from './sidecar.js'

/** `touches` maps a slug to the local days its commits fall on, within the heat window. */
export function withHeat(graph: Graph, sidecar: Sidecar, touches: Map<string, string[]>, today: string): Graph {
  const nodes = graph.nodes.map(node => {
    if (node.kind !== 'entity' || node.type !== 'project') return node
    const hours = sidecar.days[node.id]
    const { heat, last_active } = heatOf(hours ?? touchesAsMinutes(touches.get(node.id) ?? []), today)
    const lastActive = hours ? last_active : last_active ?? node.last_touched
    return {
      ...node,
      heat,
      heat_source: hours ? 'hours' as const : 'touches' as const,
      ...(lastActive === undefined ? {} : { last_active: lastActive }),
    }
  })
  return { ...graph, nodes }
}
