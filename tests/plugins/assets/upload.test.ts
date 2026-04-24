/**
 * Tests for the asset upload route (POST /api/plugins/assets/upload).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, mock } from 'bun:test'
import { mkdirSync, rmSync, existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  activatePlugin,
  findRoute,
  type ActivatedPlugin,
} from '../test-helpers'

const testDir = join(tmpdir(), `bakin-test-upload-${Date.now()}`)
const assetsRoot = join(testDir, 'assets')

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
    expect(body.path).toMatch(/^assets\/store\/\d{4}-\d{2}\//)
    expect(body.filename).toMatch(/\.png$/)

    // Verify sidecar was created with source field
    const metaPath = join(testDir, body.metadataPath as string)
    expect(existsSync(metaPath)).toBe(true)
    const sidecar = JSON.parse(readFileSync(metaPath, 'utf-8'))
    expect(sidecar.agent).toBe('user')
    expect(sidecar.source).toBe('upload')
    expect(sidecar.taskId).toBe('task-upload-1')
    expect(sidecar.type).toBe('images')
    expect(sidecar.originalFilename).toBe('test-photo.png')
  })

  it('uploads a text file', async () => {
    const form = createFormData(
      [{ name: 'notes.md', content: '# Notes\nSome content', type: 'text/markdown' }],
      { taskId: 'task-upload-2', description: 'My notes', tags: 'draft,notes' },
    )
    const { status, body } = await callUpload(form)
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.path).toMatch(/^assets\/store\/\d{4}-\d{2}\//)

    const metaPath = join(testDir, body.metadataPath as string)
    const sidecar = JSON.parse(readFileSync(metaPath, 'utf-8'))
    expect(sidecar.description).toBe('My notes')
    expect(sidecar.tags).toEqual(['draft', 'notes'])
  })

  it('writes to the store even when no taskId is provided', async () => {
    const form = createFormData(
      [{ name: 'random.txt', content: 'hello', type: 'text/plain' }],
    )
    const { status, body } = await callUpload(form)
    expect(status).toBe(200)
    expect(body.path).toMatch(/^assets\/store\/\d{4}-\d{2}\//)
    // taskId lives in the sidecar — the absence of a task doesn't affect path.
    const sidecar = JSON.parse(readFileSync(join(testDir, body.metadataPath as string), 'utf-8'))
    expect(sidecar.taskId === null || sidecar.taskId === '_unlinked').toBe(true)
  })

  it('sets source to clipboard when specified', async () => {
    const form = createFormData(
      [{ name: 'screenshot.png', content: 'png-bytes', type: 'image/png' }],
      { taskId: 'task-clip-1', source: 'clipboard' },
    )
    const { status, body } = await callUpload(form)
    expect(status).toBe(200)
    const metaPath = join(testDir, body.metadataPath as string)
    const sidecar = JSON.parse(readFileSync(metaPath, 'utf-8'))
    expect(sidecar.source).toBe('clipboard')
  })

  it('rejects empty file', async () => {
    const form = new FormData()
    const blob = new Blob([], { type: 'image/png' })
    form.append('file', new File([blob], 'empty.png', { type: 'image/png' }))
    const { status, body } = await callUpload(form)
    expect(status).toBe(400)
    expect(body.error).toMatch(/empty/i)
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
    expect(body.path).toMatch(/^assets\/store\/\d{4}-\d{2}\//)
    const sidecar = JSON.parse(readFileSync(join(testDir, body.metadataPath as string), 'utf-8'))
    expect(sidecar.type).toBe('pdf')
    expect(sidecar.taskId).toBe('task-pdf-1')
  })
})
