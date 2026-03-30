'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

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
}

interface ServerData {
  port: number
  pid: number
  nodeVersion: string
  memoryMB: number
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
  source: 'built-in' | 'user'
  routes: number
}

interface ExecToolStat {
  name: string
  source: string
  calls: number
  lastUsed: string | null
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

interface HealthSummary {
  mcp: McpData | null
  doctor: DoctorData | null
  requests: RequestsData | null
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

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString()
}

function formatAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60_000)
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

  const fetchData = useCallback(async () => {
    try {
      const [summaryRes, registryRes, usageRes] = await Promise.all([
        fetch('/api/plugins/health/summary'),
        fetch('/api/plugins/health/registry'),
        fetch('/api/plugins/health/usage'),
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

  const { mcp, doctor, requests, server } = data
  const sortedTools = mcp
    ? Object.entries(mcp.toolCallCounts).sort(([, a], [, b]) => b - a)
    : []

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">System Health</h1>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            Updated {lastRefresh.toLocaleTimeString()}
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
            <p className="text-xs text-muted-foreground">MCP Requests</p>
            <p className="text-xl font-mono font-semibold">
              {mcp?.totalRequests ?? 0}
            </p>
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
              {server?.memoryMB ?? '—'} MB
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* MCP Tool Calls — horizontal bar chart */}
        <Card>
          <CardHeader>
            <CardTitle>MCP Tool Calls</CardTitle>
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
                <span>Session Cost</span>
                <Badge variant="secondary" className="font-mono text-xs">
                  ${usage.reduce((sum, u) => sum + u.cost.total, 0).toFixed(2)} total
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
      {requests && requests.endpoints.length > 0 && (
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
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              <div className="flex items-center text-[10px] text-muted-foreground uppercase tracking-wider pb-1 border-b border-white/5">
                <span className="flex-1">Endpoint</span>
                <span className="w-16 text-right">Calls</span>
                <span className="w-16 text-right">Errors</span>
                <span className="w-24 text-right">Last Called</span>
              </div>
              {requests.endpoints.map((ep) => (
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
          </CardContent>
        </Card>
      )}

      {/* Recent Requests */}
      {requests && requests.recent.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent Requests</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 max-h-72 overflow-y-auto">
              <div className="flex items-center text-[10px] text-muted-foreground uppercase tracking-wider pb-1 border-b border-white/5">
                <span className="w-16">Method</span>
                <span className="flex-1">Path</span>
                <span className="w-14 text-right">Status</span>
                <span className="w-16 text-right">Duration</span>
                <span className="w-20 text-right">Agent</span>
                <span className="w-20 text-right">Time</span>
              </div>
              {requests.recent.slice(0, 30).map((r, i) => (
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
          </CardContent>
        </Card>
      )}

      {/* Registry — Plugins & Exec Tools */}
      {registry && (
        <div className="grid md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Plugins</CardTitle>
            </CardHeader>
            <CardContent>
              {registry.plugins.length === 0 ? (
                <p className="text-sm text-muted-foreground">No plugins loaded</p>
              ) : (
                <div className="space-y-1.5">
                  <div className="flex items-center text-[10px] text-muted-foreground uppercase tracking-wider pb-1 border-b border-white/5">
                    <span className="flex-1">Plugin</span>
                    <span className="w-16 text-right">Version</span>
                    <span className="w-16 text-right">Source</span>
                    <span className="w-14 text-right">Routes</span>
                  </div>
                  {registry.plugins.map((p) => (
                    <div key={p.id} className="flex items-center text-sm">
                      <span className="flex-1 font-medium">{p.name}</span>
                      <span className="w-16 text-right font-mono text-xs text-muted-foreground">{p.version}</span>
                      <span className="w-16 text-right">
                        <Badge variant="secondary" className="text-[10px] px-1.5">
                          {p.source}
                        </Badge>
                      </span>
                      <span className="w-14 text-right font-mono text-xs text-muted-foreground">{p.routes}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Exec Tools</CardTitle>
            </CardHeader>
            <CardContent>
              {registry.execTools.length === 0 ? (
                <p className="text-sm text-muted-foreground">No exec tools registered</p>
              ) : (
                <div className="space-y-1.5">
                  <div className="flex items-center text-[10px] text-muted-foreground uppercase tracking-wider pb-1 border-b border-white/5">
                    <span className="flex-1">Tool</span>
                    <span className="w-16 text-right">Source</span>
                    <span className="w-14 text-right">Calls</span>
                    <span className="w-20 text-right">Last Used</span>
                  </div>
                  {registry.execTools.map((t) => (
                    <div key={t.name} className="flex items-center text-sm">
                      <span className="flex-1 font-mono text-muted-foreground truncate">{t.name.replace('bakin_exec_', '')}</span>
                      <span className="w-16 text-right">
                        <Badge variant="secondary" className="text-[10px] px-1.5">
                          {t.source}
                        </Badge>
                      </span>
                      <span className="w-14 text-right font-mono">{t.calls}</span>
                      <span className="w-20 text-right text-xs text-muted-foreground">
                        {t.lastUsed ? formatTime(t.lastUsed) : '—'}
                      </span>
                    </div>
                  ))}
                </div>
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
              <span>Diagnostics</span>
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
