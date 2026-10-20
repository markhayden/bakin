/** `GET /api/plugins/manifest` reads the updates engine for `upgradeAvailable`/`staleHintDays`; `?check=1` runs the engine's plugin pass (#1007 B 8.2). */
import { afterAll, afterEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const testDir = join(tmpdir(), `bakin-test-plugin-manifest-updates-${Date.now()}-${randomUUID()}`)
mkdirSync(testDir, { recursive: true })
process.env.BAKIN_HOME = testDir
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, root: testDir, db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
const loggerMock = () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) })
mock.module('../../src/core/logger', loggerMock)
mock.module('../../packages/core/src/logger', loggerMock)
mock.module('../../src/core/sse', () => ({ broadcast: () => {} }))
const LOCK_ENTRY = { source: 'github:acme/notes', type: 'github', ref: 'main', commitSha: 'a'.repeat(40), installedAt: '2026-10-01T00:00:00.000Z', version: '1.0.0', permissions: [], manifestSha: 'c'.repeat(64) }
mock.module('@bakin/core/plugins/lockfile', () => ({
  readPluginLockfile: () => ({ version: 1, plugins: { notes: LOCK_ENTRY } }),
}))
mock.module('@/core/plugin-registry', () => ({
  isCorePlugin: (id: string) => id === 'tasks',
  pluginRegistry: {
    getRegistrySnapshot: () => [
      { id: 'tasks', name: 'Tasks', version: '1.0.0', status: 'active', contributes: {} },
      { id: 'notes', name: 'Notes', version: '1.0.0', status: 'active', contributes: {} },
    ],
  },
}))
afterAll(() => { delete process.env.BAKIN_HOME; rmSync(testDir, { recursive: true, force: true }) })

import { get, staleHintDaysOf } from '../../packages/host/src/api/plugins/manifest'
import { fingerprintOf } from '../../src/core/updates/inventory'
import { getUpdatesEngine, registerUpdateSource, resetUpdateSources, startUpdates, stopUpdates } from '../../src/core/updates/service'
import type { UpdateObservation, UpdateSource } from '../../src/core/updates/types'

interface ManifestBody { plugins: Array<{ id: string; upgradeAvailable: boolean; staleHintDays: number | null; updateObservedAt: string | null }> }
const read = async (query = ''): Promise<ManifestBody> => (await (await get(new Request(`http://localhost/api/plugins/manifest${query}`))).json()) as ManifestBody
const row = async (query = '') => (await read(query)).plugins.find((p) => p.id === 'notes')!

function scripted(observe: (id: string) => Promise<UpdateObservation>) {
  const calls: string[] = []
  const source: UpdateSource = {
    kind: 'plugin',
    inventory: async () => [{ subject: { kind: 'plugin', id: 'notes', label: 'notes' }, group: 'available', fingerprint: fingerprintOf({ id: 'notes' }), source: { kind: 's', endpoint: 'notes' } }],
    observe: async (entry) => { calls.push(entry.subject.id); return observe(entry.subject.id) },
  }
  return { source, calls }
}
const available: UpdateObservation = { installed: { version: '1.0.0', display: '1.0.0' }, available: { version: '1.1.0', display: '1.1.0' }, reason: 'newer-version', outcome: 'update-available', action: { kind: 'operation', start: { route: '/api/updates/plugin%3Anotes/apply' }, impact: ['download'] } }
const current: UpdateObservation = { installed: { version: '1.0.0', display: '1.0.0' }, outcome: 'current' }

afterEach(() => { stopUpdates(); resetUpdateSources() })

describe('GET /api/plugins/manifest — upgrade projection from the updates engine', () => {
  it('without a running engine every user plugin is honestly not-upgradable with no staleness hint; core plugins never are', async () => {
    const body = await read()
    expect(body.plugins.map((p) => [p.id, p.upgradeAvailable, p.staleHintDays, p.updateObservedAt])).toEqual([['tasks', false, null, null], ['notes', false, null, null]])
  })

  it('updateObservedAt is the record\'s last successful observation — absent before one, kept across a later failed attempt', async () => {
    let fail = false
    const { source } = scripted(async () => { if (fail) throw new Error('offline'); return current })
    registerUpdateSource(source)
    const engine = startUpdates(testDir)
    await engine.ready
    expect((await row()).updateObservedAt).toBeNull()
    await engine.observe('plugin:notes')
    const observedAt = (await engine.snapshot()).records.find((r) => r.id === 'plugin:notes')!.observedAt!
    expect((await row()).updateObservedAt).toBe(observedAt)
    fail = true
    await engine.observe('plugin:notes')
    expect((await row()).updateObservedAt).toBe(observedAt)
  })

  it('an unskipped update-available record is an upgrade; a skipped one is not; current is not — the lockfile markers are never read', async () => {
    const plugins = scripted(async () => available)
    registerUpdateSource(plugins.source)
    startUpdates(testDir)
    const engine = getUpdatesEngine()!
    await engine.ready
    expect((await row()).upgradeAvailable).toBe(false) // nothing observed yet
    await engine.observe('plugin:notes')
    expect((await row()).upgradeAvailable).toBe(true)
    await engine.skip('plugin:notes')
    expect((await row()).upgradeAvailable).toBe(false)
  })

  it('?check=1 runs the engine\'s plugin pass and answers with the refreshed projection', async () => {
    let answer = current
    const plugins = scripted(async () => answer)
    registerUpdateSource(plugins.source)
    startUpdates(testDir)
    await getUpdatesEngine()!.ready
    expect((await row('?check=1')).upgradeAvailable).toBe(false)
    expect(plugins.calls).toEqual(['notes'])
    answer = available
    expect((await row('?check=1')).upgradeAvailable).toBe(true)
    expect(plugins.calls).toEqual(['notes', 'notes'])
    // A plain read runs nothing.
    await row()
    expect(plugins.calls).toEqual(['notes', 'notes'])
  })

  it('staleHintDays comes from the record\'s observedAt (older than 7 days ⇒ the age in days, otherwise null)', async () => {
    const plugins = scripted(async () => current)
    registerUpdateSource(plugins.source)
    const engine = startUpdates(testDir)
    await engine.ready
    await engine.observe('plugin:notes')
    expect((await row()).staleHintDays).toBeNull()
    const now = Date.parse('2026-10-20T12:00:00.000Z')
    expect(staleHintDaysOf('2026-10-15T12:00:00.000Z', now)).toBeNull()
    expect(staleHintDaysOf('2026-10-01T12:00:00.000Z', now)).toBe(19)
    expect(staleHintDaysOf(undefined, now)).toBeNull()
  })
})
