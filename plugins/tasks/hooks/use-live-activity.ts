'use client'

import { useEffect, useState } from 'react'
import { usePluginEvent } from '@makinbakin/sdk/hooks'

/** Latest live chip for one task's in-flight turn (ephemeral UI state). */
export interface LiveActivity {
  label: string
  ts: number
}

/** A chip with no fresh activity for this long is swept (turn likely settled
 *  or gone quiet — the tap is best-effort, so absence of a terminal signal
 *  is normal). */
const TTL_MS = 45_000
const SWEEP_MS = 10_000

function chipLabel(chunk: { type?: string; content?: string; data?: { toolName?: string; phase?: string } }): string {
  if (chunk.type === 'tool') {
    const name = chunk.data?.toolName ?? 'tool'
    return chunk.data?.phase === 'result' ? `${name} ✓` : `${name}…`
  }
  return chunk.content || 'working…'
}

/**
 * Live turn-activity chips keyed by task id, fed by the ephemeral
 * 'turn-activity' SSE events (never persisted server-side). A nested-
 * workflow step turn chips BOTH the parent task and the child board task.
 */
export function useLiveActivity(): Record<string, LiveActivity> {
  const [byTask, setByTask] = useState<Record<string, LiveActivity>>({})

  usePluginEvent('turn-activity', (payload) => {
    const chunk = payload.chunk as { type?: string; content?: string; data?: { toolName?: string; phase?: string } } | undefined
    if (!chunk) return
    const ids = [payload.taskId, payload.childTaskId].filter((id): id is string => typeof id === 'string')
    if (ids.length === 0) return
    const entry: LiveActivity = { label: chipLabel(chunk), ts: Date.now() }
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
