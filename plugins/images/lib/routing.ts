import type { PluginContext } from '@bakin/core/plugin-types'
import type { ImagePluginSettings, ImageProviderId } from '../types'
import { DEFAULT_IMAGE_SETTINGS, getImageProvider, providerReadiness } from './providers'
import { getImageProfile } from './platform-profiles'

export interface ImageRouteRequest {
  surface?: string
  objective?: string
  provider?: ImageProviderId | 'auto'
  model?: string
  quality?: 'draft' | 'standard' | 'premium'
}

export interface ImageRouteRecommendation {
  ok: true
  surface: string
  width: number
  height: number
  provider: ImageProviderId
  model: string
  quality: 'draft' | 'standard' | 'premium'
  reason: string
  fallbackRoutes: Array<{ provider: ImageProviderId; model: string }>
}

function settings(ctx: PluginContext): Required<ImagePluginSettings> {
  const configured = ctx.getSettings<ImagePluginSettings>()
  return {
    defaultProvider: configured.defaultProvider ?? DEFAULT_IMAGE_SETTINGS.defaultProvider,
    defaultSurface: configured.defaultSurface ?? DEFAULT_IMAGE_SETTINGS.defaultSurface,
    fallbackOrder: configured.fallbackOrder ?? DEFAULT_IMAGE_SETTINGS.fallbackOrder,
    quality: configured.quality ?? DEFAULT_IMAGE_SETTINGS.quality,
  }
}

function parseRoute(route: string): { provider: ImageProviderId; model: string } | null {
  const [provider, ...modelParts] = route.split('/')
  const model = modelParts.join('/')
  if ((provider === 'openai' || provider === 'google') && model) return { provider, model }
  return null
}

function defaultModel(provider: ImageProviderId): string {
  return provider === 'openai' ? 'gpt-image-2' : 'gemini-3.1-flash-image'
}

function providerForModel(model: string): ImageProviderId | null {
  for (const providerId of ['openai', 'google'] as ImageProviderId[]) {
    const provider = getImageProvider(providerId)
    if (provider?.models.some(candidate => candidate.id === model)) return providerId
  }
  return null
}

function normalizeRequestedRoute(
  provider: ImageProviderId | 'auto' | undefined,
  model: string | undefined,
): { provider: ImageProviderId; model: string } | null {
  if (provider && provider !== 'auto') {
    const explicit = model ? parseRoute(model) : null
    return explicit ?? { provider, model: model ?? defaultModel(provider) }
  }
  if (!model) return null
  const explicit = parseRoute(model)
  if (explicit) return explicit
  const inferredProvider = providerForModel(model)
  return inferredProvider ? { provider: inferredProvider, model } : null
}

function objectiveBias(objective: string | undefined): ImageProviderId | null {
  const text = (objective || '').toLowerCase()
  if (text.includes('ctr') || text.includes('carousel') || text.includes('text') || text.includes('typography')) return 'openai'
  if (text.includes('brand') || text.includes('landing') || text.includes('email') || text.includes('photo')) return 'google'
  return null
}

export async function recommendImageRoute(ctx: PluginContext, request: ImageRouteRequest = {}): Promise<ImageRouteRecommendation | { ok: false; error: string }> {
  const effective = settings(ctx)
  const profile = getImageProfile(request.surface || effective.defaultSurface)
  if (!profile) return { ok: false, error: `Unknown image surface: ${request.surface || effective.defaultSurface}` }

  const readiness = await providerReadiness(ctx)
  const readyProviderIds = new Set(readiness.filter(provider => provider.routable).map(provider => provider.id))
  const configuredFallbacks = effective.fallbackOrder
    .map(parseRoute)
    .filter((route): route is { provider: ImageProviderId; model: string } => Boolean(route))
  const fallbackRoutes = configuredFallbacks.filter(route => readyProviderIds.has(route.provider))

  let chosen: { provider: ImageProviderId; model: string } | null = null
  const requested = normalizeRequestedRoute(request.provider, request.model)
  if (requested) {
    chosen = requested
  } else if (request.model) {
    return { ok: false, error: `Unknown image model: ${request.model}` }
  } else if (effective.defaultProvider !== 'auto') {
    chosen = { provider: effective.defaultProvider, model: defaultModel(effective.defaultProvider) }
  } else {
    const biased = objectiveBias(request.objective)
    chosen = (biased ? fallbackRoutes.find(route => route.provider === biased) : null) ?? fallbackRoutes[0] ?? configuredFallbacks[0] ?? null
  }

  if (!chosen) return { ok: false, error: 'No image provider route is configured.' }
  const provider = getImageProvider(chosen.provider)
  const model = provider?.models.find(candidate => candidate.id === chosen.model)
  if (!provider || !model) return { ok: false, error: `Unknown image model: ${chosen.provider}/${chosen.model}` }

  const configured = readyProviderIds.has(chosen.provider)
  const reason = configured
    ? `${provider.label} ${model.label} is configured and fits ${profile.label}.`
    : `${provider.label} ${model.label} is the preferred route for ${profile.label}, but credentials are not configured yet.`

  return {
    ok: true,
    surface: profile.id,
    width: profile.width,
    height: profile.height,
    provider: chosen.provider,
    model: chosen.model,
    quality: request.quality ?? effective.quality,
    reason,
    fallbackRoutes,
  }
}
