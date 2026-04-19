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
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

const TIERS: Array<{ key: string; label: string }> = [
  { key: 'audit', label: 'Audit' },
  { key: 'session', label: 'Sessions' },
  { key: 'turn', label: 'Turns' },
  { key: 'checkpoint', label: 'Checkpoints' },
  { key: 'daily_note', label: 'Daily Notes' },
  { key: 'durable', label: 'Durable' },
  { key: 'dream', label: 'Dreams' },
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
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        Failed to load memory status: {error}
      </div>
    )
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
        return (
          <Card key={t.key} className="flex flex-col gap-1 p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {t.label}
            </div>
            <div className="text-2xl font-semibold tabular-nums">{count}</div>
          </Card>
        )
      })}
    </div>
  )
}
