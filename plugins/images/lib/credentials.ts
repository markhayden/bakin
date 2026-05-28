import type { PluginContext } from '@bakin/core/plugin-types'
import type { NativeImageProviderId } from '../types'

interface RuntimeProviderConfig {
  apiKey?: unknown
  env?: Record<string, unknown>
}

export interface RuntimeConfig {
  models?: {
    providers?: Record<string, RuntimeProviderConfig>
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function envApiKey(provider: NativeImageProviderId): string | null {
  if (provider === 'openai') return process.env.OPENAI_API_KEY || null
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || null
}

/** Extract a provider API key from already-loaded runtime config (no I/O). */
export function apiKeyFromConfig(provider: NativeImageProviderId, config: RuntimeConfig | null): string | null {
  if (!config) return null
  if (provider === 'openai') {
    const openai = config.models?.providers?.openai
    return stringValue(openai?.apiKey) || stringValue(openai?.env?.OPENAI_API_KEY)
  }
  const google = config.models?.providers?.google
  return (
    stringValue(google?.apiKey)
    || stringValue(google?.env?.GEMINI_API_KEY)
    || stringValue(google?.env?.GOOGLE_AI_API_KEY)
  )
}

/** Load the raw runtime config once; callers can pass it to apiKeyFromConfig. */
export async function loadRuntimeConfig(ctx: PluginContext): Promise<RuntimeConfig | null> {
  try {
    return await ctx.runtime.config.get<RuntimeConfig>()
  } catch {
    return null
  }
}

/** Resolve a key from env or a pre-loaded config, with no further I/O. */
export function resolveImageApiKeyFrom(provider: NativeImageProviderId, config: RuntimeConfig | null): string | null {
  return envApiKey(provider) ?? apiKeyFromConfig(provider, config)
}

export async function resolveImageApiKey(ctx: PluginContext, provider: NativeImageProviderId): Promise<string | null> {
  const env = envApiKey(provider)
  if (env) return env
  return apiKeyFromConfig(provider, await loadRuntimeConfig(ctx))
}
