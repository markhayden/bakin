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
import { withDeadline } from '../lib/request-deadline'

export const SYSTEM_REFRESH_MS = 60_000
export const SYSTEM_REQUEST_TIMEOUT_MS = 15_000
export const SYSTEM_MUTATION_OPERATION_TIMEOUT_MS = 5 * 60_000

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

export type SystemMutationStatus = 'idle' | 'pending' | 'success' | 'error' | 'confirmation' | 'outcome-unknown'

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
  noop: boolean
}

export interface SystemMutationTimeouts {
  /** Maximum wait for the server operation to return response headers. */
  operationMs?: number
  /** Maximum wait to consume the response body after the operation returns. */
  responseBodyMs?: number
}

export class SystemMutationOutcomeUnknownError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SystemMutationOutcomeUnknownError'
  }
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

async function responseJsonWithTimeout(response: Response, timeoutMs: number): Promise<unknown> {
  return await withDeadline(
    responseJson(response),
    timeoutMs,
    { timeoutError: () => new Error(`System response body timed out after ${timeoutMs}ms`) },
  )
}

async function mutationResponseJson(
  response: Response,
  timeoutMs: number,
  outcomeUnknownMessage: string,
): Promise<unknown> {
  try {
    return await responseJsonWithTimeout(response, timeoutMs)
  } catch (error) {
    if (response.ok) throw new SystemMutationOutcomeUnknownError(outcomeUnknownMessage)
    throw error
  }
}

async function fetchSystemJson(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = SYSTEM_REQUEST_TIMEOUT_MS,
): Promise<{ response: Response; body: unknown }> {
  const controller = new AbortController()
  return await withDeadline((async () => {
    const response = await fetch(url, { ...init, signal: controller.signal })
    return { response, body: await responseJson(response) }
  })(), timeoutMs, {
    timeoutError: () => new Error(`System request timed out after ${timeoutMs}ms`),
    onTimeout: () => controller.abort(),
  })
}

async function fetchSystemMutation(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<Response> {
  const controller = new AbortController()
  return await withDeadline(
    fetch(url, { ...init, signal: controller.signal }),
    timeoutMs,
    {
      timeoutError: () => new SystemMutationOutcomeUnknownError(timeoutMessage),
      onTimeout: () => controller.abort(),
    },
  )
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
  timeouts: SystemMutationTimeouts = {},
): Promise<SearchReindexResult> {
  const operationMs = timeouts.operationMs ?? SYSTEM_MUTATION_OPERATION_TIMEOUT_MS
  const responseBodyMs = timeouts.responseBodyMs ?? SYSTEM_REQUEST_TIMEOUT_MS
  const url = `/api/reindex${table ? `?table=${encodeURIComponent(table)}` : ''}`
  const response = await fetchSystemMutation(
    url,
    { method: 'POST' },
    operationMs,
    'Search reindex is taking longer than expected. The server may still be rebuilding indexes; refresh live data to confirm the result.',
  )
  const confirmationUnknown = 'Search reindex returned success headers, but Bakin could not read its confirmation. The server may have completed the rebuild; refresh live data to confirm the result.'
  const body = await mutationResponseJson(response, responseBodyMs, confirmationUnknown)
  if (!response.ok || (isRecord(body) && body.ok === false)) {
    throw responseError(response, body, 'Search reindex failed')
  }
  if (!isRecord(body) || body.ok !== true) {
    throw new SystemMutationOutcomeUnknownError(
      'Search reindex returned success headers, but Bakin could not confirm the result. Refresh live data before trying again.',
    )
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
  timeouts: SystemMutationTimeouts = {},
): Promise<PluginUpgradeResult> {
  const operationMs = timeouts.operationMs ?? SYSTEM_MUTATION_OPERATION_TIMEOUT_MS
  const responseBodyMs = timeouts.responseBodyMs ?? SYSTEM_REQUEST_TIMEOUT_MS
  const response = await fetchSystemMutation(
    '/api/plugins/upgrade',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pluginId, ...(approvePermissions ? { yes: true } : {}) }),
    },
    operationMs,
    'The plugin update is taking longer than expected. The server may still be updating it; refresh live data to confirm the result.',
  )
  const confirmationUnknown = 'The plugin update returned success headers, but Bakin could not read its confirmation. The server may have completed the update; refresh live data to confirm the result.'
  const body = await mutationResponseJson(response, responseBodyMs, confirmationUnknown)
  if (!response.ok || (isRecord(body) && body.ok === false)) {
    throw responseError(response, body, 'Plugin update failed')
  }
  if (!isRecord(body)
    || body.ok !== true
    || typeof body.noop !== 'boolean'
    || typeof body.awaitingConsent !== 'boolean'
    || !Array.isArray(body.newPermissions)
    || !body.newPermissions.every((permission) => typeof permission === 'string')) {
    throw new SystemMutationOutcomeUnknownError(
      'The plugin update returned success headers, but Bakin could not confirm the result. Refresh live data before trying again.',
    )
  }
  const awaitingConsent = body.awaitingConsent
  const permissions = body.newPermissions
  const noop = body.noop
  return {
    awaitingConsent,
    permissions,
    noop,
    message: noop
      ? `${pluginId} is already current.`
      : awaitingConsent
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
    timeoutMs: SYSTEM_REQUEST_TIMEOUT_MS,
    request: requestJson,
  })
  const searchStatus = useHealthResource<SearchHealthData>('/api/plugins/health/search-status', {
    intervalMs: SYSTEM_REFRESH_MS,
    timeoutMs: SYSTEM_REQUEST_TIMEOUT_MS,
    request: requestJson,
  })
  const searchTelemetry = useHealthResource<SearchTelemetryData>('/api/plugins/health/search-telemetry', {
    intervalMs: SYSTEM_REFRESH_MS,
    timeoutMs: SYSTEM_REQUEST_TIMEOUT_MS,
    request: requestJson,
  })
  const registry = useHealthResource<SystemRegistryData>('/api/plugins/health/registry', {
    intervalMs: SYSTEM_REFRESH_MS,
    timeoutMs: SYSTEM_REQUEST_TIMEOUT_MS,
    request: requestJson,
  })
  const pluginManifest = useHealthResource<SystemPluginManifestData>('/api/plugins/manifest', {
    intervalMs: SYSTEM_REFRESH_MS,
    timeoutMs: SYSTEM_REQUEST_TIMEOUT_MS,
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
    const { response: readinessResponse, body: readinessBody } = await fetchSystemJson('/api/plugins/health/search-readiness')
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
        status: error instanceof SystemMutationOutcomeUnknownError ? 'outcome-unknown' : 'error',
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
        status: error instanceof SystemMutationOutcomeUnknownError ? 'outcome-unknown' : 'error',
        message: error instanceof Error ? error.message : String(error),
        target: pluginId,
      })
    }
  }, [pluginManifestRefresh, registryRefresh, reportRefresh])

  const refreshSystemDetails = useCallback(async () => {
    const results = await Promise.all([
      liveRefresh('reconcile'),
      searchStatusRefresh('reconcile'),
      searchTelemetryRefresh('reconcile'),
      registryRefresh('reconcile'),
      pluginManifestRefresh('reconcile'),
      reportRefresh('background'),
    ])
    const searchReconciled = results[1] !== null && results[2] !== null
    const pluginsReconciled = results[3] !== null && results[4] !== null
    if (searchReconciled) {
      setSearchMutation((state) => state.status === 'outcome-unknown' ? IDLE_MUTATION : state)
    }
    if (pluginsReconciled) {
      setPluginMutation((state) => state.status === 'outcome-unknown' ? IDLE_MUTATION : state)
    }
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
