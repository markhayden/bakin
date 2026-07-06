'use client'

import { Card, CardHeader, CardTitle, CardContent } from '@makinbakin/sdk/ui'
import { Badge } from '@makinbakin/sdk/ui'
import { useQueryState } from '@makinbakin/sdk/hooks'
import { StackedColumnChart } from '@makinbakin/sdk/components'
import type { UsageHistoryData, UsageHistoryWindow } from '../types'
import { formatTokenCount, formatRuntimeCost } from '../lib/format'
import { usePolledJson, HEALTH_POLL_MS } from './use-health-data'

const WINDOWS: UsageHistoryWindow[] = ['24h', '7d', '30d']

/**
 * Historical token usage from the durable usage store (#359) — the
 * multi-session complement to the latest-session card. Window selection is
 * URL-backed (`uw`, omitted at the 24h default). Cost is runtime-reported
 * only: partial coverage is labeled, zero coverage renders an em-dash.
 */
export function UsageHistorySection({ refreshNonce }: { refreshNonce: number }) {
  const [window, setWindow] = useQueryState('uw', '24h')
  const win: UsageHistoryWindow = WINDOWS.includes(window as UsageHistoryWindow)
    ? (window as UsageHistoryWindow)
    : '24h'

  const result = usePolledJson<UsageHistoryData>(
    `/api/plugins/health/usage-history?window=${win}`,
    {
      intervalMs: HEALTH_POLL_MS,
      refreshNonce,
      // Only trust a well-formed body — an error/empty payload must render
      // the honest empty state, never crash or fake zeros.
      select: (raw) => {
        const body = raw as Partial<UsageHistoryData> | null
        return body && Array.isArray(body.byAgent) && Array.isArray(body.byDay)
          ? (body as UsageHistoryData)
          : null
      },
    },
  )
  const data = result.data

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>
            Usage History
            <span className="block text-[11px] font-normal text-muted-foreground mt-0.5">
              All sessions, aggregated per local calendar day
            </span>
          </span>
          <span className="flex items-center gap-3">
            {data && data.byAgent.length > 0 && (
              <Badge variant="secondary" className="font-mono text-xs">
                {formatTokenCount(data.byAgent.reduce((sum, a) => sum + a.tokens.total, 0))} tokens
              </Badge>
            )}
            <span className="flex items-center gap-1 rounded-md border border-border p-0.5">
              {WINDOWS.map((w) => (
                <button
                  key={w}
                  onClick={() => setWindow(w)}
                  className={`px-2 py-0.5 text-[11px] font-mono rounded transition-colors ${
                    win === w
                      ? 'bg-foreground/10 text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {w}
                </button>
              ))}
            </span>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {result.error ? (
          <p className="text-sm text-muted-foreground">Usage history unavailable: {result.error}</p>
        ) : !data || data.byAgent.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {data?.scannedAt
              ? 'No usage recorded in this window.'
              : 'No usage history yet — the first transcript scan has not completed.'}
          </p>
        ) : (
          <div className="space-y-4">
            <PerAgentDailyChart byAgentDay={data.byAgentDay ?? []} byDay={data.byDay} />

            <div className="space-y-1.5">
              <div className="flex items-center text-[10px] text-muted-foreground uppercase tracking-wider pb-1 border-b border-white/5">
                <span className="flex-1">Agent</span>
                <span className="w-14 text-right">In</span>
                <span className="w-14 text-right">Out</span>
                <span className="w-16 text-right">Cache R</span>
                <span className="w-16 text-right">Cache W</span>
                <span className="w-16 text-right">Total</span>
                <span className="w-20 text-right">Est. cost</span>
              </div>
              {data.byAgent.map((a) => (
                <div key={a.agent} className="flex items-center text-sm">
                  <span className="flex-1 font-medium">{a.agent}</span>
                  <span className="w-14 text-right font-mono text-xs text-muted-foreground">{formatTokenCount(a.tokens.input)}</span>
                  <span className="w-14 text-right font-mono text-xs text-muted-foreground">{formatTokenCount(a.tokens.output)}</span>
                  <span className="w-16 text-right font-mono text-xs text-muted-foreground">{formatTokenCount(a.tokens.cacheRead)}</span>
                  <span className="w-16 text-right font-mono text-xs text-muted-foreground">{formatTokenCount(a.tokens.cacheWrite)}</span>
                  <span className="w-16 text-right font-mono text-xs">{formatTokenCount(a.tokens.total)}</span>
                  <CostCell costUsdMicros={a.costUsdMicros} costedMessages={a.costedMessages} messageCount={a.messageCount} />
                </div>
              ))}
            </div>

            {data.scannedAt && (
              <p className="text-[10px] text-muted-foreground">
                Last transcript scan {new Date(data.scannedAt).toLocaleTimeString()} · runtime-reported cost only
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * Runtime-reported cost with coverage honesty: em-dash when nothing was
 * reported, a "partial" marker when only some messages carried cost.
 */
function CostCell({ costUsdMicros, costedMessages, messageCount }: {
  costUsdMicros: number | null
  costedMessages: number
  messageCount: number
}) {
  if (costUsdMicros === null || costedMessages === 0) {
    return <span className="w-20 text-right font-mono text-xs text-muted-foreground">—</span>
  }
  const partial = costedMessages < messageCount
  return (
    <span
      className="w-20 text-right font-mono text-xs"
      title={`Runtime-reported cost on ${costedMessages} of ${messageCount} messages`}
    >
      {formatRuntimeCost(costUsdMicros / 1_000_000)}
      {partial && <span className="text-muted-foreground ml-0.5">*</span>}
    </span>
  )
}

/**
 * Per-agent stacked daily columns (#385) — one column per local calendar day,
 * stacked by agent (usage.db's agent×day cross-tab). Falls back to the byDay
 * totals when the cross-tab is empty. Needs ≥2 days to be a trend.
 */
function PerAgentDailyChart({
  byAgentDay,
  byDay,
}: {
  byAgentDay: UsageHistoryData['byAgentDay']
  byDay: UsageHistoryData['byDay']
}) {
  const days = [...new Set(byDay.map((d) => d.day))].sort()
  if (days.length < 2) return null

  const cellsByDay = new Map<string, Record<string, number>>()
  for (const day of days) cellsByDay.set(day, {})
  for (const cell of byAgentDay) {
    const bucket = cellsByDay.get(cell.day)
    if (bucket) bucket[cell.agent] = cell.tokens.total
  }
  // Cross-tab absent (older payloads / empty) → single "all agents" series.
  const haveCells = byAgentDay.length > 0
  const data = days.map((day) => ({
    x: day,
    xLabel: day.slice(5), // MM-DD
    values: haveCells
      ? cellsByDay.get(day)!
      : { 'all agents': byDay.find((d) => d.day === day)?.tokens.total ?? 0 },
  }))

  return <StackedColumnChart data={data} height={112} formatValue={formatTokenCount} />
}
