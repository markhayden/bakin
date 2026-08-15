'use client'

/**
 * Compact landing-page snapshot of indexed rows per memory tier.
 *
 * Everyday memory tiers remain visible by default; high-volume system logs
 * are opt-in. Missing tiers surface as zero so the group stays stable when
 * the status response is partial.
 */
import {
  Bookmark,
  Calendar,
  ClipboardList,
  CornerDownRight,
  Database,
  MessagesSquare,
  Moon,
} from 'lucide-react'
import { StatGroup, StatTile } from '@makinbakin/sdk/patterns'
import { Button, Skeleton, SystemState } from '@makinbakin/sdk/ui'
import { usePluginJsonFetch } from '@makinbakin/sdk/hooks'

const TIERS = [
  { key: 'session', label: 'Sessions', icon: MessagesSquare },
  { key: 'daily_note', label: 'Daily Notes', icon: Calendar },
  { key: 'dream', label: 'Dreams', icon: Moon },
  { key: 'durable', label: 'Durable', icon: Database },
  { key: 'checkpoint', label: 'Checkpoints', icon: Bookmark },
] as const

const SYSTEM_LOG_TIERS = [
  { key: 'audit', label: 'Audit', icon: ClipboardList },
  { key: 'turn', label: 'Turns', icon: CornerDownRight },
] as const

interface StatusResponse {
  countsByTier: Record<string, number>
  totalRows: number
  offsetsTracked: number
  lastUpdated: number
}

export function TierOverviewCards({ includeSystemLogs = false }: { includeSystemLogs?: boolean }) {
  // The status route counts rows per tier, so it gets an explicit deadline
  // instead of leaving the skeletons up forever behind a stalled engine.
  const { data, error, loading, refresh } = usePluginJsonFetch<StatusResponse>(
    'memory',
    'status',
    { timeoutMs: 15_000 },
  )
  const visibleTiers = includeSystemLogs ? [...TIERS, ...SYSTEM_LOG_TIERS] : TIERS

  if (error) {
    return (
      <SystemState
        kind="error"
        recovery="available"
        scope="inline"
        title="Memory totals could not be loaded"
        description={error}
        action={<Button variant="outline" size="sm" onClick={refresh}>Try again</Button>}
      />
    )
  }

  if (loading || !data) {
    return (
      <StatGroup label="Memory totals" aria-busy="true">
        {visibleTiers.map((tier) => (
          <Skeleton key={tier.key} className="h-16 w-32" />
        ))}
      </StatGroup>
    )
  }

  return (
    <StatGroup label="Memory totals">
      {visibleTiers.map((tier) => (
        <StatTile
          key={tier.key}
          icon={tier.icon}
          label={tier.label}
          value={data.countsByTier[tier.key] ?? 0}
          className="min-w-32"
        />
      ))}
    </StatGroup>
  )
}
