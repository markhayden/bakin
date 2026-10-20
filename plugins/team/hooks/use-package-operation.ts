'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { OperationStartResponse } from '@makinbakin/sdk/types'
import { startOperation, useOperation } from '@makinbakin/sdk/hooks'

/**
 * Start a converted package route (install, remove, sync, team sync) and
 * follow its operation live (#895). The body the route used to answer arrives
 * as `result` once the operation settles — no request deadline, no guess.
 */
export type PackageOperationSettle<B> =
  | { result: { httpStatus: number; body: B | undefined }; error?: undefined }
  | { error: string; result?: undefined }

export interface UsePackageOperationOptions<B> {
  /**
   * Called once per start: with the settled operation's result (the body the
   * route used to answer), or with the reason the start itself failed. The
   * settle is the operation's event — consumers record outcomes here, never
   * in an effect watching `result` (#966b).
   */
  onSettle?: (settle: PackageOperationSettle<B>) => void
}

export function usePackageOperation<B = Record<string, unknown>>(opts: UsePackageOperationOptions<B> = {}) {
  const [started, setStarted] = useState<OperationStartResponse | null>(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The latest callback, read by the start path (an async handler) and by the
  // followed operation's settle; written from an effect, never during render.
  const optsRef = useRef(opts)
  useEffect(() => { optsRef.current = opts })
  const followed = useOperation<B>(started?.operationId ?? null, {
    ...(started ? { bootId: started.bootId } : {}),
    onSettle: (view) => {
      const settled = view && view.status !== 'running' && view.status !== 'cancelling' ? view.result ?? null : null
      if (settled) optsRef.current.onSettle?.({ result: settled as { httpStatus: number; body: B | undefined } })
    },
  })
  // A reset (the subject changed, the dialog closed) makes any start still in
  // flight obsolete: its answer must never attach to the new subject.
  const generation = useRef(0)

  const start = useCallback(async (request: () => Promise<Response>): Promise<boolean> => {
    const mine = ++generation.current
    setStarting(true)
    setError(null)
    setStarted(null)
    try {
      const next = await startOperation(request)
      if (mine !== generation.current) return false
      setStarted(next)
      return true
    } catch (caught) {
      if (mine !== generation.current) return false
      const message = caught instanceof Error ? caught.message : String(caught)
      setError(message)
      optsRef.current.onSettle?.({ error: message })
      return false
    } finally {
      if (mine === generation.current) setStarting(false)
    }
  }, [])

  const reset = useCallback(() => {
    generation.current += 1
    setStarted(null)
    setStarting(false)
    setError(null)
  }, [])

  const operation = started ? followed.operation : null
  const result = useMemo(() => {
    if (!operation || operation.status === 'running' || operation.status === 'cancelling') return null
    return operation.result ?? null
  }, [operation])

  return {
    start,
    reset,
    /** The POST that starts the operation is in flight. */
    starting,
    /** True from the click until the operation settles (or fails to start). */
    busy: starting || (operation !== null && (operation.status === 'running' || operation.status === 'cancelling')),
    operation,
    /**
     * Render `OperationProgress` while this is true: the operation is live, or
     * it ended without a result (cancelled, restarted, expired). Once a result
     * arrives the surface's own success/failure UI takes over — never both.
     */
    showProgress: operation !== null && result === null,
    phase: started ? followed.phase : null,
    cancel: followed.cancel,
    /** `{ httpStatus, body }` — what the route used to answer — once settled. */
    result,
    /** The request could not start (validation 4xx, network). */
    error,
  }
}
