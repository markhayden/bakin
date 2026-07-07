/**
 * Runtime auth-profile shape normalization, shared by the onboarding LLM
 * check and the models plugin's billing-lane detection (cost-control v2).
 *
 * Runtime adapters expose several auth-profile shapes for
 * `agents.<id>.authProfiles`:
 *   1. Bare array:   [{ provider, apiKey }]                (imitation crab)
 *   2. Object+array: { profiles: [{ provider }] }          (docker setup)
 *   3. Object+dict:  { profiles: { key: { provider } } }
 * All normalize into a flat array of entry objects.
 *
 * Credential-field semantics: `apiKey`/`api_key` mean a metered (pay-per-use)
 * key; `token`/`access`/`refresh` are OAuth artifacts, i.e. a subscription
 * login. An entry can carry both — a key present wins (it is what the
 * provider bills).
 */

/** Any field whose presence makes an entry a usable LLM credential. */
export const LLM_CREDENTIAL_FIELDS = ['apiKey', 'api_key', 'token', 'access', 'refresh'] as const
/** Fields that indicate pay-per-use API-key billing. */
export const METERED_CREDENTIAL_FIELDS = ['apiKey', 'api_key'] as const
/** Fields that indicate OAuth / subscription-login billing. */
export const SUBSCRIPTION_CREDENTIAL_FIELDS = ['token', 'access', 'refresh'] as const

/** Flatten any of the three known auth-profile shapes into entry objects. */
export function normalizeAuthProfileEntries(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed
  if (parsed !== null && typeof parsed === 'object') {
    const inner = (parsed as Record<string, unknown>).profiles
    if (Array.isArray(inner)) return inner
    if (inner !== null && typeof inner === 'object') return Object.values(inner as Record<string, unknown>)
  }
  return []
}

/** The entry's provider id, independent of whether credentials are usable. */
export function authProfileEntryProvider(entry: unknown): string | null {
  if (entry === null || typeof entry !== 'object') return null
  const provider = (entry as Record<string, unknown>).provider
  return typeof provider === 'string' && provider.trim().length > 0 ? provider : null
}

/** True when the entry carries a non-empty string in any of `fields`. */
export function authProfileEntryHasField(entry: unknown, fields: readonly string[]): boolean {
  if (entry === null || typeof entry !== 'object') return false
  const obj = entry as Record<string, unknown>
  return fields.some((field) => typeof obj[field] === 'string' && (obj[field] as string).trim().length > 0)
}
