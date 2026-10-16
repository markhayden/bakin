/**
 * The live list of top-level operations (#895 D14) behind the header tray:
 * `GET /api/operations` on mount and on `bakin.reconcile`, then
 * `operation.updated` events merged under the rev and boot guards. Children
 * roll up into their parent and never list on their own.
 */
import { useCallback, useEffect, useReducer, useState } from 'react'
import { usePluginEvent } from '@makinbakin/sdk/hooks'
import { isOperationFinished, type OperationListResponse, type OperationView } from '@makinbakin/sdk/types'

/** A finished operation stays in the tray this long. */
export const RECENTLY_FINISHED_MS = 2 * 60_000

export interface OperationListState {
  bootId: string | null
  operations: Record<string, OperationView>
}

export type OperationListInput =
  | { type: 'list'; bootId: string; operations: OperationView[] }
  | { type: 'event'; view: OperationView }

export const EMPTY_OPERATION_LIST: OperationListState = { bootId: null, operations: {} }

/** Pure: a list read or one event, keeping the highest rev per operation within one boot. */
export function mergeOperationList(state: OperationListState, input: OperationListInput): OperationListState {
  if (input.type === 'list') {
    const sameBoot = state.bootId === input.bootId
    const operations: Record<string, OperationView> = {}
    for (const view of input.operations) {
      if (view.parentId) continue
      const held = sameBoot ? state.operations[view.id] : undefined
      operations[view.id] = held && held.rev > view.rev ? held : view
    }
    return { bootId: input.bootId, operations }
  }
  const { view } = input
  if (view.parentId) return state
  // A different boot means the server restarted: everything held is gone.
  if (state.bootId && view.bootId !== state.bootId) return { bootId: view.bootId, operations: { [view.id]: view } }
  const held = state.operations[view.id]
  if (held && held.rev >= view.rev) return state
  return { bootId: view.bootId, operations: { ...state.operations, [view.id]: view } }
}

/** Running work, then what finished in the last couple of minutes; newest first. */
export function visibleOperations(state: OperationListState, now: number): OperationView[] {
  return Object.values(state.operations)
    .filter((op) => !isOperationFinished(op.status) || (op.endedAt !== undefined && now - Date.parse(op.endedAt) < RECENTLY_FINISHED_MS))
    .sort((a, b) => {
      const live = Number(isOperationFinished(a.status)) - Number(isOperationFinished(b.status))
      return live !== 0 ? live : Date.parse(b.startedAt) - Date.parse(a.startedAt)
    })
}

export function useOperationsList(): OperationView[] {
  const [state, dispatch] = useReducer(mergeOperationList, EMPTY_OPERATION_LIST)
  const [now, setNow] = useState(() => Date.now())

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch('/api/operations', { signal })
      if (!res.ok) return
      const body = (await res.json()) as Partial<OperationListResponse> | null
      // A malformed answer must never take the header down with it.
      if (signal?.aborted || typeof body?.bootId !== 'string' || !Array.isArray(body.operations)) return
      dispatch({ type: 'list', bootId: body.bootId, operations: body.operations })
    } catch {
      // The tray is a convenience view; the next reconcile or event fills it in.
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void refresh(controller.signal)
    return () => controller.abort()
  }, [refresh])

  usePluginEvent('operation.updated', (payload) => {
    const view = payload.view as OperationView | undefined
    if (view && typeof view.id === 'string') {
      setNow(Date.now())
      dispatch({ type: 'event', view })
    }
  })
  usePluginEvent('bakin.reconcile', () => { void refresh() })

  const visible = visibleOperations(state, now)
  const hasRecent = visible.some((op) => isOperationFinished(op.status))
  // Only tick while something finished is waiting to age out of the tray.
  useEffect(() => {
    if (!hasRecent) return
    const timer = setInterval(() => setNow(Date.now()), 10_000)
    return () => clearInterval(timer)
  }, [hasRecent])

  return visible
}
