/**
 * adapter-pi #627 — image generation on Pi routes through Bakin's SHARED
 * direct-provider shim behind runtime.images (same fallback path OpenClaw
 * uses). Keys resolve env → secret store; no key = typed guidance, never
 * a fabricated result. Edit stays typed-unsupported (shim is generate-only).
 */
import { describe, test, expect, beforeAll, afterAll, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-pi-imgshim-${Date.now()}-${randomUUID()}`)
process.env.PI_HOME = join(testDir, 'pi')
process.env.BAKIN_HOME = join(testDir, 'bakin')

const contentDirMock = () => ({
  getContentDir: () => join(testDir, 'bakin'),
  getBakinPaths: () => ({ home: join(testDir, 'bakin'), db: join(testDir, 'bakin', 'bakin.db') }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

// The shim itself is core-shared and separately tested — mock the billed call.
const directCalls: Array<Record<string, unknown>> = []
mock.module('../../../packages/core/src/media/direct-image-provider', () => ({
  isDirectImageProvider: (id: string) => id === 'openai' || id === 'google',
  generateDirectImage: async (req: Record<string, unknown>) => {
    directCalls.push(req)
    return { filePath: join(testDir, 'shim-out.png'), mimeType: 'image/png', width: 1024, height: 1024 }
  },
}))

import type { RuntimeError } from '../../../packages/core/src/adapters/runtime'
import { createPiRuntimeAdapter } from '../../../packages/adapter-pi/src/index'
import { resetPiHome } from '../../../packages/adapter-pi/src/home'
import { providerReadiness } from '../../../plugins/images/lib/providers'
import type { PluginContext } from '@bakin/core/plugin-types'

const adapter = createPiRuntimeAdapter()

beforeAll(async () => {
  resetPiHome()
  mkdirSync(join(testDir, 'pi', 'agent'), { recursive: true })
  writeFileSync(join(testDir, 'pi', 'agent', 'auth.json'), '{}')
  writeFileSync(join(testDir, 'shim-out.png'), 'fake-png-bytes')
  await adapter.initialize({ contentDir: join(testDir, 'bakin') })
})

afterAll(() => {
  delete process.env.OPENAI_API_KEY
  rmSync(testDir, { recursive: true, force: true })
})

describe('images on Pi via the shared shim', () => {
  test('generate with a Bakin key routes through the direct provider and tags shim provenance', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-shim'
    directCalls.length = 0
    const result = await adapter.images!.generate({
      prompt: 'a pop-tart hero shot',
      provider: 'openai',
      model: 'gpt-image-1',
      width: 1080,
      height: 1350,
      metadata: { quality: 'premium' },
    })
    expect(directCalls[0]).toMatchObject({ provider: 'openai', model: 'gpt-image-1', width: 1080, height: 1350, quality: 'premium', apiKey: 'sk-test-shim' })
    expect(result.images[0].filePath).toBe(join(testDir, 'shim-out.png'))
    expect(result.metadata).toMatchObject({ servedBy: 'shim', credentialSource: 'bakin-env' })
  })

  test('no key: typed failure carrying setup guidance, never a fabricated image', async () => {
    delete process.env.OPENAI_API_KEY
    try {
      await adapter.images!.generate({ prompt: 'x', provider: 'openai' })
      throw new Error('expected generate to reject')
    } catch (err) {
      expect((err as RuntimeError).kind).toBe('runtime_failed')
      expect((err as Error).message).toContain('OPENAI_API_KEY')
    }
  })

  test('non-direct provider and edit are typed-unsupported', async () => {
    await expect(adapter.images!.generate({ prompt: 'x', provider: 'dall-e-9000' })).rejects.toThrow('not shim-servable')
    await expect(adapter.images!.edit({ prompt: 'x', files: ['/tmp/a.png'] })).rejects.toThrow('generate-only')
  })

  test('plugin readiness: shim with a key, honestly unconfigured without', async () => {
    const ctx = { runtime: adapter } as unknown as PluginContext
    process.env.OPENAI_API_KEY = 'sk-test-shim'
    const withKey = await providerReadiness(ctx)
    expect(withKey.find((p) => p.id === 'openai')?.servedBy).toBe('shim')

    delete process.env.OPENAI_API_KEY
    const withoutKey = await providerReadiness(ctx)
    expect(withoutKey.find((p) => p.id === 'openai')?.servedBy).toBe('unconfigured')
  })
})
