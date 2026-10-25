// tests/graph-tokens.test.ts
// The page's token sheet and the one stylesheet built from it (#272): pure
// client modules, run in node.
import { describe, it, expect } from 'vitest'
import { FONT } from '../src/graph/client/tokens.js'
import { stylesheet } from '../src/graph/client/stylesheet.js'

describe('the stylesheet', () => {
  it('declares a bundled @font-face, served from /fonts/, for the first family of every font stack', () => {
    const css = stylesheet()
    const faces = [...css.matchAll(/@font-face\s*{([^}]*)}/g)].map(m => m[1])
    for (const [role, stack] of Object.entries(FONT)) {
      const first = stack.split(',')[0].trim()
      const face = faces.find(f => f.includes(`font-family: ${first};`))
      expect(face, role).toBeDefined()
      expect(face, role).toMatch(/src: url\(\/fonts\/[\w-]+\.woff2\) format\('woff2'\)/)
    }
  })
})
