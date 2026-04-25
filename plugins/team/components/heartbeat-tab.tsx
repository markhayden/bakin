'use client'

/**
 * Heartbeat tab — view-only render of HEARTBEAT.md with a "last updated"
 * indicator. No edit affordance — heartbeats are agent-authored
 * narrative; user editing is meaningless.
 *
 * Reads from /api/plugins/team/:agentId/heartbeat which returns
 * { content, lastUpdated } or null when the file doesn't exist yet.
 */
import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { MarkdownContent } from '@bakin/sdk/components'
import type { HeartbeatRaw } from '../types'

export interface HeartbeatTabProps {
  agentId: string
}

function formatRelative(isoTimestamp: string | null): string {
  if (!isoTimestamp) return ''
  const ts = new Date(isoTimestamp).getTime()
  if (Number.isNaN(ts)) return ''
  const deltaSec = Math.round((Date.now() - ts) / 1000)
  if (deltaSec < 60) return `${deltaSec}s ago`
  const deltaMin = Math.round(deltaSec / 60)
  if (deltaMin < 60) return `${deltaMin}m ago`
  const deltaHr = Math.round(deltaMin / 60)
  if (deltaHr < 24) return `${deltaHr}h ago`
  const deltaDay = Math.round(deltaHr / 24)
  return `${deltaDay}d ago`
}

export function HeartbeatTab({ agentId }: HeartbeatTabProps) {
  const [heartbeat, setHeartbeat] = useState<HeartbeatRaw | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/plugins/team/${agentId}/heartbeat`)
      .then((r) => r.json() as Promise<{ ok: boolean; heartbeat: HeartbeatRaw | null; error?: string }>)
      .then((body) => {
        if (cancelled) return
        if (!body.ok) {
          setError(body.error ?? 'Failed to load heartbeat')
          return
        }
        setHeartbeat(body.heartbeat)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [agentId])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="size-4 animate-spin mr-2" />
        Loading heartbeat...
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-sm text-destructive py-12 text-center">{error}</div>
    )
  }

  if (!heartbeat) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
        <div className="text-base font-medium text-foreground mb-1">No heartbeat reported yet</div>
        <p className="text-sm max-w-md">
          Heartbeats appear here once the agent writes its first <code className="font-mono">HEARTBEAT.md</code>.
        </p>
      </div>
    )
  }

  return (
    <div className="relative w-full">
      <div className="absolute top-2 right-2 z-10 text-xs text-muted-foreground bg-muted/40 backdrop-blur-sm rounded-full px-3 py-1">
        Last updated {formatRelative(heartbeat.lastUpdated)}
      </div>
      <div className="w-full min-h-[calc(100vh-260px)] rounded-lg border border-border bg-muted/20 p-6 pr-32 overflow-auto">
        <MarkdownContent content={heartbeat.content} />
      </div>
    </div>
  )
}
