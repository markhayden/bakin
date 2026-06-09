import type { PluginContext } from '@bakin/core/plugin-types'
import type { RuntimeImageProvider } from '@bakin/core/adapters/runtime'
import { IMAGE_PROVIDER_ENV_VARS, listStoredProviders } from '@bakin/core/media'
import type { ImageModelDescriptor, ImagePluginSettings, ImageProviderDescriptor, ImageProviderReadiness } from '../types'

export const IMAGE_PROVIDERS: ImageProviderDescriptor[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    envVars: IMAGE_PROVIDER_ENV_VARS.openai,
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
        id: 'gpt-image-1.5',
        provider: 'openai',
        label: 'GPT Image 1.5',
        tier: 'premium',
        status: 'routable',
        capabilities: ['generate', 'edit', 'reference-images', 'text-rendering', 'transparent-background'],
        defaultQuality: 'premium',
      },
      {
        id: 'gpt-image-1',
        provider: 'openai',
        label: 'GPT Image 1',
        tier: 'standard',
        status: 'routable',
        capabilities: ['generate', 'edit', 'reference-images', 'text-rendering'],
        defaultQuality: 'standard',
      },
      {
        id: 'gpt-image-1-mini',
        provider: 'openai',
        label: 'GPT Image 1 Mini',
        tier: 'budget',
        status: 'routable',
        capabilities: ['generate', 'edit', 'reference-images'],
        defaultQuality: 'draft',
      },
    ],
  },
  {
    id: 'google',
    label: 'Google Gemini',
    envVars: IMAGE_PROVIDER_ENV_VARS.google,
    models: [
      {
        id: 'gemini-3.1-flash-image-preview',
        provider: 'google',
        label: 'Gemini 3.1 Flash Image Preview',
        tier: 'budget',
        status: 'routable',
        capabilities: ['generate', 'edit', 'reference-images'],
        defaultQuality: 'standard',
      },
      {
        id: 'gemini-3-pro-image-preview',
        provider: 'google',
        label: 'Gemini 3 Pro Image Preview',
        tier: 'premium',
        status: 'routable',
        capabilities: ['generate', 'edit', 'reference-images', 'text-rendering'],
        defaultQuality: 'premium',
      },
    ],
  },
]

export const DEFAULT_IMAGE_SETTINGS: Required<ImagePluginSettings> = {
  defaultProvider: 'auto',
  defaultSurface: 'instagram-feed-portrait',
  fallbackOrder: [
    'openai/gpt-image-2',
    'google/gemini-3.1-flash-image-preview',
    'google/gemini-3-pro-image-preview',
  ],
  quality: 'standard',
}

/** Merge configured plugin settings over the defaults. Shared by tools + routing. */
export function effectiveImageSettings(ctx: PluginContext): Required<ImagePluginSettings> {
  const settings = ctx.getSettings<ImagePluginSettings>()
  return {
    defaultProvider: settings.defaultProvider ?? DEFAULT_IMAGE_SETTINGS.defaultProvider,
    defaultSurface: settings.defaultSurface ?? DEFAULT_IMAGE_SETTINGS.defaultSurface,
    fallbackOrder: settings.fallbackOrder ?? DEFAULT_IMAGE_SETTINGS.fallbackOrder,
    quality: settings.quality ?? DEFAULT_IMAGE_SETTINGS.quality,
  }
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

export async function providerReadiness(
  ctx: PluginContext,
  prefetchedRuntimeProviders?: RuntimeImageProvider[],
): Promise<ImageProviderReadiness[]> {
  const envReadiness = providerReadinessFromEnv()
  const envById = new Map(envReadiness.map(provider => [provider.id, provider]))
  const runtimeProviders = prefetchedRuntimeProviders ?? await fetchRuntimeImageProviders(ctx)
  const runtimeById = new Map(runtimeProviders.map(provider => [provider.id, provider]))
  // Read the secret store once for the whole pass (not once per provider).
  const storedProviders = new Set(listStoredProviders())

  const native: ImageProviderReadiness[] = IMAGE_PROVIDERS.map((provider): ImageProviderReadiness => {
    const env = envById.get(provider.id)
    const runtime = runtimeById.get(provider.id)
    // A native provider is reachable if the runtime serves it OR a Bakin-owned
    // shim key (env or secret store) is present. We no longer read provider
    // keys out of the runtime's raw config — that crossed the adapter boundary.
    const hasEnvKey = (env?.configuredEnvVars.length ?? 0) > 0
    const hasBakinKey = hasEnvKey || storedProviders.has(provider.id)
    const configured = hasBakinKey || runtime?.configured === true
    const routable = configured && (
      provider.models.some(model => model.status === 'routable')
      || runtimeProviderRoutable(runtime)
    )
    return {
      id: provider.id,
      label: runtime?.label ?? provider.label,
      configured,
      routable,
      envVars: provider.envVars,
      configuredEnvVars: env?.configuredEnvVars ?? [],
      models: mergeImageModels(provider.models, runtimeModels(runtime, provider.id)),
      defaultModel: runtime?.defaultModel,
      selected: runtime?.selected,
      source: runtime ? 'native+runtime' as const : 'native' as const,
      servedBy: runtime?.configured === true ? 'runtime' : hasBakinKey ? 'shim' : 'unconfigured',
    }
  })

  const nativeIds = new Set(native.map(provider => provider.id))
  const runtimeOnly = runtimeProviders
    .filter(provider => !nativeIds.has(provider.id))
    .map((provider): ImageProviderReadiness => ({
      id: provider.id,
      label: provider.label ?? provider.id,
      configured: provider.configured === true,
      routable: runtimeProviderRoutable(provider),
      envVars: [],
      configuredEnvVars: [],
      models: runtimeModels(provider, provider.id),
      defaultModel: provider.defaultModel,
      selected: provider.selected,
      source: 'runtime',
      servedBy: provider.configured === true ? 'runtime' : 'unconfigured',
    }))

  return [...native, ...runtimeOnly]
}

export async function fetchRuntimeImageProviders(ctx: PluginContext): Promise<RuntimeImageProvider[]> {
  try {
    return await ctx.runtime.images?.providers() ?? []
  } catch {
    return []
  }
}

function runtimeProviderRoutable(provider: RuntimeImageProvider | undefined): boolean {
  if (!provider || provider.configured !== true) return false
  if (provider.capabilities?.generate && provider.capabilities.generate.maxCount === 0) return false
  return (provider.models?.length ?? 0) > 0 || Boolean(provider.defaultModel)
}

function runtimeModels(provider: RuntimeImageProvider | undefined, providerId: string): ImageModelDescriptor[] {
  if (!provider) return []
  const models = provider.models?.length ? provider.models : provider.defaultModel ? [provider.defaultModel] : []
  return models.map((model): ImageModelDescriptor => ({
    id: model,
    provider: providerId,
    label: model,
    tier: provider.selected ? 'standard' : 'budget',
    status: provider.configured ? 'routable' : 'known',
    capabilities: ['generate', ...(provider.capabilities?.edit?.enabled ? ['edit' as const] : [])],
    defaultQuality: 'standard',
  }))
}

function mergeImageModels(primary: ImageModelDescriptor[], secondary: ImageModelDescriptor[]): ImageModelDescriptor[] {
  const out = new Map<string, ImageModelDescriptor>()
  for (const model of [...primary, ...secondary]) out.set(model.id, model)
  return [...out.values()]
}
