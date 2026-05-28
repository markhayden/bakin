import { describe, expect, it } from 'bun:test'
import { DEFAULT_IMAGE_SETTINGS, listImageProviders, providerReadinessFromEnv } from '../../../plugins/images/lib/providers'

describe('image providers', () => {
  it('ships routable OpenAI and Gemini providers for v1', () => {
    const providers = listImageProviders()
    const byId = new Map(providers.map(provider => [provider.id, provider]))

    expect(byId.get('openai')?.models.map(model => model.id)).toEqual([
      'gpt-image-2',
      'gpt-5.5',
    ])
    expect(byId.get('google')?.models.map(model => model.id)).toEqual([
      'gemini-3.1-flash-image',
      'gemini-3-pro-image',
      'gemini-2.5-flash-image',
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

  it('defaults to automatic routing and a social portrait surface', () => {
    expect(DEFAULT_IMAGE_SETTINGS).toMatchObject({
      defaultProvider: 'auto',
      defaultSurface: 'instagram-feed-portrait',
      quality: 'standard',
    })
    expect(DEFAULT_IMAGE_SETTINGS.fallbackOrder.length).toBeGreaterThan(1)
  })
})
