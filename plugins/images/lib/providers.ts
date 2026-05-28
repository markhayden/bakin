import type { PluginContext } from '@bakin/core/plugin-types'
import type { ImagePluginSettings, ImageProviderDescriptor, ImageProviderReadiness } from '../types'
import { resolveImageApiKey } from './credentials'

export const IMAGE_PROVIDERS: ImageProviderDescriptor[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    envVars: ['OPENAI_API_KEY'],
    models: [
      {
        id: 'gpt-image-2',
        provider: 'openai',
        label: 'GPT Image 2',
        tier: 'standard',
        status: 'routable',
        capabilities: ['generate', 'edit', 'reference-images', 'text-rendering'],
        defaultQuality: 'standard',
      },
      {
        id: 'gpt-5.5',
        provider: 'openai',
        label: 'GPT-5.5 image generation tool',
        tier: 'premium',
        status: 'routable',
        capabilities: ['generate', 'responses-image-tool', 'text-rendering'],
        defaultQuality: 'premium',
      },
    ],
  },
  {
    id: 'google',
    label: 'Google Gemini',
    envVars: ['GEMINI_API_KEY', 'GOOGLE_AI_API_KEY'],
    models: [
      {
        id: 'gemini-3.1-flash-image',
        provider: 'google',
        label: 'Gemini 3.1 Flash Image',
        tier: 'budget',
        status: 'routable',
        capabilities: ['generate', 'edit', 'reference-images'],
        defaultQuality: 'standard',
      },
      {
        id: 'gemini-3-pro-image',
        provider: 'google',
        label: 'Gemini 3 Pro Image',
        tier: 'premium',
        status: 'routable',
        capabilities: ['generate', 'edit', 'reference-images', 'text-rendering'],
        defaultQuality: 'premium',
      },
      {
        id: 'gemini-2.5-flash-image',
        provider: 'google',
        label: 'Gemini 2.5 Flash Image',
        tier: 'budget',
        status: 'routable',
        capabilities: ['generate', 'edit', 'reference-images'],
        defaultQuality: 'standard',
      },
    ],
  },
]

export const DEFAULT_IMAGE_SETTINGS: Required<ImagePluginSettings> = {
  defaultProvider: 'auto',
  defaultSurface: 'instagram-feed-portrait',
  fallbackOrder: [
    'openai/gpt-image-2',
    'google/gemini-3.1-flash-image',
    'google/gemini-3-pro-image',
  ],
  quality: 'standard',
}

export function listImageProviders(): ImageProviderDescriptor[] {
  return IMAGE_PROVIDERS
}

export function getImageProvider(id: string): ImageProviderDescriptor | null {
  return IMAGE_PROVIDERS.find(provider => provider.id === id) ?? null
}

export function providerReadinessFromEnv(env: Record<string, string | undefined> = process.env): ImageProviderReadiness[] {
  return IMAGE_PROVIDERS.map((provider) => {
    const configuredEnvVars = provider.envVars.filter(name => Boolean(env[name]))
    return {
      id: provider.id,
      label: provider.label,
      configured: configuredEnvVars.length > 0,
      routable: configuredEnvVars.length > 0 && provider.models.some(model => model.status === 'routable'),
      envVars: provider.envVars,
      configuredEnvVars,
      models: provider.models,
    }
  })
}

export async function providerReadiness(ctx: PluginContext): Promise<ImageProviderReadiness[]> {
  const envReadiness = providerReadinessFromEnv()
  const envById = new Map(envReadiness.map(provider => [provider.id, provider]))

  return Promise.all(IMAGE_PROVIDERS.map(async (provider) => {
    const apiKey = await resolveImageApiKey(ctx, provider.id)
    const env = envById.get(provider.id)
    const configured = Boolean(apiKey)
    return {
      id: provider.id,
      label: provider.label,
      configured,
      routable: configured && provider.models.some(model => model.status === 'routable'),
      envVars: provider.envVars,
      configuredEnvVars: env?.configuredEnvVars ?? [],
      models: provider.models,
    }
  }))
}
