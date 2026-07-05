'use client'

import { useState } from 'react'
import { useQueryState } from "@makinbakin/sdk/hooks"
import { Button } from "@makinbakin/sdk/ui"
import { PluginHeader } from "@makinbakin/sdk/components"
import type { AgentUsage } from '@makinbakin/sdk/types'
import type { HealthSummary, MeteredSpendData, UsageKind, UsageFeedData } from '../types'
import { formatDateShort } from '../lib/format'
import { usePolledJson, HEALTH_POLL_MS } from './use-health-data'
import {
  SummaryCards,
  SpendTokenSection,
  UsageSection,
  ContextUsageSection,
  DiagnosticsSection,
  ServerFooter,
} from './health-sections'
import { SearchSection } from './search-section'
import { PluginsSection } from './plugins-section'
import { UsageHistorySection } from './usage-history-section'
import { LiveNowSection, AttentionSection, EffortSection } from './supervision-sections'

/**
 * The System Health dashboard shell. Each section fetches independently (see
 * usePolledJson) so a single failing endpoint faults only its own card rather
 * than blanking the whole page behind one loading gate — the deliberate
 * behavior change from the former all-or-nothing Promise.all. The shell owns
 * layout, the shared summary/usage feeds (consumed by multiple sections), and
 * the global Refresh nonce.
 */
export function HealthPage() {
  const [refreshNonce, setRefreshNonce] = useState(0)

  // Usage tabs state (URL-backed)
  const [usageTab, setUsageTab] = useQueryState('usage_tab', 'tools')
  const [usageWindow, setUsageWindow] = useQueryState('usage_window', '1h')
  const kindForTab: UsageKind = usageTab === 'endpoints' ? 'rest' : usageTab === 'agents' ? 'agent' : 'mcp'

  // Shared feeds consumed by more than one section.
  const summary = usePolledJson<HealthSummary>('/api/plugins/health/summary', { intervalMs: HEALTH_POLL_MS, refreshNonce })
  const usageResult = usePolledJson<AgentUsage[]>('/api/plugins/health/usage', {
    intervalMs: HEALTH_POLL_MS,
    refreshNonce,
    select: (raw) => (Array.isArray(raw) ? (raw as AgentUsage[]) : null),
  })
  const usageFeed = usePolledJson<UsageFeedData>(
    `/api/plugins/health/usage-feed?kind=${kindForTab}&window=${usageWindow}`,
    { intervalMs: HEALTH_POLL_MS, refreshNonce },
  )
  // Cross-plugin + optional: only trust a 2xx body — the /spend error path returns
  // 500 with a {totalUsdMicros:0} shape, which must NOT render as a real $0 card.
  const spend = usePolledJson<MeteredSpendData>('/api/plugins/models/spend?window=24h', {
    intervalMs: HEALTH_POLL_MS,
    refreshNonce,
    swallowErrors: true,
    select: (raw) => {
      const body = raw as Partial<MeteredSpendData> | null
      return body && typeof body.totalUsdMicros === 'number' ? (body as MeteredSpendData) : null
    },
  })

  const usage = usageResult.data ?? []
  const lastRefresh = summary.lastUpdated ? new Date(summary.lastUpdated) : new Date()

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
          <Button variant="outline" size="sm" onClick={() => setRefreshNonce((n) => n + 1)}>
            Refresh
          </Button>
        </div>
      </div>

      <SummaryCards result={summary} />

      <LiveNowSection refreshNonce={refreshNonce} />

      <AttentionSection result={summary} />

      <SpendTokenSection usage={usage} meteredSpend={spend.data} />

      <UsageHistorySection refreshNonce={refreshNonce} />

      <EffortSection refreshNonce={refreshNonce} />

      <UsageSection
        feed={usageFeed.data}
        usageTab={usageTab}
        setUsageTab={setUsageTab}
        usageWindow={usageWindow}
        setUsageWindow={setUsageWindow}
      />

      <ContextUsageSection usage={usage} />

      <SearchSection refreshNonce={refreshNonce} />

      <PluginsSection refreshNonce={refreshNonce} />

      <DiagnosticsSection result={summary} />

      <ServerFooter result={summary} />
    </div>
  )
}
