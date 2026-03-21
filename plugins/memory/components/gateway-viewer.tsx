'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { GatewayLogEntry } from '../types'

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

export function GatewayViewer() {
  const [date, setDate] = useState(todayStr)
  const [entries, setEntries] = useState<GatewayLogEntry[]>([])
  const [offset, setOffset] = useState(0)
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)

  const limit = 50

  useEffect(() => {
    setLoading(true)
    fetch(`/api/plugins/memory/gateway?date=${date}&offset=${offset}&limit=${limit}`)
      .then((r) => (r.ok ? r.json() : { entries: [], total: 0, hasMore: false }))
      .then((data) => {
        setEntries(data.entries || [])
        setTotal(data.total || 0)
        setHasMore(data.hasMore || false)
      })
      .catch(() => {
        setEntries([])
        setTotal(0)
        setHasMore(false)
      })
      .finally(() => setLoading(false))
  }, [date, offset])

  // Reset offset when date changes
  const handleDateChange = (newDate: string) => {
    setDate(newDate)
    setOffset(0)
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <Input
          type="date"
          value={date}
          onChange={(e) => handleDateChange(e.target.value)}
          className="w-44 h-8 bg-surface border-border font-mono text-sm"
        />
        <span className="text-xs text-muted-foreground">
          {total} entries
        </span>
        <div className="flex items-center gap-1 ml-auto">
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - limit))}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="text-xs text-muted-foreground font-mono px-2">
            {offset + 1}–{Math.min(offset + limit, total)}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={!hasMore}
            onClick={() => setOffset(offset + limit)}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      {loading && (
        <p className="text-sm text-muted-foreground">Loading gateway log...</p>
      )}

      {!loading && entries.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No gateway log entries for {date}.
        </p>
      )}

      {!loading && entries.length > 0 && (
        <div className="rounded-md border border-border bg-card overflow-hidden">
          <div className="divide-y divide-border">
            {entries.map((entry, i) => (
              <div key={i} className="px-4 py-2 hover:bg-muted/30 transition-colors">
                <div className="flex items-baseline gap-3">
                  <span className="text-xs text-muted-foreground font-mono shrink-0">
                    {entry.timestamp}
                  </span>
                  <span className="text-sm text-foreground break-all">
                    {entry.message}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
