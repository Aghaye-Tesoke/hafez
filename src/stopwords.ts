// src/stopwords.ts
// Words too common to tell two texts apart: dropped from full-text search
// terms (db.ts) and, through `tokenize`, from the words the Near-match rule
// (near-match.ts) and the read-miss closest slugs (closest.ts) compare.

export const STOPWORDS: ReadonlySet<string> = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of',
  'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
  'may', 'might', 'can', 'shall', 'not', 'no', 'nor', 'so', 'if', 'then', 'than',
  'that', 'this', 'these', 'those', 'it', 'its', 'my', 'your', 'his', 'her',
  'our', 'their', 'what', 'which', 'who', 'whom', 'how', 'when', 'where', 'why',
  'all', 'each', 'every', 'both', 'few', 'more', 'most', 'some', 'any', 'such',
  'about', 'into', 'over', 'after', 'before',
  'work', 'works', 'working', 'use', 'using', 'used', 'get', 'got', 'make', 'made',
  'need', 'want', 'like', 'just', 'also', 'still', 'already', 'very', 'much',
])

/** Lowercased words with stopwords dropped. `stem` also strips a plural `s`,
 * so `launchpads` and `launchpad` are one word. */
export function tokenize(text: string, { stem = false }: { stem?: boolean } = {}): string[] {
  const words = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(w => w && !STOPWORDS.has(w))
  return stem ? words.map(w => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)) : words
}
