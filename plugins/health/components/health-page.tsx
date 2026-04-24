'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useContentStore } from "@bakin/sdk/hooks"
import { useQueryState } from "@bakin/sdk/hooks"
import { Card, CardHeader, CardTitle, CardContent } from "@bakin/sdk/ui"
import { Badge } from "@bakin/sdk/ui"
import { Button } from "@bakin/sdk/ui"
import { Input } from "@bakin/sdk/ui"
import { Skeleton } from "@bakin/sdk/ui"
import { PluginHeader } from "@bakin/sdk/components"
import { UnderlineTabs } from "@bakin/sdk/components"
import { ExternalLink, Search, CircleCheck, Clock, AlertCircle } from 'lucide-react'

const USAGE_TABS = [
  { id: 'tools', label: 'Tool Usage' },
  { id: 'endpoints', label: 'Endpoint Usage' },
  { id: 'agents', label: 'Agent Usage' },
] as const

interface McpSessionInfo {
  agent: string
  sessions: number
  connectedAt: string
}

interface DiagnosticResult {
  check: string
  status: 'ok' | 'warn' | 'error' | 'fixed'
  message: string
}

interface DoctorData {
  results: DiagnosticResult[]
  summary: { total: number; errors: number; warnings: number }
  cachedAt?: string
}

interface ServerData {
  port: number
  pid: number
  nodeVersion: string
  memoryMB: number
  totalMemoryMB: number
}

interface PluginInfo {
  id: string
  name: string
  version: string
  description: string
  source: 'built-in' | 'user'
  routes: number
}

interface RegistryData {
  plugins: PluginInfo[]
}

interface AgentUsage {
  agent: string
  sessionId: string
  sessionStarted: string
  model: string
  messages: number
  tokens: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    total: number
  }
  cost: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    total: number
  }
}

interface ErrorsByKind {
  total: number
  byKind: { mcp: number; rest: number; agent: number }
}

type UsageKind = 'mcp' | 'rest' | 'agent'

interface UsageEntry {
  ts: string
  kind: UsageKind
  name: string
  agent: string | null
  durationMs: number | null
  status: 'ok' | 'error'
  meta?: Record<string, unknown>
}

interface TopByNameRow {
  name: string
  count: number
  errors: number
  medianDurationMs: number | null
}

interface ByAgentRow {
  agent: string
  count: number
  errors: number
  lastActivity: UsageEntry | null
}

interface UsageFeedData {
  totals: { count: number; errors: number; errorRate: number }
  topByName: TopByNameRow[]
  byAgent: ByAgentRow[]
  recent: UsageEntry[]
}

interface HealthSummary {
  doctor: DoctorData | null
  errors1h: ErrorsByKind | null
  activeSessions: McpSessionInfo[] | null
  upSince: string | null
  openclawPort: number | null
  server: ServerData | null
}

function formatUptime(since: string): string {
  const ms = Date.now() - new Date(since).getTime()
  const secs = Math.floor(ms / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ${secs % 60}s`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ${mins % 60}m`
  const days = Math.floor(hrs / 24)
  return `${days}d ${hrs % 24}h`
}

function formatAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function formatDateShort(date: Date): string {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

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

function extractErrorMessage(entry: UsageEntry): string {
  const meta = entry.meta ?? {}
  if (typeof meta.error === 'string' && meta.error.length > 0) return meta.error
  if (typeof meta.httpStatus === 'number') {
    const method = typeof meta.method === 'string' ? `${meta.method} ` : ''
    return `${method}HTTP ${meta.httpStatus}`
  }
  return 'Error (no detail)'
}

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

function formatActivity(entry: UsageEntry | null): string {
  if (!entry) return 'no activity'
  const ageSec = Math.max(0, Math.round((Date.now() - new Date(entry.ts).getTime()) / 1000))
  if (ageSec >= 30) return `idle ${ageSec}s`
  if (entry.kind === 'mcp') return `calling ${entry.name.replace('bakin_exec_', '')} · ${ageSec}s ago`
  if (entry.kind === 'rest') return `handling ${entry.name} · ${ageSec}s ago`
  return `${entry.name} · ${ageSec}s ago`
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
  const [registry, setRegistry] = useState<RegistryData | null>(null)
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
  const reindexProgress = useContentStore((s) => s.reindexProgress)
  const clearReindexProgress = useContentStore((s) => s.clearReindexProgress)

  // Search state
  const [pluginSearch, setPluginSearch] = useState('')

  // Usage tabs state (URL-backed)
  const [usageTab, setUsageTab] = useQueryState('usage_tab', 'tools')
  const [usageWindow, setUsageWindow] = useQueryState('usage_window', '1h')
  const kindForTab: UsageKind = usageTab === 'endpoints' ? 'rest' : usageTab === 'agents' ? 'agent' : 'mcp'
  const [usageFeed, setUsageFeed] = useState<UsageFeedData | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const [summaryRes, registryRes, usageRes, searchRes, feedRes] = await Promise.all([
        fetch('/api/plugins/health/summary'),
        fetch('/api/plugins/health/registry'),
        fetch('/api/plugins/health/usage'),
        fetch('/api/plugins/health/antfly-status'),
        fetch(`/api/plugins/health/usage-feed?kind=${kindForTab}&window=${usageWindow}`),
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
      setLastRefresh(new Date())
    } catch (err) {
      console.error('Failed to fetch health data:', err)
    } finally {
      setLoading(false)
    }
  }, [kindForTab, usageWindow])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 10_000)
    return () => clearInterval(interval)
  }, [fetchData])

  // Filtered plugins
  const filteredPlugins = useMemo(() => {
    if (!registry) return []
    if (!pluginSearch) return registry.plugins
    const q = pluginSearch.toLowerCase()
    return registry.plugins.filter(p =>
      p.name.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)
    )
  }, [registry, pluginSearch])

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

  const { doctor, server, openclawPort } = data

  const memoryPercent = server?.totalMemoryMB
    ? Math.round((server.memoryMB / server.totalMemoryMB) * 100)
    : null

  const openclawUrl = openclawPort
    ? `${window.location.protocol}//${window.location.hostname}:${openclawPort}`
    : null

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <PluginHeader title="System Health" />
        <div className="flex items-center gap-3">
          {openclawUrl && (
            <a
              href={openclawUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ExternalLink className="size-3" />
              OpenClaw
            </a>
          )}
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

      {/* Search / Antfly Section */}
      {searchHealth && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                Search
                <a href="https://antfly.io" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/5 text-[10px] text-muted-foreground font-normal hover:bg-white/10 hover:text-foreground transition-colors cursor-pointer">
                  <svg width="12" height="12" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M39.2842 28.0677C39.2842 34.2626 34.2623 39.2845 28.0674 39.2845H6.10853C5.37819 39.2845 5.01243 38.4015 5.52886 37.885L11.0896 32.3243H28.0674C30.4183 32.3243 32.324 30.4186 32.324 28.0677V11.0898L37.8847 5.5291C38.4012 5.01267 39.2842 5.37843 39.2842 6.10877V28.0677Z" fill="currentColor"/>
                    <path d="M27.2721 24.5018C27.2698 25.2127 26.4103 25.5671 25.9076 25.0645L21.1775 20.3344C20.8653 20.0223 20.8653 19.5162 21.1775 19.2041L25.9377 14.4438C26.4421 13.9395 27.3044 14.2983 27.3022 15.0116L27.2721 24.5018Z" fill="currentColor"/>
                    <path d="M28.3149 6.96011H11.2167C8.86587 6.96012 6.96011 8.86587 6.9601 11.2167V28.3149L1.39945 33.8755C0.883015 34.392 0 34.0262 0 33.2958V11.2167C4.48304e-06 5.02189 5.02189 9.39218e-06 11.2167 0H33.2958C34.0262 0 34.3919 0.883017 33.8755 1.39945L28.3149 6.96011Z" fill="currentColor"/>
                    <path d="M11.8783 15.1175C11.8806 14.4067 12.7401 14.0522 13.2428 14.5549L17.8625 19.1746C18.1747 19.4867 18.1747 19.9928 17.8625 20.3049L13.2134 24.9541C12.709 25.4584 11.8467 25.0996 11.8489 24.3863L11.8783 15.1175Z" fill="currentColor"/>
                  </svg>
                  Powered by Antfly
                </a>
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
                  const docs = (t.stats as any)?.num_docs ?? 0
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

      {/* Agent Context Usage */}
      {usage.length > 0 && (
        <div className="grid md:grid-cols-2 gap-6">
          {/* Token usage bar chart */}
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

          {/* Cost breakdown table */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Session Cost (est.)</span>
                <Badge variant="secondary" className="font-mono text-xs">
                  ~${usage.reduce((sum, u) => sum + u.cost.total, 0).toFixed(2)} total
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
                  <span className="w-16 text-right">Cost</span>
                </div>
                {usage.map((u) => (
                  <div key={u.agent} className="flex items-center text-sm">
                    <span className="flex-1 font-medium">{u.agent}</span>
                    <span className="w-14 text-right font-mono text-xs text-muted-foreground">
                      {formatTokenCount(u.tokens.input)}
                    </span>
                    <span className="w-14 text-right font-mono text-xs text-muted-foreground">
                      {formatTokenCount(u.tokens.output)}
                    </span>
                    <span className="w-16 text-right font-mono text-xs text-muted-foreground">
                      {formatTokenCount(u.tokens.cacheRead)}
                    </span>
                    <span className="w-16 text-right font-mono text-xs text-muted-foreground">
                      {formatTokenCount(u.tokens.cacheWrite)}
                    </span>
                    <span className="w-16 text-right font-mono text-xs font-medium">
                      ${u.cost.total.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Active Plugins */}
      {registry && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Active Plugins</span>
              <Badge variant="secondary" className="font-mono text-xs">{registry.plugins.length}</Badge>
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
                </div>
                {filteredPlugins.map((p) => (
                  <div key={p.id} className="flex items-center text-sm">
                    <div className="flex-1 min-w-0">
                      <span className="font-medium">{p.name}</span>
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
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

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
              <div className="flex gap-2 text-xs">
                <Badge className={STATUS_STYLES.ok}>
                  {doctor.summary.total - doctor.summary.errors - doctor.summary.warnings} ok
                </Badge>
                {doctor.summary.warnings > 0 && (
                  <Badge className={STATUS_STYLES.warn}>{doctor.summary.warnings} warn</Badge>
                )}
                {doctor.summary.errors > 0 && (
                  <Badge className={STATUS_STYLES.error}>{doctor.summary.errors} error</Badge>
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
