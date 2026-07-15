'use client'

import type { UsageKind } from '../types'
import { useHealthResource } from './use-health-resource'

export type ActivityWindow = '5m' | '1h' | '24h'
export type ActivityKindFilter = 'all' | UsageKind

export interface ActivityFailureTarget {
  kind: UsageKind
  method: string | null
  destination: string
}

export function useActivityData(options: {
  window: ActivityWindow
  kind: ActivityKindFilter
  includeRoutine: boolean
  failureGroupOffset?: number
  failureGroupLimit?: number
  failureGroupTarget?: ActivityFailureTarget
  /** Only enable additive target params after a response advertises support. */
  exactFailureTargetingSupported?: boolean
}) {
  const params = new URLSearchParams({ window: options.window })
  if (options.kind !== 'all') params.set('kind', options.kind)
  if (options.includeRoutine) params.set('includeRoutine', 'true')
  if (options.failureGroupOffset !== undefined) {
    params.set('failureGroupOffset', options.failureGroupOffset.toString())
  }
  if (options.failureGroupLimit !== undefined) {
    params.set('failureGroupLimit', options.failureGroupLimit.toString())
  }
  if (options.exactFailureTargetingSupported && options.failureGroupTarget) {
    params.set('failureGroupTargetKind', options.failureGroupTarget.kind)
    params.set('failureGroupTargetMethod', options.failureGroupTarget.method ?? '')
    params.set('failureGroupTargetDestination', options.failureGroupTarget.destination)
  }
  // Keep transport data unknown until Activity's canonical parser (with its
  // isolated rolling-version adapter) validates the browser boundary.
  return useHealthResource<unknown>(`/api/plugins/health/usage-feed?${params.toString()}`, {
    intervalMs: 15_000,
  })
}
