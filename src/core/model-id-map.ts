/**
 * Map a model id onto a catalog — the ONE catalog-MIGRATION rule shared by
 * dead-selection proposals ("same id under a credentialed provider") and the
 * runtime switch's roster carry. Leaf module (no imports) so every consumer
 * can reach it without a cycle.
 *
 * This is a PROPOSAL rule, never a verdict: whether a runtime would RUN a
 * non-verbatim id is the adapter's own resolution (`models.resolveId`, used
 * by the eligibility engine and the dispatch gate) — not this shape match.
 *
 *   1. exact id match → as-is
 *   2. UNIQUE bare-model match (`anything/<model>` present exactly once) →
 *      the catalog's qualified id (a provider rename between catalogs,
 *      `openai/gpt-5.5` ↔ `openai-codex/gpt-5.5`).
 *   3. otherwise null — reported, never guessed.
 */
export function mapModelToCatalog(sourceModel: string, targetCatalog: readonly string[]): string | null {
  if (targetCatalog.includes(sourceModel)) return sourceModel
  const bare = sourceModel.includes('/') ? sourceModel.slice(sourceModel.indexOf('/') + 1) : sourceModel
  const matches = targetCatalog.filter((id) => id === bare || id.endsWith(`/${bare}`))
  return matches.length === 1 ? matches[0]! : null
}
