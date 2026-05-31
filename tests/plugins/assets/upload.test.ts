/**
 * Tests for the asset upload route (POST /api/plugins/assets/upload).
 * Each uploaded file becomes a versioned asset (v1) via createAsset; the route
 * returns the new assetId and the manifest is the source of truth.
 */
import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  activatePlugin,
  findRoute,
  type ActivatedPlugin,
} from '../test-helpers'

const testDir = join(tmpdir(), `bakin-test-upload-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => {
    const base = join(testDir, 'assets')
    return {
      assets: base,
      'assets.store': join(base, 'store'),
      'assets.inbox': join(base, 'inbox'),
      'assets.trash': join(base, '.trash'),
    }
  },
}))

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

mock.module('../../../src/core/watcher', () => ({
  registerSyncHook: mock(),
}))

import assetsPlugin from '@bakin/assets'

let plugin: ActivatedPlugin

beforeAll(async () => {
  mkdirSync(testDir, { recursive: true })
  plugin = await activatePlugin(assetsPlugin, testDir)
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

function findUploadRoute() {
  return findRoute(plugin.routes, 'POST', '/upload')
}

function createFormData(files: Array<{ name: string; content: string; type?: string }>, fields?: Record<string, string>): FormData {
  const form = new FormData()
  for (const f of files) {
    const blob = new Blob([f.content], { type: f.type || 'application/octet-stream' })
    form.append('file', new File([blob], f.name, { type: f.type || 'application/octet-stream' }))
  }
  if (fields) {
    for (const [k, v] of Object.entries(fields)) {
      form.append(k, v)
    }
  }
  return form
}

async function callUpload(form: FormData): Promise<{ status: number; body: Record<string, unknown> }> {
  const route = findUploadRoute()
  expect(route).toBeDefined()
  const req = new Request('http://localhost/api/plugins/assets/upload', {
    method: 'POST',
    body: form,
  })
  const res = await route!.handler(req, plugin.ctx)
  return { status: res.status, body: await res.json() }
}

/** Read the manifest for an assetId (assetId encodes its YYYYMM shard). */
function readManifest(assetId: string): Record<string, unknown> {
  const month = `${assetId.slice(0, 4)}-${assetId.slice(4, 6)}`
  const path = join(testDir, 'assets', 'store', month, assetId, 'manifest.json')
  return JSON.parse(readFileSync(path, 'utf-8'))
}

describe('POST /upload', () => {
  it('registers the upload route', () => {
    expect(findUploadRoute()).toBeDefined()
  })

  it('uploads an image file with auto-type detection', async () => {
    const form = createFormData(
      [{ name: 'test-photo.png', content: 'fake-png-data', type: 'image/png' }],
      { taskId: 'task-upload-1' },
    )
    const { status, body } = await callUpload(form)
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.assetId).toMatch(/^\d{8}-.+-[0-9a-f]{8}$/)
    expect(body.filename).toBe('test-photo.png')

    const manifest = readManifest(body.assetId as string)
    expect(manifest.agent).toBe('user')
    expect((manifest.source as Record<string, unknown>).kind).toBe('upload')
    expect(manifest.taskId).toBe('task-upload-1')
    expect(manifest.type).toBe('images')
    expect(manifest.currentVersion).toBe(1)
  })

  it('uploads a text file', async () => {
    const form = createFormData(
      [{ name: 'notes.md', content: '# Notes\nSome content', type: 'text/markdown' }],
      { taskId: 'task-upload-2', description: 'My notes', tags: 'draft,notes' },
    )
    const { status, body } = await callUpload(form)
    expect(status).toBe(200)
    expect(body.ok).toBe(true)

    const manifest = readManifest(body.assetId as string)
    expect(manifest.description).toBe('My notes')
    expect(manifest.tags).toEqual(['draft', 'notes'])
    expect(manifest.type).toBe('text')
  })

  it('writes to the store even when no taskId is provided', async () => {
    const form = createFormData(
      [{ name: 'random.txt', content: 'hello', type: 'text/plain' }],
    )
    const { status, body } = await callUpload(form)
    expect(status).toBe(200)
    const manifest = readManifest(body.assetId as string)
    expect(manifest.taskId).toBeNull()
  })

  it('sets source to clipboard when specified', async () => {
    const form = createFormData(
      [{ name: 'screenshot.png', content: 'png-bytes', type: 'image/png' }],
      { taskId: 'task-clip-1', source: 'clipboard' },
    )
    const { status, body } = await callUpload(form)
    expect(status).toBe(200)
    const manifest = readManifest(body.assetId as string)
    expect((manifest.source as Record<string, unknown>).kind).toBe('clipboard')
  })

  it('creates a distinct asset per file on a multi-file upload', async () => {
    const form = createFormData([
      { name: 'a.txt', content: 'alpha', type: 'text/plain' },
      { name: 'b.txt', content: 'bravo', type: 'text/plain' },
    ])
    const route = findUploadRoute()
    const req = new Request('http://localhost/api/plugins/assets/upload', { method: 'POST', body: form })
    const res = await route!.handler(req, plugin.ctx)
    const body = await res.json() as { ok: boolean; results: Array<{ ok: boolean; assetId: string }> }
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.results).toHaveLength(2)
    const ids = new Set(body.results.map(r => r.assetId))
    expect(ids.size).toBe(2)
  })

  it('rejects empty file', async () => {
    const form = new FormData()
    const blob = new Blob([], { type: 'image/png' })
    form.append('file', new File([blob], 'empty.png', { type: 'image/png' }))
    const { status, body } = await callUpload(form)
    expect(status).toBe(400)
    // bun's Request.formData() drops zero-byte File entries during the multipart
    // round-trip, so the handler's `file.size === 0` branch is unreachable in
    // this test environment — we get the "no files provided" error instead.
    // Either message confirms the bad input is rejected.
    expect(body.error).toMatch(/empty|no file/i)
  })

  it('rejects request with no files', async () => {
    const form = new FormData()
    form.append('taskId', 'task-1')
    const { status, body } = await callUpload(form)
    expect(status).toBe(400)
    expect(body.error).toMatch(/no file/i)
  })

  it('rejects oversized files', async () => {
    // Override settings to have tiny maxFileSize
    const origGetSettings = plugin.ctx.getSettings
    plugin.ctx.getSettings = (() => ({ maxFileSize: 0.0001 })) as typeof origGetSettings
    try {
      const form = createFormData(
        [{ name: 'big.txt', content: 'x'.repeat(200), type: 'text/plain' }],
      )
      const { status, body } = await callUpload(form)
      expect(status).toBe(413)
      expect(body.error).toMatch(/exceeds/i)
    } finally {
      plugin.ctx.getSettings = origGetSettings
    }
  })

  it('auto-detects PDF as pdf type', async () => {
    const form = createFormData(
      [{ name: 'document.pdf', content: '%PDF-fake', type: 'application/pdf' }],
      { taskId: 'task-pdf-1' },
    )
    const { status, body } = await callUpload(form)
    expect(status).toBe(200)
    const manifest = readManifest(body.assetId as string)
    expect(manifest.type).toBe('pdf')
    expect(manifest.taskId).toBe('task-pdf-1')
  })
})

// Sanity: the readdir helper above keeps the store layout assumption honest.
describe('upload store layout', () => {
  it('shards assets under assets/store/<YYYY-MM>/<assetId>/', async () => {
    const form = createFormData([{ name: 'layout.txt', content: 'x', type: 'text/plain' }])
    const { body } = await callUpload(form)
    const assetId = body.assetId as string
    const month = `${assetId.slice(0, 4)}-${assetId.slice(4, 6)}`
    const dir = join(testDir, 'assets', 'store', month, assetId)
    expect(readdirSync(dir)).toContain('manifest.json')
  })
})
