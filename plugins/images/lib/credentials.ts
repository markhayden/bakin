import type { PluginContext } from '@bakin/core/plugin-types'
import type { ImageProviderId } from '../types'

interface RuntimeProviderConfig {
  apiKey?: unknown
  env?: Record<string, unknown>
}

interface RuntimeConfig {
  models?: {
    providers?: Record<string, RuntimeProviderConfig>
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

export async function resolveImageApiKey(ctx: PluginContext, provider: ImageProviderId): Promise<string | null> {
  if (provider === 'openai') {
    if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY
  } else {
    if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY
    if (process.env.GOOGLE_AI_API_KEY) return process.env.GOOGLE_AI_API_KEY
  }

  try {
    const config = await ctx.runtime.config.get<RuntimeConfig>()
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
  } catch {
    return null
  }
}
