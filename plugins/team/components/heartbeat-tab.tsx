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
import { Loader2, Heart, Pencil } from 'lucide-react'
import { MarkdownContent } from '@bakin/sdk/components'
import type { HeartbeatRaw } from '../types'
import { EmptyState } from './empty-state'

const HEARTBEAT_DISABLED_REASON = 'HEARTBEAT.md is an agent-maintained narrative — the agent updates it itself as it works. Editing from the UI would conflict with what the agent next writes.'

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
      <EmptyState
        icon={Heart}
        title="No heartbeat yet"
        description={
          <>
            This agent hasn't written a
            {' '}
            <code className="font-mono text-foreground/80">HEARTBEAT.md</code>
            {' '}
            yet — it appears here once they do. (Distinct from the JSON
            status signal at <code className="font-mono text-foreground/80">~/.bakin/heartbeats/{'{id}'}.json</code>;
            this tab shows the agent's narrative file in their workspace.)
          </>
        }
      />
    )
  }

  return (
    <div className="relative w-full">
      <div className="absolute top-2 right-2 z-10 flex items-center gap-2">
        <span className="text-xs text-muted-foreground bg-muted/40 backdrop-blur-sm rounded-full px-3 py-1">
          Last updated {formatRelative(heartbeat.lastUpdated)}
        </span>
        <button
          disabled
          aria-disabled="true"
          title={HEARTBEAT_DISABLED_REASON}
          aria-label={`Edit disabled — ${HEARTBEAT_DISABLED_REASON}`}
          className="size-8 rounded-full bg-zinc-700/40 text-zinc-500 flex items-center justify-center cursor-not-allowed shadow-lg backdrop-blur-sm"
        >
          <Pencil className="size-4" />
        </button>
      </div>
      <div className="w-full min-h-[calc(100vh-260px)] pr-14 overflow-auto">
        <MarkdownContent content={heartbeat.content} />
      </div>
    </div>
  )
}
