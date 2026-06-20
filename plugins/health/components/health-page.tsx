'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { usePluginEvent } from "@makinbakin/sdk/hooks"
import { useQueryState } from "@makinbakin/sdk/hooks"
import { Card, CardHeader, CardTitle, CardContent } from "@makinbakin/sdk/ui"
import { Badge } from "@makinbakin/sdk/ui"
import { Button } from "@makinbakin/sdk/ui"
import { Input } from "@makinbakin/sdk/ui"
import { Skeleton } from "@makinbakin/sdk/ui"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@makinbakin/sdk/ui"
import { PluginHeader } from "@makinbakin/sdk/components"
import { UnderlineTabs } from "@makinbakin/sdk/components"
import { formatAge } from "@makinbakin/sdk/utils"
import { Search, CircleCheck, Clock, AlertCircle, Wrench } from 'lucide-react'
import { RepairDialog } from './repair-dialog'
import type { AgentUsage } from '@makinbakin/sdk/types'
import type {
  PluginInfo,
  RegistryData,
  PluginManifestData,
  UsageKind,
  UsageFeedData,
  HealthSummary,
} from '../types'
import {
  formatUptime,
  formatTokenCount,
  formatRuntimeCost,
  formatDateShort,
  searchStatsDocumentCount,
  extractErrorMessage,
  formatActivity,
} from '../lib/format'

const PLUGIN_CHECK_INTERVAL_MS = 60 * 60 * 1000

const USAGE_TABS = [
  { id: 'tools', label: 'Tool Usage' },
  { id: 'endpoints', label: 'Endpoint Usage' },
  { id: 'agents', label: 'Agent Usage' },
] as const


// ---------------------------------------------------------------------------
// Horizontal bar chart component (pure CSS, no dependencies)
// ---------------------------------------------------------------------------

interface BarItem {
  label: string
  value: number
  sublabel?: string
}

const BAR_COLORS = [
  'bg-blue-500',
  'bg-emerald-500',
  'bg-violet-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-cyan-500',
  'bg-pink-500',
  'bg-teal-500',
]

function HorizontalBars({ items, unit = '' }: { items: BarItem[]; unit?: string }) {
  const max = Math.max(...items.map(i => i.value), 1)

  return (
    <div className="space-y-2.5">
      {items.map((item, i) => (
        <div key={item.label}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-mono text-muted-foreground truncate mr-2">
              {item.label}
            </span>
            <span className="text-xs font-mono font-medium shrink-0">
              {item.value}{unit}
              {item.sublabel && (
                <span className="text-muted-foreground font-normal ml-1.5">{item.sublabel}</span>
              )}
            </span>
          </div>
          <div className="h-2 rounded-full bg-white/5 overflow-hidden">
            <div
              className={`h-full rounded-full ${BAR_COLORS[i % BAR_COLORS.length]} transition-all duration-500`}
              style={{ width: `${(item.value / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inline search input
// ---------------------------------------------------------------------------

function ListSearch({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative mb-3">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || 'Search...'}
        className="pl-8 h-7 text-xs bg-surface border-border"
      />
    </div>
  )
}

const STATUS_STYLES: Record<string, string> = {
  ok: 'bg-green-500/10 text-green-400',
  warn: 'bg-yellow-500/10 text-yellow-400',
  error: 'bg-red-500/10 text-red-400',
  fixed: 'bg-blue-500/10 text-blue-400',
}

// ---------------------------------------------------------------------------
// Usage tab panels
// ---------------------------------------------------------------------------

function UsageBarsPanel({
  feed,
  kind,
  emptyLabel,
  labelTransform,
}: {
  feed: UsageFeedData | null
  kind: UsageKind
  emptyLabel: string
  labelTransform?: (name: string) => string
}) {
  const [expanded, setExpanded] = useState<string | null>(null)

  if (!feed || feed.topByName.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>
  }
  const mostRecent = feed.recent[0]
  const lastLabel = mostRecent
    ? labelTransform ? labelTransform(mostRecent.name) : mostRecent.name
    : null
  const max = Math.max(...feed.topByName.map(r => r.count), 1)

  return (
    <div className="space-y-3">
      <div className="space-y-2.5">
        {feed.topByName.map((row, i) => {
          const label = labelTransform ? labelTransform(row.name) : row.name
          const isExpanded = expanded === row.name
          const hasErrors = row.errors > 0
          const errorEntries = hasErrors
            ? feed.recent.filter(e => e.name === row.name && e.status === 'error')
            : []

          return (
            <div key={row.name}>
              <button
                type="button"
                onClick={() => hasErrors && setExpanded(isExpanded ? null : row.name)}
                disabled={!hasErrors}
                aria-expanded={isExpanded}
                className="w-full text-left group"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-xs font-mono truncate mr-2 ${hasErrors ? 'text-foreground group-hover:text-accent' : 'text-muted-foreground'}`}>
                    {label}
                  </span>
                  <span className="text-xs font-mono font-medium shrink-0">
                    {row.count}
                    <span className={`ml-1.5 font-normal ${hasErrors ? 'text-red-400' : 'text-muted-foreground'}`}>
                      {hasErrors ? `${row.errors} err` : 'ok'}
                      {row.medianDurationMs !== null && ` · ${row.medianDurationMs}ms`}
                    </span>
                  </span>
                </div>
                <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${BAR_COLORS[i % BAR_COLORS.length]} transition-all duration-500`}
                    style={{ width: `${(row.count / max) * 100}%` }}
                  />
                </div>
              </button>

              {isExpanded && errorEntries.length > 0 && (
                <div className="mt-2 ml-2 pl-3 border-l-2 border-red-500/40 space-y-1.5">
                  {errorEntries.map((e, ei) => (
                    <div key={ei} className="text-[11px] font-mono">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <span className="text-red-400">{formatAge(e.ts)}</span>
                        {e.agent && <span>· {e.agent}</span>}
                        {e.durationMs !== null && <span>· {e.durationMs}ms</span>}
                      </div>
                      <div className="text-red-400/90 break-all whitespace-pre-wrap">
                        {extractErrorMessage(e)}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {isExpanded && errorEntries.length === 0 && (
                <p className="mt-2 ml-2 text-[11px] text-muted-foreground italic">
                  Error older than the recent window — details not retained.
                </p>
              )}
            </div>
          )
        })}
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-white/5 text-[11px] text-muted-foreground">
        <span>
          {feed.totals.count} {kind} calls
          {feed.totals.errors > 0 && (
            <span className="ml-1.5 text-red-400">· {feed.totals.errors} errors</span>
          )}
        </span>
        {lastLabel && (
          <span className="truncate ml-2 font-mono">latest: {lastLabel}</span>
        )}
      </div>
    </div>
  )
}

function AgentUsagePanel({ feed }: { feed: UsageFeedData | null }) {
  if (!feed || feed.byAgent.length === 0) {
    return <p className="text-sm text-muted-foreground">No agent activity in this window</p>
  }
  // Filter out heartbeat noise from the count display (still visible in "current activity").
  const rows = feed.byAgent
  return (
    <div className="space-y-1.5">
      <div className="flex items-center text-[10px] text-muted-foreground uppercase tracking-wider pb-1 border-b border-white/5">
        <span className="w-24">Agent</span>
        <span className="flex-1">Current activity</span>
        <span className="w-16 text-right">Events</span>
        <span className="w-14 text-right">Errors</span>
      </div>
      {rows.map((row) => (
        <div key={row.agent} className="flex items-center text-sm">
          <span className="w-24 font-medium truncate">{row.agent}</span>
          <span className="flex-1 font-mono text-xs text-muted-foreground truncate">
            {formatActivity(row.lastActivity)}
          </span>
          <span className="w-16 text-right font-mono">{row.count}</span>
          <span className={`w-14 text-right font-mono ${row.errors > 0 ? 'text-red-400' : 'text-muted-foreground'}`}>
            {row.errors || '—'}
          </span>
        </div>
      ))}
    </div>
  )
}

export function HealthPage() {
  const [data, setData] = useState<HealthSummary | null>(null)
  const [repairOpen, setRepairOpen] = useState(false)
  const [registry, setRegistry] = useState<RegistryData | null>(null)
  const [pluginManifest, setPluginManifest] = useState<PluginManifestData | null>(null)
  const [pluginChecking, setPluginChecking] = useState(false)
  const [pluginUpgradeTarget, setPluginUpgradeTarget] = useState<PluginInfo | null>(null)
  const [pluginUpgrading, setPluginUpgrading] = useState(false)
  const [pluginUpgradeError, setPluginUpgradeError] = useState<string | null>(null)
  const [pluginUpgradeMessage, setPluginUpgradeMessage] = useState<string | null>(null)
  const [pluginConsentPermissions, setPluginConsentPermissions] = useState<string[] | null>(null)
  const [usage, setUsage] = useState<AgentUsage[]>([])
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())
  const [searchHealth, setSearchHealth] = useState<{
    enabled: boolean
    tables: Array<{
      table: string
      pluginId: string
      stats: Record<string, unknown> | null
      indexHealth?: Array<{
        name: string
        type: string
        totalIndexed: number
        walBacklog: number
        error?: string
        rebuilding: boolean
        backfillProgress?: number
      }>
      healthy?: boolean
    }>
  } | null>(null)
  const [reindexing, setReindexing] = useState(false)
  // Per-table reindex progress, fed by the shell's single SSE connection.
  const [reindexProgress, setReindexProgress] = useState<Record<string, { indexed: number; done: boolean }>>({})
  const clearReindexProgress = useCallback(() => setReindexProgress({}), [])
  usePluginEvent('reindex.start', (d) => setReindexProgress((p) => ({ ...p, [d.table as string]: { indexed: 0, done: false } })))
  usePluginEvent('reindex.progress', (d) => setReindexProgress((p) => ({ ...p, [d.table as string]: { indexed: (d.indexed as number) ?? 0, done: false } })))
  usePluginEvent('reindex.complete', (d) => setReindexProgress((p) => ({ ...p, [d.table as string]: { indexed: (d.indexed as number) ?? 0, done: true } })))

  // Search state
  const [pluginSearch, setPluginSearch] = useState('')

  // Usage tabs state (URL-backed)
  const [usageTab, setUsageTab] = useQueryState('usage_tab', 'tools')
  const [usageWindow, setUsageWindow] = useQueryState('usage_window', '1h')
  const kindForTab: UsageKind = usageTab === 'endpoints' ? 'rest' : usageTab === 'agents' ? 'agent' : 'mcp'
  const [usageFeed, setUsageFeed] = useState<UsageFeedData | null>(null)
  const [meteredSpend, setMeteredSpend] = useState<{ totalUsdMicros: number; byAgent: Array<{ agent: string; costUsdMicros: number; runs: number }> } | null>(null)
  const lastPluginCheckRef = useRef(0)

  const fetchPluginManifest = useCallback(async (force = false) => {
    const now = Date.now()
    const shouldCheck = force || lastPluginCheckRef.current === 0 || now - lastPluginCheckRef.current >= PLUGIN_CHECK_INTERVAL_MS
    const path = `/api/plugins/manifest${shouldCheck ? '?check=1' : ''}`
    if (shouldCheck) setPluginChecking(true)
    try {
      const res = await fetch(path)
      const json = await res.json()
      if (json && Array.isArray(json.plugins)) {
        setPluginManifest(json)
        if (shouldCheck) lastPluginCheckRef.current = now
      }
    } catch {
      // Manifest status is optional for Health; keep the registry list visible.
    } finally {
      if (shouldCheck) setPluginChecking(false)
    }
  }, [])

  const fetchData = useCallback(async () => {
    try {
      const [summaryRes, registryRes, usageRes, searchRes, feedRes, spendRes] = await Promise.all([
        fetch('/api/plugins/health/summary'),
        fetch('/api/plugins/health/registry'),
        fetch('/api/plugins/health/usage'),
        fetch('/api/plugins/health/search-status'),
        fetch(`/api/plugins/health/usage-feed?kind=${kindForTab}&window=${usageWindow}`),
        // Cross-plugin + optional: a transport error must not reject the batch
        // and blank the core panels, so swallow it to a null response here.
        fetch('/api/plugins/models/spend?window=24h').catch(() => null),
      ])
      const json = await summaryRes.json()
      setData(json)
      try {
        const regJson = await registryRes.json()
        setRegistry(regJson)
      } catch { /* registry endpoint optional */ }
      try {
        const usageJson = await usageRes.json()
        if (Array.isArray(usageJson)) setUsage(usageJson)
      } catch { /* usage endpoint optional */ }
      try {
        const feedJson = await feedRes.json()
        setUsageFeed(feedJson)
      } catch { /* usage-feed optional */ }
      try {
        const searchJson = await searchRes.json()
        setSearchHealth(searchJson)
      } catch { /* search endpoint optional */ }
      try {
        // Only trust a 2xx body — the /spend error path returns 500 with a
        // {totalUsdMicros:0} shape, which must NOT render as a real $0 card.
        if (spendRes?.ok) {
          const spendJson = await spendRes.json()
          if (spendJson && typeof spendJson.totalUsdMicros === 'number') setMeteredSpend(spendJson)
        }
      } catch { /* models spend optional (plugin may be disabled) */ }
      await fetchPluginManifest(false)
      setLastRefresh(new Date())
    } catch (err) {
      console.error('Failed to fetch health data:', err)
    } finally {
      setLoading(false)
    }
  }, [fetchPluginManifest, kindForTab, usageWindow])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 10_000)
    return () => clearInterval(interval)
  }, [fetchData])

  // Filtered plugins
  const filteredPlugins = useMemo(() => {
    if (!registry) return []
    const manifestById = new Map((pluginManifest?.plugins ?? []).map((plugin) => [plugin.id, plugin]))
    const merged = registry.plugins.map((plugin) => {
      const manifest = manifestById.get(plugin.id)
      if (!manifest) return plugin
      return {
        ...plugin,
        version: manifest.version ?? plugin.version,
        source: manifest.source === 'core' ? 'built-in' as const : 'user' as const,
        installed: manifest.installed,
        latestVersion: manifest.latestVersion,
        upgradeAvailable: manifest.upgradeAvailable,
        staleHintDays: manifest.staleHintDays,
      }
    })
    if (!pluginSearch) return merged
    const q = pluginSearch.toLowerCase()
    return merged.filter(p =>
      p.name.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)
    )
  }, [pluginManifest, registry, pluginSearch])

  const openPluginUpgrade = useCallback((plugin: PluginInfo) => {
    setPluginUpgradeTarget(plugin)
    setPluginUpgradeError(null)
    setPluginUpgradeMessage(null)
    setPluginConsentPermissions(null)
  }, [])

  const runPluginUpgrade = useCallback(async (yes = false) => {
    if (!pluginUpgradeTarget) return
    setPluginUpgrading(true)
    setPluginUpgradeError(null)
    setPluginUpgradeMessage(null)
    try {
      const res = await fetch('/api/plugins/upgrade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pluginId: pluginUpgradeTarget.id, ...(yes ? { yes: true } : {}) }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || body?.ok === false) {
        throw new Error(typeof body?.error === 'string' ? body.error : 'Plugin upgrade failed.')
      }
      if (body?.awaitingConsent) {
        setPluginConsentPermissions(Array.isArray(body.newPermissions) ? body.newPermissions.map(String) : [])
        return
      }
      setPluginConsentPermissions(null)
      setPluginUpgradeMessage(`${pluginUpgradeTarget.name} upgraded.`)
      await fetchPluginManifest(true)
    } catch (err) {
      setPluginUpgradeError(err instanceof Error ? err.message : String(err))
    } finally {
      setPluginUpgrading(false)
    }
  }, [fetchPluginManifest, pluginUpgradeTarget])

  if (loading) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-8 w-24" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="p-6">
        <p className="text-red-400 text-sm">Failed to load health data</p>
      </div>
    )
  }

  const { doctor, server } = data

  const memoryPercent = server?.totalMemoryMB
    ? Math.round((server.memoryMB / server.totalMemoryMB) * 100)
    : null

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <PluginHeader title="System Health" />
        <div className="flex items-center gap-3">
          <span className="text-xs whitespace-nowrap">
            <span className="text-muted-foreground">{formatDateShort(lastRefresh)}</span>
            <span className="text-muted-foreground/60 mx-1.5">·</span>
            <span className="text-muted-foreground/80">{lastRefresh.toLocaleTimeString()}</span>
          </span>
          <Button variant="outline" size="sm" onClick={fetchData}>
            Refresh
          </Button>
        </div>
      </div>

      {/* Top row — summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card size="sm">
          <CardContent className="pt-3">
            <p className="text-xs text-muted-foreground">Uptime</p>
            <p className="text-xl font-mono font-semibold">
              {data.upSince ? formatUptime(data.upSince) : '—'}
            </p>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardContent className="pt-3">
            <p className="text-xs text-muted-foreground">Active Sessions</p>
            <p className="text-xl font-mono font-semibold">
              {data.activeSessions?.length ?? 0}
            </p>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardContent className="pt-3">
            <p className="text-xs text-muted-foreground">Memory</p>
            <p className="text-xl font-mono font-semibold">
              {server ? `${server.memoryMB} MB` : '—'}
            </p>
            {server && memoryPercent !== null && (
              <>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {memoryPercent}% of {(server.totalMemoryMB / 1024).toFixed(0)} GB
                </p>
                <div className="h-1 rounded-full bg-white/5 overflow-hidden mt-1.5">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${memoryPercent > 80 ? 'bg-red-500' : memoryPercent > 60 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                    style={{ width: `${memoryPercent}%` }}
                  />
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card size="sm">
          <CardContent className="pt-3">
            <p className="text-xs text-muted-foreground">Errors (1h)</p>
            {(() => {
              const e = data?.errors1h
              const total = e?.total ?? 0
              const tone = total > 0 ? 'text-red-400' : 'text-emerald-400'
              const bk = e?.byKind ?? { mcp: 0, rest: 0, agent: 0 }
              return (
                <>
                  <p className={`text-xl font-mono font-semibold ${tone}`}>{total}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    mcp: {bk.mcp} · rest: {bk.rest} · agent: {bk.agent}
                  </p>
                </>
              )
            })()}
          </CardContent>
        </Card>
      </div>

      {/* Estimated token usage (runtime-reported) + estimated cost (Bakin's
          figure, what the budget cap gates on), side by side. One is tokens,
          the other dollars — not two competing "cost" numbers. */}
      {(usage.length > 0 || meteredSpend) && (
        <div className={`grid gap-6 ${usage.length > 0 && meteredSpend ? 'md:grid-cols-2' : 'grid-cols-1'}`}>
          {/* Estimated Token Usage — runtime-reported token breakdown (no $). */}
          {usage.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Estimated Token Usage</span>
                  <Badge variant="secondary" className="font-mono text-xs">
                    {formatTokenCount(usage.reduce((sum, u) => sum + (u.tokens.total ?? 0), 0))} tokens
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5">
                  <div className="flex items-center text-[10px] text-muted-foreground uppercase tracking-wider pb-1 border-b border-white/5">
                    <span className="flex-1">Agent</span>
                    <span className="w-14 text-right">In</span>
                    <span className="w-14 text-right">Out</span>
                    <span className="w-16 text-right">Cache R</span>
                    <span className="w-16 text-right">Cache W</span>
                  </div>
                  {usage.map((u) => (
                    <div key={u.agent} className="flex items-center text-sm">
                      <span className="flex-1 font-medium">{u.agent}</span>
                      <span className="w-14 text-right font-mono text-xs text-muted-foreground">{formatTokenCount(u.tokens.input)}</span>
                      <span className="w-14 text-right font-mono text-xs text-muted-foreground">{formatTokenCount(u.tokens.output)}</span>
                      <span className="w-16 text-right font-mono text-xs text-muted-foreground">{formatTokenCount(u.tokens.cacheRead)}</span>
                      <span className="w-16 text-right font-mono text-xs text-muted-foreground">{formatTokenCount(u.tokens.cacheWrite)}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Estimated Cost — Bakin's estimated dollars the budget cap enforces. */}
          {meteredSpend && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Estimated Cost</span>
                  <Badge variant="secondary" className="font-mono text-xs">
                    ~{formatRuntimeCost(meteredSpend.totalUsdMicros / 1_000_000)} / 24h
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-[11px] text-muted-foreground mb-2">Bakin&apos;s estimate (the figure budget caps gate on).</p>
                {meteredSpend.byAgent.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No metered turns in the last 24h.</p>
                ) : (
                  <div className="space-y-1.5">
                    <div className="flex items-center text-[10px] text-muted-foreground uppercase tracking-wider pb-1 border-b border-white/5">
                      <span className="flex-1">Agent</span>
                      <span className="w-16 text-right">Runs</span>
                      <span className="w-20 text-right">Est. cost</span>
                    </div>
                    {[...meteredSpend.byAgent].sort((a, b) => b.costUsdMicros - a.costUsdMicros).map((r) => (
                      <div key={r.agent} className="flex items-center text-sm">
                        <span className="flex-1 font-medium">{r.agent}</span>
                        <span className="w-16 text-right font-mono text-xs text-muted-foreground">{r.runs}</span>
                        <span className={`w-20 text-right font-mono text-xs font-medium ${r.costUsdMicros === 0 ? 'text-muted-foreground' : ''}`}>
                          {r.costUsdMicros === 0 ? '$ n/a' : formatRuntimeCost(r.costUsdMicros / 1_000_000)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Usage — unified tabbed section backed by /api/plugins/health/usage-feed */}
      <Card>
        <CardContent className="pt-4 space-y-4">
          <UnderlineTabs
            tabs={USAGE_TABS}
            value={usageTab}
            onValueChange={setUsageTab}
            rightSlot={
              <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
                {(['5m', '1h', '24h'] as const).map((w) => (
                  <button
                    key={w}
                    onClick={() => setUsageWindow(w)}
                    className={`px-2 py-0.5 text-[11px] font-mono rounded transition-colors ${
                      usageWindow === w
                        ? 'bg-foreground/10 text-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {w}
                  </button>
                ))}
              </div>
            }
          />

          {usageTab === 'tools' && (
            <UsageBarsPanel
              feed={usageFeed}
              kind="mcp"
              emptyLabel="No MCP calls in this window"
              labelTransform={(name) => name.replace('bakin_exec_', '')}
            />
          )}
          {usageTab === 'endpoints' && (
            <UsageBarsPanel
              feed={usageFeed}
              kind="rest"
              emptyLabel="No REST requests in this window"
            />
          )}
          {usageTab === 'agents' && <AgentUsagePanel feed={usageFeed} />}
        </CardContent>
      </Card>

      {/* Context Usage — full width: per-agent token totals (latest session). */}
      {usage.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Context Usage</span>
              <span className="text-xs font-normal text-muted-foreground">latest session per agent</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <HorizontalBars
              items={usage.map((u) => ({
                label: u.agent,
                value: u.tokens.total,
                sublabel: u.sessionStarted ? formatAge(u.sessionStarted) : `${u.messages} msg`,
              }))}
              unit=" tokens"
            />
          </CardContent>
        </Card>
      )}

      {/* Search Section */}
      {searchHealth && (
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
                  disabled={!searchHealth.enabled || reindexing}
                  onClick={async () => {
                    clearReindexProgress()
                    setReindexing(true)
                    try {
                      await fetch('/api/reindex', { method: 'POST' })
                      await fetchData()
                    } finally {
                      setReindexing(false)
                    }
                  }}
                >
                  {reindexing ? 'Reindexing...' : 'Reindex All'}
                </Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {searchHealth.tables.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tables registered</p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {searchHealth.tables.map(t => {
                  const docs = searchStatsDocumentCount(t.stats)
                  const progress = reindexProgress[t.table]
                  const isActive = reindexing && progress && !progress.done
                  const hasEnrichmentError = t.indexHealth?.some(i => i.error)
                  const hasWalBacklog = t.indexHealth?.some(i => i.walBacklog > 0)
                  const enrichmentError = t.indexHealth?.find(i => i.error)?.error
                  return (
                    <div key={t.table} className={`rounded-lg border p-3 transition-colors ${isActive ? 'border-amber-500/50 bg-amber-500/5' : progress?.done ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-border'}`}>
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-muted-foreground">{t.pluginId}</p>
                        {t.indexHealth && (
                          hasEnrichmentError ? (
                            <span title={enrichmentError ?? 'Enrichment error'}>
                              <AlertCircle className="h-3.5 w-3.5 text-red-400" />
                            </span>
                          ) : hasWalBacklog ? (
                            <span title="Enrichment in progress">
                              <Clock className="h-3.5 w-3.5 text-amber-400" />
                            </span>
                          ) : (
                            <CircleCheck className="h-3.5 w-3.5 text-emerald-400" />
                          )
                        )}
                      </div>
                      {isActive ? (
                        <p className="text-lg font-semibold tabular-nums text-amber-400">{progress.indexed}...</p>
                      ) : progress?.done ? (
                        <p className="text-lg font-semibold tabular-nums text-emerald-400">{progress.indexed}</p>
                      ) : (
                        <p className="text-lg font-semibold tabular-nums">{docs}</p>
                      )}
                      <p className="text-[10px] text-muted-foreground">{t.table}</p>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Active Plugins */}
      {registry && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Active Plugins</span>
              <span className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  aria-label="Check plugin updates now"
                  disabled={pluginChecking}
                  onClick={() => fetchPluginManifest(true)}
                >
                  {pluginChecking ? 'Checking...' : 'Check now'}
                </Button>
                <Badge variant="secondary" className="font-mono text-xs">{registry.plugins.length}</Badge>
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ListSearch value={pluginSearch} onChange={setPluginSearch} placeholder="Search plugins..." />
            {filteredPlugins.length === 0 ? (
              <p className="text-sm text-muted-foreground">{pluginSearch ? 'No matching plugins' : 'No plugins loaded'}</p>
            ) : (
              <div className="space-y-1.5">
                <div className="flex items-center text-[10px] text-muted-foreground uppercase tracking-wider pb-1 border-b border-white/5">
                  <span className="flex-1">Plugin</span>
                  <span className="w-16 text-right">Version</span>
                  <span className="w-16 text-right">Source</span>
                  <span className="w-14 text-right">Routes</span>
                  <span className="w-32 text-right">Status</span>
                </div>
                {filteredPlugins.map((p) => (
                  <div
                    key={p.id}
                    className={`flex items-center rounded-md px-2 py-1 text-sm -mx-2 ${p.upgradeAvailable ? 'border border-info/20 bg-info/5' : ''}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="font-medium">{p.name}</span>
                        {p.upgradeAvailable && (
                          <Badge className="shrink-0 text-[10px] px-1.5 bg-info/10 text-info border-info/20">
                            Update available
                          </Badge>
                        )}
                      </div>
                      {p.description && (
                        <p className="text-[11px] text-muted-foreground truncate">{p.description}</p>
                      )}
                    </div>
                    <span className="w-16 text-right font-mono text-xs text-muted-foreground shrink-0">{p.version}</span>
                    <span className="w-16 text-right shrink-0">
                      <Badge variant="secondary" className="text-[10px] px-1.5">
                        {p.source}
                      </Badge>
                    </span>
                    <span className="w-14 text-right font-mono text-xs text-muted-foreground shrink-0">{p.routes}</span>
                    <span className="w-32 shrink-0 text-right">
                      {p.source === 'built-in' ? (
                        <span className="text-[11px] text-muted-foreground">Core</span>
                      ) : p.upgradeAvailable ? (
                        <Button
                          size="xs"
                          variant="outline"
                          className="border-info/30 bg-info/10 text-info hover:bg-info/20"
                          aria-label={`Upgrade ${p.name}`}
                          onClick={() => openPluginUpgrade(p)}
                        >
                          Upgrade
                        </Button>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">Current</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog
        open={Boolean(pluginUpgradeTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setPluginUpgradeTarget(null)
            setPluginUpgradeError(null)
            setPluginUpgradeMessage(null)
            setPluginConsentPermissions(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upgrade {pluginUpgradeTarget?.name}</DialogTitle>
            <DialogDescription>
              Bakin will update this user plugin from its recorded source and reactivate it after the upgrade completes.
            </DialogDescription>
          </DialogHeader>
          {pluginUpgradeTarget && (
            <div className="rounded-md border border-border bg-muted/30 px-3 py-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Current version</p>
                  <p className="mt-1 font-mono text-lg font-semibold text-foreground">{pluginUpgradeTarget.version}</p>
                  <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                    commit {pluginUpgradeTarget.installed?.commitSha ?? 'unknown'}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Available version</p>
                  <p className="mt-1 font-mono text-lg font-semibold text-info">
                    {pluginUpgradeTarget.latestVersion ?? 'latest'}
                  </p>
                  <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                    commit {pluginUpgradeTarget.installed?.remoteHeadSha ?? 'unknown'}
                  </p>
                </div>
              </div>
            </div>
          )}
          {pluginConsentPermissions && (
            <div className="rounded-md border border-warning/20 bg-warning/10 px-3 py-2 text-sm">
              <p className="font-medium text-warning">New permissions requested</p>
              <p className="mt-1 text-xs text-muted-foreground">{pluginConsentPermissions.length ? pluginConsentPermissions.join(', ') : 'Review the updated plugin permissions before continuing.'}</p>
            </div>
          )}
          {pluginUpgradeError && (
            <div className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {pluginUpgradeError}
            </div>
          )}
          {pluginUpgradeMessage && (
            <div className="rounded-md border border-success/20 bg-success/10 px-3 py-2 text-sm text-success">
              {pluginUpgradeMessage}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPluginUpgradeTarget(null)}>
              Close
            </Button>
            {!pluginUpgradeMessage && (
              <Button
                variant={pluginConsentPermissions ? 'warning' : 'default'}
                disabled={pluginUpgrading}
                onClick={() => runPluginUpgrade(Boolean(pluginConsentPermissions))}
              >
                {pluginUpgrading ? 'Upgrading...' : pluginConsentPermissions ? 'Approve and upgrade' : 'Upgrade plugin'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diagnostics */}
      {doctor && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-baseline gap-2">
                <span>Diagnostics</span>
                {doctor.cachedAt && (
                  <span
                    className="text-xs font-normal text-muted-foreground"
                    title={new Date(doctor.cachedAt).toLocaleString()}
                  >
                    ran {formatAge(doctor.cachedAt)}
                  </span>
                )}
              </span>
              <div className="flex items-center gap-2 text-xs">
                <Badge className={STATUS_STYLES.ok}>
                  {doctor.summary.total - doctor.summary.errors - doctor.summary.warnings} ok
                </Badge>
                {doctor.summary.warnings > 0 && (
                  <Badge className={STATUS_STYLES.warn}>{doctor.summary.warnings} warn</Badge>
                )}
                {doctor.summary.errors > 0 && (
                  <Badge className={STATUS_STYLES.error}>{doctor.summary.errors} error</Badge>
                )}
                {doctor.summary.warnings + doctor.summary.errors > 0 && (
                  <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-xs" onClick={() => setRepairOpen(true)}>
                    <Wrench className="size-3" /> Repair…
                  </Button>
                )}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {doctor.results
                .filter((r) => r.status !== 'ok')
                .map((r, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <Badge className={`${STATUS_STYLES[r.status]} shrink-0 text-[10px] px-1.5`}>
                      {r.status}
                    </Badge>
                    <span className="text-muted-foreground">
                      <span className="font-medium text-foreground">{r.check}</span>: {r.message}
                    </span>
                  </div>
                ))}
              {doctor.results.filter((r) => r.status !== 'ok').length === 0 && (
                <p className="text-sm text-muted-foreground">All {doctor.summary.total} checks passed</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <RepairDialog open={repairOpen} onOpenChange={setRepairOpen} onApplied={() => { void fetchData() }} />

      {/* Server info footer */}
      {server && (
        <div className="flex gap-4 text-xs text-muted-foreground">
          <span>Port {server.port}</span>
          <span>PID {server.pid}</span>
          <span>Node {server.nodeVersion}</span>
        </div>
      )}
    </div>
  )
}
