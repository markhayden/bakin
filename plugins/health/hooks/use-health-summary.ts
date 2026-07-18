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
  sensitivity: 'developer' | 'standard' | 'quiet'
  incidents: Array<{
    id: string
    effectiveDisposition: 'advisory' | 'watch' | 'action_required'
  }>
}

type HealthSummaryDisposition = HealthSummaryPayload['incidents'][number]['effectiveDisposition']

function isHealthSummaryDisposition(value: unknown): value is HealthSummaryDisposition {
  return value === 'advisory' || value === 'watch' || value === 'action_required'
}

function isHealthSensitivity(value: unknown): value is HealthSummaryPayload['sensitivity'] {
  return value === 'developer' || value === 'standard' || value === 'quiet'
}

function parseHealthSummary(value: unknown): HealthSummaryPayload {
  if (typeof value !== 'object' || value === null || !('incidents' in value) || !Array.isArray(value.incidents)
    || !('sensitivity' in value) || !isHealthSensitivity(value.sensitivity)) {
    throw new Error('Health summary response was invalid')
  }
  const incidents = value.incidents.map((incident) => {
    if (typeof incident !== 'object' || incident === null
      || !('id' in incident) || typeof incident.id !== 'string'
      || !('effectiveDisposition' in incident)
      || !isHealthSummaryDisposition(incident.effectiveDisposition)) {
      throw new Error('Health summary response was invalid')
    }
    return {
      id: incident.id,
      effectiveDisposition: incident.effectiveDisposition,
    }
  })
  return { sensitivity: value.sensitivity, incidents }
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
  // D10: quiet mode notifies only for action_required — watch items stay
  // visible on the Health page but never tap the user on the shoulder.
  const badgeFloor = resource.data.sensitivity === 'quiet' ? 'action_required' : 'watch'
  const incidents = [...new Map(
    resource.data.incidents
      .filter((incident) => badgeFloor === 'action_required'
        ? incident.effectiveDisposition === 'action_required'
        : incident.effectiveDisposition !== 'advisory')
      .map((incident) => [incident.id, incident]),
  ).values()]
  return {
    count: incidents.length,
    tone: incidents.some((incident) => incident.effectiveDisposition === 'action_required') ? 'error' : 'attention',
  }
}
