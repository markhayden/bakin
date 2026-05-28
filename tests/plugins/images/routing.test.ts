import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import type { PluginContext } from '@bakin/core/plugin-types'
import { recommendImageRoute } from '../../../plugins/images/lib/routing'

const originalOpenAI = process.env.OPENAI_API_KEY
const originalGemini = process.env.GEMINI_API_KEY
const originalGoogle = process.env.GOOGLE_AI_API_KEY

function makeContext(settings: Record<string, unknown> = {}): PluginContext {
  return {
    getSettings: mock(() => settings),
  } as unknown as PluginContext
}

describe('image route recommendation', () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY
    delete process.env.GEMINI_API_KEY
    delete process.env.GOOGLE_AI_API_KEY
  })

  afterEach(() => {
    if (originalOpenAI === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = originalOpenAI
    if (originalGemini === undefined) delete process.env.GEMINI_API_KEY
    else process.env.GEMINI_API_KEY = originalGemini
    if (originalGoogle === undefined) delete process.env.GOOGLE_AI_API_KEY
    else process.env.GOOGLE_AI_API_KEY = originalGoogle
    mock.restore()
  })

  it('returns the configured preferred route with a missing-credentials reason', async () => {
    const result = await recommendImageRoute(makeContext(), { surface: 'blog-hero' })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result).toMatchObject({
      provider: 'openai',
      model: 'gpt-image-2',
      surface: 'blog-hero',
      width: 1600,
      height: 900,
      quality: 'standard',
      fallbackRoutes: [],
    })
    expect(result.reason).toContain('credentials are not configured')
  })

  it('biases CTR and typography objectives toward OpenAI when configured', async () => {
    process.env.OPENAI_API_KEY = 'openai-key'
    process.env.GEMINI_API_KEY = 'gemini-key'

    const result = await recommendImageRoute(makeContext(), {
      surface: 'google-display-square',
      objective: 'CTR ad creative with readable typography',
      quality: 'premium',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result).toMatchObject({
      provider: 'openai',
      model: 'gpt-image-2',
      surface: 'google-display-square',
      quality: 'premium',
    })
  })

  it('biases brand photo objectives toward Gemini when configured', async () => {
    process.env.OPENAI_API_KEY = 'openai-key'
    process.env.GEMINI_API_KEY = 'gemini-key'

    const result = await recommendImageRoute(makeContext(), {
      surface: 'email-header',
      objective: 'brand photography for an email campaign',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result).toMatchObject({
      provider: 'google',
      model: 'gemini-3.1-flash-image-preview',
      surface: 'email-header',
    })
  })

  it('does not bias toward OpenAI when "text" only appears as a substring', async () => {
    process.env.OPENAI_API_KEY = 'openai-key'
    process.env.GEMINI_API_KEY = 'gemini-key'

    // "context" contains the substring "text" but should not trigger the
    // OpenAI text-rendering bias; with Gemini first in the fallback order the
    // route should stay on Gemini.
    const result = await recommendImageRoute(
      makeContext({ fallbackOrder: ['google/gemini-3.1-flash-image-preview', 'openai/gpt-image-2'] }),
      { surface: 'blog-hero', objective: 'add more context to the hero scene' },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.provider).toBe('google')
  })

  it('accepts an unqualified explicit model id', async () => {
    process.env.GEMINI_API_KEY = 'gemini-key'

    const result = await recommendImageRoute(makeContext(), {
      model: 'gemini-3-pro-image-preview',
      surface: 'open-graph',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result).toMatchObject({
      provider: 'google',
      model: 'gemini-3-pro-image-preview',
      surface: 'open-graph',
    })
  })

  it('accepts runtime provider/model routes when the runtime provider is configured', async () => {
    const ctx = {
      getSettings: mock(() => ({
        fallbackOrder: ['openrouter/google/gemini-3.1-flash-image-preview'],
      })),
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
      },
    } as unknown as PluginContext

    const result = await recommendImageRoute(ctx, { surface: 'blog-hero' })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result).toMatchObject({
      provider: 'openrouter',
      model: 'google/gemini-3.1-flash-image-preview',
      surface: 'blog-hero',
    })
  })

  it('rejects unknown surfaces and unknown explicit models', async () => {
    expect(await recommendImageRoute(makeContext(), { surface: 'my-space-banner' })).toEqual({
      ok: false,
      error: 'Unknown image surface: my-space-banner',
    })
    expect(await recommendImageRoute(makeContext(), { model: 'made-up-model' })).toEqual({
      ok: false,
      error: 'Unknown image model: made-up-model',
    })
  })
})
