// tests/internal-surface.test.ts
// The graph server's index controls are internal (#270 review, the owner's
// call): `indexSync` and `syncIndex()` are on src/internal.ts's types only,
// never on the package's HafezConfig or Hafez. The type checks below run in
// `npm run typecheck`: each @ts-expect-error fails the build if the field
// comes back to the public type.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { Hafez, HafezConfig } from '../src/index.js'
import type { InternalHafez, InternalHafezConfig } from '../src/internal.js'

describe('the library surface', () => {
  it('takes no indexSync and has no syncIndex; the internal types carry both', () => {
    // @ts-expect-error indexSync is internal
    const config: HafezConfig = { vaultPath: '/v', indexSync: 'manual' }
    const internal: InternalHafezConfig = { vaultPath: '/v', indexSync: 'manual' }
    // @ts-expect-error syncIndex is internal
    const sync: Hafez['syncIndex'] = async () => {}
    const internalSync: InternalHafez['syncIndex'] = async () => {}
    expect([config, internal, sync, internalSync]).toHaveLength(4)
  })

  it('the published declarations the package exports name neither', () => {
    for (const file of ['index.d.ts', 'types.d.ts']) {
      const dts = readFileSync(join(process.cwd(), 'dist', file), 'utf-8')
      expect(dts, file).not.toMatch(/indexSync|syncIndex/)
    }
  })
})
