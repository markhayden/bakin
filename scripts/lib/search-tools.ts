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
    q: { type: 'string', description: 'Search query text', required: true },
    table: { type: 'string', description: 'Limit to a specific table (tasks, assets, projects, workflows, schedule, team, audit). Omit for cross-table search.' },
    limit: { type: 'number', description: 'Maximum results to return (default: 20)' },
    offset: { type: 'number', description: 'Skip this many results (for pagination)' },
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
    table: { type: 'string', description: 'Table to search (tasks, assets, projects, workflows, schedule, team, audit)', required: true },
    q: { type: 'string', description: 'Search query text', required: true },
    facets: { type: 'string', description: 'Comma-separated facet fields to include counts for (e.g., "status,agent")' },
    limit: { type: 'number', description: 'Maximum results (default: 20)' },
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
    table: { type: 'string', description: 'Table name (tasks, assets, projects, etc.)', required: true },
    key: { type: 'string', description: 'Document key to look up', required: true },
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
    table: { type: 'string', description: 'Table name (tasks, assets, projects, etc.)', required: true },
    facets: { type: 'string', description: 'Comma-separated facet fields (e.g., "status,agent")', required: true },
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
    text: { type: 'string', description: 'Text to find similar documents for', required: true },
    table: { type: 'string', description: 'Limit to a specific table (optional)' },
    limit: { type: 'number', description: 'Maximum results (default: 10)' },
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
    table: { type: 'string', description: 'Specific table to reindex (optional — omit for all)' },
    rebuild: { type: 'boolean', description: 'Drop and recreate indexes before reindexing (default: false)' },
  },
  handler: async (params) => {
    const results = await reindexContentTypes({
      table: params.table as string | undefined,
      rebuild: params.rebuild as boolean | undefined,
    })
    const total = results.reduce((sum, r) => sum + r.indexed, 0)
    return { ok: true, total, tables: results }
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
