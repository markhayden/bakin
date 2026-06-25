/**
 * Search Registry — the stable public surface for plugin content-type
 * registration, table provisioning, the plugin-scoped SearchAPI, reindex/health,
 * and cross-table search.
 *
 * The implementation is split across four modules; this barrel re-exports them
 * so `@/core/search-registry` (and `mock.module` on it) keeps working unchanged:
 *   - search-registry-core  — globalThis state, provisioning, resolvers, mappers
 *   - search-plugin-api     — buildSearchAPI + the startup-reconcile drain
 *   - search-reindex        — reindexContentTypes + getSearchHealth
 *   - search-query          — crossTableSearch
 */
export * from './search-registry-core'
export * from './search-plugin-api'
export * from './search-reindex'
export * from './search-query'
