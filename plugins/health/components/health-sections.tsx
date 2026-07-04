'use client'

import { useState } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from "@makinbakin/sdk/ui"
import { Badge } from "@makinbakin/sdk/ui"
import { Button } from "@makinbakin/sdk/ui"
import { Input } from "@makinbakin/sdk/ui"
import { Skeleton } from "@makinbakin/sdk/ui"
import { UnderlineTabs } from "@makinbakin/sdk/components"
import { formatAge } from "@makinbakin/sdk/utils"
import { Search, Wrench } from 'lucide-react'
import { RepairDialog } from './repair-dialog'
import type { PolledResult } from './use-health-data'
import type { AgentUsage } from '@makinbakin/sdk/types'
import type { HealthSummary, MeteredSpendData, UsageKind, UsageFeedData } from '../types'
import {
  formatUptime,
  formatTokenCount,
  formatRuntimeCost,
  extractErrorMessage,
  formatActivity,
} from '../lib/format'

// ---------------------------------------------------------------------------
// Shared leaf presentational helpers
// ---------------------------------------------------------------------------

interface BarItem {
  label: string
  value: number
  sublabel?: string
}

export const BAR_COLORS = [
  'bg-blue-500',
  'bg-emerald-500',
  'bg-violet-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-cyan-500',
  'bg-pink-500',
  'bg-teal-500',
]

export function HorizontalBars({ items, unit = '' }: { items: BarItem[]; unit?: string }) {
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

export function ListSearch({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
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

export const STATUS_STYLES: Record<string, string> = {
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

const USAGE_TABS = [
  { id: 'tools', label: 'Tool Usage' },
  { id: 'endpoints', label: 'Endpoint Usage' },
  { id: 'agents', label: 'Agent Usage' },
] as const

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

/** Top-row summary cards (uptime / sessions / memory / errors). */
export function SummaryCards({ result }: { result: PolledResult<HealthSummary> }) {
  const { data, error, loading } = result

  if (loading && !data) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    )
  }

  if (!data) {
    return <p className="text-red-400 text-sm">{error ?? 'Failed to load health data'}</p>
  }

  const { server } = data
  const memoryPercent = server?.totalMemoryMB
    ? Math.round((server.memoryMB / server.totalMemoryMB) * 100)
    : null

  return (
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
  )
}

/** Latest-session context (runtime-reported) + estimated cost (Bakin's figure), side by side. */
export function SpendTokenSection({ usage, meteredSpend }: { usage: AgentUsage[]; meteredSpend: MeteredSpendData | null }) {
  if (!(usage.length > 0 || meteredSpend)) return null
  return (
    <div className={`grid gap-6 ${usage.length > 0 && meteredSpend ? 'md:grid-cols-2' : 'grid-cols-1'}`}>
      {/* Latest Session Context — runtime-reported token breakdown for each
          agent's NEWEST session only (context pressure, not history — the
          Usage History section is the multi-session aggregate). */}
      {usage.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>
                Latest Session Context
                <span className="block text-[11px] font-normal text-muted-foreground mt-0.5">
                  Each agent&apos;s newest session only — not a historical total
                </span>
              </span>
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
  )
}

/** Unified tabbed usage section backed by /api/plugins/health/usage-feed. */
export function UsageSection({
  feed,
  usageTab,
  setUsageTab,
  usageWindow,
  setUsageWindow,
}: {
  feed: UsageFeedData | null
  usageTab: string
  setUsageTab: (v: string) => void
  usageWindow: string
  setUsageWindow: (v: string) => void
}) {
  return (
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
            feed={feed}
            kind="mcp"
            emptyLabel="No MCP calls in this window"
            labelTransform={(name) => name.replace('bakin_exec_', '')}
          />
        )}
        {usageTab === 'endpoints' && (
          <UsageBarsPanel
            feed={feed}
            kind="rest"
            emptyLabel="No REST requests in this window"
          />
        )}
        {usageTab === 'agents' && <AgentUsagePanel feed={feed} />}
      </CardContent>
    </Card>
  )
}

/** Full-width per-agent token totals (latest session). */
export function ContextUsageSection({ usage }: { usage: AgentUsage[] }) {
  if (usage.length === 0) return null
  return (
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
  )
}

/** Doctor diagnostics card with the repair dialog. */
export function DiagnosticsSection({ result }: { result: PolledResult<HealthSummary> }) {
  const [repairOpen, setRepairOpen] = useState(false)
  const doctor = result.data?.doctor
  if (!doctor) return null
  return (
    <>
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

      <RepairDialog open={repairOpen} onOpenChange={setRepairOpen} onApplied={() => { result.refresh() }} />
    </>
  )
}

/** Server info footer (port / pid / node). */
export function ServerFooter({ result }: { result: PolledResult<HealthSummary> }) {
  const server = result.data?.server
  if (!server) return null
  return (
    <div className="flex gap-4 text-xs text-muted-foreground">
      <span>Port {server.port}</span>
      <span>PID {server.pid}</span>
      <span>Node {server.nodeVersion}</span>
    </div>
  )
}
