import { randomUUID } from 'crypto'

import type { AdapterTurnActivityEvent } from '../shared'

type TurnResultEvent = Extract<AdapterTurnActivityEvent, { phase: 'result' }>

export interface AdapterTurnActivityReporter {
  readonly turnId: string
  finish(result: Pick<TurnResultEvent, 'status'> & Partial<Pick<TurnResultEvent, 'resultId' | 'usage'>>): void
}

export interface BeginAdapterTurnActivityOptions {
  onActivity?: (event: AdapterTurnActivityEvent) => void
  onCallbackError?: (error: unknown) => void
  agentId: string
  activityClass: AdapterTurnActivityEvent['activityClass']
  threadId?: string
  operation: AdapterTurnActivityEvent['operation']
}

/**
 * Start one adapter messaging lifecycle and return its exactly-once finisher.
 * Both the observer and its error reporter are contained: observability is
 * never allowed to change a turn's outcome.
 */
export function beginAdapterTurnActivity(
  options: BeginAdapterTurnActivityOptions,
): AdapterTurnActivityReporter {
  const turnId = randomUUID()
  const startedAt = Date.now()
  let finished = false
  const base = {
    agentId: options.agentId,
    activityClass: options.activityClass,
    ...(options.threadId === undefined ? {} : { threadId: options.threadId }),
    operation: options.operation,
    turnId,
  }

  const emit = (event: AdapterTurnActivityEvent): void => {
    try {
      options.onActivity?.(event)
    } catch (error) {
      try {
        options.onCallbackError?.(error)
      } catch {
        // An observer's error reporter is telemetry too; contain it as well.
      }
    }
  }

  emit({ ...base, phase: 'start', status: 'running' })

  return {
    turnId,
    finish(result): void {
      if (finished) return
      finished = true
      emit({
        ...base,
        phase: 'result',
        status: result.status,
        durationMs: Math.max(0, Date.now() - startedAt),
        ...(result.resultId === undefined ? {} : { resultId: result.resultId }),
        ...(result.usage === undefined ? {} : { usage: result.usage }),
      })
    },
  }
}
