'use client'

import { useEffect, useState } from 'react'
import { usePluginEvent } from '@makinbakin/sdk/hooks'

/** Latest live feedback for one task's in-flight turn (ephemeral UI state). */
export interface LiveActivity {
  label: string
  ts: number
}

/** Feedback with no fresh activity for this long is swept (turn likely settled
 *  or gone quiet — the tap is best-effort, so absence of a terminal signal
 *  is normal). */
const TTL_MS = 45_000
const SWEEP_MS = 10_000

export interface LiveActivityChunk {
  type?: string
  content?: string
  data?: { toolName?: string; phase?: string; status?: string }
}

export function chipLabel(chunk: LiveActivityChunk): string {
  if (chunk.type === 'tool') {
    const name = chunk.data?.toolName ?? 'tool'
    if (chunk.data?.phase === 'result') return chunk.data?.status === 'failed' ? `${name} ✗` : `${name} ✓`
    return `${name}…`
  }
  return chunk.content || 'working…'
}

/** The event's own timestamp when parseable, else receipt time — and stale
 *  events (older than the TTL) are dropped outright so a replayed or
 *  delayed event can never re-surface a settled task. */
export function liveActivityTs(rawTs: unknown, now = Date.now()): number | null {
  const eventTs = Date.parse(String(rawTs ?? ''))
  const ts = Number.isFinite(eventTs) ? eventTs : now
  return now - ts > TTL_MS ? null : ts
}

/**
 * Live turn-activity feedback keyed by task id, fed by the ephemeral
 * 'turn-activity' SSE events (never persisted server-side). A nested-
 * workflow step turn updates BOTH the parent task and the child board task.
 */
export function useLiveActivity(): Record<string, LiveActivity> {
  const [byTask, setByTask] = useState<Record<string, LiveActivity>>({})

  usePluginEvent('turn-activity', (payload) => {
    const chunk = payload.chunk as LiveActivityChunk | undefined
    if (!chunk) return
    const ids = [payload.taskId, payload.childTaskId].filter((id): id is string => typeof id === 'string')
    if (ids.length === 0) return
    const ts = liveActivityTs(payload.ts)
    if (ts === null) return
    const entry: LiveActivity = { label: chipLabel(chunk), ts }
    setByTask((prev) => {
      const next = { ...prev }
      for (const id of ids) next[id] = entry
      return next
    })
  })

  useEffect(() => {
    const timer = setInterval(() => {
      setByTask((prev) => {
        const cutoff = Date.now() - TTL_MS
        const live = Object.entries(prev).filter(([, v]) => v.ts >= cutoff)
        return live.length === Object.keys(prev).length ? prev : Object.fromEntries(live)
      })
    }, SWEEP_MS)
    return () => clearInterval(timer)
  }, [])

  return byTask
}
