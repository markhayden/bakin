/**
 * B8: HTTP routes for the versioned model (list / get / promote / delete-version
 * / export / delete-asset).
 */
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
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
  handleVersionedAddVersion, handleTrashList, handleTrashRestore,
  handleTrashPermanentDelete, handleTrashEmpty,
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

describe('add-version + trash routes', () => {
  const trashBase = 'http://localhost/api/plugins/assets/trash'
  let id = ''

  beforeAll(async () => {
    const created = await createAsset({ sourceFilePath: join(srcDir, 'a.png'), type: 'images', agent: 'pixel', taskId: null, slug: 'tr', op: 'upload', description: 'trash subject' })
    id = created.assetId
  })

  it('appends a version from an uploaded file', async () => {
    const form = new FormData()
    form.append('file', new File([readFileSync(join(srcDir, 'b.png'))], 'b.png', { type: 'image/png' }))
    const req = new Request(`${base}/${id}/version`, { method: 'POST', body: form })
    const res = await handleVersionedAddVersion(req)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.version).toBe(2)
    expect(getAsset(id)!.versions).toHaveLength(2)
  })

  it('sanitizes a path-traversal upload filename — no write escapes the temp dir', async () => {
    // A crafted multipart filename must not let the staged write escape into the
    // content dir. Plant a canary the traversal would target, then add a version
    // to a DEDICATED asset (don't perturb the shared `id` other tests assert on).
    const subject = await createAsset({ sourceFilePath: join(srcDir, 'a.png'), type: 'images', agent: 'pixel', taskId: null, slug: 'traversal', op: 'upload', description: 'traversal subject' })
    const canary = join(testDir, 'CANARY.txt')
    writeFileSync(canary, 'original')

    const form = new FormData()
    // The handler stages under os.tmpdir()/bakin-addversion-<uuid>, a sibling of
    // testDir. So `../<testDir-name>/CANARY.txt` is exactly one level up — without
    // basename() this write lands on the canary; with it, it stays in the temp dir.
    const evilName = `../${testDir.split('/').pop()}/CANARY.txt`
    form.append('file', new File([readFileSync(join(srcDir, 'b.png'))], evilName, { type: 'image/png' }))
    const res = await handleVersionedAddVersion(new Request(`${base}/${subject.assetId}/version`, { method: 'POST', body: form }))
    const body = await res.json()

    // Version still added (staged under basename inside the unique temp dir)...
    expect(body.ok).toBe(true)
    expect(getAsset(subject.assetId)!.versions).toHaveLength(2)
    // ...and the canary outside the temp dir is untouched.
    expect(readFileSync(canary, 'utf8')).toBe('original')
  })

  it('404s add-version for an unknown asset', async () => {
    const form = new FormData()
    form.append('file', new File([readFileSync(join(srcDir, 'b.png'))], 'b.png', { type: 'image/png' }))
    const res = await handleVersionedAddVersion(new Request(`${base}/20260529-ghost-deadbeef/version`, { method: 'POST', body: form }))
    expect(res.status).toBe(404)
  })

  it('lists, restores, and permanently deletes trashed assets', async () => {
    // Trash it.
    await handleVersionedDeleteAsset(send(`/${id}`, 'DELETE'))
    expect(getAsset(id)).toBeNull()

    // It appears in the trash list.
    const listed = await (await handleTrashList()).json()
    const entry = listed.items.find((t: { assetId: string }) => t.assetId === id)
    expect(entry).toBeDefined()
    expect(entry.versionCount).toBe(2)

    // Restore brings it back.
    const restored = await handleTrashRestore(new Request(`${trashBase}/${encodeURIComponent(entry.trashName)}/restore`, { method: 'POST' }))
    expect((await restored.json()).ok).toBe(true)
    expect(getAsset(id)).not.toBeNull()

    // Trash again, then permanently delete by trashName.
    await handleVersionedDeleteAsset(send(`/${id}`, 'DELETE'))
    const again = (await (await handleTrashList()).json()).items.find((t: { assetId: string }) => t.assetId === id)
    const del = await handleTrashPermanentDelete(new Request(`${trashBase}/${encodeURIComponent(again.trashName)}`, { method: 'DELETE' }))
    expect((await del.json()).ok).toBe(true)
    expect((await (await handleTrashList()).json()).items.some((t: { assetId: string }) => t.assetId === id)).toBe(false)
  })

  it('empties the trash', async () => {
    const created = await createAsset({ sourceFilePath: join(srcDir, 'a.png'), type: 'images', agent: 'pixel', taskId: null, slug: 'tr2', op: 'upload' })
    await handleVersionedDeleteAsset(send(`/${created.assetId}`, 'DELETE'))
    const res = await handleTrashEmpty()
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.deleted).toBeGreaterThanOrEqual(1)
    expect((await (await handleTrashList()).json()).items).toHaveLength(0)
  })
})
