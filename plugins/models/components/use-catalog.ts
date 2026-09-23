'use client'

/**
 * The model catalog read (`GET /available` + `POST /refresh[?probe=1]`):
 * cached rows with their cache facts, the stale auto-refresh, the explicit
 * (billed) availability probe, and the ONE picker-option mapping every
 * ModelSelect on the Models page uses (ineligible rows disabled with their
 * reason, #907).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'

import { toModelSelectOptions } from '@makinbakin/sdk/hooks'
import { pluginFetchJson } from '@makinbakin/sdk/utils'

import type { AvailableModel } from '../types'

const PLUGIN_ID = 'models'
const LOAD_TIMEOUT_MS = 10_000
/** Provider round-trip: slower than a local read, still bounded. */
const REFRESH_TIMEOUT_MS = 30_000
// Verify = refresh + N bounded probes (concurrency 3, 20s adapter ceiling
// each) — the budget covers the worst honest case without hanging the button.
const VERIFY_TIMEOUT_MS = 90_000

function isAbortError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: string }).name === 'AbortError'
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Wire shape of GET /available (the cached runtime catalog + its cache facts). */
interface AvailableModelsPayload {
  models?: AvailableModel[]
  cached?: boolean
  cachedAt?: number | null
  stale?: boolean
  error?: string | null
}

/** Per-model probe verdict from POST /refresh?probe=1 (#852). */
export interface ProbeVerdictWire {
  model: string
  status: 'verified' | 'rejected' | 'skipped'
  detail?: string
}

export interface UseCatalogOptions {
  /**
   * Roster agents whose pickers need THEIR OWN verdicts (#907 review): an
   * agent pin is validated by the write path under that agent's
   * credentials, so the picker that stages it must disable by the same
   * verdict. One scoped `GET /available?agentId=` per agent, re-read
   * whenever the catalog or the roster changes.
   */
  agentIds?: readonly string[]
}

export function useCatalog(options: UseCatalogOptions = {}) {
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([])
  const [agentCatalogs, setAgentCatalogs] = useState<Record<string, AvailableModel[]>>({})
  // Identity-stable roster key so a fresh array per render never refetches.
  const agentIdsKey = (options.agentIds ?? []).join('\n')
  const [modelsCached, setModelsCached] = useState(false)
  const [modelsCachedAt, setModelsCachedAt] = useState<number | null>(null)
  const [modelsStale, setModelsStale] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [modelsLoaded, setModelsLoaded] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [probeVerdicts, setProbeVerdicts] = useState<ProbeVerdictWire[] | null>(null)

  const fetchAvailable = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await pluginFetchJson<AvailableModelsPayload>(PLUGIN_ID, 'available', { label: 'Models', timeoutMs: LOAD_TIMEOUT_MS, signal })
      if (signal?.aborted) return
      setAvailableModels(data.models ?? [])
      setModelsCached(!!data.cached)
      setModelsCachedAt(data.cachedAt ?? null)
      setModelsStale(!!data.stale)
      setModelsError(data.error ?? null)
    } catch (err) {
      if (isAbortError(err) || signal?.aborted) return
      // The Available tab renders `modelsError`; no console-only failure here.
      setModelsError(errorMessage(err))
    } finally {
      if (!signal?.aborted) setModelsLoaded(true)
    }
  }, [])

  const handleRefresh = useCallback(async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      // Bounded like every read path: this also AUTO-fires when the cache is
      // stale, and `refreshing` gates the Refresh button's `disabled`, so an
      // unbounded hang left the control permanently dead and spinning.
      const data = await pluginFetchJson<AvailableModelsPayload>(PLUGIN_ID, 'refresh', { label: 'Refresh', timeoutMs: REFRESH_TIMEOUT_MS, init: { method: 'POST' } })
      if (Array.isArray(data.models)) {
        setAvailableModels(data.models)
      }
      setModelsCached(!!data.cached)
      setModelsCachedAt(data.cachedAt ?? null)
      setModelsStale(!!data.stale)
      setModelsError(data.error ?? null)
    } catch (err) {
      setModelsError(err instanceof Error ? err.message : String(err))
    } finally {
      setRefreshing(false)
    }
  }, [refreshing])

  const handleVerify = useCallback(async () => {
    // Probing is billed (~pennies) and EXPLICIT (#852): only this action ever
    // passes probe=1 — handleRefresh and the stale auto-refresh never do.
    if (verifying || refreshing) return
    setVerifying(true)
    try {
      const data = await pluginFetchJson<AvailableModelsPayload & { probe?: { supported: boolean; verdicts: ProbeVerdictWire[] } }>(PLUGIN_ID, 'refresh?probe=1', { label: 'Verify availability', timeoutMs: VERIFY_TIMEOUT_MS, init: { method: 'POST' } })
      if (Array.isArray(data.models)) {
        setAvailableModels(data.models)
      }
      setModelsCached(!!data.cached)
      setModelsCachedAt(data.cachedAt ?? null)
      setModelsStale(!!data.stale)
      setModelsError(data.error ?? null)
      setProbeVerdicts(data.probe?.verdicts ?? null)
    } catch (err) {
      setModelsError(err instanceof Error ? err.message : String(err))
    } finally {
      setVerifying(false)
    }
  }, [verifying, refreshing])

  useEffect(() => {
    const controller = new AbortController()
    void fetchAvailable(controller.signal)
    return () => controller.abort()
  }, [fetchAvailable])

  // Agent-scoped catalogs: the unscoped list answers "can this install run
  // it"; each roster agent's pickers take the verdicts under its own keys.
  // The unscoped list stands in until a row's read lands (or fails — never
  // a blank picker).
  useEffect(() => {
    const agentIds = agentIdsKey.split('\n').filter(Boolean)
    if (agentIds.length === 0 || !modelsLoaded) return
    const controller = new AbortController()
    void Promise.all(agentIds.map(async (agentId) => {
      try {
        const data = await pluginFetchJson<AvailableModelsPayload>(PLUGIN_ID, `available?agentId=${encodeURIComponent(agentId)}`, { label: 'Models', timeoutMs: LOAD_TIMEOUT_MS, signal: controller.signal })
        return [agentId, data.models ?? []] as const
      } catch (err) {
        if (!isAbortError(err) && !controller.signal.aborted) console.warn(`Agent-scoped model catalog for ${agentId} failed; using the unscoped catalog: ${errorMessage(err)}`)
        return null
      }
    })).then((entries) => {
      if (controller.signal.aborted) return
      setAgentCatalogs(Object.fromEntries(entries.filter((e): e is readonly [string, AvailableModel[]] => e !== null)))
    })
    return () => controller.abort()
  }, [agentIdsKey, availableModels, modelsLoaded])

  // Auto-refresh in the background when the served cache was stale.
  // We surface the cached data immediately; the refresh swaps rows
  // in place when it returns. handleRefresh guards against double-firing.
  useEffect(() => {
    if (modelsLoaded && modelsStale && !refreshing) {
      void handleRefresh()
    }
    // Only react to the stale signal changing after initial load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelsLoaded, modelsStale])

  // Picker options: ineligible rows disabled with their reason (#907) — the
  // ONE mapping every ModelSelect on this page uses. Memoized: a fresh array
  // per render would re-render every picker and defeat the catalog's memos.
  const modelSelectOptions = useMemo(() => toModelSelectOptions(availableModels), [availableModels])
  // Per-agent options (agent rows): that agent's verdicts, the unscoped
  // mapping until its scoped read lands. Memoized per catalog generation so
  // a row's picker keeps a stable array between renders.
  const agentModelSelectOptions = useMemo(() => {
    const byAgent = new Map<string, ReturnType<typeof toModelSelectOptions>>()
    return (agentId: string) => {
      const hit = byAgent.get(agentId)
      if (hit) return hit
      const options = agentCatalogs[agentId] ? toModelSelectOptions(agentCatalogs[agentId]) : modelSelectOptions
      byAgent.set(agentId, options)
      return options
    }
  }, [agentCatalogs, modelSelectOptions])
  const availableProviders = useMemo(() => [...new Set(availableModels.map((m) => m.provider))].sort((a, b) => a.localeCompare(b)), [availableModels])

  return {
    availableModels, modelsCached, modelsCachedAt, modelsStale, modelsError, modelsLoaded,
    refreshing, verifying, probeVerdicts, handleRefresh, handleVerify,
    modelSelectOptions, agentModelSelectOptions, availableProviders,
    /** Re-read the cached catalog (after a save that changes default/fallback flags). */
    fetchAvailable,
  }
}

export type CatalogData = ReturnType<typeof useCatalog>
