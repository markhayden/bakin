'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useContentStore } from '@/hooks/use-content-store'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PluginHeader } from '@/components/plugin-header'
import { ExternalLink, Search, CircleCheck, Clock, AlertCircle } from 'lucide-react'

interface McpSession {
  agent: string
  sessions: number
  connectedAt: string
  toolCalls: number
}

interface McpData {
  activeSessions: McpSession[]
  toolCallCounts: Record<string, number>
  totalRequests: number
  upSince: string
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

interface EndpointStat {
  endpoint: string
  count: number
  errors: number
  lastCalled: string
}

interface RecentRequest {
  ts: string
  method: string
  path: string
  status: number
  durationMs: number
  agent?: string
}

interface RequestsData {
  totalRequests: number
  totalErrors: number
  upSince: string
  endpoints: EndpointStat[]
  recent: RecentRequest[]
}

interface PluginInfo {
  id: string
  name: string
  version: string
  description: string
  source: 'built-in' | 'user'
  routes: number
}

interface ExecToolStat {
  name: string
  source: string
  calls: number
  errors: number
  lastUsed: string | null
  lastError: string | null
}

interface RegistryData {
  plugins: PluginInfo[]
  execTools: ExecToolStat[]
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

interface McpHealth {
  windowSec: number
  total: number
  errors: number
  successRate: number
  recent: { windowSec: number; total: number; errors: number }
}

interface RestPluginBucket {
  pluginId: string
  total: number
  errors: number
  successRate: number
  perMethod: Record<string, number>
  lastCalled: string | null
}

interface RestHealth {
  windowSec: number
  total: number
  errors: number
  successRate: number
  byPlugin: RestPluginBucket[]
  recent: { windowSec: number; total: number; errors: number; byPlugin: RestPluginBucket[] }
}

interface HealthSummary {
  mcp: McpData | null
  mcpHealth: McpHealth | null
  restHealth: RestHealth | null
  doctor: DoctorData | null
  requests: RequestsData | null
  server: ServerData | null
  openclawPort: number | null
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

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString()
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
// Pagination helper
// ---------------------------------------------------------------------------

const PAGE_SIZE = 20

function PaginationControls({ page, total, onPageChange }: { page: number; total: number; onPageChange: (p: number) => void }) {
  const totalPages = Math.ceil(total / PAGE_SIZE)
  if (totalPages <= 1) return null

  return (
    <div className="flex items-center justify-between pt-3 border-t border-white/5">
      <span className="text-xs text-muted-foreground">
        {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
      </span>
      <div className="flex gap-1">
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" disabled={page === 0} onClick={() => onPageChange(page - 1)}>
          Prev
        </Button>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" disabled={page >= totalPages - 1} onClick={() => onPageChange(page + 1)}>
          Next
        </Button>
      </div>
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
  const [toolSearch, setToolSearch] = useState('')

  // Pagination state
  const [toolPage, setToolPage] = useState(0)
  const [endpointPage, setEndpointPage] = useState(0)
  const [recentPage, setRecentPage] = useState(0)

  const fetchData = useCallback(async () => {
    try {
      const [summaryRes, registryRes, usageRes, searchRes] = await Promise.all([
        fetch('/api/plugins/health/summary'),
        fetch('/api/plugins/health/registry'),
        fetch('/api/plugins/health/usage'),
        fetch('/api/plugins/health/antfly-status'),
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
        const searchJson = await searchRes.json()
        setSearchHealth(searchJson)
      } catch { /* search endpoint optional */ }
      setLastRefresh(new Date())
    } catch (err) {
      console.error('Failed to fetch health data:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 10_000)
    return () => clearInterval(interval)
  }, [fetchData])

  // Filtered + sorted tools
  const filteredTools = useMemo(() => {
    if (!registry) return []
    let tools = registry.execTools
    if (toolSearch) {
      const q = toolSearch.toLowerCase()
      tools = tools.filter(t =>
        t.name.toLowerCase().includes(q) || t.source.toLowerCase().includes(q)
      )
    }
    return [...tools].sort((a, b) => {
      // Sort by lastUsed desc (null at bottom), then calls desc
      if (a.lastUsed && b.lastUsed) return new Date(b.lastUsed).getTime() - new Date(a.lastUsed).getTime()
      if (a.lastUsed && !b.lastUsed) return -1
      if (!a.lastUsed && b.lastUsed) return 1
      return b.calls - a.calls
    })
  }, [registry, toolSearch])

  // Filtered plugins
  const filteredPlugins = useMemo(() => {
    if (!registry) return []
    if (!pluginSearch) return registry.plugins
    const q = pluginSearch.toLowerCase()
    return registry.plugins.filter(p =>
      p.name.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)
    )
  }, [registry, pluginSearch])

  // Reset pages when search changes
  useEffect(() => { setToolPage(0) }, [toolSearch])
  useEffect(() => { setEndpointPage(0) }, [pluginSearch])

  if (loading) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground text-sm">Loading health data...</p>
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

  const { mcp, doctor, requests, server, openclawPort } = data
  const sortedTools = mcp
    ? Object.entries(mcp.toolCallCounts).sort(([, a], [, b]) => b - a)
    : []

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
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card size="sm">
          <CardContent className="pt-3">
            <p className="text-xs text-muted-foreground">Uptime</p>
            <p className="text-xl font-mono font-semibold">
              {requests?.upSince ? formatUptime(requests.upSince) : mcp?.upSince ? formatUptime(mcp.upSince) : '—'}
            </p>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardContent className="pt-3">
            <p className="text-xs text-muted-foreground">API Requests</p>
            <p className="text-xl font-mono font-semibold">
              {requests?.totalRequests ?? 0}
            </p>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardContent className="pt-3">
            <p className="text-xs text-muted-foreground">MCP Health</p>
            {(() => {
              const mh = data?.mcpHealth
              if (!mh || mh.total === 0) {
                return (
                  <>
                    <p className="text-xl font-mono font-semibold text-muted-foreground">—</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">no calls last hour</p>
                  </>
                )
              }
              const pct = Math.round(mh.successRate * 100)
              const tone = pct >= 99
                ? 'text-emerald-400'
                : pct >= 95
                ? 'text-amber-400'
                : 'text-red-400'
              return (
                <>
                  <p className={`text-xl font-mono font-semibold ${tone}`}>{pct}%</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {mh.errors} err / {mh.total} req · 1h
                    {mh.recent.errors > 0 && (
                      <span className="ml-1 text-red-400">
                        · {mh.recent.errors} in last {mh.recent.windowSec}s
                      </span>
                    )}
                  </p>
                </>
              )
            })()}
          </CardContent>
        </Card>

        <Card size="sm">
          <CardContent className="pt-3">
            <p className="text-xs text-muted-foreground">REST Health</p>
            {(() => {
              const rh = data?.restHealth
              if (!rh || rh.total === 0) {
                return (
                  <>
                    <p className="text-xl font-mono font-semibold text-muted-foreground">—</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">no calls last hour</p>
                  </>
                )
              }
              const pct = Math.round(rh.successRate * 100)
              const tone = pct >= 99
                ? 'text-emerald-400'
                : pct >= 95
                ? 'text-amber-400'
                : 'text-red-400'
              return (
                <>
                  <p className={`text-xl font-mono font-semibold ${tone}`}>{pct}%</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {rh.errors} err / {rh.total} req · 1h
                    {rh.recent.errors > 0 && (
                      <span className="ml-1 text-red-400">
                        · {rh.recent.errors} in last {rh.recent.windowSec}s
                      </span>
                    )}
                  </p>
                </>
              )
            })()}
          </CardContent>
        </Card>

        <Card size="sm">
          <CardContent className="pt-3">
            <p className="text-xs text-muted-foreground">Active Sessions</p>
            <p className="text-xl font-mono font-semibold">
              {mcp?.activeSessions.length ?? 0}
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
      </div>

      {/* REST traffic by plugin — agents should be using MCP exec tools,
          not REST. Non-trivial REST traffic here flags bad habits. */}
      {data?.restHealth && data.restHealth.byPlugin.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>REST traffic by plugin (last hour)</span>
              <span className="text-xs font-normal text-muted-foreground">
                Agents should prefer MCP exec tools over REST
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2.5">
              {data.restHealth.byPlugin.map((bucket, i) => {
                const pct = Math.round(bucket.successRate * 100)
                const tone = pct >= 99 ? 'text-emerald-400' : pct >= 95 ? 'text-amber-400' : 'text-red-400'
                const methods = Object.entries(bucket.perMethod)
                  .sort((a, b) => b[1] - a[1])
                  .map(([m, n]) => `${m} ${n}`)
                  .join(' · ')
                return (
                  <div key={bucket.pluginId}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-mono truncate mr-2">{bucket.pluginId}</span>
                      <span className="text-xs font-mono font-medium shrink-0">
                        {bucket.total}
                        <span className={`ml-2 ${tone}`}>{pct}%</span>
                        <span className="text-muted-foreground font-normal ml-2">{methods}</span>
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${BAR_COLORS[i % BAR_COLORS.length]} transition-all duration-500`}
                        style={{ width: `${(bucket.total / Math.max(...data.restHealth!.byPlugin.map(b => b.total), 1)) * 100}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

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
                  className="cursor-pointer"
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

      <div className="grid md:grid-cols-2 gap-6">
        {/* Tool Usage — horizontal bar chart */}
        <Card>
          <CardHeader>
            <CardTitle>Tool Usage</CardTitle>
          </CardHeader>
          <CardContent>
            {sortedTools.length === 0 ? (
              <p className="text-sm text-muted-foreground">No MCP calls yet this session</p>
            ) : (
              <HorizontalBars
                items={sortedTools.map(([tool, count]) => ({
                  label: tool.replace('bakin_', ''),
                  value: count,
                }))}
              />
            )}
          </CardContent>
        </Card>

        {/* Agent Usage — horizontal bar chart */}
        <Card>
          <CardHeader>
            <CardTitle>Agent Usage</CardTitle>
          </CardHeader>
          <CardContent>
            {!mcp?.activeSessions.length ? (
              <p className="text-sm text-muted-foreground">No active sessions</p>
            ) : (
              <HorizontalBars
                items={mcp.activeSessions
                  .sort((a, b) => b.toolCalls - a.toolCalls)
                  .map((s) => ({
                    label: s.agent,
                    value: s.toolCalls,
                    sublabel: `${s.sessions} session${s.sessions !== 1 ? 's' : ''}`,
                  }))}
                unit=" calls"
              />
            )}
          </CardContent>
        </Card>
      </div>

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

      {/* API Endpoints */}
      {requests && requests.endpoints.length > 0 && (() => {
        const endpoints = requests.endpoints
        const pagedEndpoints = endpoints.slice(endpointPage * PAGE_SIZE, (endpointPage + 1) * PAGE_SIZE)
        return (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>API Endpoints</span>
                {requests.totalErrors > 0 && (
                  <Badge className={STATUS_STYLES.error}>{requests.totalErrors} errors</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1.5">
                <div className="flex items-center text-[10px] text-muted-foreground uppercase tracking-wider pb-1 border-b border-white/5">
                  <span className="flex-1">Endpoint</span>
                  <span className="w-16 text-right">Calls</span>
                  <span className="w-16 text-right">Errors</span>
                  <span className="w-24 text-right">Last Called</span>
                </div>
                {pagedEndpoints.map((ep) => (
                  <div key={ep.endpoint} className="flex items-center text-sm">
                    <span className="flex-1 font-mono text-muted-foreground truncate">{ep.endpoint}</span>
                    <span className="w-16 text-right font-mono">{ep.count}</span>
                    <span className={`w-16 text-right font-mono ${ep.errors > 0 ? 'text-red-400' : ''}`}>
                      {ep.errors || '—'}
                    </span>
                    <span className="w-24 text-right text-xs text-muted-foreground">
                      {formatTime(ep.lastCalled)}
                    </span>
                  </div>
                ))}
              </div>
              <PaginationControls page={endpointPage} total={endpoints.length} onPageChange={setEndpointPage} />
            </CardContent>
          </Card>
        )
      })()}

      {/* Recent Requests */}
      {requests && requests.recent.length > 0 && (() => {
        const recent = requests.recent
        const pagedRecent = recent.slice(recentPage * PAGE_SIZE, (recentPage + 1) * PAGE_SIZE)
        return (
          <Card>
            <CardHeader>
              <CardTitle>Recent Requests</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                <div className="flex items-center text-[10px] text-muted-foreground uppercase tracking-wider pb-1 border-b border-white/5">
                  <span className="w-16">Method</span>
                  <span className="flex-1">Path</span>
                  <span className="w-14 text-right">Status</span>
                  <span className="w-16 text-right">Duration</span>
                  <span className="w-20 text-right">Agent</span>
                  <span className="w-20 text-right">Time</span>
                </div>
                {pagedRecent.map((r, i) => (
                  <div key={i} className="flex items-center text-sm">
                    <span className="w-16 font-mono text-xs text-muted-foreground">{r.method}</span>
                    <span className="flex-1 font-mono text-muted-foreground truncate">{r.path}</span>
                    <span className={`w-14 text-right font-mono text-xs ${r.status >= 400 ? 'text-red-400' : r.status >= 300 ? 'text-yellow-400' : 'text-green-400'}`}>
                      {r.status}
                    </span>
                    <span className="w-16 text-right font-mono text-xs text-muted-foreground">{r.durationMs}ms</span>
                    <span className="w-20 text-right text-xs text-muted-foreground truncate">{r.agent || '—'}</span>
                    <span className="w-20 text-right text-xs text-muted-foreground">{formatTime(r.ts)}</span>
                  </div>
                ))}
              </div>
              <PaginationControls page={recentPage} total={recent.length} onPageChange={setRecentPage} />
            </CardContent>
          </Card>
        )
      })()}

      {/* Registry — Active Plugins & Active Tools */}
      {registry && (
        <div className="grid md:grid-cols-2 gap-6">
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

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Active Tools</span>
                <Badge variant="secondary" className="font-mono text-xs">{registry.execTools.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ListSearch value={toolSearch} onChange={setToolSearch} placeholder="Search tools..." />
              {filteredTools.length === 0 ? (
                <p className="text-sm text-muted-foreground">{toolSearch ? 'No matching tools' : 'No exec tools registered'}</p>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <div className="flex items-center text-[10px] text-muted-foreground uppercase tracking-wider pb-1 border-b border-white/5">
                      <span className="flex-1">Tool</span>
                      <span className="w-24 text-right">Source</span>
                      <span className="w-14 text-right">Calls</span>
                      <span className="w-14 text-right">Errors</span>
                      <span className="w-20 text-right">Last Used</span>
                    </div>
                    {filteredTools.slice(toolPage * PAGE_SIZE, (toolPage + 1) * PAGE_SIZE).map((t) => (
                      <div key={t.name} className="flex items-center text-sm" title={t.lastError || undefined}>
                        <span className="flex-1 font-mono text-muted-foreground truncate">{t.name.replace('bakin_exec_', '')}</span>
                        <span className="w-24 text-right">
                          <Badge variant="secondary" className="text-[10px] px-1.5">
                            plugin:{t.source === 'core' ? 'core' : t.source}
                          </Badge>
                        </span>
                        <span className="w-14 text-right font-mono">{t.calls}</span>
                        <span className={`w-14 text-right font-mono ${t.errors > 0 ? 'text-red-400' : 'text-muted-foreground'}`}>{t.errors}</span>
                        <span className="w-20 text-right text-xs text-muted-foreground">
                          {t.lastUsed ? formatAge(t.lastUsed) : '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                  <PaginationControls page={toolPage} total={filteredTools.length} onPageChange={setToolPage} />
                </>
              )}
            </CardContent>
          </Card>
        </div>
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
