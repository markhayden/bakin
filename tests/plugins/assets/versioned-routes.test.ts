/**
 * B8: HTTP routes for the versioned model (list / get / promote / delete-version
 * / export / delete-asset).
 */
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdirSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const testDir = join(tmpdir(), `bakin-versioned-routes-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')

import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import sharp from 'sharp'
import { createAsset, addVersion, getAsset } from '../../../plugins/assets/lib/asset-service'
import {
  handleVersionedList, handleVersionedGet, handleVersionedPromote,
  handleVersionedDeleteVersion, handleVersionedDeleteAsset, handleVersionedExport,
} from '../../../plugins/assets/routes/versioned'

const base = 'http://localhost/api/plugins/assets/versioned'
const get = (path = '') => new Request(`${base}${path}`)
const send = (path: string, method: string, body?: unknown) =>
  new Request(`${base}${path}`, { method, body: body ? JSON.stringify(body) : undefined, headers: body ? { 'Content-Type': 'application/json' } : undefined })

const srcDir = join(testDir, 'src')
let assetId = ''

beforeAll(async () => {
  mkdirSync(srcDir, { recursive: true })
  await sharp({ create: { width: 6, height: 6, channels: 3, background: { r: 1, g: 1, b: 1 } } }).png().toFile(join(srcDir, 'a.png'))
  await sharp({ create: { width: 6, height: 6, channels: 3, background: { r: 2, g: 2, b: 2 } } }).png().toFile(join(srcDir, 'b.png'))
  const created = await createAsset({ sourceFilePath: join(srcDir, 'a.png'), type: 'images', agent: 'pixel', taskId: 't1', slug: 'cake', op: 'generate', description: 'v1' })
  assetId = created.assetId
  await addVersion(assetId, { sourceFilePath: join(srcDir, 'b.png'), op: 'edit', description: 'v2' }) // current = v2
})

afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('versioned routes', () => {
  it('lists versioned assets', async () => {
    const body = await (await handleVersionedList(get())).json()
    expect(body.assets.some((a: { assetId: string }) => a.assetId === assetId)).toBe(true)
    const summary = body.assets.find((a: { assetId: string }) => a.assetId === assetId)
    expect(summary.versionCount).toBe(2)
    expect(summary.currentVersion).toBe(2)
  })

  it('gets a manifest, 404s unknown', async () => {
    const ok = await handleVersionedGet(get(`/${assetId}`))
    expect((await ok.json()).asset.assetId).toBe(assetId)
    const miss = await handleVersionedGet(get('/20260529-ghost-deadbeef'))
    expect(miss.status).toBe(404)
  })

  it('promotes a version', async () => {
    const res = await handleVersionedPromote(send(`/${assetId}/promote`, 'POST', { version: 1 }))
    expect((await res.json()).asset.currentVersion).toBe(1)
    expect(getAsset(assetId)!.currentVersion).toBe(1)
    await handleVersionedPromote(send(`/${assetId}/promote`, 'POST', { version: 2 })) // restore
  })

  it('attaches an export', async () => {
    const res = await handleVersionedExport(send(`/${assetId}/export`, 'POST', { surface: 'open-graph', format: 'jpg', width: 120, height: 63 }))
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.name).toBe('open-graph')
    expect(getAsset(assetId)!.exports).toHaveLength(1)
  })

  it('deletes a version (auto-fallback)', async () => {
    const res = await handleVersionedDeleteVersion(send(`/${assetId}/v/2`, 'DELETE'))
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.asset.versions.map((v: { version: number }) => v.version)).toEqual([1])
    expect(body.asset.currentVersion).toBe(1)
  })

  it('trashes the whole asset', async () => {
    const res = await handleVersionedDeleteAsset(send(`/${assetId}`, 'DELETE'))
    expect((await res.json()).ok).toBe(true)
    expect(getAsset(assetId)).toBeNull()
  })
})
