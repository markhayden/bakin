/**
 * `bakin search` / `bakin search:stats` / `bakin reindex` — full-text +
 * semantic search queries, index stats, and reindexing. Relocated verbatim
 * from cli/bakin.ts (B5.3 command-module split).
 */
import { apiGet, apiPost } from '../http'
import { confirmPrompt, exitUsage } from '../help'
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

async function printSearchStatsTui(snapshot: {
  enabled: boolean
  engineReachable?: boolean
  outbox?: { pending: number; quarantined: number }
  tables: Array<Record<string, unknown>>
}): Promise<void> {
  return renderInkReport(() => import('../../core/cli/ui/readonly'), (m) => m.SearchStatsReport, snapshot)
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
  // Shape = SearchHealthSnapshot (getSearchHealth); the old num_docs/
  // walBacklog fields never existed on this route and printed "? docs".
  const result = await apiGet('/api/plugins/health/search-status') as {
    enabled: boolean
    engineReachable?: boolean
    outbox?: { pending: number; quarantined: number; oldestPendingAt: number | null }
    tables: Array<{
      logical: string
      pluginId: string
      docCount: number | null
      lastIndexedAt: number | null
      journalPending: number
      state: 'active' | 'migrating'
      phase: string | null
      legs: Array<{ name: string; totalIndexed: number; rebuilding: boolean; pending?: number; error?: string }>
      healthy: boolean
    }>
  }
  if (process.stdout.isTTY) {
    await printSearchStatsTui({
      enabled: result.enabled,
      engineReachable: result.engineReachable,
      outbox: result.outbox,
      tables: result.tables as unknown as Array<Record<string, unknown>>,
    })
    return
  }
  // "disabled" (a setting) and "unreachable" (an outage) demand different
  // fixes — the old conflated header sent a Margo's-box recovery down the
  // wrong path entirely (2026-07-21).
  const reachable = result.engineReachable !== false
  console.log(`Search: ${result.enabled ? (reachable ? 'enabled' : 'enabled — engine UNREACHABLE') : 'disabled'}`)
  if (result.outbox) {
    console.log(`Journal: ${result.outbox.pending} pending · ${result.outbox.quarantined} quarantined`)
  }
  const ago = (ms: number | null): string => {
    if (ms === null) return 'never'
    const s = Math.max(0, Math.floor((Date.now() - ms) / 1000))
    if (s < 60) return `${s}s ago`
    if (s < 3600) return `${Math.floor(s / 60)}m ago`
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`
    return `${Math.floor(s / 86400)}d ago`
  }
  for (const t of result.tables ?? []) {
    const backlog = t.legs.reduce((sum, leg) => sum + (leg.pending ?? 0), 0)
    const tags = [
      t.healthy === false ? '[unhealthy]' : '',
      t.state === 'migrating' ? `[migrating${t.phase ? `: ${t.phase}` : ''}]` : '',
      t.journalPending > 0 ? `[${t.journalPending} queued]` : '',
      backlog > 0 ? `[${backlog} embedding]` : '',
    ].filter(Boolean).join(' ')
    console.log(`  ${t.logical} (${t.pluginId}): ${t.docCount ?? '?'} docs · indexed ${ago(t.lastIndexedAt)}${tags ? ` ${tags}` : ''}`)
    for (const leg of t.legs) {
      if (leg.error) console.log(`    ${leg.name}: ERROR — ${leg.error}`)
    }
  }
}

async function cmdReindex(options: { table?: string; rebuild?: boolean; force?: boolean } = {}): Promise<void> {
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
  const params: string[] = ['async=1']
  if (options.table) params.push(`table=${encodeURIComponent(options.table)}`)
  if (options.rebuild) params.push('rebuild=true')
  // Default is REPAIR (resume parked, regenerate engine-missing, skip
  // healthy); --force mints fresh generations for every targeted table.
  if (options.force) params.push('force=1')
  url += `?${params.join('&')}`

  const target = options.table || 'all content'
  if (!process.stdout.isTTY) {
    console.log(`Reindexing ${target} into search${options.rebuild ? ' (rebuild indexes)' : ''}...`)
  }
  // 202-job flow: the server no longer holds the socket across a
  // multi-minute blue/green pass (the old sync request had NO timeout and
  // NO progress — a long rebuild was indistinguishable from a hang). We
  // poll /api/reindex/status and narrate elapsed time. An older
  // not-yet-restarted server ignores ?async=1 and answers 200 with the
  // final result directly — handle both shapes.
  type ReindexResult = ReindexResultData & {
    ok: boolean
    total?: number
    errors: number
    parked?: number
    tables: Array<import('../../core/search-registry-core').ReindexTableOutcome>
  }
  const kicked = await apiPost(url) as { job?: { id: string; state: string } } & Partial<ReindexResult>
  let result: ReindexResult
  if (kicked.job) {
    const startedAt = Date.now()
    let lastNote = 0
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 2_000))
      const { job } = await apiGet('/api/reindex/status') as {
        job: { state: 'running' | 'done' | 'failed'; error?: string } & Partial<ReindexResult>
      }
      if (job.state === 'failed') {
        console.error(`Reindex failed: ${job.error ?? 'unknown error'}`)
        process.exit(1)
      }
      if (job.state === 'done') {
        result = {
          ok: job.ok ?? false,
          total: job.total,
          errors: job.errors ?? 0,
          parked: job.parked,
          tables: job.tables ?? [],
        }
        break
      }
      const elapsed = Math.round((Date.now() - startedAt) / 1000)
      // A quiet line every ~15s so a long pass reads as progress, not a hang.
      if (elapsed - lastNote >= 15) {
        lastNote = elapsed
        console.log(`  still rebuilding (${elapsed}s) — queries keep answering from the current tables`)
      }
    }
  } else {
    result = kicked as ReindexResult
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
        const parkedTag = t.result === 'parked' ? ' [PARKED — green never converged; doctor resumes it]' : ''
        console.log(`  ${t.table}: ${t.indexed ?? 0} documents${parkedTag}`)
      }
    }
  }
  console.log(typeof result.total === 'number' ? `Done. ${result.total} total documents indexed.` : 'Done.')
  if ((result.parked ?? 0) > 0) {
    console.log(`WARNING: ${result.parked} table(s) parked mid-migration — queries keep answering from the old table; run \`bakin doctor\` to resume.`)
  }
}

/**
 * `bakin search:reset` — stop the engine, wipe its derived index data,
 * start clean, repair-reindex everything from source. The one-command
 * version of the eight-step manual recovery from 2026-07-21. Derived
 * data only: content and models are untouched. Gated on an explicit
 * confirmation (--yes for non-interactive runs).
 */
async function cmdSearchReset(options: { yes: boolean }): Promise<void> {
  if (!options.yes) {
    const confirmed = await confirmPrompt(
      'This stops the search engine, wipes its derived index data, and rebuilds every table from source.\nContent and models are untouched; search degrades until the rebuild converges. Continue?',
    )
    if (!confirmed) {
      console.log('Aborted. (Use --yes to skip this prompt.)')
      return
    }
  }
  console.log('Resetting the search engine (stop → wipe derived data → clean start → repair reindex)...')
  const result = await apiPost('/api/search/reset') as {
    ok: boolean
    message: string
    job: { id: string; state: string } | null
  }
  if (!result.ok) {
    console.error(`Reset failed: ${result.message}`)
    process.exit(1)
  }
  console.log(result.message)
  console.log('Rebuild is running in the background — following it now (safe to Ctrl-C; `bakin search:stats` shows progress).')
  const startedAt = Date.now()
  let lastNote = 0
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    const { job } = await apiGet('/api/reindex/status') as {
      job: { state: 'running' | 'done' | 'failed'; error?: string; total?: number; errors?: number; parked?: number }
    }
    if (job.state === 'failed') {
      console.error(`Rebuild failed: ${job.error ?? 'unknown error'}`)
      process.exit(1)
    }
    if (job.state === 'done') {
      console.log(`Done. ${job.total ?? 0} documents reindexed${(job.errors ?? 0) > 0 ? `, ${job.errors} table errors` : ''}${(job.parked ?? 0) > 0 ? `, ${job.parked} parked (doctor resumes them)` : ''}.`)
      if ((job.errors ?? 0) > 0 || (job.parked ?? 0) > 0) process.exit(1)
      return
    }
    const elapsed = Math.round((Date.now() - startedAt) / 1000)
    if (elapsed - lastNote >= 15) {
      lastNote = elapsed
      console.log(`  still rebuilding (${elapsed}s)...`)
    }
  }
}

export async function run(args: string[]): Promise<void> {
  const cmd = args[0]
  if (cmd === 'search:stats') {
    await cmdSearchStats()
    return
  }
  if (cmd === 'search:reset') {
    await cmdSearchReset({ yes: args.includes('--yes') || args.includes('-y') })
    return
  }
  if (cmd === 'reindex') {
    const reindexOpts: { table?: string; rebuild?: boolean; force?: boolean } = {}
    for (let i = 1; i < args.length; i++) {
      if (args[i].startsWith('--table=')) reindexOpts.table = args[i].split('=')[1]
      else if (args[i] === '--table' && args[i + 1]) reindexOpts.table = args[++i]
      else if (args[i] === '--rebuild') reindexOpts.rebuild = true
      else if (args[i] === '--force') reindexOpts.force = true
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
