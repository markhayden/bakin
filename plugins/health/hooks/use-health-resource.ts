'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export type HealthResourceRefreshReason = 'initial' | 'background' | 'explicit' | 'stale' | 'reconcile'

export interface HealthResourceRequestContext {
  signal: AbortSignal
  reason: HealthResourceRefreshReason
}

export interface UseHealthResourceOptions<T> {
  /** Background refresh cadence. Omit or use zero to disable polling. */
  intervalMs?: number
  /** Abort and surface a retryable error when a request exceeds this deadline. */
  timeoutMs?: number | ((reason: HealthResourceRefreshReason) => number | undefined)
  /** Override the standard JSON GET while retaining cancellation/coalescing. */
  request?: (url: string, context: HealthResourceRequestContext) => Promise<T>
  /** Optional source-specific freshness predicate for retained data. */
  isStale?: (data: T) => boolean
}

export interface UseHealthResourceResult<T> {
  data: T | null
  /** Failure before any usable data has loaded. */
  error: string | null
  /** Failure after usable data loaded; `data` remains available. */
  backgroundError: string | null
  /** True only while obtaining the first usable value. */
  loading: boolean
  /** True while updating retained data. */
  refreshing: boolean
  /** Retained data is known stale or its latest background refresh failed. */
  stale?: boolean
  /**
   * Refresh explicitly by default. Concurrent compatible refreshes share the
   * same promise; a fresh request supersedes a cached background read.
   */
  refresh: (reason?: Exclude<HealthResourceRefreshReason, 'initial'>) => Promise<T | null>
}

interface ResourceState<T> {
  data: T | null
  error: string | null
  backgroundError: string | null
  requesting: boolean
}

interface ActiveRequest<T> {
  controller: AbortController
  fresh: boolean
  generation: number
  promise: Promise<T | null>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Request failed'
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
    || (typeof error === 'object' && error !== null && 'name' in error
      && (error as { name?: unknown }).name === 'AbortError')
}

async function requestJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`Request failed (${response.status})`)
  return await response.json() as T
}

function requestWithTimeout<T>(
  request: Promise<T>,
  timeoutMs: number | undefined,
  onTimeout: () => void,
): Promise<T> {
  if (timeoutMs === undefined || timeoutMs <= 0) return request
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      onTimeout()
      reject(new Error(`Request timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    void request.then(
      (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function requiresFreshSweep(reason: HealthResourceRefreshReason): boolean {
  return reason === 'explicit' || reason === 'stale' || reason === 'reconcile'
}

/**
 * Source-aware JSON resource lifecycle for Health tabs.
 *
 * The hook retains the last good value across background failures, aborts a
 * request when its source changes, and also guards every commit with a request
 * generation for transports that resolve after abort. Polls and repeated
 * refreshes coalesce rather than creating overlapping reads.
 */
export function useHealthResource<T>(
  url: string | null,
  options: UseHealthResourceOptions<T> = {},
): UseHealthResourceResult<T> {
  const [state, setState] = useState<ResourceState<T>>({
    data: null,
    error: null,
    backgroundError: null,
    requesting: url !== null,
  })
  const dataRef = useRef<T | null>(null)
  const urlRef = useRef(url)
  const optionsRef = useRef(options)
  const activeRef = useRef<ActiveRequest<T> | null>(null)
  const generationRef = useRef(0)
  const mountedRef = useRef(false)

  urlRef.current = url
  optionsRef.current = options

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const startRequest = useCallback((reason: HealthResourceRefreshReason): Promise<T | null> => {
    const requestUrl = urlRef.current
    if (requestUrl === null) return Promise.resolve(null)

    const fresh = requiresFreshSweep(reason)
    const forceNew = reason === 'reconcile'
    const active = activeRef.current
    if (active) {
      // Any background read can use a fresher in-flight result. Repeated fresh
      // requests also join. Reconciliation is the exception: its result must
      // have started after the mutation whose outcome it is confirming.
      if (!forceNew && (!fresh || active.fresh)) return active.promise
      active.controller.abort()
    }

    const controller = new AbortController()
    const generation = ++generationRef.current
    const hasData = dataRef.current !== null
    setState((current) => ({
      ...current,
      error: hasData ? current.error : null,
      backgroundError: null,
      requesting: true,
    }))

    const promise = (async (): Promise<T | null> => {
      let timedOut = false
      try {
        const request = optionsRef.current.request
        const pending = request
          ? request(requestUrl, { signal: controller.signal, reason })
          : requestJson<T>(requestUrl, controller.signal)
        const timeoutOption = optionsRef.current.timeoutMs
        const timeoutMs = typeof timeoutOption === 'function' ? timeoutOption(reason) : timeoutOption
        const next = await requestWithTimeout(pending, timeoutMs, () => {
          timedOut = true
          controller.abort()
        })

        if (!mountedRef.current || controller.signal.aborted || generation !== generationRef.current) {
          return null
        }
        dataRef.current = next
        setState({ data: next, error: null, backgroundError: null, requesting: false })
        return next
      } catch (error) {
        if (generation !== generationRef.current) return null
        if (!timedOut && (controller.signal.aborted || isAbortError(error))) {
          return null
        }
        if (!mountedRef.current) return null
        const message = errorMessage(error)
        setState((current) => current.data === null
          ? { ...current, error: message, backgroundError: null, requesting: false }
          : { ...current, error: null, backgroundError: message, requesting: false })
        return null
      } finally {
        if (activeRef.current?.generation === generation) activeRef.current = null
      }
    })()

    activeRef.current = { controller, fresh, generation, promise }
    return promise
  }, [])

  const refresh = useCallback((reason: Exclude<HealthResourceRefreshReason, 'initial'> = 'explicit') =>
    startRequest(reason), [startRequest])

  useEffect(() => {
    generationRef.current += 1
    activeRef.current?.controller.abort()
    activeRef.current = null
    dataRef.current = null
    setState({
      data: null,
      error: null,
      backgroundError: null,
      requesting: url !== null,
    })
    if (url !== null) void startRequest('initial')

    return () => {
      generationRef.current += 1
      activeRef.current?.controller.abort()
      activeRef.current = null
    }
  }, [startRequest, url])

  useEffect(() => {
    const intervalMs = options.intervalMs
    if (url === null || intervalMs === undefined || intervalMs <= 0) return
    const interval = setInterval(() => { void startRequest('background') }, intervalMs)
    return () => clearInterval(interval)
  }, [options.intervalMs, startRequest, url])

  return {
    data: state.data,
    error: state.error,
    backgroundError: state.backgroundError,
    loading: state.requesting && state.data === null,
    refreshing: state.requesting && state.data !== null,
    stale: state.data !== null
      && (state.backgroundError !== null || optionsRef.current.isStale?.(state.data) === true),
    refresh,
  }
}
