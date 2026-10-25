// src/graph/client/motion.ts
// prefers-reduced-motion (K5), the page's one query of it: while it matches,
// every camera move is instant (main.ts) and a pulse's ring stays put (live.ts).
const query = matchMedia('(prefers-reduced-motion: reduce)')

export const reducedMotion = (): boolean => query.matches

/** A camera move's duration: `ms`, or 0 under reduced motion. */
export const motion = (ms: number): number => (query.matches ? 0 : ms)
