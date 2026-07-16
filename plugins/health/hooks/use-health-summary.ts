'use client'

import { usePluginEvent } from '@makinbakin/sdk/hooks'
import type { NavBadgeTone } from '@makinbakin/sdk'
import {
  useHealthResource,
  type HealthResourceRequestContext,
} from './use-health-resource'

interface UseHealthSummaryResult {
  count: number | null
  tone: Extract<NavBadgeTone, 'error' | 'attention'>
}

interface HealthSummaryPayload {
  incidents: Array<{
    id: string
    disposition: 'advisory' | 'watch' | 'action_required'
  }>
}

type HealthSummaryDisposition = HealthSummaryPayload['incidents'][number]['disposition']

function isHealthSummaryDisposition(value: unknown): value is HealthSummaryDisposition {
  return value === 'advisory' || value === 'watch' || value === 'action_required'
}

function parseHealthSummary(value: unknown): HealthSummaryPayload {
  if (typeof value !== 'object' || value === null || !('incidents' in value) || !Array.isArray(value.incidents)) {
    throw new Error('Health summary response was invalid')
  }
  const incidents = value.incidents.map((incident) => {
    if (typeof incident !== 'object' || incident === null
      || !('id' in incident) || typeof incident.id !== 'string'
      || !('disposition' in incident)
      || !isHealthSummaryDisposition(incident.disposition)) {
      throw new Error('Health summary response was invalid')
    }
    return {
      id: incident.id,
      disposition: incident.disposition,
    }
  })
  return { incidents }
}

async function requestHealthSummary(
  url: string,
  context: HealthResourceRequestContext,
): Promise<HealthSummaryPayload> {
  const response = await fetch(url, { signal: context.signal })
  if (!response.ok) throw new Error(`Failed to load health summary (${response.status})`)
  return parseHealthSummary(await response.json())
}

/**
 * Unique non-advisory incident count for the Health nav badge. The canonical
 * cached report is cheap to project and is refreshed through the shell's one
 * plugin-event connection; this hook opens no EventSource and does not poll.
 */
export function useHealthSummary(): UseHealthSummaryResult {
  const resource = useHealthResource<HealthSummaryPayload>('/api/plugins/health/doctor', {
    request: requestHealthSummary,
  })
  usePluginEvent('health.report.changed', () => { void resource.refresh('reconcile') })

  if (!resource.data) return { count: null, tone: 'attention' }
  const incidents = [...new Map(
    resource.data.incidents
      .filter((incident) => incident.disposition !== 'advisory')
      .map((incident) => [incident.id, incident]),
  ).values()]
  return {
    count: incidents.length,
    tone: incidents.some((incident) => incident.disposition === 'action_required') ? 'error' : 'attention',
  }
}
