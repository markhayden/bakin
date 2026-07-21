/**
 * Tests for /api/plugins/install and /api/plugins/remove.
 *
 * Verifies the local-install path end-to-end: writing a fake plugin
 * source to a temp dir, posting to /install with type=local, then
 * confirming the plugin landed at ~/.bakin/plugins/<id>/ and is
 * removable via /remove. GitHub cloning is not exercised (network).
 *
 * Post-migration (#147 Phase B): the handlers live at
 * packages/host/src/api/plugins/{install,remove}.ts and export `post`
 * as `(req, url) => Response`. Tests invoke them directly with a synthetic
 * `URL` derived from the Request.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, writeFileSync, existsSync, rmSync, realpathSync } from 'fs'
import { join } from 'path'

const testDir = (() => {
  const { join } = require('path')
  const { tmpdir } = require('os')
  return join(tmpdir(), `bakin-test-plugin-install-${Date.now()}`)
})()

// ES imports are hoisted above mock.module — set env so the content-dir
// guard doesn't trip when plugin modules call getContentDir at init.
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = testDir + '-openclaw'

mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))
mock.module('@/core/plugins/live-lifecycle', () => ({
  activateUserPluginDir: async () => ({ id: 'hello', version: '1.0.0', runtimeVersion: 1 }),
  isLiveActivationUnavailable: () => false,
  watchLinkedPluginIfEnabled: async () => false,
  notifyPluginRemoved: () => {},
}))

import { post as installPOST } from '../../packages/host/src/api/plugins/install'
import { post as removePOST } from '../../packages/host/src/api/plugins/remove'
import { resetSettingsCache } from '../../src/core/settings'

// Source plugin lives INSIDE the mocked content dir so it's contained by
// the install handler's path-traversal guard (C12 hardening). The original
// `join(testDir, '..', 'source-plugin')` placement was outside any trusted
// root (~/.bakin/ ↔ testDir / $HOME / cwd) — exactly the case the guard
// rejects.
const sourcePluginDir = join(testDir, 'source-plugin')
const settingsFile = join(testDir, 'settings.json')

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/plugins/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// Helper: invoke a migrated handler with the URL derived from the Request.
async function invoke(
  handler: (req: Request, url: URL) => Promise<Response>,
  req: Request,
): Promise<Response> {
  return handler(req, new URL(req.url))
}

function writeSourceManifest(manifest: Record<string, unknown> = {}) {
  writeFileSync(
    join(sourcePluginDir, 'bakin-plugin.json'),
    JSON.stringify({
      id: 'hello',
      name: 'Hello',
      version: '1.0.0',
      bakin: '*',
      description: 'Test plugin',
            permissions: [],
      ...manifest,
    }, null, 2),
  )
}

function writeSettings(settings: Record<string, unknown>) {
  writeFileSync(settingsFile, JSON.stringify(settings, null, 2))
  resetSettingsCache()
}

beforeAll(() => {
  mkdirSync(testDir, { recursive: true })
  mkdirSync(sourcePluginDir, { recursive: true })
  writeSourceManifest()
  writeFileSync(join(sourcePluginDir, 'index.ts'), '// stub\n')
})

afterAll(() => {
  rmSync(sourcePluginDir, { recursive: true, force: true })
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  const installed = join(testDir, 'plugins', 'hello')
  if (existsSync(installed)) rmSync(installed, { recursive: true, force: true })
  rmSync(join(testDir, 'plugins', 'lock.json'), { force: true })
  rmSync(settingsFile, { force: true })
  writeSourceManifest()
  resetSettingsCache()
})

describe('POST /api/plugins/install', () => {
  it('rejects invalid JSON bodies with 400', async () => {
    const req = new Request('http://localhost/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json{',
    })
    const res = await invoke(installPOST, req)
    expect(res.status).toBe(400)
  })

  it('rejects missing source with 400', async () => {
    const res = await invoke(installPOST, makeRequest({ type: 'local' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/Missing source/)
  })

  it('rejects invalid type with 400', async () => {
    const res = await invoke(installPOST, makeRequest({ source: '/tmp', type: 'ftp' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/Invalid type/)
  })

  it('rejects missing source path with 400', async () => {
    const res = await invoke(installPOST, makeRequest({
      source: '/nonexistent/path/xyz',
      type: 'local',
    }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/does not exist/)
  })

  it('rejects source missing bakin-plugin.json with 400', async () => {
    // Inside content dir to clear the C12 path-traversal containment guard.
    const bad = join(testDir, 'bad-plugin-source')
    mkdirSync(bad, { recursive: true })
    try {
      const res = await invoke(installPOST, makeRequest({ source: bad, type: 'local' }))
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/missing bakin-plugin.json/i)
    } finally {
      rmSync(bad, { recursive: true, force: true })
    }
  })

  it('installs a valid local plugin and returns the id', async () => {
    const res = await invoke(installPOST, makeRequest({ source: sourcePluginDir, type: 'local' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.id).toBe('hello')
    expect(body.message).toMatch(/activated/)
    expect(existsSync(join(testDir, 'plugins', 'hello', 'bakin-plugin.json'))).toBe(true)
  })

  it('rejects unsigned plugins when signatures are required', async () => {
    writeSettings({
      plugins: {
        requireSignatures: true,
        trustedSigners: [],
      },
    })

    const res = await invoke(installPOST, makeRequest({ source: sourcePluginDir, type: 'local' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/signed plugin manifest/)
    expect(existsSync(join(testDir, 'plugins', 'hello'))).toBe(false)
  })

  it('rejects dev installs from github sources', async () => {
    const res = await invoke(installPOST, makeRequest({
      source: 'github:markhayden/bakin-bits-official#plugins/messaging',
      type: 'github',
      dev: true,
    }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/dev installs only support local/i)
  })

  it('dev-installs a local plugin through the link flow', async () => {
    const res = await invoke(installPOST, makeRequest({
      source: sourcePluginDir,
      type: 'local',
      dev: true,
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.id).toBe('hello')
    expect(body.activated).toBe(true)
    expect(body.linkedSource).toBe(realpathSync(sourcePluginDir))
    expect(body.message).toMatch(/Dev-installed/)
  })

  it('rejects unsigned dev installs when signatures are required', async () => {
    writeSettings({
      plugins: {
        requireSignatures: true,
        trustedSigners: [],
      },
    })

    const res = await invoke(installPOST, makeRequest({
      source: sourcePluginDir,
      type: 'local',
      dev: true,
    }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/signed plugin manifest/)
  })

  it('overwrites an existing install cleanly', async () => {
    await invoke(installPOST, makeRequest({ source: sourcePluginDir, type: 'local' }))
    const res = await invoke(installPOST, makeRequest({ source: sourcePluginDir, type: 'local' }))
    expect(res.status).toBe(200)
  })
})

describe('POST /api/plugins/remove', () => {
  function removeReq(body: unknown) {
    return new Request('http://localhost/api/plugins/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  it('rejects missing pluginId with 400', async () => {
    const res = await invoke(removePOST, removeReq({}))
    expect(res.status).toBe(400)
  })

  it('rejects invalid pluginId with 400', async () => {
    const res = await invoke(removePOST, removeReq({ pluginId: '../../etc/passwd' }))
    expect(res.status).toBe(400)
  })

  it('returns 404 for plugins that are not installed', async () => {
    const res = await invoke(removePOST, removeReq({ pluginId: 'never-installed' }))
    expect(res.status).toBe(404)
  })

  it('removes an installed plugin', async () => {
    await invoke(installPOST, makeRequest({ source: sourcePluginDir, type: 'local' }))
    const installed = join(testDir, 'plugins', 'hello')
    expect(existsSync(installed)).toBe(true)

    const res = await invoke(removePOST, removeReq({ pluginId: 'hello' }))
    expect(res.status).toBe(200)
    expect(existsSync(installed)).toBe(false)
  })
})
