/**
 * Pure function that maps an embedder ref ('default', 'visual', or a custom
 * name) to the concrete provider+model config in settings. Used by the search
 * registry when creating per-index embedders so plugins can declare which
 * embedder each of their indexes should use without knowing anything about
 * settings.json layout.
 *
 * Keep this pure — no globalThis, no logging, no filesystem access. The
 * caller passes settings in. This makes it trivially testable and avoids
 * order-of-initialization problems with the Antfly client.
 */
import type { BakinSettings } from '../../packages/core/src/settings'

export interface EmbedderConfig {
  provider: string
  model: string
}

/**
 * Resolve a ref to a concrete embedder config. Throws on unknown refs with
 * a message listing the available refs so the caller can correct the
 * mistake quickly.
 */
export function resolveEmbedder(ref: string, settings: BakinSettings): EmbedderConfig {
  const embedders = settings.antfly.embedders
  const match = embedders[ref]
  if (!match) {
    const available = Object.keys(embedders).join(', ')
    throw new Error(`Unknown embedder ref "${ref}". Available refs: ${available}`)
  }
  return { provider: match.provider, model: match.model }
}

/**
 * Stable hash of the whole embedders map. Used by the Antfly client to
 * detect config changes that require index rebuilds. The hash includes
 * every configured embedder so changing *any* embedder triggers a rebuild,
 * not just the default one.
 */
export function embeddersHash(settings: BakinSettings): string {
  const entries = Object.entries(settings.antfly.embedders)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, cfg]) => `${name}:${cfg.provider}:${cfg.model}`)
  return entries.join('|')
}
