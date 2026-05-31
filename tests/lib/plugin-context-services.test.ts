import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { resetContentDir } from '../../src/core/content-dir'

let testDir = join(tmpdir(), `bakin-plugin-assets-api-${Date.now()}`)
const originalBakinHome = process.env.BAKIN_HOME

mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import { createPluginAssetsAPI } from '../../src/lib/plugin-context-services'

describe('createPluginAssetsAPI', () => {
  beforeEach(() => {
    testDir = join(tmpdir(), `bakin-plugin-assets-api-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    mkdirSync(testDir, { recursive: true })
    process.env.BAKIN_HOME = testDir
    resetContentDir()
  })

  afterEach(() => {
    if (originalBakinHome === undefined) delete process.env.BAKIN_HOME
    else process.env.BAKIN_HOME = originalBakinHome
    resetContentDir()
    rmSync(testDir, { recursive: true, force: true })
    mock.restore()
  })

  it('creates a versioned asset (v1) through the public plugin API', async () => {
    const src = join(testDir, 'source.png')
    writeFileSync(src, 'fake-image')
    const assets = createPluginAssetsAPI()

    const { assetId, version } = await assets.createAsset({
      sourceFilePath: src,
      taskId: 'task-123',
      type: 'images',
      agent: 'pixel',
      description: 'Generated image',
      slug: 'generated-image',
      op: 'generate',
      generation: {
        provider: 'google',
        model: 'gemini-3.1-flash-image',
        surface: 'instagram-story',
        quality: 'standard',
        routeSource: 'runtime',
      },
    })

    expect(version).toBe(1)
    expect(assetId).toMatch(/^\d{8}-generated-image-[0-9a-f]{8}$/)

    const ref = await assets.resolveVersionFile(assetId)
    expect(ref?.version).toBe(1)
    expect(ref?.mimeType).toBe('image/png')
    expect(ref?.absPath).toContain(assetId)
  })

  it('appends a new version to an existing asset', async () => {
    const src = join(testDir, 'doc.md')
    writeFileSync(src, '# v1\n')
    const assets = createPluginAssetsAPI()

    const created = await assets.createAsset({
      sourceFilePath: src, taskId: null, type: 'text', agent: 'margo', slug: 'doc',
    })
    expect(created.version).toBe(1)

    writeFileSync(src, '# v2\n')
    const next = await assets.addVersion(created.assetId, { sourceFilePath: src, op: 'edit' })
    expect(next.assetId).toBe(created.assetId)
    expect(next.version).toBe(2)

    const ref = await assets.resolveVersionFile(created.assetId)
    expect(ref?.version).toBe(2)
  })
})
