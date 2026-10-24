/**
 * The ONE live activation boundary honours the ledger's `disabled` mark
 * (self-healing PR1 row 98, Codex r2 N7): an upgrade, reinstall, restore or
 * link of a plugin the operator disabled is placed on disk but NEVER
 * activated — the registry keeps listing it disabled and the caller is told
 * (`skipped: 'disabled'`). Only the enable route clears the mark first.
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-live-lifecycle-disabled-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = pathJoin(testDir, 'openclaw')

import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }), isUsingBakinHome: () => true })
mock.module('@/core/content-dir', contentDirMock)
mock.module('@bakin/core/content-dir', contentDirMock)
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({ getOpenClawHome: () => pathJoin(testDir, 'openclaw'), getOpenClawPath: (...parts: string[]) => pathJoin(testDir, 'openclaw', ...parts), resetOpenClawHome: () => {} }))
mock.module('@/core/logger', () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) }))

class PluginRegistryNotInitializedError extends Error {}
const activateUserPluginFromDir = mock(async (dir: string) => ({ id: dir.split('/').pop() ?? 'plugin', version: '2.0.0' }))
const markPluginDisabled = mock(() => {})
mock.module('@/core/plugin-registry', () => ({
  PluginRegistryNotInitializedError,
  pluginRegistry: { activateUserPluginFromDir, markPluginDisabled },
}))
const broadcastPluginManifestChanged = mock(() => {})
const broadcastPluginReload = mock(() => {})
mock.module('@/core/sse', () => ({ broadcastPluginManifestChanged, broadcastPluginReload, broadcast: () => {} }))
mock.module('@/core/search-registry', () => ({ ensurePluginSearchReady: async () => {} }))
mock.module('../../../packages/host/src/api/dev/events', () => ({ broadcastDev: () => {} }))

import { activateUserPluginDir } from '../../../src/core/plugins/live-lifecycle'
import { writePluginLockfile } from '../../../packages/core/src/plugins/lockfile'

const entry = { source: 'github:acme/bits#plugins/stale', type: 'github' as const, ref: '', commitSha: '', installedAt: '2026-10-01T00:00:00.000Z', version: '2.0.0', permissions: [], manifestSha: 'c'.repeat(64) }
const pluginDir = (id: string) => join(testDir, 'plugins', id)

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(pluginDir('stale'), { recursive: true })
  writeFileSync(join(pluginDir('stale'), 'bakin-plugin.json'), JSON.stringify({ id: 'stale', name: 'Stale', version: '2.0.0', description: 'd' }))
  activateUserPluginFromDir.mockClear(); markPluginDisabled.mockClear(); broadcastPluginManifestChanged.mockClear(); broadcastPluginReload.mockClear()
})
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('activateUserPluginDir and the disabled mark', () => {
  it('a plugin the ledger marks disabled is NOT activated: the registry lists it disabled and the caller learns it was skipped', async () => {
    writePluginLockfile({ version: 1, plugins: { stale: { ...entry, disabled: true } } })
    const result = await activateUserPluginDir(pluginDir('stale'))
    expect(result).toMatchObject({ id: 'stale', version: '2.0.0', skipped: 'disabled' })
    expect(activateUserPluginFromDir).not.toHaveBeenCalled()
    expect(markPluginDisabled).toHaveBeenCalledWith({ id: 'stale', name: 'Stale', version: '2.0.0', description: 'd' })
    expect(broadcastPluginManifestChanged).toHaveBeenCalledWith('stale', 'changed')
    expect(broadcastPluginReload).not.toHaveBeenCalled()
  })

  it('an enabled plugin activates through the registry as before', async () => {
    writePluginLockfile({ version: 1, plugins: { stale: entry } })
    const result = await activateUserPluginDir(pluginDir('stale'))
    expect(result.skipped).toBeUndefined()
    expect(result).toMatchObject({ id: 'stale', version: '2.0.0' })
    expect(activateUserPluginFromDir).toHaveBeenCalledTimes(1)
    expect(markPluginDisabled).not.toHaveBeenCalled()
    expect(broadcastPluginReload).toHaveBeenCalledTimes(1)
  })

  it('a plugin the ledger does not know, or an unreadable ledger, is treated as enabled (the registry reports real errors)', async () => {
    writePluginLockfile({ version: 1, plugins: {} })
    expect((await activateUserPluginDir(pluginDir('stale'))).skipped).toBeUndefined()
    writeFileSync(join(testDir, 'plugins', 'lock.json'), '{ not json')
    expect((await activateUserPluginDir(pluginDir('stale'))).skipped).toBeUndefined()
    expect(activateUserPluginFromDir).toHaveBeenCalledTimes(2)
  })
})
