/**
 * Coverage for POST /api/plugins/link and POST /api/plugins/unlink
 * (Phase 2 P2.C3). The endpoints are thin HTTP adapters over
 * src/core/plugins/link.ts (covered separately in
 * tests/plugins/lifecycle/link.test.ts) — these tests only assert the
 * HTTP-shape concerns: body parsing, error mapping, response shape.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, mock } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, lstatSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-plugins-link-api-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('@/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))
// Holds the initial build (past the point of no return) when set.
let buildGate: Promise<void> | null = null
mock.module('../../packages/host/src/plugin-host/user-plugin-builder', () => ({
  buildUserPlugin: async () => { if (buildGate) await buildGate },
}))
mock.module('@/core/plugin-registry', () => ({
  isCorePlugin: () => false,
}))
mock.module('@/core/plugins/live-lifecycle', () => ({
  activateUserPluginDir: async (pluginDir: string) => ({ id: pluginDir.split('/').pop() ?? 'plugin', version: '0.1.0', runtimeVersion: 1 }),
  watchLinkedPluginIfEnabled: async () => false,
  unwatchPluginIfEnabled: async () => false,
  notifyPluginRemoved: () => {},
}))

import { linkPOST } from '../helpers/plugin-routes'
import { post as unlinkPOST } from '../../packages/host/src/api/plugins/unlink'
import { post as linkRoute } from '../../packages/host/src/api/plugins/link'
import { holdNow } from '../../packages/core/src/operations'
import { readPluginLockfile } from '../../packages/core/src/plugins/lockfile'
import { _resetOperationRegistryForTests, getOperationRegistry } from '../../src/core/operations'
import { waitUntil } from '../helpers/wait'

const sourceDir = join(testDir, 'dev-src')

function makeReq(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

async function callLink(body: unknown) {
  return linkPOST(makeReq('/api/plugins/link', body), new URL('http://localhost/api/plugins/link'))
}
async function callUnlink(body: unknown) {
  return unlinkPOST(makeReq('/api/plugins/unlink', body))
}

beforeAll(() => mkdirSync(testDir, { recursive: true }))
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

beforeEach(() => {
  _resetOperationRegistryForTests()
  buildGate = null
  rmSync(sourceDir, { recursive: true, force: true })
  rmSync(join(testDir, 'plugins'), { recursive: true, force: true })
})

function writeManifest(dir: string, body: Record<string, unknown>): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'bakin-plugin.json'), JSON.stringify(body, null, 2), 'utf-8')
  writeFileSync(join(dir, 'index.ts'), `export default { id: '${body.id}', activate() {} }`, 'utf-8')
}

describe('POST /api/plugins/link — body validation', () => {
  it('rejects malformed JSON with 400', async () => {
    const res = await callLink('not-json{')
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Invalid JSON/)
  })

  it('rejects missing localPath with 400', async () => {
    const res = await callLink({})
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Missing localPath/)
  })

  it('rejects non-boolean force with 400', async () => {
    const res = await callLink({ localPath: '/tmp', force: 'yes' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/force must be a boolean/)
  })
})

describe('POST /api/plugins/link — happy path', () => {
  it('returns 200 with id + linkedSource and creates the symlink', async () => {
    writeManifest(sourceDir, { id: 'apilinked', name: 'AL', version: '0.1.0', permissions: [] })
    const res = await callLink({ localPath: sourceDir })
    const body = await res.json()
    if (res.status !== 200) throw new Error(`link failed: ${body.error}`)
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.id).toBe('apilinked')
    expect(body.message).toMatch(/activated/)

    const symlink = join(testDir, 'plugins', 'apilinked')
    expect(lstatSync(symlink).isSymbolicLink()).toBe(true)
  })
})

describe('POST /api/plugins/link — refusal mapping', () => {
  it('maps LinkRefusedError to 400 with the original message', async () => {
    const res = await callLink({ localPath: join(testDir, 'no-such-dir') })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/does not exist/)
  })
})

describe('POST /api/plugins/unlink', () => {
  it('keeps persistent plugins linked until the removal preflight can run', async () => {
    writeManifest(sourceDir, { id: 'persistent', name: 'Persistent', version: '0.1.0', permissions: [], uninstallPreflightRequired: true })
    await callLink({ localPath: sourceDir })
    const res = await callUnlink({ pluginId: 'persistent' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('preflight')
    expect(existsSync(join(testDir, 'plugins', 'persistent'))).toBe(true)
  })
  it('removes the symlink and the lockfile entry', async () => {
    writeManifest(sourceDir, { id: 'apiunlinked', name: 'AU', version: '0.1.0', permissions: [] })
    await callLink({ localPath: sourceDir })

    const res = await callUnlink({ pluginId: 'apiunlinked' })
    const errorBody = await res.clone().json()
    if (res.status !== 200) throw new Error(`unlink failed: ${errorBody.error}`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.id).toBe('apiunlinked')

    const symlink = join(testDir, 'plugins', 'apiunlinked')
    expect(existsSync(symlink)).toBe(false)
  })

  it('rejects missing pluginId with 400', async () => {
    const res = await callUnlink({})
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Missing pluginId/)
  })

  it('returns 400 for an unknown pluginId', async () => {
    const res = await callUnlink({ pluginId: 'nope' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/not in the lockfile/i)
  })
})

describe('link and unlink over install-state (#895)', () => {
  /** Hold install-state as another operation would, until `release()`. */
  async function holdInstallState(title: string): Promise<() => void> {
    let release!: () => void
    let ready!: () => void
    const heldReady = new Promise<void>((resolve) => { ready = resolve })
    void holdNow(['install-state'], { title }, () => new Promise<void>((resolve) => { release = resolve; ready() }))
    await heldReady
    return release
  }
  async function startLink(body: Record<string, unknown>): Promise<string> {
    const res = await linkRoute(makeReq('/api/plugins/link', body))
    expect(res.status).toBe(202)
    return (await res.json() as { operationId: string }).operationId
  }

  it("--force cancelled before its point of no return leaves the prior link intact (the force boundary)", async () => {
    writeManifest(sourceDir, { id: 'forced', name: 'Forced', version: '0.1.0', permissions: [] })
    expect((await callLink({ localPath: sourceDir })).status).toBe(200)
    const release = await holdInstallState('Install plugin notes')

    const operationId = await startLink({ localPath: sourceDir, force: true })
    await waitUntil(() => getOperationRegistry().get(operationId)?.waitingFor !== undefined, { label: 'link waiting' })
    expect(getOperationRegistry().cancel(operationId)).toBe('cancelling')
    release()
    const view = await getOperationRegistry().await(operationId)

    expect(view.status).toBe('cancelled')
    expect(lstatSync(join(testDir, 'plugins', 'forced')).isSymbolicLink()).toBe(true)
    expect(readPluginLockfile().plugins.forced).toBeDefined()
  })

  it('refuses cancel once the initial build has started, and completes', async () => {
    writeManifest(sourceDir, { id: 'building', name: 'Building', version: '0.1.0', permissions: [] })
    let open!: () => void
    buildGate = new Promise<void>((resolve) => { open = resolve })

    const operationId = await startLink({ localPath: sourceDir })
    await waitUntil(() => getOperationRegistry().get(operationId)?.stages.find((s) => s.id === 'link')?.status === 'active', { label: 'link building' })
    expect(getOperationRegistry().cancel(operationId)).toBe('not_cancellable')
    open()
    const view = await getOperationRegistry().await(operationId)

    expect(view.status).toBe('succeeded')
    expect(view.resources).toEqual(['install-state'])
    expect(lstatSync(join(testDir, 'plugins', 'building')).isSymbolicLink()).toBe(true)
  })

  it('unlink never waits: busy → 409 install_busy naming the holder, still linked', async () => {
    writeManifest(sourceDir, { id: 'stillhere', name: 'Still', version: '0.1.0', permissions: [] })
    expect((await callLink({ localPath: sourceDir })).status).toBe(200)
    const release = await holdInstallState('Sync team media')

    const res = await callUnlink({ pluginId: 'stillhere' })
    release()

    expect(res.status).toBe(409)
    const body = await res.json() as { error: string; holder: { title: string } }
    expect(body.error).toBe('install_busy')
    expect(body.holder.title).toBe('Sync team media')
    expect(lstatSync(join(testDir, 'plugins', 'stillhere')).isSymbolicLink()).toBe(true)
    expect(readPluginLockfile().plugins.stillhere).toBeDefined()
  })
})
