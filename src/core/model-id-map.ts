/**
 * Map a model id onto a catalog — the ONE resolution rule shared by the
 * eligibility engine, the dispatch gate, dead-selection proposals and the
 * runtime switch's roster carry. Leaf module (no imports) so every consumer
 * can reach it without a cycle.
 *
 *   1. exact id match → as-is
 *   2. UNIQUE bare-model match (`anything/<model>` present exactly once) →
 *      the catalog's qualified id. Covers both a bare id the runtime accepts
 *      (Pi resolves `gpt-5.5` itself) and a provider rename between catalogs
 *      (`openai/gpt-5.5` ↔ `openai-codex/gpt-5.5`).
 *   3. otherwise null — reported, never guessed.
 */
export function mapModelToCatalog(sourceModel: string, targetCatalog: readonly string[]): string | null {
  if (targetCatalog.includes(sourceModel)) return sourceModel
  const bare = sourceModel.includes('/') ? sourceModel.slice(sourceModel.indexOf('/') + 1) : sourceModel
  const matches = targetCatalog.filter((id) => id === bare || id.endsWith(`/${bare}`))
  return matches.length === 1 ? matches[0]! : null
}
