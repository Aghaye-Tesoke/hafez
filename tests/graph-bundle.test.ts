// tests/graph-bundle.test.ts
// What the page's bundle takes from the rest of src/ (spec #270): types, and
// only the pure, dependency-free modules listed here. Anything else would pull
// node-side code (the index, git, the fs) into the browser bundle.
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { dirname, join, relative, resolve } from 'path'
import { fileURLToPath } from 'url'

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src')
const CLIENT = join(SRC, 'graph', 'client')

/** The modules outside client/ the bundle may import values from. */
const SHARED = ['dates.ts', 'graph/fields.ts', 'graph/fonts.ts']

/** A module's value imports (`import type` left out), as paths under src/. */
function valueImports(file: string): string[] {
  const text = readFileSync(file, 'utf-8')
  return [...text.matchAll(/^import\s+(?!type\s)[^'"]*?from\s+'([^']+)'/gm)]
    .map(m => m[1])
    .filter(spec => spec.startsWith('.'))
    .map(spec => relative(SRC, resolve(dirname(file), spec)).replace(/\\/g, '/').replace(/\.js$/, '.ts'))
}

describe('the page bundle', () => {
  it('imports values from outside client/ only from the shared pure modules', () => {
    // Every module under client/, galaxy/ included.
    const files = (readdirSync(CLIENT, { recursive: true }) as string[]).map(f => f.replace(/\\/g, '/')).filter(f => f.endsWith('.ts'))
    expect(files).toContain('galaxy/meshes.ts')
    const outside = files
      .flatMap(f => valueImports(join(CLIENT, f)).filter(path => !path.startsWith('graph/client/')).map(path => `${f} → ${path}`))
    for (const line of outside) expect(SHARED, line).toContain(line.split(' → ')[1])
  })

  it('the shared modules import nothing themselves', () => {
    for (const path of SHARED) expect(valueImports(join(SRC, path)), path).toEqual([])
  })

  it('stays under 1.5 MB minified', () => expect(statSync(resolve(SRC, '..', 'dist', 'graph', 'client.js')).size).toBeLessThan(1.5 * 1024 * 1024))
})
