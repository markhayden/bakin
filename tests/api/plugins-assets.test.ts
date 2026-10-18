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
import { mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
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
import { pluginAssetVersion } from '../../packages/host/src/api/plugins/asset-version'

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

describe('plugin assets route — cache keys match the bytes served', () => {
  it('caches only the CURRENT version immutably; a stale ?v= gets the short cache', async () => {
    const current = await pluginAssetVersion('userplug', 'client.js')
    expect(current).not.toBeNull()

    const fresh = await get(...req(`/api/plugins/userplug/assets/client.js?v=${current}`))
    expect(fresh.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')

    const stale = await get(...req('/api/plugins/userplug/assets/client.js?v=1'))
    expect(stale.status).toBe(200)
    expect(stale.headers.get('Cache-Control')).toBe('public, max-age=300')
  })

  it('versions the same file it serves: a user install shadows an embedded copy in both', async () => {
    const embedded = join(testDir, 'embedded-userplug-client.js')
    writeFileSync(embedded, 'registerPlugin({ id: "userplug", embedded: true })\n')
    setEmbeddedAssets(new Map([['/api/plugins/userplug/assets/client.js', embedded]]))
    try {
      const version = await pluginAssetVersion('userplug', 'client.js')
      expect(version).toMatch(/^\d+$/) // disk mtime, not an embedded hash
      const res = await get(...req(`/api/plugins/userplug/assets/client.js?v=${version}`))
      expect(await res.text()).not.toContain('embedded: true')
      expect(res.headers.get('Cache-Control')).toContain('immutable')
    } finally {
      setEmbeddedAssets(new Map())
    }
  })

  it('a compiled-in (/$bunfs/) asset is keyed by its content hash, and a failed read is retried, not cached', async () => {
    const realBytes = join(testDir, 'bunfs-core-client.js')
    writeFileSync(realBytes, 'registerPlugin({ id: "coreplug" })\n')
    setEmbeddedAssets(new Map([['/api/plugins/coreplug/assets/client.js', '/$bunfs/root/coreplug-client.js']]))
    const originalFile = Bun.file
    try {
      let failNext = true
      Bun.file = ((path: string) => {
        const real = originalFile(path === '/$bunfs/root/coreplug-client.js' ? realBytes : path)
        return {
          exists: () => real.exists(),
          arrayBuffer: () => {
            if (failNext) { failNext = false; return Promise.reject(new Error('transient read failure')) }
            return real.arrayBuffer()
          },
        }
      }) as unknown as typeof Bun.file
      expect(await pluginAssetVersion('coreplug', 'client.js')).toBeNull()
      expect(await pluginAssetVersion('coreplug', 'client.js')).toMatch(/^embedded-[0-9a-f]{16}$/)
    } finally {
      Bun.file = originalFile
      setEmbeddedAssets(new Map())
    }
  })

  it('a source run\'s map entry is an ordinary file: a rebuild gets a new key, never a memoized one', async () => {
    const built = join(testDir, 'devplug-client.js')
    writeFileSync(built, 'registerPlugin({ id: "devplug", build: 1 })\n')
    setEmbeddedAssets(new Map([['/api/plugins/devplug/assets/client.js', built]]))
    try {
      const first = await pluginAssetVersion('devplug', 'client.js')
      expect(first).toMatch(/^\d+$/)
      writeFileSync(built, 'registerPlugin({ id: "devplug", build: 2 })\n')
      utimesSync(built, new Date(), new Date(Date.now() + 5_000))
      const second = await pluginAssetVersion('devplug', 'client.js')
      expect(second).not.toBe(first)
      const stale = await get(...req(`/api/plugins/devplug/assets/client.js?v=${first}`))
      expect(stale.headers.get('Cache-Control')).not.toContain('immutable')
    } finally {
      setEmbeddedAssets(new Map())
    }
  })
})
