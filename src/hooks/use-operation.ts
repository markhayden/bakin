'use client'

import { useCallback, useEffect, useEffectEvent, useReducer, useRef } from 'react'
import {
  isOperationFinished,
  type OperationCancelResult,
  type OperationGetResponse,
  type OperationPhase,
  type OperationStartResponse,
  type OperationView,
} from '@makinbakin/sdk/types'
import { usePluginEvent } from './use-plugin-event'

/**
 * Follow one server operation (#895 D3/D9) over the shell's single SSE
 * connection, reconciling from `GET /api/operations/:id?children=1`.
 *
 * Guards: a view replaces the held one only with a higher `rev`; views and
 * answers from a boot other than the held one never apply. A different boot
 * on a read latches `restarted` (outcome unknown) and nothing after it
 * applies — not even a late answer from the old boot. A 404 from the held
 * boot is `expired`. A failed read is `unreachable` and retries with bounded
 * backoff, keeping the last view on screen.
 */

export interface UseOperationOptions<B = unknown> {
  /** The boot id from the start response; adopted from the first read when omitted. */
  bootId?: string
  /**
   * Called once per followed operation when it settles: finished (with its
   * final view), or expired / restarted (the outcome went missing — the
   * view is whatever was last seen, possibly null). The settle is the
   * operation's event; consumers record outcomes here, never in an effect
   * watching `phase` (issue 966b).
   */
  onSettle?: (operation: OperationView<B> | null, phase: OperationPhase) => void
}

export interface UseOperationResult<B = unknown> {
  operation: OperationView<B> | null
  /** Child operations in the parent's declared order (repair apply). */
  children: OperationView[]
  phase: OperationPhase
  /** Requests cancel; the view moves through `cancelling` → `cancelled` on its own. */
  cancel: () => Promise<OperationCancelResult | 'unreachable'>
}

export const OPERATION_UPDATED_EVENT = 'operation.updated'
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000]

export interface OperationFollowState {
  id: string | null
  bootId: string | null
  operation: OperationView | null
  children: Record<string, OperationView>
  phase: OperationPhase
}

export type OperationFollowInput =
  | { type: 'read'; bootId: string; operation: OperationView; children?: OperationView[] }
  | { type: 'not-found'; bootId: string }
  | { type: 'unreachable' }
  | { type: 'event'; view: OperationView }

export function initialFollowState(id: string | null, bootId?: string): OperationFollowState {
  return { id, bootId: bootId ?? null, operation: null, children: {}, phase: 'loading' }
}

function newer(held: OperationView | null | undefined, next: OperationView): boolean {
  return !held || next.rev > held.rev
}

function phaseOf(operation: OperationView | null, fallback: OperationPhase): OperationPhase {
  if (!operation) return fallback
  return isOperationFinished(operation.status) ? 'finished' : 'live'
}

function mergeChildren(held: Record<string, OperationView>, incoming: OperationView[]): Record<string, OperationView> {
  let next = held
  for (const child of incoming) {
    if (!newer(held[child.id], child)) continue
    if (next === held) next = { ...held }
    next[child.id] = child
  }
  return next
}

/** Pure: applies one read or event under the rev and boot guards. */
export function reduceOperationFollow(state: OperationFollowState, input: OperationFollowInput): OperationFollowState {
  if (state.phase === 'restarted' || state.phase === 'expired') return state
  switch (input.type) {
    case 'read': {
      if (state.bootId && input.bootId !== state.bootId) return { ...state, phase: 'restarted' }
      if (input.operation.id !== state.id) return state
      const operation = newer(state.operation, input.operation) ? input.operation : state.operation
      const children = mergeChildren(state.children, input.children ?? [])
      return { ...state, bootId: input.bootId, operation, children, phase: phaseOf(operation, 'loading') }
    }
    case 'not-found': {
      if (state.bootId && input.bootId !== state.bootId) return { ...state, phase: 'restarted' }
      // A finished record that aged out of the registry stays finished.
      if (state.phase === 'finished') return state
      return { ...state, bootId: input.bootId, phase: 'expired' }
    }
    case 'unreachable':
      return state.phase === 'finished' || state.phase === 'unreachable' ? state : { ...state, phase: 'unreachable' }
    case 'event': {
      const { view } = input
      if (state.bootId && view.bootId !== state.bootId) return state
      if (view.id === state.id) {
        if (!newer(state.operation, view)) return state
        return { ...state, bootId: view.bootId, operation: view, phase: phaseOf(view, state.phase) }
      }
      if (view.parentId === state.id && newer(state.children[view.id], view)) {
        return { ...state, children: { ...state.children, [view.id]: view } }
      }
      return state
    }
  }
}

type Action = OperationFollowInput | { type: 'reset'; id: string | null; bootId?: string }

function reducer(state: OperationFollowState, action: Action): OperationFollowState {
  return action.type === 'reset' ? initialFollowState(action.id, action.bootId) : reduceOperationFollow(state, action)
}

function settled(phase: OperationPhase): boolean {
  return phase === 'finished' || phase === 'expired' || phase === 'restarted'
}

export function useOperation<B = unknown>(id: string | null, opts: UseOperationOptions<B> = {}): UseOperationResult<B> {
  const [state, dispatch] = useReducer(reducer, initialFollowState(id, opts.bootId))
  if (state.id !== id) dispatch({ type: 'reset', id, bootId: opts.bootId })

  const phaseRef = useRef(state.phase)
  phaseRef.current = state.phase

  // One settle event per followed id, delivered to the latest callback.
  const settleEvent = useEffectEvent((operation: OperationView<B> | null, phase: OperationPhase) => { opts.onSettle?.(operation, phase) })
  // Scoped to one follow: following nothing (id null) ends the lifecycle, so
  // following the same operation again settles again.
  const settledFor = useRef<string | null>(null)
  useEffect(() => {
    if (!id) { settledFor.current = null; return }
    if (!settled(state.phase) || settledFor.current === id) return
    settledFor.current = id
    settleEvent(state.operation as OperationView<B> | null, state.phase)
  }, [id, state.phase, state.operation])

  const read = useCallback(async (signal?: AbortSignal) => {
    if (!id) return
    let res: Response
    try {
      res = await fetch(`/api/operations/${encodeURIComponent(id)}?children=1`, { signal })
    } catch {
      if (!signal?.aborted) dispatch({ type: 'unreachable' })
      return
    }
    if (signal?.aborted) return
    const body = (await res.json().catch(() => null)) as (Partial<OperationGetResponse> & { error?: string }) | null
    if (signal?.aborted) return
    if (res.ok && body?.bootId && body.operation) {
      dispatch({ type: 'read', bootId: body.bootId, operation: body.operation, children: body.children })
    } else if (res.status === 404 && body?.bootId) {
      dispatch({ type: 'not-found', bootId: body.bootId })
    } else {
      dispatch({ type: 'unreachable' })
    }
  }, [id])

  useEffect(() => {
    const controller = new AbortController()
    void read(controller.signal)
    return () => controller.abort()
  }, [read])

  // Bounded backoff while unreachable; leaving the phase ends the loop.
  useEffect(() => {
    if (state.phase !== 'unreachable') return
    const controller = new AbortController()
    let attempt = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]
      attempt += 1
      timer = setTimeout(async () => {
        await read(controller.signal)
        if (!controller.signal.aborted && phaseRef.current === 'unreachable') schedule()
      }, delay)
    }
    schedule()
    return () => { clearTimeout(timer); controller.abort() }
  }, [state.phase, read])

  usePluginEvent(OPERATION_UPDATED_EVENT, (payload) => {
    const view = payload.view as OperationView | undefined
    if (view && typeof view.id === 'string') dispatch({ type: 'event', view })
  })
  usePluginEvent('bakin.reconcile', () => {
    if (!settled(phaseRef.current)) void read()
  })

  const cancel = useCallback(async (): Promise<OperationCancelResult | 'unreachable'> => {
    if (!id) return 'not_found'
    try {
      const res = await fetch(`/api/operations/${encodeURIComponent(id)}/cancel`, { method: 'POST' })
      const body = (await res.json().catch(() => null)) as { status?: OperationCancelResult } | null
      void read()
      return body?.status ?? 'unreachable'
    } catch {
      return 'unreachable'
    }
  }, [id, read])

  const operation = state.operation as OperationView<B> | null
  const children = (operation?.children ?? []).map((childId) => state.children[childId]).filter((c): c is OperationView => Boolean(c))
  return { operation, children, phase: state.phase, cancel }
}

/** A converted route refused the request (its original 4xx/5xx and JSON body). */
export class OperationStartError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    const message = body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : `Request failed (${status})`
    super(message)
    this.name = 'OperationStartError'
  }
}

/**
 * Calls a converted route and returns its `{ operationId, bootId }` (202, or
 * 200 when attached to an identical live request). Any other answer throws
 * an `OperationStartError` carrying the route's status and body.
 */
export async function startOperation(fetcher: () => Promise<Response>): Promise<OperationStartResponse> {
  const res = await fetcher()
  const body = (await res.json().catch(() => null)) as Partial<OperationStartResponse> | null
  if (!res.ok || typeof body?.operationId !== 'string' || typeof body.bootId !== 'string') {
    throw new OperationStartError(res.status, body)
  }
  return { operationId: body.operationId, bootId: body.bootId, ...(body.attached ? { attached: true as const } : {}) }
}
