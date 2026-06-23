import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
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
mock.module('@/core/plugins/live-lifecycle', () => ({
  activateUserPluginDir: async () => ({ id: 'demo-plugin', version: '1.2.3', runtimeVersion: 1 }),
  isLiveActivationUnavailable: () => false,
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => openClawDir,
  getOpenClawPath: (...parts: string[]) => join(openClawDir, ...parts),
  resetOpenClawHome: () => {},
}))

import { post as restorePOST } from '../../packages/host/src/api/plugins/restore'
import { snapshotUninstall } from '../../src/core/plugins/uninstall-snapshot'
import { addPlugin, readPluginLockfile, writePluginLockfile } from '../../packages/core/src/plugins/lockfile'

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
    entry: { server: 'index.ts' },
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
