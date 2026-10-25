// src/graph/fields.ts
// Plain data shared by the index (db.ts) and the graph page's bundle. Kept
// out of contracts.ts, whose contract objects esbuild cannot drop from the
// bundle once it imports anything there.

/** The optional Graph node fields queryGraph copies from an index row when set. */
export const GRAPH_ROW_FIELDS = ['type', 'status', 'subtype', 'confidence', 'last_touched', 'description'] as const

/** The optional Graph node fields queryGraph derives (#271): an Entity's signals
 * and an Unlinked note's mark and placing slug. */
export const GRAPH_SIGNAL_FIELDS = ['open_actions', 'stale', 'stale_actions', 'staleness_days', 'unlinked', 'best'] as const

/** Every optional Graph node field: what the page's merge drops from a node a
 * refresh no longer gives it. */
export const GRAPH_NODE_FIELDS = [...GRAPH_ROW_FIELDS, ...GRAPH_SIGNAL_FIELDS] as const
