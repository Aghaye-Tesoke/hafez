// tests/index-lifecycle.test.ts
// Two read-index lifecycle races, both driven deterministically (the
// interleaving is injected, never slept for):
//  (a) rebuildIndex() used to bypass the two-level vault write lock, so a
//      rebuild could interleave with a mutation's file writes.
//  (b) A file written WHILE a staleness scan is in flight was stamped by the
//      scan's END time, so every later sync saw mtime < watermark and skipped
//      it — permanently stale.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, utimesSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { serializeFile } from '../src/vault.js'
import { createHafez, removeTemp } from './helpers/hafez.js'
import { createIndex, __setAfterScanHook } from '../src/db.js'
import { createMemoryJournal } from './helpers/memory-journal.js'
import { localDay } from '../src/dates.js'

const TMP = join(tmpdir(), 'hafez-test-idxlife-' + Date.now())
const today = localDay()

function makeVault(name: string): string {
  const vault = join(TMP, name)
  mkdirSync(join(vault, 'entities'), { recursive: true })
  mkdirSync(join(vault, 'knowledge'), { recursive: true })
  return vault
}

/** Let pending microtasks and I/O callbacks drain without sleeping. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r))
}

beforeAll(() => { mkdirSync(TMP, { recursive: true }) })
afterAll(() => { removeTemp(TMP) })

describe('rebuildIndex takes the vault write lock', () => {
  it('serializes behind an in-flight mutation instead of interleaving with its write', async () => {
    const vault = makeVault('vault-lock')
    writeFileSync(
      join(vault, 'entities', 'lock-target.md'),
      serializeFile(
        { name: 'Lock Target', type: 'project', status: 'active', created: today, 'last-touched': today },
        '## Purpose\n\nLock target\n\n## Session Log\n',
      ),
    )

    // Gate the Journal: the mutation parks inside commit() — i.e. holding the
    // lock, past its file write — until the test releases it.
    const journal = createMemoryJournal()
    const inner = journal.commit.bind(journal)
    let releaseCommit!: () => void
    const commitGate = new Promise<void>(r => { releaseCommit = r })
    let commitEntered!: () => void
    const entered = new Promise<void>(r => { commitEntered = r })
    journal.commit = async (written, deleted, message) => {
      commitEntered()
      await commitGate
      return inner(written, deleted, message)
    }

    const os = createHafez({ vaultPath: vault, persistence: journal })

    const mutation = os.update('lock-target', {
      session_log: { summary: 'held mid-commit', type: 'progress', agent: 'test' },
    })
    await entered

    let rebuildSettled = false
    const rebuild = os.rebuildIndex().then(() => { rebuildSettled = true })
    await flush()

    // The mutation still holds the lock: the rebuild must not have run.
    expect(rebuildSettled).toBe(false)

    releaseCommit()
    await mutation
    await rebuild
    expect(rebuildSettled).toBe(true)

    // …and both landed: the rebuild indexed the committed write.
    const found = await os.query({ filter: 'all' })
    expect(found.items.map(i => i.slug)).toContain('lock-target')
  })
})

describe('staleness watermark survives a mid-scan write', () => {
  it('picks up on the next sync a file written between the scan read and the record', () => {
    const vault = makeVault('vault-scan')
    const file = join(vault, 'entities', 'mid-scan.md')
    const write = (marker: string) => writeFileSync(
      file,
      serializeFile(
        { name: 'Mid Scan', type: 'project', status: 'active', created: today, 'last-touched': today },
        `## Brief\n\n${marker}\n\n## Session Log\n`,
      ),
    )

    write('version-one')
    const idx = createIndex(vault)          // auto-rebuild seeds the watermark
    const indexed = () => idx.queryItems({}).items.find(i => i.slug === 'mid-scan')!.brief
    expect(indexed()).toContain('version-one')

    // A change the scan WILL see, so the watermark actually advances.
    write('version-two')
    utimesSync(file, new Date(), new Date())

    // …and a change that lands after the scan read the file but before it
    // records the watermark. The clock is jumped forward at the same moment so
    // an end-of-scan watermark is unambiguously later than the write's mtime.
    const realNow = Date.now
    __setAfterScanHook(() => {
      write('version-three')
      // Pin the mtime a hair ahead of the scan-start watermark: the FS clock
      // and Date.now() round differently at the boundary, and this test is
      // about the watermark policy, not sub-millisecond clock agreement.
      const ahead = new Date(realNow() + 5)
      utimesSync(file, ahead, ahead)
      vi.spyOn(Date, 'now').mockReturnValue(realNow() + 60_000)
    })
    try {
      idx.syncIfStale()
    } finally {
      __setAfterScanHook(null)
      vi.restoreAllMocks()
    }
    expect(indexed()).toContain('version-two')

    // The mid-scan write must not be lost to the watermark.
    idx.syncIfStale()
    expect(indexed()).toContain('version-three')

    idx.close()
  })
})

describe('close() releases the index handle (#184)', () => {
  it('lets the index file be deleted, and the next call reopens it', async () => {
    const vault = makeVault('vault-close')
    const os = createHafez({ vaultPath: vault, persistence: createMemoryJournal() })
    await os.create('entity', 'Kept', { type: 'project' })

    os.close()
    os.close()
    // Windows refuses to delete an open file; POSIX would allow it either way.
    // The -wal/-shm siblings go too: a leftover WAL beside a fresh db would
    // read as corruption, not as the open-handle regression this guards.
    for (const suffix of ['', '-wal', '-shm']) rmSync(join(vault, `.hafez.db${suffix}`), { force: true })

    expect((await os.query({ filter: 'all' })).items.map(i => i.slug)).toEqual(['kept'])
  })
})
