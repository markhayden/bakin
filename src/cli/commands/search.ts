/**
 * `bakin search` / `bakin search:stats` / `bakin reindex` — full-text +
 * semantic search queries, index stats, and reindexing. Relocated verbatim
 * from cli/bakin.ts (B5.3 command-module split).
 */
import { apiGet, apiPost } from '../http'
import { exitUsage } from '../help'
import { renderInkReport } from '../../core/cli/ui/render-report'
import type {
  ReindexResultData,
  SearchAggregationsData,
  SearchMetaData,
  SearchResultData,
} from '../../core/cli/ui/readonly'

async function printSearchResultsTui(query: string, result: Record<string, unknown>): Promise<void> {
  const results = Array.isArray(result.results) ? result.results as SearchResultData[] : []
  const aggregations = result.aggregations && typeof result.aggregations === 'object' && !Array.isArray(result.aggregations)
    ? result.aggregations as SearchAggregationsData
    : undefined
  const meta = result.meta && typeof result.meta === 'object' && !Array.isArray(result.meta)
    ? result.meta as SearchMetaData
    : undefined
  return renderInkReport(() => import('../../core/cli/ui/readonly'), (m) => m.SearchResultsReport, {
    query,
    results,
    aggregations,
    meta,
  })
}

async function printSearchStatsTui(enabled: boolean, tables: Array<Record<string, unknown>>): Promise<void> {
  return renderInkReport(() => import('../../core/cli/ui/readonly'), (m) => m.SearchStatsReport, { enabled, tables })
}

async function printReindexTui(result: ReindexResultData, options: { target: string; rebuild: boolean }): Promise<void> {
  return renderInkReport(() => import('../../core/cli/ui/readonly'), (m) => m.ReindexReport, { result, ...options })
}

async function cmdSearch(query: string, options: { table?: string; limit?: number; agent?: string; facets?: string } = {}): Promise<void> {
  let url = `/api/search?q=${encodeURIComponent(query)}`
  if (options.table) url += `&table=${encodeURIComponent(options.table)}`
  if (options.limit) url += `&limit=${options.limit}`
  if (options.facets) url += `&facets=${encodeURIComponent(options.facets)}`
  const result = await apiGet(url) as {
    results?: Array<{ id?: string; key?: string; score?: number; table?: string; _table?: string; fields?: Record<string, unknown>; document?: Record<string, unknown> }>
    aggregations?: Record<string, Array<{ value: string; count: number }>>
    meta?: { query: string; total: number; took_ms: number; source: string }
  }

  if (process.stdout.isTTY) {
    await printSearchResultsTui(query, result as Record<string, unknown>)
    return
  }

  if (result.meta) {
    console.log(`Search: "${result.meta.query}" — ${result.meta.total} results in ${result.meta.took_ms}ms (${result.meta.source})`)
  }

  if (result.results?.length) {
    for (const r of result.results) {
      const tableName = r.table ?? r._table
      const table = tableName ? ` [${tableName.replace('bakin_', '')}]` : ''
      const doc = r.fields ?? r.document
      const title = doc?.title || doc?.name || r.id || r.key
      console.log(`  ${String(title).slice(0, 100)}${table} (score: ${r.score?.toFixed(3) ?? '?'})`)
    }
  } else {
    console.log('  No results found.')
  }

  if (result.aggregations && Object.keys(result.aggregations).length) {
    console.log('')
    for (const [facet, values] of Object.entries(result.aggregations)) {
      console.log(`  ${facet}: ${values.map(v => `${v.value}(${v.count})`).join(', ')}`)
    }
  }
}

async function cmdSearchStats(): Promise<void> {
  const result = await apiGet('/api/plugins/health/search-status') as {
    enabled: boolean
    tables: Array<{
      table: string
      pluginId: string
      stats: Record<string, unknown> | null
      indexHealth?: Array<{ name: string; error?: string; walBacklog: number; rebuilding: boolean }>
      healthy?: boolean
    }>
  }
  if (process.stdout.isTTY) {
    await printSearchStatsTui(result.enabled, result.tables as Array<Record<string, unknown>>)
    return
  }
  console.log(`Search: ${result.enabled ? 'enabled' : 'disabled'}`)
  if (result.tables?.length) {
    for (const t of result.tables) {
      const docs = (t.stats as any)?.num_docs ?? '?'
      const healthTag = t.healthy === false ? ' [unhealthy]'
        : t.indexHealth?.some(i => i.walBacklog > 0) ? ' [enriching]'
        : ''
      console.log(`  ${t.table} (${t.pluginId}): ${docs} docs${healthTag}`)
      if (t.healthy === false && t.indexHealth) {
        for (const idx of t.indexHealth) {
          if (idx.error) console.log(`    ${idx.name}: ERROR — ${idx.error}`)
        }
      }
    }
  }
}

async function cmdReindex(options: { table?: string; rebuild?: boolean } = {}): Promise<void> {
  // Pre-flight: reindexing with models missing "works" (documents land in
  // the tables) while every semantic query stays dead — a silently confusing
  // state. Name it before doing the work, at the moment it matters. Goes
  // through the onboarding component so the ACTIVE settings decide which
  // models are required (custom embedders in, disabled reranker out) —
  // hardcoding the adapter with default settings warned wrongly in both
  // directions.
  try {
    const { searchModelsComponent } = await import('../../core/onboarding/search-models')
    const modelsCheck = await searchModelsComponent.check()
    if (modelsCheck && modelsCheck.status !== 'ok') {
      console.log('WARNING: search models are missing — this reindex will populate tables, but semantic search stays dead until `bakin install search-models` runs (then reindex again).')
    }
  } catch {
    // Pre-flight is advisory only — never block a reindex on it.
  }

  let url = '/api/reindex'
  const params: string[] = []
  if (options.table) params.push(`table=${encodeURIComponent(options.table)}`)
  if (options.rebuild) params.push('rebuild=true')
  if (params.length) url += `?${params.join('&')}`

  const target = options.table || 'all content'
  if (!process.stdout.isTTY) {
    console.log(`Reindexing ${target} into search${options.rebuild ? ' (rebuild indexes)' : ''}...`)
  }
  const result = await apiPost(url) as ReindexResultData & {
    ok: boolean
    total: number
    errors: number
    enrichmentErrors?: number
    tables: Array<{
      table: string
      indexed: number
      error?: string
      enrichment?: { healthy: boolean; indexes: Array<{ name: string; error?: string; walBacklog: number }> }
    }>
  }
  if (process.stdout.isTTY) {
    await printReindexTui(result, { target, rebuild: options.rebuild === true })
    return
  }
  if (result.tables?.length) {
    for (const t of result.tables) {
      if (t.error) {
        console.log(`  ${t.table}: ERROR — ${t.error}`)
      } else {
        const enrichTag = t.enrichment
          ? t.enrichment.healthy ? '' : ' [enrichment unhealthy]'
          : ''
        console.log(`  ${t.table}: ${t.indexed} documents${enrichTag}`)
      }
    }
  }
  console.log(`Done. ${result.total} total documents indexed.`)
  if ((result.enrichmentErrors ?? 0) > 0) {
    console.log(`WARNING: ${result.enrichmentErrors} table(s) have enrichment errors — check health page for details.`)
  }
}

export async function run(args: string[]): Promise<void> {
  const cmd = args[0]
  if (cmd === 'search:stats') {
    await cmdSearchStats()
    return
  }
  if (cmd === 'reindex') {
    const reindexOpts: { table?: string; rebuild?: boolean } = {}
    for (let i = 1; i < args.length; i++) {
      if (args[i].startsWith('--table=')) reindexOpts.table = args[i].split('=')[1]
      else if (args[i] === '--table' && args[i + 1]) reindexOpts.table = args[++i]
      else if (args[i] === '--rebuild') reindexOpts.rebuild = true
    }
    await cmdReindex(reindexOpts)
    return
  }
  const searchOpts: { table?: string; limit?: number; agent?: string; facets?: string } = {}
  const queryParts: string[] = []
  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith('--table=')) searchOpts.table = args[i].split('=')[1]
    else if (args[i] === '--table' && args[i + 1]) searchOpts.table = args[++i]
    else if (args[i].startsWith('--agent=')) searchOpts.agent = args[i].split('=')[1]
    else if (args[i] === '--agent' && args[i + 1]) searchOpts.agent = args[++i]
    else if (args[i].startsWith('--limit=')) searchOpts.limit = Number(args[i].split('=')[1])
    else if (args[i] === '--limit' && args[i + 1]) searchOpts.limit = Number(args[++i])
    else if (args[i].startsWith('--facets=')) searchOpts.facets = args[i].split('=')[1]
    else if (args[i] === '--facets' && args[i + 1]) searchOpts.facets = args[++i]
    else queryParts.push(args[i])
  }
  if (!queryParts.length) await exitUsage('bakin search <query> [--table=tasks] [--limit=10] [--facets=status,agent]')
  await cmdSearch(queryParts.join(' '), searchOpts)
}
