/**
 * Search MCP tools — agent-facing search capabilities.
 * System-level tools (stay in scripts, not plugin-specific).
 */
import { z } from 'zod'
import { addExecTool } from './registry'
import { crossTableSearch, reindexContentTypes, getSearchHealth, getContentTypes } from '../../src/core/search-registry'
import * as antfly from '../../src/core/antfly'

// ---------------------------------------------------------------------------
// bakin_exec_search_query — cross-table or single-table search
// ---------------------------------------------------------------------------

addExecTool({
  name: 'bakin_exec_search_query',
  label: 'Search',
  description: 'Search across all Bakin content (tasks, assets, projects, workflows, schedules, agents) or a specific table. Returns ranked results with scores.',
  source: 'core',
  parameters: {
    q: z.string().describe('Search query text'),
    table: z.string().optional().describe('Limit to a specific table (tasks, assets, projects, workflows, schedule, team, audit). Omit for cross-table search.'),
    limit: z.number().optional().describe('Maximum results to return (default: 20)'),
    offset: z.number().optional().describe('Skip this many results (for pagination)'),
  },
  handler: async (params) => {
    const q = params.q as string
    if (!q) return { ok: false, error: 'Missing q parameter' }
    const result = await crossTableSearch(q, {
      table: params.table as string | undefined,
      limit: params.limit as number | undefined,
      offset: params.offset as number | undefined,
    })
    return { ok: true, ...result }
  },
})

// ---------------------------------------------------------------------------
// bakin_exec_search_table — search a specific table with facets
// ---------------------------------------------------------------------------

addExecTool({
  name: 'bakin_exec_search_table',
  label: 'Search table',
  description: 'Search a specific Bakin table with facet filtering. Returns results plus facet counts for filtering.',
  source: 'core',
  parameters: {
    table: z.string().describe('Table to search (tasks, assets, projects, workflows, schedule, team, audit)'),
    q: z.string().describe('Search query text'),
    facets: z.string().optional().describe('Comma-separated facet fields to include counts for (e.g., "status,agent")'),
    limit: z.number().optional().describe('Maximum results (default: 20)'),
  },
  handler: async (params) => {
    const table = params.table as string
    const q = params.q as string
    if (!table || !q) return { ok: false, error: 'Missing table or q parameter' }
    const result = await crossTableSearch(q, {
      table,
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
  description: 'Look up a specific indexed document by its key and table.',
  source: 'core',
  parameters: {
    table: z.string().describe('Table name (tasks, assets, projects, etc.)'),
    key: z.string().describe('Document key to look up'),
  },
  handler: async (params) => {
    const table = `bakin_${params.table}`
    const key = params.key as string
    if (!key) return { ok: false, error: 'Missing key parameter' }
    const stats = await antfly.getTableStats(table)
    if (!stats) return { ok: false, error: `Table ${table} not found or Antfly disabled` }
    // Use a targeted query to find the specific document
    const result = await antfly.queryTable(table, key, { limit: 1 })
    const doc = result.results.find(r => r.id === key)
    return doc ? { ok: true, document: doc } : { ok: false, error: 'Document not found' }
  },
})

// ---------------------------------------------------------------------------
// bakin_exec_search_facets — get facet counts without a query
// ---------------------------------------------------------------------------

addExecTool({
  name: 'bakin_exec_search_facets',
  label: 'Search facets',
  description: 'Get facet value counts for a table. Useful for understanding data distribution (e.g., how many tasks per status).',
  source: 'core',
  parameters: {
    table: z.string().describe('Table name (tasks, assets, projects, etc.)'),
    facets: z.string().describe('Comma-separated facet fields (e.g., "status,agent")'),
  },
  handler: async (params) => {
    const table = params.table as string
    const facetFields = (params.facets as string)?.split(',').filter(Boolean)
    if (!table || !facetFields?.length) return { ok: false, error: 'Missing table or facets parameter' }
    // Use a wildcard query to get all facet counts
    const result = await crossTableSearch('*', {
      table,
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
  description: 'Find documents similar to a given text description. Uses semantic (vector) search for meaning-based matching.',
  source: 'core',
  parameters: {
    text: z.string().describe('Text to find similar documents for'),
    table: z.string().optional().describe('Limit to a specific table (optional)'),
    limit: z.number().optional().describe('Maximum results (default: 10)'),
  },
  handler: async (params) => {
    const text = params.text as string
    if (!text) return { ok: false, error: 'Missing text parameter' }
    const result = await crossTableSearch(text, {
      table: params.table as string | undefined,
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
  description: 'Trigger a full reindex of all content types (or a specific table). Use after bulk data changes.',
  source: 'core',
  parameters: {
    table: z.string().optional().describe('Specific table to reindex (optional — omit for all)'),
    rebuild: z.boolean().optional().describe('Drop and recreate indexes before reindexing (default: false)'),
    verify: z.boolean().optional().describe('Re-query tables after reindex to verify doc counts (default: false)'),
  },
  handler: async (params) => {
    const results = await reindexContentTypes({
      table: params.table as string | undefined,
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
    const health = await getSearchHealth()
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
