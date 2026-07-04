'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePluginEvent } from "@makinbakin/sdk/hooks"
import { Card, CardHeader, CardTitle, CardContent } from "@makinbakin/sdk/ui"
import { Button } from "@makinbakin/sdk/ui"
import { CircleCheck, Clock, AlertCircle, RotateCw } from 'lucide-react'
import type { SearchHealthData, SearchTelemetryData } from '../types'

const REINDEX_POLL_MS = 2_500
const REINDEX_CONVERGE_TIMEOUT_MS = 120_000
const SEARCH_POLL_MS = 10_000

/**
 * Self-contained search-health section: polls /search-status + /search-telemetry
 * independently of the rest of the page (a failed load simply hides this card,
 * as before), drives blue/green reindexes, and tracks per-table rebuild progress
 * from the shell's single SSE connection. `refreshNonce` re-triggers on the
 * header Refresh button.
 */
export function SearchSection({ refreshNonce }: { refreshNonce: number }) {
  const [searchHealth, setSearchHealth] = useState<SearchHealthData | null>(null)
  const [searchTelemetry, setSearchTelemetry] = useState<SearchTelemetryData | null>(null)

  // Which reindex is currently running: null = none, 'all' = every table, or a
  // specific table name. Stays set through the BACKEND embedding convergence, not
  // just the HTTP round-trip (see triggerReindex / #582).
  const [reindexScope, setReindexScope] = useState<string | null>(null)
  // Per-table reindex progress, fed by the shell's single SSE connection.
  const [reindexProgress, setReindexProgress] = useState<Record<string, { indexed: number; done: boolean }>>({})
  const clearReindexProgress = useCallback(() => setReindexProgress({}), [])
  usePluginEvent('search.rebuild.start', (d) => setReindexProgress((p) => ({ ...p, [d.table as string]: { indexed: 0, done: false } })))
  usePluginEvent('search.rebuild.progress', (d) => setReindexProgress((p) => ({ ...p, [d.table as string]: { indexed: (d.indexed as number) ?? 0, done: false } })))
  usePluginEvent('search.rebuild.complete', (d) => setReindexProgress((p) => ({ ...p, [d.table as string]: { indexed: (d.indexed as number) ?? 0, done: true } })))

  // Lightweight poll of just the search-status endpoint — cheap enough to call
  // every couple seconds while a reindex converges.
  const fetchSearchStatus = useCallback(async () => {
    const res = await fetch('/api/plugins/health/search-status')
    return await res.json()
  }, [])

  const loadSearch = useCallback(async () => {
    try {
      const searchJson = await fetchSearchStatus()
      setSearchHealth(searchJson)
    } catch { /* search endpoint optional — keep the card hidden on fault */ }
    try {
      const telemetryRes = await fetch('/api/plugins/health/search-telemetry')
      setSearchTelemetry(await telemetryRes.json())
    } catch { /* telemetry optional */ }
  }, [fetchSearchStatus])

  useEffect(() => {
    loadSearch()
    const interval = setInterval(loadSearch, SEARCH_POLL_MS)
    return () => clearInterval(interval)
  }, [loadSearch, refreshNonce])

  // Trigger a blue/green rebuild of one table (by logical name) or all, then
  // keep tracking until the pointer flips and every leg converges — the POST
  // returns when the rebuild is INITIATED; the backfill continues behind it
  // while queries keep answering from the old physical. Gives up the live
  // spinner after a timeout and lets the migration finish in the background.
  const triggerReindex = useCallback(async (table?: string) => {
    const scope = table ?? 'all'
    setReindexScope(scope)
    clearReindexProgress()
    try {
      await fetch(`/api/reindex${table ? `?table=${encodeURIComponent(table)}` : ''}`, { method: 'POST' })
      const deadline = Date.now() + REINDEX_CONVERGE_TIMEOUT_MS
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, REINDEX_POLL_MS))
        let snap: SearchHealthData | null = null
        try { snap = await fetchSearchStatus() as SearchHealthData } catch { continue }
        if (!snap || !Array.isArray(snap.tables)) continue
        setSearchHealth(snap)
        const targets = snap.tables.filter((t) => scope === 'all' || t.logical === scope)
        const converged = targets.length > 0 && targets.every((t) =>
          t.state === 'active' && t.legs.every((i) => !i.rebuilding && !i.error))
        if (converged) break
      }
    } finally {
      setReindexScope(null)
      loadSearch()
    }
  }, [clearReindexProgress, fetchSearchStatus, loadSearch])

  // A table's embedding indexes have finished backfilling + catching up.
  const tableConverged = useCallback((t: { state: 'active' | 'migrating'; legs: Array<{ rebuilding: boolean; error?: string }> }) =>
    t.state === 'active' && t.legs.every((i) => !i.rebuilding && !i.error), [])

  if (!searchHealth) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            Search
          </span>
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${
              searchHealth.enabled
                ? 'bg-emerald-500/10 text-emerald-500'
                : 'bg-muted text-muted-foreground'
            }`}>
              {searchHealth.enabled ? 'Connected' : 'Disabled'}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={!searchHealth.enabled || reindexScope !== null}
              onClick={() => triggerReindex()}
            >
              {reindexScope === 'all' ? 'Reindexing all…' : reindexScope ? 'Reindexing…' : 'Reindex All'}
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground mb-3">
          Rebuilds run blue/green — a fresh table backfills in the background and search stays available throughout.
          {searchHealth.outbox && (searchHealth.outbox.pending > 0 || searchHealth.outbox.quarantined > 0) && (
            <span className="ml-2">
              Journal: {searchHealth.outbox.pending} pending
              {searchHealth.outbox.quarantined > 0 && <span className="text-red-400"> · {searchHealth.outbox.quarantined} quarantined</span>}
            </span>
          )}
        </p>
        {searchTelemetry?.windows?.['1h'] && searchTelemetry.outbox && (
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">Queries (1h)</p>
              <p className="text-lg font-semibold tabular-nums">
                {searchTelemetry.windows['1h'].query.count}
                {searchTelemetry.windows['1h'].query.errors > 0 && (
                  <span className="text-sm text-red-400 ml-1">· {searchTelemetry.windows['1h'].query.errors} err</span>
                )}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {searchTelemetry.windows['1h'].query.medianMs != null ? `median ${Math.round(searchTelemetry.windows['1h'].query.medianMs)}ms` : 'no traffic'}
              </p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">Journal drains (1h)</p>
              <p className="text-lg font-semibold tabular-nums">
                {searchTelemetry.windows['1h'].drain.count}
                {searchTelemetry.outbox.quarantined > 0 && (
                  <span className="text-sm text-red-400 ml-1">· {searchTelemetry.outbox.quarantined} quarantined</span>
                )}
              </p>
              <p className="text-[10px] text-muted-foreground">{searchTelemetry.outbox.pending} pending</p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">Enrichment</p>
              <p className="text-lg font-semibold tabular-nums">
                {searchTelemetry.enrichment?.coverage
                  ? `${searchTelemetry.enrichment.coverage.enriched}/${searchTelemetry.enrichment.coverage.total}`
                  : searchTelemetry.windows['1h'].enrich.count}
                {searchTelemetry.windows['1h'].enrich.errors > 0 && (
                  <span className="text-sm text-red-400 ml-1">· {searchTelemetry.windows['1h'].enrich.errors} err</span>
                )}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {searchTelemetry.enrichment?.coverage
                  ? [
                      searchTelemetry.enrichment.coverage.missing + searchTelemetry.enrichment.coverage.stale > 0
                        ? `${searchTelemetry.enrichment.coverage.missing + searchTelemetry.enrichment.coverage.stale} to enrich`
                        : null,
                      searchTelemetry.enrichment.coverage.skipped > 0 ? `${searchTelemetry.enrichment.coverage.skipped} skipped` : null,
                      searchTelemetry.enrichment.coverage.failed > 0 ? `${searchTelemetry.enrichment.coverage.failed} failed` : null,
                      `${searchTelemetry.enrichment?.depth ?? 0} queued`,
                    ].filter(Boolean).join(' · ')
                  : (searchTelemetry.enrichment?.depth != null ? `${searchTelemetry.enrichment.depth} queued` : 'billed vision calls')}
              </p>
            </div>
          </div>
        )}
        {searchHealth.tables.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tables registered</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {searchHealth.tables.map(t => {
              const progress = reindexProgress[t.logical]
              const writing = progress && !progress.done
              const legError = t.legs.find(i => i.error)?.error
              const migrating = t.state === 'migrating'
              const parked = migrating && t.phase === 'parked'
              // Blue/green convergence: 'done' means the pointer flipped
              // (state active) and every leg finished building.
              const converged = tableConverged(t)
              const isTarget = reindexScope !== null && (reindexScope === 'all' || reindexScope === t.logical)
              const isConverging = (isTarget && !converged) || (migrating && !parked)
              return (
                <div key={t.logical} className={`rounded-lg border p-3 transition-colors ${parked ? 'border-red-500/50 bg-red-500/5' : isConverging ? 'border-amber-500/50 bg-amber-500/5' : (isTarget && converged) ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-border'}`}>
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">{t.pluginId} <span className="opacity-60">v{t.schemaVersion}</span></p>
                    <div className="flex items-center gap-1">
                      {legError ? (
                        <span title={legError}>
                          <AlertCircle className="h-3.5 w-3.5 text-red-400" />
                        </span>
                      ) : isConverging ? (
                        <span title={migrating ? `migrating: ${t.phase ?? 'running'}` : 'Embedding / catching up'}>
                          <Clock className="h-3.5 w-3.5 text-amber-400" />
                        </span>
                      ) : parked ? (
                        <span title="Migration parked — repair from the doctor panel">
                          <AlertCircle className="h-3.5 w-3.5 text-red-400" />
                        </span>
                      ) : (
                        <CircleCheck className="h-3.5 w-3.5 text-emerald-400" />
                      )}
                      <button
                        type="button"
                        title={`Rebuild ${t.logical} (search stays available)`}
                        disabled={!searchHealth.enabled || reindexScope !== null}
                        onClick={() => triggerReindex(t.logical)}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:hover:text-muted-foreground"
                      >
                        <RotateCw className={`h-3.5 w-3.5 ${isConverging ? 'animate-spin text-amber-400' : ''}`} />
                      </button>
                    </div>
                  </div>
                  <p className={`text-lg font-semibold tabular-nums ${isConverging ? 'text-amber-400' : (isTarget && converged) ? 'text-emerald-400' : ''}`}>
                    {writing ? `${progress.indexed}…` : (t.docCount ?? '—')}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {parked
                      ? 'migration parked'
                      : migrating
                        ? `migrating: ${t.phase ?? 'running'}`
                        : isConverging
                          ? (writing ? 'writing…' : 'catching up…')
                          : t.logical}
                  </p>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
