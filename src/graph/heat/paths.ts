// src/graph/heat/paths.ts
// Maps a working folder to the vault entity whose `resource` holds it. A
// resource is free text: a Windows path, a POSIX or WSL path, a URL, or a
// path with a trailing branch note. Both sides are normalized to one form
// so that the comparison is on folders, not on how they were typed.

/**
 * Normalizes a path for comparison: drops a trailing ` (...)` note, uses `/`
 * separators, maps a WSL mount (`/mnt/d/x`) to a drive (`d:/x`), lowercases,
 * and strips trailing slashes.
 */
export function normalizePath(p: string): string {
  return p
    .replace(/ \(.*\)$/, '')
    .replace(/\\/g, '/')
    .replace(/^\/mnt\/([a-z])\//i, '$1:/')
    .toLowerCase()
    .replace(/\/+$/, '')
}

/** True when a resource names a folder: URLs and bare web addresses do not. */
export function isPathResource(resource: string): boolean {
  return !resource.includes('://') && !resource.startsWith('www.')
}

/**
 * The slug whose path resource is the cwd itself or an ancestor of it, cut at
 * a `/` boundary so `automazon` does not claim `automazon2`. When several
 * resources hold the cwd, the longest one wins. URLs and null resources are
 * skipped.
 */
export function hostSlug(
  cwd: string,
  resources: ReadonlyArray<{ slug: string; resource: string | null }>,
): string | undefined {
  const here = normalizePath(cwd)
  let best: string | undefined
  let bestLength = -1
  for (const { slug, resource } of resources) {
    if (resource === null || !isPathResource(resource)) continue
    const folder = normalizePath(resource)
    const holds = here === folder || here.startsWith(folder + '/')
    if (holds && folder.length > bestLength) {
      best = slug
      bestLength = folder.length
    }
  }
  return best
}
