import type { AdapterToolActivityEvent, AdapterTurnActivityEvent } from '@bakin/core/adapters/shared'

import {
  getUsageObservationCursor,
  reconcileObservedUsage,
  recordUsage,
} from './usage'

type AdapterToolResultEvent = Extract<AdapterToolActivityEvent, { phase: 'result' }>

const MAX_PENDING_TOOL_CALLS = 1_000
const MAX_SETTLED_TOOL_CALLS = 1_000

function callKey(event: AdapterToolActivityEvent): string {
  return [event.agentId, event.turnId, event.threadId ?? '', event.callId ?? `tool:${event.toolName}`].join('\0')
}

interface PendingToolCall {
  event: AdapterToolActivityEvent
  at: number
  usageCursor: number
}

export interface RuntimeToolUsageRecorder {
  (event: AdapterToolActivityEvent): void
  /** Close calls that never produced a result frame when their exact owning turn settles. */
  reconcileTurn(event: AdapterTurnActivityEvent): void
}

/**
 * Converts adapter-native tool results into the unified interaction recorder.
 * Bakin exec results are reconciled against richer source-side MCP/provider
 * rows. If validation or transport fails before that source can meter the
 * call, the adapter observation becomes the row instead of disappearing.
 */
export function createRuntimeToolUsageRecorder(
  now: () => number = Date.now,
): RuntimeToolUsageRecorder {
  const pendingByKey = new Map<string, PendingToolCall[]>()
  let pendingCount = 0
  const settledCalls = new Set<string>()

  const rememberSettled = (key: string): void => {
    if (!settledCalls.has(key) && settledCalls.size >= MAX_SETTLED_TOOL_CALLS) {
      const oldestKey = settledCalls.values().next().value
      if (oldestKey !== undefined) settledCalls.delete(oldestKey)
    }
    settledCalls.add(key)
  }

  const recordResult = (
    event: AdapterToolResultEvent,
    started: PendingToolCall | undefined,
    endedAt: number,
    terminalStatus?: Extract<AdapterTurnActivityEvent, { phase: 'result' }>['status'],
  ): void => {
    const derivedDuration = started === undefined ? null : Math.max(0, endedAt - started.at)
    const reportedDuration = event.durationMs
    const durationMs = typeof reportedDuration === 'number' && Number.isFinite(reportedDuration)
      ? Math.max(0, reportedDuration)
      : derivedDuration
    const status = event.status === 'failed' ? 'error' : 'ok'
    const isBakinExec = event.toolName.startsWith('bakin_exec_')
    const observerSource = 'runtime-native-observer'
    const terminalMeta = terminalStatus
      ? { resultMissing: true, turnTerminalStatus: terminalStatus }
      : { terminalStatus: event.status }

    if (isBakinExec && started && reconcileObservedUsage({
      kind: 'mcp',
      name: event.toolName,
      agent: event.agentId,
      observedStatus: status,
      observerSource,
      afterCursor: started.usageCursor,
      observationMeta: terminalMeta,
    })) {
      return
    }

    recordUsage({
      kind: 'mcp',
      activityClass: event.activityClass,
      name: event.toolName,
      agent: event.agentId,
      durationMs,
      status,
      meta: {
        source: isBakinExec ? observerSource : 'runtime-native',
        ...(event.callId ? { callId: event.callId } : {}),
        turnId: event.turnId,
        ...(event.threadId ? { threadId: event.threadId } : {}),
        ...terminalMeta,
      },
    })
  }

  const recorder = ((event: AdapterToolActivityEvent): void => {
    const key = callKey(event)
    if (event.phase === 'call') {
      settledCalls.delete(key)
      const existing = pendingByKey.get(key)
      // A repeated explicit call id is a duplicate frame, not another call.
      if (event.callId && existing?.length) return
      if (pendingCount >= MAX_PENDING_TOOL_CALLS) {
        const oldestKey = pendingByKey.keys().next().value
        if (oldestKey !== undefined) {
          const oldest = pendingByKey.get(oldestKey)!
          oldest.shift()
          pendingCount--
          if (oldest.length === 0) pendingByKey.delete(oldestKey)
        }
      }
      const pending = existing ?? []
      pending.push({ event: { ...event }, at: now(), usageCursor: getUsageObservationCursor() })
      pendingCount++
      pendingByKey.set(key, pending)
      return
    }

    if (settledCalls.has(key)) return
    const endedAt = now()
    const pending = pendingByKey.get(key)
    const started = pending?.shift()
    if (started) pendingCount--
    if (!pending || pending.length === 0) {
      pendingByKey.delete(key)
      rememberSettled(key)
    }
    recordResult(event, started, endedAt)
  }) as RuntimeToolUsageRecorder

  recorder.reconcileTurn = (event): void => {
    if (event.phase !== 'result') return
    const endedAt = now()
    for (const [key, pending] of pendingByKey) {
      const first = pending[0]
      if (!first || first.event.agentId !== event.agentId || first.event.turnId !== event.turnId) continue
      pendingByKey.delete(key)
      pendingCount -= pending.length
      rememberSettled(key)
      for (const started of pending) {
        recordResult({
          ...started.event,
          phase: 'result',
          status: event.status,
        }, started, endedAt, event.status)
      }
    }
  }

  return recorder
}
