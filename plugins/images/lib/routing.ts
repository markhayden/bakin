import type { PluginContext } from '@bakin/core/plugin-types'
import type { ImagePluginSettings, ImageProviderId, ImageProviderReadiness } from '../types'
import { effectiveImageSettings, getImageProvider, providerReadiness } from './providers'
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
  /** Predicted serving path for the chosen provider (operator diagnostic). */
  servedBy: 'runtime' | 'shim' | 'unconfigured'
  fallbackRoutes: Array<{ provider: ImageProviderId; model: string }>
}


function parseRoute(route: string): { provider: ImageProviderId; model: string } | null {
  const [provider, ...modelParts] = route.split('/')
  const model = modelParts.join('/')
  if (provider && model) return { provider, model }
  return null
}

function defaultModel(provider: ImageProviderId, readiness: ImageProviderReadiness[] = []): string {
  const runtimeDefault = readiness.find(candidate => candidate.id === provider)?.defaultModel
  if (runtimeDefault) return runtimeDefault
  if (provider === 'openai') return 'gpt-image-2'
  if (provider === 'google') return 'gemini-3.1-flash-image-preview'
  return readiness.find(candidate => candidate.id === provider)?.models[0]?.id ?? ''
}

function providerForModel(model: string, readiness: ImageProviderReadiness[] = []): ImageProviderId | null {
  for (const providerId of new Set([
    ...['openai', 'google'],
    ...readiness.map(provider => provider.id),
  ])) {
    const provider = getImageProvider(providerId)
    if (provider?.models.some(candidate => candidate.id === model)) return providerId
    const runtime = readiness.find(candidate => candidate.id === providerId)
    if (runtime?.models.some(candidate => candidate.id === model)) return providerId
  }
  return null
}

function normalizeRequestedRoute(
  provider: ImageProviderId | 'auto' | undefined,
  model: string | undefined,
  readiness: ImageProviderReadiness[],
): { provider: ImageProviderId; model: string } | null {
  if (provider && provider !== 'auto') {
    const explicit = model ? parseRoute(model) : null
    return explicit ?? { provider, model: model ?? defaultModel(provider, readiness) }
  }
  if (!model) return null
  const explicit = parseRoute(model)
  if (explicit) return explicit
  const inferredProvider = providerForModel(model, readiness)
  return inferredProvider ? { provider: inferredProvider, model } : null
}

/**
 * Match keywords on a word-start boundary so substrings don't misfire — e.g.
 * a plain `includes('text')` matched "context"/"subtext" and biased unrelated
 * briefs toward OpenAI. The leading `\b` still lets a stem match inflections
 * ("photo" → "photography").
 */
function mentionsAny(text: string, words: string[]): boolean {
  return words.some(word => new RegExp(`\\b${word}`).test(text))
}

function objectiveBias(objective: string | undefined): ImageProviderId | null {
  const text = (objective || '').toLowerCase()
  if (mentionsAny(text, ['ctr', 'carousel', 'text', 'typography'])) return 'openai'
  if (mentionsAny(text, ['brand', 'landing', 'email', 'photo'])) return 'google'
  return null
}

/**
 * Resolve a concrete provider/model route from readiness, settings, and an
 * optional request. Shared by `recommendImageRoute` (the recommend tool) and
 * `generateImage` so the recommendation can never diverge from what generation
 * actually picks. Returns null when no route can be determined.
 */
export function resolveImageRoute(
  readiness: ImageProviderReadiness[],
  effective: Required<ImagePluginSettings>,
  request: { provider?: ImageProviderId | 'auto'; model?: string; objective?: string } = {},
): { provider: ImageProviderId; model: string } | null {
  const requested = normalizeRequestedRoute(request.provider, request.model, readiness)
  if (requested) return requested
  if (request.model) return null // explicit model that can't be resolved

  if (effective.defaultProvider !== 'auto') {
    return { provider: effective.defaultProvider, model: defaultModel(effective.defaultProvider, readiness) }
  }

  const configuredFallbacks = effective.fallbackOrder
    .map(parseRoute)
    .filter((route): route is { provider: ImageProviderId; model: string } => Boolean(route))
  const readyProviderIds = new Set(readiness.filter(provider => provider.routable).map(provider => provider.id))
  const routableFallbacks = configuredFallbacks.filter(route => readyProviderIds.has(route.provider))
  const biased = objectiveBias(request.objective)
  return (biased ? routableFallbacks.find(route => route.provider === biased) : null)
    ?? routableFallbacks[0]
    ?? configuredFallbacks[0]
    ?? null
}

export async function recommendImageRoute(ctx: PluginContext, request: ImageRouteRequest = {}): Promise<ImageRouteRecommendation | { ok: false; error: string }> {
  const effective = effectiveImageSettings(ctx)
  const profile = getImageProfile(request.surface || effective.defaultSurface)
  if (!profile) return { ok: false, error: `Unknown image surface: ${request.surface || effective.defaultSurface}` }

  const readiness = await providerReadiness(ctx)
  const readyProviderIds = new Set(readiness.filter(provider => provider.routable).map(provider => provider.id))
  const fallbackRoutes = effective.fallbackOrder
    .map(parseRoute)
    .filter((route): route is { provider: ImageProviderId; model: string } => Boolean(route))
    .filter(route => readyProviderIds.has(route.provider))

  const chosen = resolveImageRoute(readiness, effective, {
    provider: request.provider,
    model: request.model,
    objective: request.objective,
  })
  if (!chosen) {
    if (request.model) return { ok: false, error: `Unknown image model: ${request.model}` }
    return { ok: false, error: 'No image provider route is configured.' }
  }
  const provider = getImageProvider(chosen.provider)
  const readyProvider = readiness.find(candidate => candidate.id === chosen.provider)
  const model = provider?.models.find(candidate => candidate.id === chosen.model)
    ?? readyProvider?.models.find(candidate => candidate.id === chosen.model)
  if (!model || (!provider && !readyProvider)) return { ok: false, error: `Unknown image model: ${chosen.provider}/${chosen.model}` }

  const configured = readyProviderIds.has(chosen.provider)
  const label = provider?.label ?? readyProvider?.label ?? chosen.provider
  const servedBy = readyProvider?.servedBy ?? (configured ? 'runtime' : 'unconfigured')
  const baseReason = configured
    ? `${label} ${model.label} is configured and fits ${profile.label}.`
    : `${label} ${model.label} is the preferred route for ${profile.label}, but credentials are not configured yet.`
  const reason = servedBy === 'shim'
    ? `${baseReason} This route will be served by the direct shim using a Bakin-side key, not the runtime.`
    : baseReason

  return {
    ok: true,
    surface: profile.id,
    width: profile.width,
    height: profile.height,
    provider: chosen.provider,
    model: chosen.model,
    quality: request.quality ?? effective.quality,
    reason,
    servedBy,
    fallbackRoutes,
  }
}
