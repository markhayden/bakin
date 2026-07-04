/**
 * Model alias helpers.
 *
 * Extracted from index.ts. Aliases live in the runtime config under
 * `agents.defaults.models` in three spellings (string, `{ alias }` object, or
 * bare key); `readAliases` flattens them to a name → normalized-id record.
 * `DEFAULT_ALIASES` seeds the prepopulate action on POST /aliases.
 */
import type { RuntimeModelConfig } from './config-io'
import { normalizeModelId } from './model-id'

export const DEFAULT_ALIASES: Record<string, string> = {
  haiku: 'anthropic/claude-haiku-4-5',
  sonnet: 'anthropic/claude-sonnet-4-6',
  opus: 'anthropic/claude-opus-4-6',
}

export function readAliases(config: RuntimeModelConfig): Record<string, string> {
  const raw = config.agents.defaults.models
  if (!raw || typeof raw !== 'object') return {}
  const result: Record<string, string> = {}
  for (const [key, val] of Object.entries(raw)) {
    if (typeof val === 'string') {
      result[key] = val
    } else if (val && typeof val === 'object' && 'alias' in val) {
      result[key] = normalizeModelId((val as { alias: string }).alias)
    } else {
      result[key] = normalizeModelId(key)
    }
  }
  return result
}
