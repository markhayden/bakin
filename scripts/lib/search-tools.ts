/**
 * Search MCP tools — agent-facing search capabilities.
 * System-level tools (stay in scripts, not plugin-specific).
 *
 * Post-issue-#67: callers pass `plugin: 'tasks'` (plugin id), not a raw
 * table name. Resolution goes through getTableForPlugin so plugins can
 * never leak their `bakin_` table prefix to the MCP surface.
 */
import { z } from 'zod'
import { getAppServices } from '../../src/core/app-services'
import { addExecTool } from './registry'
import {
  crossTableSearch,
  reindexContentTypes,
  getContentTypes,
  getTableForPlugin,
  getIndexNames,
  buildSearchAPI,
} from '../../src/core/search-registry'

/**
 * Resolve a plugin id to its registered bakin_ table name.
 * Returns a discriminated result so callers can short-circuit with a
 * clear error message instead of silently returning zero results.
 */
function resolvePluginTable(pluginId: string): { ok: true; table: string } | { ok: false; error: string } {
  try {
    const table = getTableForPlugin(pluginId)
    if (!table) {
      return {
        ok: false,
        error: `Plugin "${pluginId}" has no registered search content type. Known plugins: ${[
          ...new Set(Array.from(getContentTypes().values()).map(d => d.pluginId)),
        ].join(', ')}`,
      }
    }
    return { ok: true, table }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ---------------------------------------------------------------------------
// bakin_exec_search_query — cross-plugin or single-plugin search
// ---------------------------------------------------------------------------

addExecTool({
  name: 'bakin_exec_search_query',
  label: 'Search',
  description:
    'Search across all Bakin content (tasks, assets, projects, workflows, schedule, team, memory, messaging) or a specific plugin. Returns ranked results with scores.',
  source: 'core',
  parameters: {
    q: z.string().describe('Search query text'),
    plugin: z
      .string()
      .optional()
      .describe(
        'Limit to a specific plugin id (tasks, assets, projects, workflows, schedule, team, memory, messaging). Omit for cross-plugin search.',
      ),
    limit: z.number().optional().describe('Maximum results to return (default: 20)'),
    offset: z.number().optional().describe('Skip this many results (for pagination)'),
  },
  handler: async (params) => {
    const q = params.q as string
    if (!q) return { ok: false, error: 'Missing q parameter' }

    let tableParam: string | undefined
    if (params.plugin) {
      const resolved = resolvePluginTable(params.plugin as string)
      if (!resolved.ok) return { ok: false, error: resolved.error }
      tableParam = resolved.table
    }

    const result = await crossTableSearch(q, {
      table: tableParam,
      limit: params.limit as number | undefined,
      offset: params.offset as number | undefined,
    })
    return { ok: true, ...result }
  },
})

// ---------------------------------------------------------------------------
// bakin_exec_search_table — search a specific plugin with facets
// (name retained for API stability; param is now `plugin`)
// ---------------------------------------------------------------------------

addExecTool({
  name: 'bakin_exec_search_table',
  label: 'Search plugin',
  description:
    'Search a specific Bakin plugin with facet filtering. Returns results plus facet counts for filtering.',
  source: 'core',
  parameters: {
    plugin: z
      .string()
      .describe('Plugin id to search (tasks, assets, projects, workflows, schedule, team, memory, messaging)'),
    q: z.string().describe('Search query text'),
    facets: z
      .string()
      .optional()
      .describe('Comma-separated facet fields to include counts for (e.g., "status,agent")'),
    limit: z.number().optional().describe('Maximum results (default: 20)'),
  },
  handler: async (params) => {
    const pluginId = params.plugin as string
    const q = params.q as string
    if (!pluginId || !q) return { ok: false, error: 'Missing plugin or q parameter' }
    const resolved = resolvePluginTable(pluginId)
    if (!resolved.ok) return { ok: false, error: resolved.error }
    const result = await crossTableSearch(q, {
      table: resolved.table,
      limit: params.limit as number | undefined,
      facets: (params.facets as string)?.split(',').filter(Boolean),
    })
    return { ok: true, ...result }
  },
})

// ---------------------------------------------------------------------------
// bakin_exec_search_lookup — get a specific document by key
// ---------------------------------------------------------------------------

addExecTool({
  name: 'bakin_exec_search_lookup',
  label: 'Search lookup',
  description: 'Look up a specific indexed document by its key and plugin.',
  source: 'core',
  parameters: {
    plugin: z.string().describe('Plugin id (tasks, assets, projects, etc.)'),
    key: z.string().describe('Document key to look up'),
  },
  handler: async (params) => {
    const pluginId = params.plugin as string
    const key = params.key as string
    if (!pluginId || !key) return { ok: false, error: 'Missing plugin or key parameter' }
    const resolved = resolvePluginTable(pluginId)
    if (!resolved.ok) return { ok: false, error: resolved.error }
    const search = getAppServices().search
    const stats = await search.tables.stats(resolved.table)
    if (!stats) return { ok: false, error: `Table ${resolved.table} not found or search adapter unavailable` }
    const result = await search.query(resolved.table, {
      text: key,
      limit: 1,
      adapterOptions: { indexes: getIndexNames(resolved.table) },
    })
    const doc = result.hits.find(r => r.key === key)
    return doc ? { ok: true, document: doc } : { ok: false, error: 'Document not found' }
  },
})

// ---------------------------------------------------------------------------
// bakin_exec_search_facets — get facet counts without a query
// ---------------------------------------------------------------------------

addExecTool({
  name: 'bakin_exec_search_facets',
  label: 'Search facets',
  description:
    'Get facet value counts for a plugin. Useful for understanding data distribution (e.g., how many tasks per status).',
  source: 'core',
  parameters: {
    plugin: z.string().describe('Plugin id (tasks, assets, projects, etc.)'),
    facets: z.string().describe('Comma-separated facet fields (e.g., "status,agent")'),
  },
  handler: async (params) => {
    const pluginId = params.plugin as string
    const facetFields = (params.facets as string)?.split(',').filter(Boolean)
    if (!pluginId || !facetFields?.length) return { ok: false, error: 'Missing plugin or facets parameter' }
    const resolved = resolvePluginTable(pluginId)
    if (!resolved.ok) return { ok: false, error: resolved.error }
    const result = await crossTableSearch('*', {
      table: resolved.table,
      limit: 0,
      facets: facetFields,
    })
    return { ok: true, aggregations: result.aggregations || {} }
  },
})

// ---------------------------------------------------------------------------
// bakin_exec_search_similar — find similar documents
// ---------------------------------------------------------------------------

addExecTool({
  name: 'bakin_exec_search_similar',
  label: 'Find similar',
  description:
    'Find documents similar to a given text description. Uses semantic (vector) search for meaning-based matching.',
  source: 'core',
  parameters: {
    text: z.string().describe('Text to find similar documents for'),
    plugin: z.string().optional().describe('Limit to a specific plugin id (optional)'),
    limit: z.number().optional().describe('Maximum results (default: 10)'),
  },
  handler: async (params) => {
    const text = params.text as string
    if (!text) return { ok: false, error: 'Missing text parameter' }

    let tableParam: string | undefined
    if (params.plugin) {
      const resolved = resolvePluginTable(params.plugin as string)
      if (!resolved.ok) return { ok: false, error: resolved.error }
      tableParam = resolved.table
    }

    const result = await crossTableSearch(text, {
      table: tableParam,
      limit: (params.limit as number) || 10,
    })
    return { ok: true, similar: result.results }
  },
})

// ---------------------------------------------------------------------------
// bakin_exec_search_reindex — trigger reindex
// ---------------------------------------------------------------------------

addExecTool({
  name: 'bakin_exec_search_reindex',
  label: 'Reindex search',
  description:
    'Trigger a full reindex of all content types (or a specific plugin). Use after bulk data changes.',
  source: 'core',
  parameters: {
    plugin: z.string().optional().describe('Specific plugin id to reindex (optional — omit for all)'),
    rebuild: z.boolean().optional().describe('Drop and recreate indexes before reindexing (default: false)'),
    verify: z.boolean().optional().describe('Re-query tables after reindex to verify doc counts (default: false)'),
  },
  handler: async (params) => {
    let tableParam: string | undefined
    if (params.plugin) {
      const resolved = resolvePluginTable(params.plugin as string)
      if (!resolved.ok) return { ok: false, error: resolved.error }
      tableParam = resolved.table
    }

    const results = await reindexContentTypes({
      table: tableParam,
      rebuild: params.rebuild as boolean | undefined,
      verify: params.verify as boolean | undefined,
    })
    const total = results.reduce((sum, r) => sum + r.indexed, 0)
    const errors = results.filter(r => r.error).length
    const enrichmentErrors = results.filter(r => r.enrichment && !r.enrichment.healthy).length
    return { ok: errors === 0 && enrichmentErrors === 0, total, errors, enrichmentErrors, tables: results }
  },
})

// ---------------------------------------------------------------------------
// bakin_exec_search_stats — get search system health/stats
// ---------------------------------------------------------------------------

addExecTool({
  name: 'bakin_exec_search_stats',
  label: 'Search stats',
  description: 'Get search system health: enabled status, per-table document counts, and index stats.',
  source: 'core',
  parameters: {},
  handler: async () => {
    const health = await buildSearchAPI('core', { skipFileBackedWiring: true }).health!()
    const contentTypes = getContentTypes()
    const registered = Array.from(contentTypes.entries()).map(([table, def]) => ({
      table,
      pluginId: def.pluginId,
      facets: def.facets || [],
      searchableFields: def.searchableFields,
      hasChunker: !!def.chunker?.enabled,
    }))
    return { ok: true, ...health, registered }
  },
})
