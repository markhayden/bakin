/**
 * Search Registry — singleton that manages plugin content type registrations
 * and provides SearchAPI instances for each plugin.
 *
 * Uses globalThis to survive Next.js webpack re-evaluation.
 */
import type {
  SearchAPI,
  SearchContentTypeDefinition,
  SearchQueryParams,
  SearchResponse,
  SearchTransformOp,
} from '../../packages/core/src/plugin-types'
import * as antfly from './antfly'
import { createLogger } from './logger'
import { getSettings } from './settings'

const log = createLogger('search-registry')

// ---------------------------------------------------------------------------
// Registry singleton (globalThis-backed)
// ---------------------------------------------------------------------------
interface RegistryState {
  /** Map of full table name → content type definition */
  contentTypes: Map<string, SearchContentTypeDefinition & { pluginId: string }>
  /** Map of pluginId → full table name */
  pluginTables: Map<string, string>
  /** Whether tables have been created during this startup */
  tablesCreated: boolean
}

const _g = globalThis as typeof globalThis & {
  __bakinSearchRegistry?: RegistryState
}

function getRegistry(): RegistryState {
  if (!_g.__bakinSearchRegistry) {
    _g.__bakinSearchRegistry = {
      contentTypes: new Map(),
      pluginTables: new Map(),
      tablesCreated: false,
    }
  }
  return _g.__bakinSearchRegistry
}

// ---------------------------------------------------------------------------
// Table name resolution
// ---------------------------------------------------------------------------
const TABLE_PREFIX = 'bakin_'

function fullTableName(table: string): string {
  return table.startsWith(TABLE_PREFIX) ? table : `${TABLE_PREFIX}${table}`
}

// ---------------------------------------------------------------------------
// Table creation from schema
// ---------------------------------------------------------------------------

function schemaFieldToAntflyType(field: SearchContentTypeDefinition['schema'][string]): string[] {
  switch (field.type) {
    case 'text': return ['text']
    case 'keyword': return ['keyword']
    case 'number': return ['keyword'] // stored as keyword for filtering
    case 'boolean': return ['keyword']
    case 'datetime': return ['keyword']
    case 'array': return ['keyword']
    default: return ['keyword']
  }
}

function buildAntflySchema(def: SearchContentTypeDefinition): { default_type: string; document_schemas: Record<string, { schema: Record<string, unknown> }> } {
  const properties: Record<string, unknown> = {}
  for (const [fieldName, fieldDef] of Object.entries(def.schema)) {
    properties[fieldName] = {
      type: 'string',
      'x-antfly-types': schemaFieldToAntflyType(fieldDef),
    }
  }

  return {
    default_type: def.table,
    document_schemas: {
      [def.table]: {
        schema: {
          type: 'object',
          properties,
          'x-antfly-include-in-all': def.searchableFields,
        },
      },
    },
  }
}

function buildAntflyIndexes(def: SearchContentTypeDefinition): Record<string, Record<string, unknown>> {
  const settings = getSettings()
  const indexes: Record<string, Record<string, unknown>> = {
    search: {
      name: 'search',
      type: 'full_text',
    },
    embeddings: {
      name: 'embeddings',
      type: 'embeddings',
      template: def.embeddingTemplate,
      embedder: {
        provider: settings.antfly.embedder.provider,
        model: settings.antfly.embedder.model,
      },
    },
  }

  if (def.chunker?.enabled) {
    indexes.embeddings.chunk_size = def.chunker.targetTokens ?? settings.antfly.chunking.defaultTargetTokens
    indexes.embeddings.chunk_overlap = def.chunker.overlapTokens ?? settings.antfly.chunking.defaultOverlapTokens
  }

  return indexes
}

async function ensureTable(def: SearchContentTypeDefinition): Promise<void> {
  const tableName = fullTableName(def.table)
  const created = await antfly.createTable(tableName, {
    description: `Bakin ${def.table} — auto-created by search registry`,
    schema: buildAntflySchema(def),
    indexes: buildAntflyIndexes(def),
    num_shards: 1,
  })
  if (created) {
    log.info(`Search table created: ${tableName}`)
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create tables for all registered content types.
 * Called during server startup after all plugins have activated.
 */
export async function createRegisteredTables(): Promise<void> {
  const registry = getRegistry()
  if (registry.tablesCreated) return
  if (!antfly.enabled()) {
    registry.tablesCreated = true
    return
  }

  for (const [, def] of registry.contentTypes) {
    try {
      await ensureTable(def)
    } catch (err) {
      log.error(`Failed to create table for ${def.table}`, err)
    }
  }

  registry.tablesCreated = true
  log.info(`Search tables ready: ${registry.contentTypes.size} content types`)
}

/**
 * Get all registered content types (for reindex, health, etc.).
 */
export function getContentTypes(): Map<string, SearchContentTypeDefinition & { pluginId: string }> {
  return getRegistry().contentTypes
}

/**
 * Get the full table name for a plugin.
 */
export function getPluginTable(pluginId: string): string | undefined {
  return getRegistry().pluginTables.get(pluginId)
}

/**
 * Build a SearchAPI instance scoped to a specific plugin.
 * This is what gets injected as ctx.search in PluginContext.
 */
export function buildSearchAPI(pluginId: string): SearchAPI {
  const registry = getRegistry()

  return {
    registerContentType(def: SearchContentTypeDefinition): void {
      const tableName = fullTableName(def.table)
      registry.contentTypes.set(tableName, { ...def, pluginId })
      registry.pluginTables.set(pluginId, tableName)
      log.info(`Content type registered: ${tableName} (plugin: ${pluginId})`)
    },

    async index(key: string, doc: Record<string, unknown>): Promise<void> {
      const tableName = registry.pluginTables.get(pluginId)
      if (!tableName) {
        log.warn(`Plugin ${pluginId} called search.index() but has no registered content type`)
        return
      }
      await antfly.indexDocument(tableName, key, doc)
    },

    async remove(key: string): Promise<void> {
      const tableName = registry.pluginTables.get(pluginId)
      if (!tableName) return
      await antfly.removeDocument(tableName, key)
    },

    async transform(key: string, operations: SearchTransformOp[]): Promise<void> {
      const tableName = registry.pluginTables.get(pluginId)
      if (!tableName) return

      // Build a flat field update from transform ops
      const fields: Record<string, unknown> = {}
      for (const op of operations) {
        if (op.op === '$set' && op.field) {
          fields[op.field] = op.value
        }
        // $inc and $push would need server-side support — for now, treat as $set
        if (op.op === '$inc' && op.field) {
          fields[op.field] = op.value
        }
        if (op.op === '$push' && op.field) {
          fields[op.field] = op.value
        }
      }
      await antfly.transformDocument(tableName, key, fields)
    },

    async query(params: SearchQueryParams): Promise<SearchResponse> {
      const tableName = registry.pluginTables.get(pluginId)
      if (!tableName || !antfly.enabled()) {
        return {
          results: [],
          meta: { query: params.q, total: 0, took_ms: 0, source: 'fallback' },
        }
      }

      // Build aggregations from facets
      const aggregations: Record<string, unknown> | undefined = params.facets?.length
        ? Object.fromEntries(
            params.facets.map(f => [f, { type: 'terms', field: f, size: 50 }])
          )
        : undefined

      const result = await antfly.queryTable(tableName, params.q, {
        limit: params.limit,
        offset: params.offset,
        filters: params.filters,
        aggregations,
      })

      // Map aggregation results to our format
      let mappedAggs: Record<string, Array<{ value: string; count: number }>> | undefined
      if (result.aggregations) {
        mappedAggs = {}
        for (const [key, agg] of Object.entries(result.aggregations)) {
          const aggObj = agg as { buckets?: Array<{ key: string; doc_count: number }> }
          if (aggObj?.buckets) {
            mappedAggs[key] = aggObj.buckets.map(b => ({
              value: String(b.key),
              count: b.doc_count,
            }))
          }
        }
      }

      return {
        results: result.results,
        aggregations: mappedAggs,
        meta: {
          query: params.q,
          total: result.total,
          took_ms: result.took,
          source: 'antfly',
        },
      }
    },
  }
}

/**
 * Reset the registry (for testing).
 */
export function resetSearchRegistry(): void {
  _g.__bakinSearchRegistry = undefined
}
