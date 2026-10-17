'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import type { OperationStartResponse } from '@makinbakin/sdk/types'
import { startOperation, useOperation } from '@makinbakin/sdk/hooks'

/**
 * Start a converted package route (install, remove, sync, team sync) and
 * follow its operation live (#895). The body the route used to answer arrives
 * as `result` once the operation settles — no request deadline, no guess.
 */
export function usePackageOperation<B = Record<string, unknown>>() {
  const [started, setStarted] = useState<OperationStartResponse | null>(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const followed = useOperation<B>(started?.operationId ?? null, started ? { bootId: started.bootId } : {})
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
      setError(caught instanceof Error ? caught.message : String(caught))
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
