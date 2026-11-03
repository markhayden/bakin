/**
 * POST /api/plugins/disable and /api/plugins/enable (self-healing PR1, row
 * 98 containment): the ledger flag is the durable change, the running
 * server follows it live when it can, core plugins are refused, and the
 * route is a bounded install-state writer (409 `install_busy`).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-plugins-disable-api-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')

const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir, home: testDir, audit: join(testDir, 'audit.jsonl'), db: join(testDir, 'bakin.db') }) })
mock.module('@/core/content-dir', contentDirMock)
mock.module('@bakin/core/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('@/core/logger', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }))

// A minimal registry: `stale` is active (so disable has something to deactivate), `tasks` is core.
const states = new Map<string, { plugin: { name: string; version: string }; manifest?: { version: string }; description: string }>()
const suspendPlugin = mock(async (id: string) => { states.delete(id); return true })
const markPluginDisabled = mock(() => {})
const clearPluginDisabled = mock(() => true)
mock.module('@/core/plugin-registry', () => ({
  isCorePlugin: (id: string) => id === 'tasks',
  pluginRegistry: {
    getPluginState: (id: string) => states.get(id),
    suspendPlugin,
    markPluginDisabled,
    clearPluginDisabled,
  },
}))
class NotInitialized extends Error {}
let activationFails: Error | null = null
const activateUserPluginDir = mock(async (dir: string) => { if (activationFails) throw activationFails; return { id: dir.split('/').pop() ?? 'plugin', version: '1.0.0', runtimeVersion: 1 } })
const notifyPluginRemoved = mock(() => {})
mock.module('@/core/plugins/live-lifecycle', () => ({
  activateUserPluginDir,
  isLiveActivationUnavailable: (err: unknown) => err instanceof NotInitialized,
  notifyPluginRemoved,
  unwatchPluginIfEnabled: async () => false,
}))

import { post as disablePOST } from '../../packages/host/src/api/plugins/disable'
import { post as enablePOST } from '../../packages/host/src/api/plugins/enable'
import { holdNow } from '../../packages/core/src/operations'
import { readPluginLockfile, writePluginLockfile } from '../../packages/core/src/plugins/lockfile'
import { _resetOperationRegistryForTests } from '../../src/core/operations'

function req(body: unknown): Request {
  return new Request('http://localhost/api/plugins/disable', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) })
}
const entry = { source: 'github:acme/bits#plugins/stale', type: 'github' as const, ref: '', commitSha: '', installedAt: '2026-10-01T00:00:00.000Z', version: '1.0.0', permissions: [], manifestSha: 'c'.repeat(64) }

beforeAll(() => mkdirSync(testDir, { recursive: true }))
afterAll(() => rmSync(testDir, { recursive: true, force: true }))
beforeEach(() => {
  _resetOperationRegistryForTests()
  rmSync(join(testDir, 'plugins'), { recursive: true, force: true })
  mkdirSync(join(testDir, 'plugins', 'stale'), { recursive: true })
  writePluginLockfile({ version: 1, plugins: { stale: entry } })
  states.clear()
  states.set('stale', { plugin: { name: 'Stale', version: '1.0.0' }, manifest: { version: '1.0.0' }, description: 'd' })
  suspendPlugin.mockClear(); markPluginDisabled.mockClear(); clearPluginDisabled.mockClear(); activateUserPluginDir.mockClear(); notifyPluginRemoved.mockClear()
  activationFails = null
})

describe('POST /api/plugins/disable', () => {
  it('rejects malformed JSON and a missing pluginId with 400', async () => {
    expect((await disablePOST(req('{ nope'))).status).toBe(400)
    expect((await disablePOST(req({}))).status).toBe(400)
  })

  it('refuses a core plugin with 409 core_plugin and never touches the ledger', async () => {
    const res = await disablePOST(req({ pluginId: 'tasks' }))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ ok: false, error: 'core_plugin', core: true })
    expect(readPluginLockfile().plugins.tasks).toBeUndefined()
  })

  it('answers 404 not_installed for a plugin the ledger does not know', async () => {
    const res = await disablePOST(req({ pluginId: 'ghost' }))
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ ok: false, error: 'not_installed' })
  })

  it('marks the ledger disabled, SUSPENDS the running plugin live (never the destructive uninstall teardown), and is idempotent', async () => {
    const res = await disablePOST(req({ pluginId: 'stale' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, id: 'stale', disabled: true, changed: true, live: true, message: 'Disabled "stale".' })
    expect(readPluginLockfile().plugins.stale!.disabled).toBe(true)
    expect(suspendPlugin).toHaveBeenCalledWith('stale', { callShutdown: true })
    expect(markPluginDisabled).toHaveBeenCalledWith({ id: 'stale', name: 'Stale', version: '1.0.0', description: 'd' })
    expect(notifyPluginRemoved).toHaveBeenCalledWith('stale')

    const again = await disablePOST(req({ pluginId: 'stale' }))
    expect(await again.json()).toMatchObject({ ok: true, changed: false, message: '"stale" was already disabled.' })
  })
})

describe('POST /api/plugins/enable', () => {
  it('clears the mark and activates the directory again', async () => {
    writePluginLockfile({ version: 1, plugins: { stale: { ...entry, disabled: true } } })
    states.clear()
    const res = await enablePOST(req({ pluginId: 'stale' }))
    expect(await res.json()).toMatchObject({ ok: true, disabled: false, changed: true, live: true, message: 'Enabled "stale".' })
    expect(readPluginLockfile().plugins.stale!.disabled).toBeUndefined()
    expect(clearPluginDisabled).toHaveBeenCalledWith('stale')
    expect(activateUserPluginDir).toHaveBeenCalledWith(join(testDir, 'plugins', 'stale'))
  })

  it('when the live step cannot run the flag is still set and the answer says so — never a silent no-op', async () => {
    writePluginLockfile({ version: 1, plugins: { stale: { ...entry, disabled: true } } })
    states.clear()
    activationFails = new NotInitialized('no registry')
    const res = await enablePOST(req({ pluginId: 'stale' }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toMatchObject({ ok: true, disabled: false, changed: true, live: false })
    expect(body.liveError).toContain('next server start')
    expect(body.message).toContain('takes effect at the next restart')
    expect(readPluginLockfile().plugins.stale!.disabled).toBeUndefined()
  })
})

describe('over install-state (#895 D23)', () => {
  it('answers 409 install_busy naming the holder while another operation owns install-state', async () => {
    let release!: () => void
    let ready!: () => void
    const heldReady = new Promise<void>((resolve) => { ready = resolve })
    void holdNow(['install-state'], { title: 'Install plugin notes' }, () => new Promise<void>((resolve) => { release = resolve; ready() }))
    await heldReady
    try {
      const res = await disablePOST(req({ pluginId: 'stale' }))
      expect(res.status).toBe(409)
      expect(await res.json()).toMatchObject({ ok: false, error: 'install_busy', holder: { title: 'Install plugin notes' } })
      expect(readPluginLockfile().plugins.stale!.disabled).toBeUndefined()
    } finally {
      release()
    }
  })
})
