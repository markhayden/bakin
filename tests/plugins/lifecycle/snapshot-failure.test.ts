/**
 * Snapshot-failure surface coverage (commit C18 / review I2 fix verification).
 *
 * The original remove flow swallowed snapshot failures (logged + audited
 * + continued) and returned `{ ok: true, snapshot: null }`. CLI just
 * printed "Removed plugin <id>" — the user had no way to know their
 * safety-net tarball never got written.
 *
 * C15 changed the response to include the snapshot path explicitly and
 * the CLI to print a WARNING + exit non-zero when null. This test pins
 * the API behavior: a remove that succeeds but produces no snapshot
 * still returns `snapshot: null` so the CLI can react.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, mock } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { installFilesystemRuntimeAppServices } from '../../helpers/runtime-app-services'

const testDir = join(tmpdir(), `bakin-test-snapshot-fail-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
const openClawDir = join(testDir, 'openclaw')
process.env.OPENCLAW_HOME = openClawDir

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => openClawDir,
  getOpenClawPath: (...parts: string[]) => join(openClawDir, ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))
// Force snapshot to throw to prove the remove flow surfaces snapshot:null.
mock.module('../../../src/core/plugins/uninstall-snapshot', () => ({
  snapshotUninstall: async () => {
    throw new Error('simulated tarball failure (test fixture)')
  },
}))
mock.module('../../../src/lib/plugin-registry', () => ({
  isCorePlugin: () => false,
  pluginRegistry: {
    getPlugin: () => undefined,
    getPluginContext: () => undefined,
    deletePlugin: () => false,
    deactivatePlugin: async () => ({ hooks: 0, execTools: 0, contentTypes: 0, skills: 0 }),
  },
  getHookRegistry: () => ({ unregisterByPlugin: () => 0 }),
}))
mock.module('@bakin/core/hooks/hook-registry-singleton', () => ({
  getHookRegistry: () => ({ unregisterByPlugin: () => 0 }),
}))

import { post as removePOST } from '../../../packages/host/src/api/plugins/remove'
import { addPlugin, readPluginLockfile, writePluginLockfile, type PluginLockEntry } from '../../../packages/core/src/plugins/lockfile'

beforeAll(() => {
  mkdirSync(testDir, { recursive: true })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  // Fresh state — wipe lockfile + plugin dir.
  rmSync(join(testDir, 'plugins'), { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  mkdirSync(openClawDir, { recursive: true })
  installFilesystemRuntimeAppServices({ openClawDir })
})

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/plugins/remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function seed(pluginId: string): void {
  const pluginDir = join(testDir, 'plugins', pluginId)
  mkdirSync(pluginDir, { recursive: true })
  writeFileSync(join(pluginDir, 'bakin-plugin.json'),
    JSON.stringify({ id: pluginId, name: pluginId, version: '1.0.0' }),
    'utf-8')
  writePluginLockfile(addPlugin(readPluginLockfile(), pluginId, {
    source: pluginDir,
    type: 'local',
    ref: '',
    commitSha: '',
    installedAt: '2026-04-25T00:00:00Z',
    version: '1.0.0',
    permissions: [],
    manifestSha: 'fixture-sha',
  } as PluginLockEntry))
}

describe('remove flow when snapshot fails', () => {
  it('still completes the remove but reports snapshot:null', async () => {
    seed('snap-fail')
    const res = await removePOST(makeRequest({ pluginId: 'snap-fail' }), new URL('http://localhost/api/plugins/remove'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.snapshot).toBeNull()
    // Plugin dir still got removed (snapshot is best-effort).
    expect(existsSync(join(testDir, 'plugins', 'snap-fail'))).toBe(false)
    // Lockfile entry is gone.
    expect(readPluginLockfile().plugins['snap-fail']).toBeUndefined()
  })
})
