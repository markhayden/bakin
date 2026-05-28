import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

let testDir = join(tmpdir(), `bakin-plugin-assets-api-${Date.now()}`)

mock.module('../../src/core/content-dir', () => ({
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

mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import { createPluginAssetsAPI } from '../../src/lib/plugin-context-services'

describe('createPluginAssetsAPI', () => {
  beforeEach(() => {
    testDir = join(tmpdir(), `bakin-plugin-assets-api-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
    mock.restore()
  })

  it('saves assets through the public plugin API and indexes them immediately', async () => {
    const src = join(testDir, 'source.png')
    writeFileSync(src, 'fake-image')
    const assets = createPluginAssetsAPI()

    const saved = await assets.save({
      filePath: src,
      taskId: 'task-123',
      type: 'images',
      agent: 'pixel',
      description: 'Generated image',
      slug: 'generated-image',
      generation: {
        provider: 'google',
        model: 'gemini-3.1-flash-image',
        surface: 'instagram-story',
        width: 1080,
        height: 1920,
        quality: 'standard',
        promptHash: 'sha256:abc123',
        createdByTool: 'bakin_exec_images_generate',
      },
    })

    expect(saved.ok).toBe(true)
    expect(saved.filename).toMatch(/^\d{8}-generated-image-[0-9a-f]{8}\.png$/)

    const indexed = await assets.getByFilename(saved.filename!)
    expect(indexed?.filename).toBe(saved.filename)
    expect(indexed?.metadata.generation).toEqual({
      provider: 'google',
      model: 'gemini-3.1-flash-image',
      surface: 'instagram-story',
      width: 1080,
      height: 1920,
      quality: 'standard',
      promptHash: 'sha256:abc123',
      createdByTool: 'bakin_exec_images_generate',
    })
  })
})
