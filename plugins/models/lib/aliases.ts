/**
 * Model alias helpers.
 *
 * P2.3: aliases arrive as a plain name → target record from the runtime's
 * `models.routingPolicy()` (native spellings are flattened by the adapter);
 * `readAliases` normalizes the target ids. `DEFAULT_ALIASES` seeds the
 * prepopulate action on POST /aliases.
 */
import { normalizeModelId } from './model-id'

export const DEFAULT_ALIASES: Record<string, string> = {
  haiku: 'anthropic/claude-haiku-4-5',
  sonnet: 'anthropic/claude-sonnet-4-6',
  opus: 'anthropic/claude-opus-4-6',
}

export function readAliases(aliases: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(aliases).map(([name, target]) => [name, normalizeModelId(target)]),
  )
}
