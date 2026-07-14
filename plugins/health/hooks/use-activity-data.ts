'use client'

import type { UsageFeedData, UsageKind } from '../types'
import { useHealthResource } from './use-health-resource'

export type ActivityWindow = '5m' | '1h' | '24h'
export type ActivityKindFilter = 'all' | UsageKind

export function useActivityData(options: {
  window: ActivityWindow
  kind: ActivityKindFilter
  includeRoutine: boolean
  failureGroupOffset?: number
  failureGroupLimit?: number
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
  return useHealthResource<UsageFeedData>(`/api/plugins/health/usage-feed?${params.toString()}`, {
    intervalMs: 15_000,
  })
}
