/**
 * B2: the host /api/assets/... serving route — assetId scheme via the
 * assets.resolveServe hook, with ETag/If-None-Match and 404/400 handling.
 */
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const testDir = join(tmpdir(), `bakin-serve-route-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')

import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import sharp from 'sharp'
import { mkdirSync, writeFileSync } from 'node:fs'
import { getHookRegistry } from '../../src/lib/plugin-registry'
import { resolveAssetServe } from '../../plugins/assets/lib/serve'
import { createAsset } from '../../plugins/assets/lib/asset-service'
import { get } from '../../packages/host/src/api/assets/[...path]'

const reqFor = (path: string, headers?: Record<string, string>) => {
  const u = `http://localhost/api/assets/${path}`
  return { req: new Request(u, { headers }), url: new URL(u) }
}

let assetId = ''

beforeAll(async () => {
  getHookRegistry().register('assets.resolveServe', (d: { segments: string[] }) => resolveAssetServe(d.segments))
  const src = join(testDir, 'src')
  mkdirSync(src, { recursive: true })
  await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 9, g: 9, b: 9 } } }).png().toFile(join(src, 'p.png'))
  const created = await createAsset({ sourceFilePath: join(src, 'p.png'), type: 'images', agent: 'pixel', taskId: 't', slug: 'p', op: 'generate' })
  assetId = created.assetId
})

afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('GET /api/assets/<assetId>', () => {
  it('serves the current version with an ETag', async () => {
    const { req, url } = reqFor(assetId)
    const res = await get(req, url)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('etag')).toBe(`"${assetId}:v1"`)
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0)
  })

  it('returns 304 when If-None-Match matches', async () => {
    const { req, url } = reqFor(assetId, { 'if-none-match': `"${assetId}:v1"` })
    const res = await get(req, url)
    expect(res.status).toBe(304)
  })

  it('404s an unknown asset', async () => {
    const { req, url } = reqFor('20260529-ghost-deadbeef')
    expect((await get(req, url)).status).toBe(404)
  })

  it('400s a path-traversal attempt', async () => {
    const { req, url } = reqFor('..%2f..%2fetc')
    expect((await get(req, url)).status).toBe(400)
  })
})
