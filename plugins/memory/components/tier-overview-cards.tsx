'use client'

/**
 * TierOverviewCards — landing-page snapshot of indexed row counts per tier.
 *
 * Pulls from GET /api/plugins/memory/status once on mount. Seven cards,
 * ordered by tier hierarchy (audit first, dream last). Shows skeletons
 * while loading and a compact error banner on failure. Missing tiers in
 * the response surface as zero rather than absent cards — the card-grid
 * geometry stays stable even on partial responses.
 */
import { useEffect, useState } from 'react'
import { Microscope } from 'lucide-react'
import { Card } from "@makinbakin/sdk/ui"
import { Skeleton } from "@makinbakin/sdk/ui"
import { ErrorBanner } from "@makinbakin/sdk/components"
import { tierStyle } from './tier-colors'

// Tiers that only surface under the page-local "System Logs" toggle. The
// Microscope glyph on their overview card tells the user at a glance that
// the number belongs to the opt-in group, not the default feed.
const SYSTEM_LOG_TIERS = new Set(['turn', 'audit'])

const TIERS: Array<{ key: string; label: string }> = [
  { key: 'session', label: 'Sessions' },
  { key: 'daily_note', label: 'Daily Notes' },
  { key: 'dream', label: 'Dreams' },
  { key: 'durable', label: 'Durable' },
  { key: 'checkpoint', label: 'Checkpoints' },
  { key: 'audit', label: 'Audit' },
  { key: 'turn', label: 'Turns' },
]

interface StatusResponse {
  countsByTier: Record<string, number>
  totalRows: number
  offsetsTracked: number
  lastUpdated: number
}

export function TierOverviewCards() {
  const [data, setData] = useState<StatusResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/plugins/memory/status')
        if (!res.ok) throw new Error(`status ${res.status}`)
        const body = (await res.json()) as StatusResponse
        if (!cancelled) setData(body)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (error) {
    return <ErrorBanner message={`Failed to load memory status: ${error}`} />
  }

  if (!data) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
        {TIERS.map((t) => (
          <Skeleton key={t.key} className="h-24 w-full" />
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
      {TIERS.map((t) => {
        const count = data.countsByTier[t.key] ?? 0
        const style = tierStyle(t.key)
        return (
          <Card key={t.key} className="flex flex-col gap-1 p-4">
            <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
              <span
                className={`inline-block size-2 rounded-full shrink-0 ${style.dot}`}
                aria-hidden
              />
              {t.label}
              {SYSTEM_LOG_TIERS.has(t.key) && (
                <Microscope
                  className="size-3 ml-auto shrink-0"
                  aria-label="System log tier"
                />
              )}
            </div>
            <div className="text-2xl font-semibold tabular-nums">{count}</div>
          </Card>
        )
      })}
    </div>
  )
}
