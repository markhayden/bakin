/**
 * Tests for /api/plugins/install and /api/plugins/remove.
 *
 * Verifies the local-install path end-to-end: writing a fake plugin
 * source to a temp dir, posting to /install with type=local, then
 * confirming the plugin landed at ~/.bakin/plugins/<id>/ and is
 * removable via /remove. GitHub cloning is not exercised (network).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = vi.hoisted(() => {
  const { join } = require('path')
  const { tmpdir } = require('os')
  return join(tmpdir(), `bakin-test-plugin-install-${Date.now()}`)
})

vi.mock('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
vi.mock('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
vi.mock('../../src/core/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

import { POST as installPOST } from '../../src/app/api/plugins/install/route'
import { POST as removePOST } from '../../src/app/api/plugins/remove/route'

const sourcePluginDir = join(testDir, '..', 'source-plugin')

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/plugins/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeAll(() => {
  mkdirSync(sourcePluginDir, { recursive: true })
  writeFileSync(
    join(sourcePluginDir, 'bakin-plugin.json'),
    JSON.stringify({ id: 'hello', name: 'Hello', version: '1.0.0' }, null, 2),
  )
  writeFileSync(join(sourcePluginDir, 'index.ts'), '// stub\n')
})

afterAll(() => {
  rmSync(sourcePluginDir, { recursive: true, force: true })
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  const installed = join(testDir, 'plugins', 'hello')
  if (existsSync(installed)) rmSync(installed, { recursive: true, force: true })
})

describe('POST /api/plugins/install', () => {
  it('rejects invalid JSON bodies with 400', async () => {
    const req = new Request('http://localhost/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json{',
    })
    const res = await installPOST(req as any)
    expect(res.status).toBe(400)
  })

  it('rejects missing source with 400', async () => {
    const res = await installPOST(makeRequest({ type: 'local' }) as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/Missing source/)
  })

  it('rejects invalid type with 400', async () => {
    const res = await installPOST(makeRequest({ source: '/tmp', type: 'ftp' }) as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/Invalid type/)
  })

  it('rejects missing source path with 400', async () => {
    const res = await installPOST(makeRequest({
      source: '/nonexistent/path/xyz',
      type: 'local',
    }) as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/does not exist/)
  })

  it('rejects source missing bakin-plugin.json with 400', async () => {
    const bad = join(testDir, '..', 'bad-plugin-source')
    mkdirSync(bad, { recursive: true })
    try {
      const res = await installPOST(makeRequest({ source: bad, type: 'local' }) as any)
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/missing bakin-plugin.json/i)
    } finally {
      rmSync(bad, { recursive: true, force: true })
    }
  })

  it('installs a valid local plugin and returns the id', async () => {
    const res = await installPOST(makeRequest({ source: sourcePluginDir, type: 'local' }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.id).toBe('hello')
    expect(body.message).toMatch(/Restart Bakin/)
    expect(existsSync(join(testDir, 'plugins', 'hello', 'bakin-plugin.json'))).toBe(true)
  })

  it('overwrites an existing install cleanly', async () => {
    await installPOST(makeRequest({ source: sourcePluginDir, type: 'local' }) as any)
    const res = await installPOST(makeRequest({ source: sourcePluginDir, type: 'local' }) as any)
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
    const res = await removePOST(removeReq({}) as any)
    expect(res.status).toBe(400)
  })

  it('rejects invalid pluginId with 400', async () => {
    const res = await removePOST(removeReq({ pluginId: '../../etc/passwd' }) as any)
    expect(res.status).toBe(400)
  })

  it('returns 404 for plugins that are not installed', async () => {
    const res = await removePOST(removeReq({ pluginId: 'never-installed' }) as any)
    expect(res.status).toBe(404)
  })

  it('removes an installed plugin', async () => {
    await installPOST(makeRequest({ source: sourcePluginDir, type: 'local' }) as any)
    const installed = join(testDir, 'plugins', 'hello')
    expect(existsSync(installed)).toBe(true)

    const res = await removePOST(removeReq({ pluginId: 'hello' }) as any)
    expect(res.status).toBe(200)
    expect(existsSync(installed)).toBe(false)
  })
})
