/**
 * adapter-pi #627 — image generation on Pi rides the images plugin's
 * Bakin-side SHIM (direct provider call, env/secret-store key), which
 * routes whenever the runtime doesn't serve images natively. The Pi
 * adapter deliberately omits runtime.images; this pins that the plugin's
 * provider readiness degrades to the shim instead of crashing or lying.
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

import type { PluginContext } from '@bakin/core/plugin-types'
import { createPiRuntimeAdapter } from '../../../packages/adapter-pi/src/index'
import { resetPiHome } from '../../../packages/adapter-pi/src/home'
import { providerReadiness } from '../../../plugins/images/lib/providers'

const adapter = createPiRuntimeAdapter()

beforeAll(async () => {
  resetPiHome()
  mkdirSync(join(testDir, 'pi', 'agent'), { recursive: true })
  writeFileSync(join(testDir, 'pi', 'agent', 'auth.json'), '{}')
  await adapter.initialize({ contentDir: join(testDir, 'bakin') })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('images on Pi via the Bakin shim', () => {
  test('runtime.images is genuinely absent (native serving off)', () => {
    expect(adapter.images).toBeUndefined()
  })

  test('with a Bakin-side key, openai routes via the shim; without, honestly unconfigured', async () => {
    const ctx = { runtime: adapter } as unknown as PluginContext

    const prevKey = process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = 'sk-test-shim-route'
    try {
      const withKey = await providerReadiness(ctx)
      const openai = withKey.find((p) => p.id === 'openai')
      expect(openai?.servedBy).toBe('shim')

      delete process.env.OPENAI_API_KEY
      const withoutKey = await providerReadiness(ctx)
      const openaiBare = withoutKey.find((p) => p.id === 'openai')
      // No fabricated availability: no runtime serving + no key = unconfigured.
      expect(openaiBare?.servedBy).toBe('unconfigured')
    } finally {
      if (prevKey !== undefined) process.env.OPENAI_API_KEY = prevKey
      else delete process.env.OPENAI_API_KEY
    }
  })
})
