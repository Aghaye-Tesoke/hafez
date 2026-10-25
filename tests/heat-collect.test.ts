// tests/heat-collect.test.ts
// The heat collector: transcripts on disk to a per-slug hours sidecar, with
// entities from a real-git temp Vault.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, writeFileSync } from 'fs'
import { join, sep } from 'path'
import { tmpdir } from 'os'
import { simpleGit } from 'simple-git'
import { createHafez, removeTemp } from './helpers/hafez.js'
import { collectHeat } from '../src/graph/heat/collect.js'
import { readSidecar, writeSidecar, emptySidecar } from '../src/graph/heat/sidecar.js'
import type { Hafez } from '../src/types.js'

const TMP = join(tmpdir(), 'hafez-test-heat-collect-' + Date.now()).split(sep).join('/')
const VAULT = `${TMP}/vault`
const PROJECT = `${TMP}/work/mapped`
const LONELY = `${TMP}/work/lonely`
const STRAY = `${TMP}/work/stray`
const ROOT = `${TMP}/transcripts`
const SIDECAR = `${TMP}/config/hours.json`
const NOW = new Date('2026-10-25T12:00:00')

let os: Hafez

function transcript(folder: string, cwd: string): void {
  mkdirSync(`${ROOT}/${folder}`, { recursive: true })
  const lines = [
    { type: 'user', timestamp: '2026-10-24T09:00:00', cwd },
    { type: 'user', timestamp: '2026-10-24T09:10:00' },
  ]
  writeFileSync(`${ROOT}/${folder}/s.jsonl`, lines.map(l => JSON.stringify(l)).join('\n') + '\n')
}

beforeAll(async () => {
  mkdirSync(`${VAULT}/entities`, { recursive: true })
  mkdirSync(`${VAULT}/knowledge`, { recursive: true })
  const git = simpleGit(VAULT)
  await git.init()
  writeFileSync(`${VAULT}/.gitkeep`, '')
  await git.add('.gitkeep')
  await git.commit('init')
  os = createHafez({ vaultPath: VAULT, git: { push: false } })
  await os.create('entity', 'Mapped', { type: 'project', resource: PROJECT })
  await os.create('entity', 'Lonely', { type: 'project', resource: LONELY })
  await os.create('entity', 'Unmapped', { type: 'project' })
  transcript('mapped-folder', PROJECT)
  transcript('stray-folder', STRAY)
  // One timestamp only: a session of 0 active minutes.
  mkdirSync(`${ROOT}/lonely-folder`, { recursive: true })
  writeFileSync(`${ROOT}/lonely-folder/s.jsonl`, JSON.stringify({ type: 'user', timestamp: '2026-10-24T09:00:00', cwd: LONELY }) + '\n')
})
afterAll(() => removeTemp(TMP))

describe('collectHeat', () => {
  it('maps a transcript cwd to its entity and drops the stray one', async () => {
    const sidecar = await collectHeat(os, { transcriptRoot: ROOT, sidecarPath: SIDECAR, now: NOW })
    expect(sidecar.days.mapped).toEqual({ '2026-10-24': 10 })
    expect(sidecar.days.unmapped).toBeUndefined()
    expect(Object.keys(sidecar.days)).toEqual(['mapped'])
    expect(sidecar.generated).toBe(NOW.toISOString())
    expect(readSidecar(SIDECAR)).toEqual(sidecar)
  })

  it('a mapped cwd with 0 minutes in the window leaves no days key', async () => {
    const sidecar = await collectHeat(os, { transcriptRoot: ROOT, sidecarPath: SIDECAR, now: NOW })
    expect(sidecar.days).not.toHaveProperty('lonely')
  })

  it('prunes days past the window and does not accumulate across runs', async () => {
    const old = emptySidecar()
    old.days.mapped = { '2026-09-01': 500, '2026-10-24': 10 }
    writeSidecar(SIDECAR, old)
    const sidecar = await collectHeat(os, { transcriptRoot: ROOT, sidecarPath: SIDECAR, now: NOW })
    expect(sidecar.days.mapped).toEqual({ '2026-10-24': 10 })
  })
})
