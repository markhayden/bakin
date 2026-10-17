import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { installFilesystemRuntimeAppServices } from '../helpers/runtime-app-services'
import type { PluginLockEntry } from '../../packages/core/src/plugins/lockfile'

const testDir = join(tmpdir(), `bakin-test-plugins-restore-${Date.now()}-${randomUUID()}`)
const openClawDir = join(testDir, 'openclaw')

process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = openClawDir

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('@/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))
mock.module('@/core/plugin-registry', () => ({
  isCorePlugin: () => false,
  pluginRegistry: {
    deactivatePlugin: async () => ({ hooks: 0, execTools: 0, contentTypes: 0, skills: 0 }),
  },
}))
// Holds activation (after the copy — past the point of no return) when set.
let activationGate: Promise<void> | null = null
mock.module('@/core/plugins/live-lifecycle', () => ({
  activateUserPluginDir: async () => {
    if (activationGate) await activationGate
    return { id: 'demo-plugin', version: '1.2.3', runtimeVersion: 1 }
  },
  isLiveActivationUnavailable: () => false,
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => openClawDir,
  getOpenClawPath: (...parts: string[]) => join(openClawDir, ...parts),
  resetOpenClawHome: () => {},
}))

import { restorePOST } from '../helpers/plugin-routes'
import { snapshotUninstall } from '../../src/core/plugins/uninstall-snapshot'
import { addPlugin, readPluginLockfile, removePlugin, writePluginLockfile } from '../../packages/core/src/plugins/lockfile'
import { holdNow } from '../../packages/core/src/operations'
import { post as restoreRoute } from '../../packages/host/src/api/plugins/restore'
import { _resetOperationRegistryForTests, getOperationRegistry } from '../../src/core/operations'
import { waitUntil } from '../helpers/wait'

const pluginEntry: PluginLockEntry = {
  source: 'github:markhayden/example-plugin',
  type: 'github',
  ref: 'main',
  commitSha: '0123456789abcdef0123456789abcdef01234567',
  installedAt: '2026-05-03T00:00:00.000Z',
  version: '1.2.3',
  permissions: [],
  manifestSha: 'fixture-manifest-sha',
  installedSkills: [],
}

beforeEach(() => {
  _resetOperationRegistryForTests()
  activationGate = null
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  mkdirSync(openClawDir, { recursive: true })
  installFilesystemRuntimeAppServices({ openClawDir })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

function request(body: unknown): Request {
  return new Request('http://localhost/api/plugins/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function invoke(body: unknown): Promise<Response> {
  return restorePOST(request(body), new URL('http://localhost/api/plugins/restore'))
}

async function seedSnapshot(): Promise<void> {
  const pluginDir = join(testDir, 'plugins', 'demo-plugin')
  mkdirSync(pluginDir, { recursive: true })
  writeFileSync(join(pluginDir, 'bakin-plugin.json'), JSON.stringify({
    id: 'demo-plugin',
    name: 'Demo Plugin',
    version: '1.2.3',
    bakin: '>=1.0.0',
    description: 'Fixture plugin',
        permissions: [],
  }, null, 2), 'utf-8')
  writeFileSync(join(pluginDir, 'index.ts'), '// fixture\n', 'utf-8')
  writePluginLockfile(addPlugin(readPluginLockfile(), 'demo-plugin', pluginEntry))
  await snapshotUninstall({
    pluginId: 'demo-plugin',
    pluginDir,
    lockEntry: pluginEntry,
  })
}

describe('POST /api/plugins/restore', () => {
  it('returns 409 with available snapshots when the plugin already exists', async () => {
    await seedSnapshot()

    const res = await invoke({ pluginId: 'demo-plugin' })
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.ok).toBe(false)
    expect(body.code).toBe('conflict')
    expect(body.snapshots).toHaveLength(1)
    expect(body.snapshots[0].pluginId).toBe('demo-plugin')
  })

  it('lists snapshots without restoring when listOnly is true', async () => {
    await seedSnapshot()

    const res = await invoke({ pluginId: 'demo-plugin', listOnly: true })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.snapshots).toHaveLength(1)
    expect(body.restored).toBe(false)
  })
})

describe('restore as an operation (#895)', () => {
  /** A removed plugin with its snapshot on disk — what restore exists for. */
  async function seedRemoved(): Promise<void> {
    await seedSnapshot()
    rmSync(join(testDir, 'plugins', 'demo-plugin'), { recursive: true, force: true })
    writePluginLockfile(removePlugin(readPluginLockfile(), 'demo-plugin'))
  }
  async function startRestore(): Promise<string> {
    const res = await restoreRoute(request({ pluginId: 'demo-plugin' }))
    expect(res.status).toBe(202)
    return (await res.json() as { operationId: string }).operationId
  }

  it('cancelled before the first copy (waiting for install-state) it restores nothing', async () => {
    await seedRemoved()
    let release!: () => void
    let ready!: () => void
    const heldReady = new Promise<void>((resolve) => { ready = resolve })
    void holdNow(['install-state'], { title: 'Install plugin notes' }, () => new Promise<void>((resolve) => { release = resolve; ready() }))
    await heldReady

    const operationId = await startRestore()
    await waitUntil(() => getOperationRegistry().get(operationId)?.waitingFor !== undefined, { label: 'restore waiting' })
    expect(getOperationRegistry().cancel(operationId)).toBe('cancelling')
    release()
    const view = await getOperationRegistry().await(operationId)

    expect(view.status).toBe('cancelled')
    expect(existsSync(join(testDir, 'plugins', 'demo-plugin'))).toBe(false)
    expect(readPluginLockfile().plugins['demo-plugin']).toBeUndefined()
  })

  it('refuses cancel once the copy has started (a non-force restore\'s point of no return), and completes', async () => {
    await seedRemoved()
    let open!: () => void
    activationGate = new Promise<void>((resolve) => { open = resolve })

    const operationId = await startRestore()
    await waitUntil(() => getOperationRegistry().get(operationId)?.stages.find((s) => s.id === 'activate')?.status === 'active', { label: 'restore past its copy' })
    expect(getOperationRegistry().cancel(operationId)).toBe('not_cancellable')
    open()
    const view = await getOperationRegistry().await(operationId)

    expect(view.status).toBe('succeeded')
    expect(view.stages.map((s) => [s.id, s.status])).toEqual([['extract', 'done'], ['place', 'done'], ['activate', 'done']])
    expect(existsSync(join(testDir, 'plugins', 'demo-plugin', 'bakin-plugin.json'))).toBe(true)
    expect(readPluginLockfile().plugins['demo-plugin']?.version).toBe('1.2.3')
  })
})
