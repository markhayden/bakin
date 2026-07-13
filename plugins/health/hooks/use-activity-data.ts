'use client'

import type { UsageFeedData, UsageKind } from '../types'
import { useHealthResource } from './use-health-resource'

export type ActivityWindow = '5m' | '1h' | '24h'
export type ActivityKindFilter = 'all' | UsageKind

export function useActivityData(options: {
  window: ActivityWindow
  kind: ActivityKindFilter
  includeRoutine: boolean
}) {
  const params = new URLSearchParams({ window: options.window })
  if (options.kind !== 'all') params.set('kind', options.kind)
  if (options.includeRoutine) params.set('includeRoutine', 'true')
  return useHealthResource<UsageFeedData>(`/api/plugins/health/usage-feed?${params.toString()}`, {
    intervalMs: 15_000,
  })
}
