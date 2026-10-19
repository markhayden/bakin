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

/** Start a search reindex operation (#895): all tables, or one with `table`. Not cancellable. */
export async function startSearchReindex(table?: string): Promise<OperationStartResponse> {
  return await startOperation(() => fetch(`/api/reindex${table ? `?table=${encodeURIComponent(table)}` : ''}`, { method: 'POST' }))
}

/** What a settled reindex means, from its view: converged, or the tables that failed or parked. */
export function interpretSearchReindex(target: string, view: OperationView): { ok: boolean; message: string } {
  const label = target === 'all' ? 'all Search indexes' : target
  if (view.status === 'succeeded') return { ok: true, message: `Reindex finished for ${label}.` }
  const body = view.result?.body
  if (view.outcome?.code === 'tables_parked' && isRecord(body)) {
    const errors = typeof body.errors === 'number' ? body.errors : 0
    const parked = typeof body.parked === 'number' ? body.parked : 0
    const parts = [errors > 0 ? `${errors} failed` : null, parked > 0 ? `${parked} parked` : null].filter(Boolean).join(', ')
    return { ok: false, message: `Reindex for ${label} did not converge (${parts}). The current indexes keep serving; parked work resumes automatically.` }
  }
  return { ok: false, message: view.outcome?.message ? `Reindex failed: ${view.outcome.message}` : `Reindex ${view.status}.` }
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
    const permissions = Array.isArray(body.declaredPermissions) ? body.declaredPermissions.filter((p): p is string => typeof p === 'string') : []
    const bins = Array.isArray(body.declaredBins) ? body.declaredBins.filter(isUpgradeBin) : []
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
            ? 'This update requests permissions and downloads binaries.'
            : 'This update requests permissions.',
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
    || !Array.isArray(body.declaredPermissions)
    || !body.declaredPermissions.every((permission) => typeof permission === 'string')) {
    throw new SystemMutationOutcomeUnknownError(
      'The plugin update finished, but Bakin could not confirm the result. Refresh live data before trying again.',
    )
  }
  const noop = body.noop
  return {
    awaitingConsent: false,
    permissions: body.declaredPermissions,
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

  // A reindex is an operation (#895), followed live until it settles; only
  // then is canonical Search readiness refreshed.
  const [reindex, setReindex] = useState<{ target: string; start: OperationStartResponse } | null>(null)
  const followedReindex = useOperation(reindex?.start.operationId ?? null, reindex ? { bootId: reindex.start.bootId } : {})

  const reindexSearch = useCallback(async (table?: string) => {
    const target = table ?? 'all'
    setSearchMutation({ status: 'pending', message: null, target })
    try {
      setReindex({ target, start: await startSearchReindex(table) })
    } catch (error) {
      setReindex(null)
      setSearchMutation({ status: 'error', message: error instanceof Error ? error.message : String(error), target })
    }
  }, [])

  const reindexView = followedReindex.operation
  const reindexPhase = followedReindex.phase
  useEffect(() => {
    if (!reindex) return
    const { target } = reindex
    if (reindexPhase === 'restarted' || reindexPhase === 'expired') {
      setReindex(null)
      setSearchMutation({
        status: 'outcome-unknown',
        message: 'Bakin restarted or lost track of the reindex. Refresh live data to confirm the result.',
        target,
      })
      return
    }
    if (!reindexView) return
    if (!isOperationFinished(reindexView.status)) {
      setSearchMutation({ status: 'pending', message: null, target, operation: reindexView })
      return
    }
    setReindex(null)
    const outcome = interpretSearchReindex(target, reindexView)
    void refreshCanonicalSearchReadiness().then(
      () => setSearchMutation({ status: outcome.ok ? 'success' : 'error', message: `${outcome.message} Readiness was refreshed.`, target }),
      (error: unknown) => setSearchMutation({
        status: 'error',
        message: `${outcome.message} Search readiness could not be refreshed: ${error instanceof Error ? error.message : String(error)}`,
        target,
      }),
    )
  }, [reindex, reindexView, reindexPhase, refreshCanonicalSearchReadiness])

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
