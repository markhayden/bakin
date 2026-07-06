/**
 * Shared direct-provider key resolution for Bakin-owned LLM transports
 * (direct-vision-provider, direct-text-provider). Extracted from the vision
 * transport when the text sibling arrived (#189).
 *
 * Resolution order is env → secret store — an env var always overrides the
 * stored value, matching every other provider secret in the codebase.
 */
import { getStoredProviderKey } from '../media/secret-store'

export type DirectProviderId = 'openai' | 'google' | 'anthropic'

export const PROVIDER_ENV_VARS: Record<DirectProviderId, string[]> = {
  openai: ['OPENAI_API_KEY'],
  google: ['GEMINI_API_KEY', 'GOOGLE_AI_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY'],
}

/** Env override → secret store, same precedence as every provider secret. */
export function resolveProviderKeySource(
  provider: DirectProviderId,
): { apiKey: string; source: 'env' | 'store' } | null {
  for (const envVar of PROVIDER_ENV_VARS[provider]) {
    const value = process.env[envVar]?.trim()
    if (value) return { apiKey: value, source: 'env' }
  }
  const stored = getStoredProviderKey(provider)
  if (stored) return { apiKey: stored, source: 'store' }
  return null
}
