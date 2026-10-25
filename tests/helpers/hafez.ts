// tests/helpers/hafez.ts
// createHafez for tests, plus the teardown that goes with it. Windows cannot
// remove a directory while a file in it is open, and every instance holds its
// vault's SQLite index open (#184). Every instance made here is remembered by
// its vault, and removeTemp closes the ones inside the dir before it deletes.
import { rmSync } from 'fs'
import { relative, resolve, isAbsolute } from 'path'
import { createHafez as createHafezCore } from '../../src/index.js'
import { createInternalHafez as createInternalHafezCore, type InternalHafez, type InternalHafezConfig } from '../../src/internal.js'
import type { Hafez, HafezConfig } from '../../src/types.js'

const open = new Map<Hafez, string>()

export function createHafez(config: HafezConfig): Hafez {
  const os = createHafezCore(config)
  open.set(os, resolve(config.vaultPath))
  return os
}

/** The same for the internal factory (src/internal.ts), the graph server's instances. */
export function createInternalHafez(config: InternalHafezConfig): InternalHafez {
  const os = createInternalHafezCore(config)
  open.set(os, resolve(config.vaultPath))
  return os
}

/** Close every instance whose vault is inside the dir, then delete the dir. */
export function removeTemp(dir: string): void {
  const root = resolve(dir)
  const inside = [...open].filter(([, vault]) => {
    const rel = relative(root, vault)
    return !rel.startsWith('..') && !isAbsolute(rel)
  })
  for (const [os] of inside) os.close()
  rmSync(root, { recursive: true, force: true })
  for (const [os] of inside) open.delete(os)
}
