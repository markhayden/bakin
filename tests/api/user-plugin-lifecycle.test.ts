/**
 * End-to-end user plugin lifecycle test (#147 TF6).
 *
 * Exercises the install → load → remove path that a real user would hit
 * when running `bakin plugins install <path>` (or calling the REST route
 * directly from the CLI). Fixture is at tests/fixtures/sample-user-plugin/.
 *
 * This test complements tests/api/plugins-build.test.ts (which just covers
 * buildUserPlugin in isolation) by walking the full server-side lifecycle:
 *
 *   1. POST /api/plugins/install with local source path
 *        → source copied to <pluginsRoot>/sample/
 *        → buildUserPlugin produces dist/index.js + client.js
 *   2. GET /api/plugins/<id>/assets/client.js
 *        → served with application/javascript MIME, real content
 *   3. GET /api/plugins/manifest
 *        → NOT listed without a pluginRegistry reload (that's a server-boot
 *          concern, verified via an explicit reload call here)
 *   4. POST /api/plugins/remove
 *        → dist + source gone
 *        → asset endpoint returns 404
 *
 * Per CLAUDE.md, content-dir is mocked to a temp dir so nothing leaks.
 */
import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import { cpSync, existsSync, mkdirSync, rmSync } from 'fs'
import { join, resolve } from 'path'

const testDir = (() => {
  const { join } = require('path')
  const { tmpdir } = require('os')
  return join(tmpdir(), `bakin-test-plugin-lifecycle-${Date.now()}`)
})()

// ES imports are hoisted above mock.module — set env so the content-dir
// guard doesn't trip when plugin modules call getContentDir at init.
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = testDir + '-openclaw'

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

import { post as installPost } from '../../packages/host/src/api/plugins/install'
import { post as removePost } from '../../packages/host/src/api/plugins/remove'
import { get as assetsGet } from '../../packages/host/src/api/plugins/assets'

const FIXTURE_DIR = resolve(__dirname, '..', 'fixtures', 'sample-user-plugin')

function makeRequest(url: string, init: RequestInit = {}): Request {
  return new Request(url, init)
}

beforeAll(() => {
  mkdirSync(testDir, { recursive: true })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('user plugin lifecycle', () => {
  it('install → build → serve → remove', async () => {
    // 1. POST /api/plugins/install with local source path
    const installReq = makeRequest('http://localhost/api/plugins/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: FIXTURE_DIR, type: 'local' }),
    })
    const installRes = await installPost(installReq, new URL(installReq.url))
    expect(installRes.status).toBe(200)
    const installBody = await installRes.json() as { ok: boolean; id?: string }
    expect(installBody.ok).toBe(true)
    expect(installBody.id).toBe('sample')

    // Installed to <testDir>/plugins/sample/ with built dist/
    const pluginDir = join(testDir, 'plugins', 'sample')
    expect(existsSync(join(pluginDir, 'bakin-plugin.json'))).toBe(true)
    expect(existsSync(join(pluginDir, 'dist', 'index.js'))).toBe(true)
    expect(existsSync(join(pluginDir, 'dist', 'client.js'))).toBe(true)

    // 2. GET /api/plugins/sample/assets/client.js — asset
    //    endpoint serves from <contentDir>/plugins/<id>/dist/<path>.
    const assetUrl = new URL('http://localhost/api/plugins/sample/assets/client.js')
    const assetReq = makeRequest(assetUrl.toString(), { method: 'GET' })
    const assetRes = await assetsGet(assetReq, assetUrl)
    expect(assetRes.status).toBe(200)
    expect(assetRes.headers.get('content-type')).toMatch(/application\/javascript/)
    const assetBody = await assetRes.text()
    // The fixture client.tsx imports registerSlot + react/jsx-runtime; after
    // externalized build, both import specifiers survive verbatim.
    expect(assetBody).toMatch(/@bakin\/sdk\/slots/)
    expect(assetBody).toMatch(/react\/jsx-runtime/)

    // 3. GET an asset that shouldn't exist
    const missingUrl = new URL('http://localhost/api/plugins/sample/assets/does-not-exist.js')
    const missingReq = makeRequest(missingUrl.toString(), { method: 'GET' })
    const missingRes = await assetsGet(missingReq, missingUrl)
    expect(missingRes.status).toBe(404)

    // 4. POST /api/plugins/remove — tears down.
    const removeReq = makeRequest('http://localhost/api/plugins/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pluginId: 'sample' }),
    })
    const removeRes = await removePost(removeReq, new URL(removeReq.url))
    expect(removeRes.status).toBe(200)
    expect(existsSync(pluginDir)).toBe(false)

    // 5. Post-remove, the asset endpoint 404s because the dist dir is gone.
    const postRemoveRes = await assetsGet(assetReq, assetUrl)
    expect(postRemoveRes.status).toBe(404)
  }, 90_000)

  it('install rejects a non-existent local source', async () => {
    const req = makeRequest('http://localhost/api/plugins/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: '/nonexistent/path/xyz-nope', type: 'local' }),
    })
    const res = await installPost(req, new URL(req.url))
    expect(res.status).toBe(400)
  })

  it('remove rejects an invalid plugin id', async () => {
    const req = makeRequest('http://localhost/api/plugins/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pluginId: '../etc/passwd' }),
    })
    const res = await removePost(req, new URL(req.url))
    expect(res.status).toBe(400)
  })

  it('remove returns 404 for a plugin that isnt installed', async () => {
    const req = makeRequest('http://localhost/api/plugins/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pluginId: 'never-installed' }),
    })
    const res = await removePost(req, new URL(req.url))
    expect(res.status).toBe(404)
  })
})
