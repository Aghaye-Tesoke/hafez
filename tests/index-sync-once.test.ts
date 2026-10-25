// tests/index-sync-once.test.ts
// indexSync 'once' (#269), the CLI's mode: the first index read in the
// process catches the index up with the files, later reads trust it. Scans
// are counted through db.ts's after-scan seam, never timed.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { serializeFile } from '../src/vault.js'
import { createInternalHafez, removeTemp } from './helpers/hafez.js'
import { createIndex, __setAfterScanHook } from '../src/db.js'
import { createMemoryJournal } from './helpers/memory-journal.js'
import { readJsonOf } from '../src/read-json.js'
import { localDay } from '../src/dates.js'
import type { InternalHafezConfig } from '../src/internal.js'

const TMP = join(tmpdir(), 'hafez-test-sync-once-' + Date.now())
const today = localDay()
let vaults = 0

function entityFile(vault: string, slug: string, name: string, extra: Record<string, unknown> = {}): void {
  writeFileSync(
    join(vault, 'entities', `${slug}.md`),
    serializeFile(
      { name, type: 'project', status: 'active', created: today, 'last-touched': today, ...extra },
      `## Purpose\n\n${name}\n\n## Session Log\n`,
    ),
  )
}

/** A vault holding one entity, its index already built by an earlier process. */
function makeVault(): string {
  const vault = join(TMP, `v${vaults++}`)
  mkdirSync(join(vault, 'entities'), { recursive: true })
  mkdirSync(join(vault, 'knowledge'), { recursive: true })
  entityFile(vault, 'hub', 'Hub')
  createIndex(vault).close()
  return vault
}

/** A fresh instance, as a new CLI process opens one. */
function open(vault: string, indexSync: InternalHafezConfig['indexSync']) {
  return createInternalHafez({ vaultPath: vault, persistence: createMemoryJournal(), indexSync })
}

let scans = 0
beforeAll(() => {
  mkdirSync(TMP, { recursive: true })
  __setAfterScanHook(() => { scans++ })
})
afterEach(() => { scans = 0 })
afterAll(() => {
  __setAfterScanHook(null)
  removeTemp(TMP)
})

async function readEntity(os: ReturnType<typeof open>, slug: string) {
  return readJsonOf(os, slug, 'summary', await os.read(slug)) as Promise<{ children: Array<{ slug: string }> }>
}

describe("indexSync 'once'", () => {
  it('scans once for an entity read, where every-read sync scans twice', async () => {
    const vault = makeVault()
    await readEntity(open(vault, 'read'), 'hub')
    expect(scans).toBe(2)

    scans = 0
    await readEntity(open(vault, 'once'), 'hub')
    expect(scans).toBe(1)
  })

  it('sees a file changed outside hafez before the first read', async () => {
    const vault = makeVault()
    entityFile(vault, 'by-hand', 'By Hand', { parent: 'hub' })

    const json = await readEntity(open(vault, 'once'), 'hub')
    expect(json.children.map(c => c.slug)).toEqual(['by-hand'])
  })

  it('sees its own write on the next read without a rescan', async () => {
    const vault = makeVault()
    const os = open(vault, 'once')
    await readEntity(os, 'hub')

    await os.create('entity', 'Written Child', { type: 'project', parent: 'hub' })
    const json = await readEntity(os, 'hub')
    expect(json.children.map(c => c.slug)).toEqual(['written-child'])
    expect(scans).toBe(1)
  })

  it('trusts the index after the first read until syncIndex()', async () => {
    const vault = makeVault()
    const os = open(vault, 'once')
    await readEntity(os, 'hub')

    entityFile(vault, 'late', 'Late', { parent: 'hub' })
    expect((await os.children('hub')).items).toEqual([])

    await os.syncIndex()
    expect((await os.children('hub')).items.map(c => c.slug)).toEqual(['late'])
  })
})
