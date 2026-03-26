'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

interface McpSession {
  sessionId: string
  agent: string
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

const STATUS_STYLES: Record<string, string> = {
  ok: 'bg-green-500/10 text-green-400',
  warn: 'bg-yellow-500/10 text-yellow-400',
  error: 'bg-red-500/10 text-red-400',
  fixed: 'bg-blue-500/10 text-blue-400',
}

export function HealthPage() {
  const [data, setData] = useState<HealthSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/plugins/health/summary')
      const json = await res.json()
      setData(json)
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
    <div className="p-6 space-y-6 max-w-5xl">
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
        {/* MCP Tool Calls */}
        <Card>
          <CardHeader>
            <CardTitle>MCP Tool Calls</CardTitle>
          </CardHeader>
          <CardContent>
            {sortedTools.length === 0 ? (
              <p className="text-sm text-muted-foreground">No MCP calls yet this session</p>
            ) : (
              <div className="space-y-2">
                {sortedTools.map(([tool, count]) => (
                  <div key={tool} className="flex items-center justify-between">
                    <span className="text-sm font-mono text-muted-foreground">{tool}</span>
                    <span className="text-sm font-mono font-medium">{count}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Active MCP Sessions */}
        <Card>
          <CardHeader>
            <CardTitle>Active MCP Sessions</CardTitle>
          </CardHeader>
          <CardContent>
            {!mcp?.activeSessions.length ? (
              <p className="text-sm text-muted-foreground">No active sessions</p>
            ) : (
              <div className="space-y-3">
                {mcp.activeSessions.map((s) => (
                  <div key={s.sessionId} className="flex items-center justify-between">
                    <div>
                      <span className="text-sm font-medium">{s.agent}</span>
                      <span className="text-xs text-muted-foreground ml-2">
                        since {formatTime(s.connectedAt)}
                      </span>
                    </div>
                    <Badge variant="secondary" className="font-mono">
                      {s.toolCalls} calls
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

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
