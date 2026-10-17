'use client'

import { useCallback, useEffect, useState } from 'react'
import type { ZodType } from 'zod'
import { isOperationFinished, type OperationStartResponse, type OperationView } from '@makinbakin/sdk/types'
import { startOperation, useOperation } from '@makinbakin/sdk/hooks'
import type { HealthSummary, SearchHealthData, SearchTelemetryData } from '../types'
import { useHealthReport, type UseHealthReportResult } from './use-health-report'
import {
  useHealthResource,
  type HealthResourceRequestContext,
  type UseHealthResourceResult,
} from './use-health-resource'
import { withDeadline } from '../lib/request-deadline'
import { healthLiveSummaryClientSchema } from '../lib/route-schemas'
import {
  searchStatusResponseSchema,
  searchTelemetryClientResponseSchema,
  systemPluginManifestClientSchema,
  systemRegistryResponseSchema,
  type SystemPluginManifestData,
  type SystemPluginManifestEntry,
  type SystemRegistryData,
  type SystemRegistryPlugin,
} from '../lib/system-route-schemas'

export type {
  SystemPluginManifestData,
  SystemPluginManifestEntry,
  SystemRegistryData,
  SystemRegistryPlugin,
}

export const SYSTEM_REFRESH_MS = 60_000
export const SYSTEM_REQUEST_TIMEOUT_MS = 15_000
export const SYSTEM_MUTATION_OPERATION_TIMEOUT_MS = 5 * 60_000

export type SystemMutationStatus = 'idle' | 'pending' | 'success' | 'error' | 'confirmation' | 'outcome-unknown'

/** A binary download an upgrade asks consent for (name, version, pinned sha, size hint). */
export interface PluginUpgradeBin {
  name: string
  version: string
  sha256: string
  sizeBytes?: number
}

export interface SystemMutationState {
  status: SystemMutationStatus
  message: string | null
  target: string | null
  permissions?: string[]
  bins?: PluginUpgradeBin[]
  /** Preview token to echo on approval — the server commits only while the target still matches it. */
  consentToken?: string
  /** The running upgrade (preview or commit), followed live — render it while pending. */
  operation?: OperationView
}

export interface SearchReindexResult {
  message: string
}

export interface PluginUpgradeResult {
  message: string
  awaitingConsent: boolean
  permissions: string[]
  bins: PluginUpgradeBin[]
  consentToken?: string
  noop: boolean
  /** A preview with nothing new to consent to: commit with `consentToken` to apply it. */
  ready?: boolean
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

async function requestJson(url: string, context: HealthResourceRequestContext): Promise<unknown> {
  const response = await fetch(url, { signal: context.signal })
  const body = await responseJson(response)
  if (!response.ok) throw responseError(response, body, 'Request failed')
  return body
}

async function requestValidated<T>(
  url: string,
  context: HealthResourceRequestContext,
  label: string,
  schema: ZodType<T>,
): Promise<T> {
  const body = await requestJson(url, context)
  const parsed = schema.safeParse(body)
  if (!parsed.success) throw new Error(`${label} returned an invalid response`)
  return parsed.data
}

const requestSearchStatus = (url: string, context: HealthResourceRequestContext) =>
  requestValidated(url, context, 'Search status', searchStatusResponseSchema)

const requestSearchTelemetry = (url: string, context: HealthResourceRequestContext) =>
  requestValidated(url, context, 'Search telemetry', searchTelemetryClientResponseSchema)

const requestRegistry = (url: string, context: HealthResourceRequestContext) =>
  requestValidated(url, context, 'Plugin registry', systemRegistryResponseSchema)

async function requestPluginManifest(
  url: string,
  context: HealthResourceRequestContext,
): Promise<SystemPluginManifestData> {
  const shouldCheck = context.reason === 'explicit'
  const requestUrl = shouldCheck ? `${url}${url.includes('?') ? '&' : '?'}check=1` : url
  return await requestValidated(
    requestUrl,
    context,
    'Plugin manifest',
    systemPluginManifestClientSchema,
  )
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

function isUpgradeBin(value: unknown): value is PluginUpgradeBin {
  return isRecord(value) && typeof value.name === 'string' && typeof value.version === 'string' && typeof value.sha256 === 'string'
}

/**
 * Start a plugin upgrade operation (#895). Two-phase (spec
 * plugin-managed-binaries S17): without a token this is the PREVIEW — it ends
 * `awaitingConsent` (permissions or binaries widen) or `ready` (nothing new to
 * consent to), each with a token; with one it is the COMMIT, which lands only
 * while the target still matches what was previewed.
 */
export async function startPluginUpgrade(pluginId: string, consentToken?: string): Promise<OperationStartResponse> {
  return await startOperation(() => fetch('/api/plugins/upgrade', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pluginId, ...(consentToken ? { accepted: true, consentToken } : {}) }),
  }))
}

/** What a settled upgrade operation means — from the body the route answers (its result). */
export function interpretPluginUpgrade(
  pluginId: string,
  result: { httpStatus: number; body: unknown } | undefined,
): PluginUpgradeResult {
  const body = result?.body
  if (isRecord(body) && typeof body.consentToken === 'string' && (body.awaitingConsent === true || body.ready === true)) {
    const permissions = Array.isArray(body.newPermissions) ? body.newPermissions.filter((p): p is string => typeof p === 'string') : []
    const bins = Array.isArray(body.newBins) ? body.newBins.filter(isUpgradeBin) : []
    if (body.ready === true) {
      return { awaitingConsent: false, ready: true, permissions, bins, consentToken: body.consentToken, noop: false, message: `Updating ${pluginId}…` }
    }
    return {
      awaitingConsent: true,
      permissions,
      bins,
      consentToken: body.consentToken,
      noop: false,
      message: body.manifestChanged === true
        ? 'This update changed since you previewed it. Review it again.'
        : bins.length > 0 && permissions.length === 0
          ? 'This update downloads binaries.'
          : bins.length > 0
            ? 'This update requests new permissions and downloads binaries.'
            : 'This update requests new permissions.',
    }
  }
  if (!result || result.httpStatus >= 400 || (isRecord(body) && body.ok === false)) {
    const message = isRecord(body) && typeof body.error === 'string' && body.error.length > 0
      ? body.error
      : `Plugin update failed (${result?.httpStatus ?? 'no result'})`
    throw new Error(message)
  }
  if (!isRecord(body)
    || body.ok !== true
    || typeof body.noop !== 'boolean'
    || !Array.isArray(body.newPermissions)
    || !body.newPermissions.every((permission) => typeof permission === 'string')) {
    throw new SystemMutationOutcomeUnknownError(
      'The plugin update finished, but Bakin could not confirm the result. Refresh live data before trying again.',
    )
  }
  const noop = body.noop
  return {
    awaitingConsent: false,
    permissions: body.newPermissions,
    bins: [],
    noop,
    message: noop
      ? `${pluginId} is already current.`
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
  upgradePlugin: (pluginId: string, consentToken?: string) => Promise<void>
  refreshSystemDetails: () => Promise<void>
}

/** Source-aware resources used only while the System tab is mounted. */
export function useSystemData(): UseSystemDataResult {
  const report = useHealthReport()
  const live = useHealthResource<HealthSummary>('/api/plugins/health/summary', {
    intervalMs: SYSTEM_REFRESH_MS,
    timeoutMs: SYSTEM_REQUEST_TIMEOUT_MS,
    request: (url, context) => requestValidated(
      url, context, 'Live system facts', healthLiveSummaryClientSchema,
    ),
  })
  const searchStatus = useHealthResource<SearchHealthData>('/api/plugins/health/search-status', {
    intervalMs: SYSTEM_REFRESH_MS,
    timeoutMs: SYSTEM_REQUEST_TIMEOUT_MS,
    request: requestSearchStatus,
  })
  const searchTelemetry = useHealthResource<SearchTelemetryData>('/api/plugins/health/search-telemetry', {
    intervalMs: SYSTEM_REFRESH_MS,
    timeoutMs: SYSTEM_REQUEST_TIMEOUT_MS,
    request: requestSearchTelemetry,
  })
  const registry = useHealthResource<SystemRegistryData>('/api/plugins/health/registry', {
    intervalMs: SYSTEM_REFRESH_MS,
    timeoutMs: SYSTEM_REQUEST_TIMEOUT_MS,
    request: requestRegistry,
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
    const refreshedReport = await reportRefresh('explicit')
    if (!refreshedReport) throw new Error('Search readiness refresh failed')
    await Promise.all([
      searchStatusRefresh('explicit'),
      searchTelemetryRefresh('explicit'),
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

  // Plugin upgrades are operations (#895), followed live: the preview, then
  // (on approval, or at once when it is `ready`) the commit.
  const [upgrade, setUpgrade] = useState<{ pluginId: string; start: OperationStartResponse } | null>(null)
  const followedUpgrade = useOperation(upgrade?.start.operationId ?? null, upgrade ? { bootId: upgrade.start.bootId } : {})

  const upgradePlugin = useCallback(async (pluginId: string, consentToken?: string) => {
    setPluginMutation({ status: 'pending', message: null, target: pluginId })
    try {
      setUpgrade({ pluginId, start: await startPluginUpgrade(pluginId, consentToken) })
    } catch (error) {
      setUpgrade(null)
      setPluginMutation({ status: 'error', message: error instanceof Error ? error.message : String(error), target: pluginId })
    }
  }, [])

  const upgradeView = followedUpgrade.operation
  const upgradePhase = followedUpgrade.phase
  useEffect(() => {
    if (!upgrade) return
    const { pluginId } = upgrade
    if (upgradePhase === 'restarted' || upgradePhase === 'expired') {
      setUpgrade(null)
      setPluginMutation({
        status: 'outcome-unknown',
        message: 'Bakin restarted or lost track of the plugin update. Refresh live data to confirm the result.',
        target: pluginId,
      })
      return
    }
    if (!upgradeView) return
    if (!isOperationFinished(upgradeView.status)) {
      setPluginMutation({ status: 'pending', message: null, target: pluginId, operation: upgradeView })
      return
    }
    setUpgrade(null)
    if (upgradeView.status === 'cancelled') {
      setPluginMutation({ status: 'error', message: `The ${pluginId} update was cancelled before anything changed.`, target: pluginId })
      return
    }
    let result: PluginUpgradeResult
    try {
      result = interpretPluginUpgrade(pluginId, upgradeView.result)
    } catch (error) {
      setPluginMutation({
        status: error instanceof SystemMutationOutcomeUnknownError ? 'outcome-unknown' : 'error',
        message: error instanceof Error ? error.message : String(error),
        target: pluginId,
      })
      return
    }
    if (result.ready && result.consentToken) {
      void upgradePlugin(pluginId, result.consentToken)
      return
    }
    if (result.awaitingConsent) {
      setPluginMutation({
        status: 'confirmation',
        message: result.message,
        target: pluginId,
        permissions: result.permissions,
        bins: result.bins,
        consentToken: result.consentToken,
      })
      return
    }
    void Promise.all([
      registryRefresh('explicit'),
      pluginManifestRefresh('explicit'),
      reportRefresh('background'),
    ]).finally(() => setPluginMutation({ status: 'success', message: result.message, target: pluginId }))
  }, [upgrade, upgradeView, upgradePhase, upgradePlugin, pluginManifestRefresh, registryRefresh, reportRefresh])

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
