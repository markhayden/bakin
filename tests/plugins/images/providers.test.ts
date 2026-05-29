import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { PluginContext } from '@bakin/core/plugin-types'
import { resetContentDir } from '../../../src/core/content-dir'
import { DEFAULT_IMAGE_SETTINGS, listImageProviders, providerReadiness, providerReadinessFromEnv } from '../../../plugins/images/lib/providers'

describe('image providers', () => {
  // readiness consults the Bakin secret store (getContentDir) — isolate it.
  let testDir: string
  const original = {
    openai: process.env.OPENAI_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
    google: process.env.GOOGLE_AI_API_KEY,
    home: process.env.BAKIN_HOME,
  }
  beforeEach(() => {
    testDir = join(tmpdir(), `bakin-images-providers-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    process.env.BAKIN_HOME = testDir
    resetContentDir()
    delete process.env.OPENAI_API_KEY
    delete process.env.GEMINI_API_KEY
    delete process.env.GOOGLE_AI_API_KEY
  })
  afterEach(() => {
    for (const [key, value] of [['OPENAI_API_KEY', original.openai], ['GEMINI_API_KEY', original.gemini], ['GOOGLE_AI_API_KEY', original.google], ['BAKIN_HOME', original.home]] as const) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    resetContentDir()
    rmSync(testDir, { recursive: true, force: true })
    mock.restore()
  })

  it('ships routable OpenAI and Gemini providers for v1', () => {
    const providers = listImageProviders()
    const byId = new Map(providers.map(provider => [provider.id, provider]))

    expect(byId.get('openai')?.models.map(model => model.id)).toEqual([
      'gpt-image-2',
      'gpt-image-1.5',
      'gpt-image-1',
      'gpt-image-1-mini',
    ])
    expect(byId.get('google')?.models.map(model => model.id)).toEqual([
      'gemini-3.1-flash-image-preview',
      'gemini-3-pro-image-preview',
    ])
    expect(providers.flatMap(provider => provider.models).every(model => model.status === 'routable')).toBe(true)
  })

  it('reports readiness from provider-specific environment variables', () => {
    const none = providerReadinessFromEnv({})
    expect(none.every(provider => provider.configured === false)).toBe(true)
    expect(none.every(provider => provider.routable === false)).toBe(true)

    const ready = providerReadinessFromEnv({
      OPENAI_API_KEY: 'openai-key',
      GEMINI_API_KEY: 'gemini-key',
    })
    expect(ready.find(provider => provider.id === 'openai')).toMatchObject({
      configured: true,
      routable: true,
      configuredEnvVars: ['OPENAI_API_KEY'],
    })
    expect(ready.find(provider => provider.id === 'google')).toMatchObject({
      configured: true,
      routable: true,
      configuredEnvVars: ['GEMINI_API_KEY'],
    })
  })

  it('reports a native provider as configured from a Bakin-owned env secret', async () => {
    // Native readiness no longer reads provider keys out of the runtime's raw
    // config (that crossed the adapter boundary). A Bakin-owned env secret is
    // the legitimate signal that the direct shim can serve the provider.
    process.env.GEMINI_API_KEY = 'gemini-key'
    const ctx = {} as unknown as PluginContext

    const ready = await providerReadiness(ctx)

    expect(ready.find(provider => provider.id === 'google')).toMatchObject({
      configured: true,
      routable: true,
      servedBy: 'shim',
    })
  })

  it('merges configured runtime image providers into readiness', async () => {
    const ctx = {
      runtime: {
        images: {
          providers: mock(async () => [
            {
              id: 'openrouter',
              label: 'OpenRouter',
              configured: true,
              defaultModel: 'google/gemini-3.1-flash-image-preview',
              models: ['google/gemini-3.1-flash-image-preview'],
              capabilities: { generate: { maxCount: 4 } },
            },
          ]),
        },
        config: {
          get: mock(async () => ({})),
        },
      },
    } as unknown as PluginContext

    const ready = await providerReadiness(ctx)

    expect(ready.find(provider => provider.id === 'openrouter')).toMatchObject({
      configured: true,
      routable: true,
      source: 'runtime',
      models: [expect.objectContaining({ id: 'google/gemini-3.1-flash-image-preview' })],
    })
  })

  it('defaults to automatic routing and a social portrait surface', () => {
    expect(DEFAULT_IMAGE_SETTINGS).toMatchObject({
      defaultProvider: 'auto',
      defaultSurface: 'instagram-feed-portrait',
      quality: 'standard',
    })
    expect(DEFAULT_IMAGE_SETTINGS.fallbackOrder.length).toBeGreaterThan(1)
  })
})
