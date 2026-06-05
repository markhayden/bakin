/**
 * Tests for the plugin assets route (packages/host/src/api/plugins/assets.ts).
 *
 * Focus: the #421 guard — server bundles (index.js) are never served over
 * HTTP, for core or user plugins, regardless of which resolution step
 * (user disk, embedded map, repo-cwd fallback) could supply them. Server
 * activation never goes through HTTP: core plugins are statically imported,
 * user plugins are imported from disk.
 */
import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

const testDir = join(tmpdir(), `bakin-test-plugins-assets-${Date.now()}-${randomUUID()}`)

mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({
    info: () => {}, warn: () => {}, error: () => {}, debug: () => {},
  }),
}))

import { get } from '../../packages/host/src/api/plugins/assets'
import { setEmbeddedAssets } from '../../packages/host/src/api/_embedded-assets'

function req(path: string): [Request, URL] {
  const url = new URL(`http://localhost:3737${path}`)
  return [new Request(url), url]
}

beforeAll(() => {
  // A user plugin with BOTH a server bundle and a client bundle on disk.
  const dist = join(testDir, 'plugins', 'userplug', 'dist')
  mkdirSync(dist, { recursive: true })
  writeFileSync(join(dist, 'index.js'), 'export default { id: "userplug" }\n')
  writeFileSync(join(dist, 'client.js'), 'registerPlugin({ id: "userplug" })\n')
  writeFileSync(join(dist, 'client.css'), '.userplug{}\n')
})

afterAll(() => {
  setEmbeddedAssets(new Map())
  rmSync(testDir, { recursive: true, force: true })
})

describe('plugin assets route — server-bundle guard (#421)', () => {
  it('404s index.js even when the user plugin file exists on disk', async () => {
    const res = await get(...req('/api/plugins/userplug/assets/index.js'))
    expect(res.status).toBe(404)
    const body = await res.json() as { error: string }
    expect(body.error).toContain('server bundle')
  })

  it('404s index.js even when an embedded-map entry exists for it', async () => {
    // Simulate a stale embed map that still carries a server bundle.
    const onDisk = join(testDir, 'plugins', 'userplug', 'dist', 'index.js')
    setEmbeddedAssets(new Map([['/api/plugins/coreish/assets/index.js', onDisk]]))
    try {
      const res = await get(...req('/api/plugins/coreish/assets/index.js'))
      expect(res.status).toBe(404)
    } finally {
      setEmbeddedAssets(new Map())
    }
  })

  it('404s nested index.js paths', async () => {
    const nestedDir = join(testDir, 'plugins', 'userplug', 'dist', 'chunks')
    mkdirSync(nestedDir, { recursive: true })
    writeFileSync(join(nestedDir, 'index.js'), '// nested server-ish bundle\n')

    const res = await get(...req('/api/plugins/userplug/assets/chunks/index.js'))
    expect(res.status).toBe(404)
  })

  it('still serves client.js from disk (control)', async () => {
    const res = await get(...req('/api/plugins/userplug/assets/client.js'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('javascript')
    expect(await res.text()).toContain('registerPlugin')
  })

  it('still serves client.css from disk (control)', async () => {
    const res = await get(...req('/api/plugins/userplug/assets/client.css'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/css')
  })

  it('still rejects malformed plugin asset paths with 400', async () => {
    const res = await get(...req('/api/plugins/userplug/assets/'))
    expect(res.status).toBe(400)
  })
})
