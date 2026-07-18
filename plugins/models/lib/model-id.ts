/**
 * Pure model-id helpers.
 *
 * Extracted from index.ts. String-derived classification and normalization —
 * no I/O, no ctx. `normalizeModelId` is the shared spelling rule (bare
 * `claude-*` ids get the `anthropic/` prefix) used by config reads, alias
 * resolution, routes, and hooks alike, so it lives in its own leaf module to
 * keep config-io ↔ available-models acyclic.
 */

export function tierFromId(id: string): 'budget' | 'standard' | 'premium' {
  // Small-model markers win over family markers: 'gpt-5.4-mini' is the cheap
  // lane of a premium family — labeling it premium starved the cheap-route
  // recommender on Codex-only runtimes.
  if (id.includes('flash') || id.includes('haiku') || id.includes('mini')) return 'budget'
  if (id.includes('gpt-5') || id.includes('opus') || id.includes('pro')) return 'premium'
  if (id.includes('sonnet')) return 'standard'
  return 'budget'
}

export function normalizeModelId(id: string): string {
  if (id.includes('/')) return id
  return id.startsWith('claude-') ? `anthropic/${id}` : id
}

export function providerFromId(id: string): string {
  return id.split('/')[0] || 'other'
}
