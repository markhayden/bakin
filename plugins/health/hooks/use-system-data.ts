'use client'

import { useCallback, useState } from 'react'
import type {
  HealthSummary,
  PluginManifestEntry,
  RegistryData,
  SearchHealthData,
  SearchTelemetryData,
} from '../types'
import { useHealthReport, type UseHealthReportResult } from './use-health-report'
import {
  useHealthResource,
  type HealthResourceRequestContext,
  type UseHealthResourceResult,
} from './use-health-resource'

export const SYSTEM_REFRESH_MS = 60_000

export interface SystemRegistryPlugin {
  id: string
  name: string
  version: string
  description: string
  source: 'built-in' | 'user'
  status: 'active' | 'failed'
  routes: number
  errorCode?: string
  errorMessage?: string
  missingDependencies?: string[]
}

export interface SystemRegistryData extends Omit<RegistryData, 'plugins'> {
  plugins: SystemRegistryPlugin[]
}

export interface SystemPluginManifestEntry extends PluginManifestEntry {
  status?: 'active' | 'failed'
  errorCode?: string
  errorMessage?: string
  missingDependencies?: string[]
}

export interface SystemPluginManifestData {
  plugins: SystemPluginManifestEntry[]
}

export type SystemMutationStatus = 'idle' | 'pending' | 'success' | 'error' | 'confirmation'

export interface SystemMutationState {
  status: SystemMutationStatus
  message: string | null
  target: string | null
  permissions?: string[]
}

export interface SearchReindexResult {
  message: string
}

export interface PluginUpgradeResult {
  message: string
  awaitingConsent: boolean
  permissions: string[]
}

const IDLE_MUTATION: SystemMutationState = { status: 'idle', message: null, target: null }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function responseJson(response: Response): Promise<unknown> {
  return await response.json().catch(() => null)
}

function responseError(response: Response, body: unknown, fallback: string): Error {
  const message = isRecord(body) && typeof body.error === 'string' && body.error.length > 0
    ? body.error
    : `${fallback} (${response.status})`
  return new Error(message)
}

async function requestJson<T>(url: string, context: HealthResourceRequestContext): Promise<T> {
  const response = await fetch(url, { signal: context.signal })
  const body = await responseJson(response)
  if (!response.ok) throw responseError(response, body, 'Request failed')
  return body as T
}

async function requestPluginManifest(
  url: string,
  context: HealthResourceRequestContext,
): Promise<SystemPluginManifestData> {
  const shouldCheck = context.reason === 'explicit'
  const requestUrl = shouldCheck ? `${url}${url.includes('?') ? '&' : '?'}check=1` : url
  const body = await requestJson<unknown>(requestUrl, context)
  if (!isRecord(body) || !Array.isArray(body.plugins)) {
    throw new Error('Plugin manifest response was invalid')
  }
  return body as unknown as SystemPluginManifestData
}

/**
 * Validate the reindex response before asking the server to refresh canonical
 * Search readiness. This ordering prevents a rejected mutation from looking
 * successful merely because a later status read happened to work.
 */
export async function performSearchReindex(
  table: string | undefined,
  refreshReadiness: () => Promise<void>,
): Promise<SearchReindexResult> {
  const url = `/api/reindex${table ? `?table=${encodeURIComponent(table)}` : ''}`
  const response = await fetch(url, { method: 'POST' })
  const body = await responseJson(response)
  if (!response.ok || (isRecord(body) && body.ok === false)) {
    throw responseError(response, body, 'Search reindex failed')
  }
  try {
    await refreshReadiness()
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Reindex started, but Search readiness could not be refreshed: ${detail}`)
  }
  return {
    message: table
      ? `Reindex started for ${table}. Readiness was refreshed.`
      : 'Reindex started for all Search indexes. Readiness was refreshed.',
  }
}

export async function performPluginUpgrade(
  pluginId: string,
  approvePermissions = false,
): Promise<PluginUpgradeResult> {
  const response = await fetch('/api/plugins/upgrade', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pluginId, ...(approvePermissions ? { yes: true } : {}) }),
  })
  const body = await responseJson(response)
  if (!response.ok || (isRecord(body) && body.ok === false)) {
    throw responseError(response, body, 'Plugin update failed')
  }
  const awaitingConsent = isRecord(body) && body.awaitingConsent === true
  const permissions = isRecord(body) && Array.isArray(body.newPermissions)
    ? body.newPermissions.map(String)
    : []
  return {
    awaitingConsent,
    permissions,
    message: awaitingConsent
      ? 'This update requests new permissions.'
      : `${pluginId} was updated and reactivated.`,
  }
}

export interface UseSystemDataResult {
  report: UseHealthReportResult
  live: UseHealthResourceResult<HealthSummary>
  searchStatus: UseHealthResourceResult<SearchHealthData>
  searchTelemetry: UseHealthResourceResult<SearchTelemetryData>
  registry: UseHealthResourceResult<SystemRegistryData>
  pluginManifest: UseHealthResourceResult<SystemPluginManifestData>
  searchMutation: SystemMutationState
  pluginMutation: SystemMutationState
  reindexSearch: (table?: string) => Promise<void>
  checkPluginUpdates: () => Promise<SystemPluginManifestData | null>
  upgradePlugin: (pluginId: string, approvePermissions?: boolean) => Promise<void>
  refreshSystemDetails: () => Promise<void>
}

/** Source-aware resources used only while the System tab is mounted. */
export function useSystemData(): UseSystemDataResult {
  const report = useHealthReport()
  const live = useHealthResource<HealthSummary>('/api/plugins/health/summary', {
    intervalMs: SYSTEM_REFRESH_MS,
    request: requestJson,
  })
  const searchStatus = useHealthResource<SearchHealthData>('/api/plugins/health/search-status', {
    intervalMs: SYSTEM_REFRESH_MS,
    request: requestJson,
  })
  const searchTelemetry = useHealthResource<SearchTelemetryData>('/api/plugins/health/search-telemetry', {
    intervalMs: SYSTEM_REFRESH_MS,
    request: requestJson,
  })
  const registry = useHealthResource<SystemRegistryData>('/api/plugins/health/registry', {
    intervalMs: SYSTEM_REFRESH_MS,
    request: requestJson,
  })
  const pluginManifest = useHealthResource<SystemPluginManifestData>('/api/plugins/manifest', {
    intervalMs: SYSTEM_REFRESH_MS,
    request: requestPluginManifest,
  })
  const [searchMutation, setSearchMutation] = useState<SystemMutationState>(IDLE_MUTATION)
  const [pluginMutation, setPluginMutation] = useState<SystemMutationState>(IDLE_MUTATION)
  const reportRefresh = report.refresh
  const liveRefresh = live.refresh
  const searchStatusRefresh = searchStatus.refresh
  const searchTelemetryRefresh = searchTelemetry.refresh
  const registryRefresh = registry.refresh
  const pluginManifestRefresh = pluginManifest.refresh

  const refreshCanonicalSearchReadiness = useCallback(async () => {
    const readinessResponse = await fetch('/api/plugins/health/search-readiness')
    const readinessBody = await responseJson(readinessResponse)
    if (!readinessResponse.ok) {
      throw responseError(readinessResponse, readinessBody, 'Search readiness refresh failed')
    }
    if (!isRecord(readinessBody) || !isRecord(readinessBody.readiness)) {
      throw new Error('Search readiness response was invalid')
    }
    await Promise.all([
      searchStatusRefresh('explicit'),
      searchTelemetryRefresh('explicit'),
      reportRefresh('background'),
    ])
  }, [reportRefresh, searchStatusRefresh, searchTelemetryRefresh])

  const reindexSearch = useCallback(async (table?: string) => {
    const target = table ?? 'all'
    setSearchMutation({ status: 'pending', message: null, target })
    try {
      const result = await performSearchReindex(table, refreshCanonicalSearchReadiness)
      setSearchMutation({ status: 'success', message: result.message, target })
    } catch (error) {
      setSearchMutation({
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
        target,
      })
    }
  }, [refreshCanonicalSearchReadiness])

  const checkPluginUpdates = useCallback(() => pluginManifestRefresh('explicit'), [pluginManifestRefresh])

  const upgradePlugin = useCallback(async (pluginId: string, approvePermissions = false) => {
    setPluginMutation({ status: 'pending', message: null, target: pluginId })
    try {
      const result = await performPluginUpgrade(pluginId, approvePermissions)
      if (result.awaitingConsent) {
        setPluginMutation({
          status: 'confirmation',
          message: result.message,
          target: pluginId,
          permissions: result.permissions,
        })
        return
      }
      await Promise.all([
        registryRefresh('explicit'),
        pluginManifestRefresh('explicit'),
        reportRefresh('background'),
      ])
      setPluginMutation({ status: 'success', message: result.message, target: pluginId })
    } catch (error) {
      setPluginMutation({
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
        target: pluginId,
      })
    }
  }, [pluginManifestRefresh, registryRefresh, reportRefresh])

  const refreshSystemDetails = useCallback(async () => {
    await Promise.all([
      liveRefresh('explicit'),
      searchStatusRefresh('explicit'),
      searchTelemetryRefresh('explicit'),
      registryRefresh('explicit'),
      pluginManifestRefresh('background'),
      reportRefresh('background'),
    ])
  }, [liveRefresh, pluginManifestRefresh, registryRefresh, reportRefresh, searchStatusRefresh, searchTelemetryRefresh])

  return {
    report,
    live,
    searchStatus,
    searchTelemetry,
    registry,
    pluginManifest,
    searchMutation,
    pluginMutation,
    reindexSearch,
    checkPluginUpdates,
    upgradePlugin,
    refreshSystemDetails,
  }
}
