import type { AdapterTurnActivityEvent } from '@bakin/core/adapters/shared'

import { recordUsage } from './usage'

const MAX_RECORDED_TURNS = 1_000

function nonNegativeFinite(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.max(0, value)
}

/** Record every adapter messaging turn once, including unmetered and failed turns. */
export function createRuntimeTurnUsageRecorder(): (event: AdapterTurnActivityEvent) => void {
  const recordedTurns = new Set<string>()

  return (event) => {
    if (event.phase !== 'result') return
    const key = `${event.agentId}\0${event.turnId}`
    if (recordedTurns.has(key)) return
    if (recordedTurns.size >= MAX_RECORDED_TURNS) {
      const oldest = recordedTurns.values().next().value
      if (oldest !== undefined) recordedTurns.delete(oldest)
    }
    recordedTurns.add(key)

    const usage = event.usage
    const tokensIn = nonNegativeFinite(usage?.input)
    const tokensOut = nonNegativeFinite(usage?.output)
    const tokensCacheRead = nonNegativeFinite(usage?.cacheRead)
    const tokensCacheWrite = nonNegativeFinite(usage?.cacheWrite)

    recordUsage({
      kind: 'agent',
      activityClass: event.activityClass,
      name: event.operation,
      agent: event.agentId,
      durationMs: nonNegativeFinite(event.durationMs) ?? 0,
      status: event.status === 'failed' ? 'error' : 'ok',
      ...(tokensIn === undefined ? {} : { tokensIn }),
      ...(tokensOut === undefined ? {} : { tokensOut }),
      ...(tokensCacheRead === undefined ? {} : { tokensCacheRead }),
      ...(tokensCacheWrite === undefined ? {} : { tokensCacheWrite }),
      meta: {
        source: 'runtime-turn',
        operation: event.operation,
        turnId: event.turnId,
        terminalStatus: event.status,
        ...(event.threadId === undefined ? {} : { threadId: event.threadId }),
        ...(event.resultId === undefined ? {} : { resultId: event.resultId }),
        ...(usage?.model === undefined ? {} : { model: usage.model }),
      },
    })
  }
}
