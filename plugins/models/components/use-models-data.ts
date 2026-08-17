'use client'

// React
import { useCallback, useEffect, useRef, useState } from 'react'
// SDK
import { usePluginEvent, emitPluginEvent } from "@makinbakin/sdk/hooks"
import { useRuntimeStatus } from "@makinbakin/sdk/hooks"
import { useQueryState } from "@makinbakin/sdk/navigation"
import { pluginFetch } from "@makinbakin/sdk/utils"
// Relative
import type { AgentModelConfig, AvailableModel, ModelsConfigResponse } from '../types'

/** This plugin's id — every own-route call goes through `pluginFetch(PLUGIN_ID, …)`. */
const PLUGIN_ID = 'models'

/**
 * Deadline for the page's configuration reads. Every GET is bounded: a stalled
 * endpoint must surface as an error the page can render, never as a spinner
 * that spins forever.
 */
const LOAD_TIMEOUT_MS = 10_000
/**
 * `/spend` and `/budget/status` read the execution ledger and the durable usage
 * history, so they are legitimately slower than a config read — still bounded.
 */
const LEDGER_TIMEOUT_MS = 20_000
/** Provider round-trip: slower than a local read, still bounded. */
const REFRESH_TIMEOUT_MS = 30_000

function isAbortError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: string }).name === 'AbortError'
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Shape every mutation route in this plugin answers with. */
interface MutationResult { ok?: boolean; error?: string }

/** Wire shape of GET /available (the cached runtime catalog + its cache facts). */
interface AvailableModelsPayload {
  models?: AvailableModel[]
  cached?: boolean
  cachedAt?: number | null
  stale?: boolean
  error?: string | null
}

/** The message a failed mutation should show: the server's reason, or the status. */
function mutationError(data: MutationResult, status: number): string {
  return typeof data.error === 'string' ? data.error : `Save failed (${status})`
}

/**
 * GET one of this plugin's own routes as JSON under a hard deadline.
 *
 * The deadline races the WHOLE chain, body parsing included — `fetch` resolves
 * at HEADERS, so racing the bare fetch promise would still leave the caller
 * hanging inside `res.json()`. That is exactly `useJsonFetch`'s `timeoutMs`
 * semantics, mirrored here for the call sites that are plain functions (called
 * from effects AND from mutation handlers) rather than hooks.
 *
 * `signal` is the caller's cancellation (unmount / dependency change). Those
 * rejections arrive as `AbortError` and callers drop them without touching
 * state; a deadline breach is a real failure and rejects with a plain Error.
 */
async function fetchPluginJson<T>(
  path: string,
  label: string,
  timeoutMs: number,
  signal?: AbortSignal,
  init?: RequestInit,
): Promise<T> {
  const controller = new AbortController()
  const forwardAbort = () => controller.abort()
  if (signal?.aborted) controller.abort()
  else signal?.addEventListener('abort', forwardAbort, { once: true })

  let timedOut = false
  let rejectDeadline: ((reason: Error) => void) | null = null
  const deadline = setTimeout(() => {
    timedOut = true
    // Abort to free the socket, but RACE the rejection rather than relying on
    // it: a fetch implementation that ignores the signal would otherwise leave
    // the caller hanging forever, the exact failure the deadline prevents.
    controller.abort()
    rejectDeadline?.(new Error('Request timed out'))
  }, timeoutMs)

  const request = pluginFetch(PLUGIN_ID, path, { ...init, signal: controller.signal })
    .then(async (res) => {
      if (!res.ok) throw new Error(`${label} fetch failed (${res.status})`)
      return await res.json() as T
    })

  try {
    return await Promise.race([
      request,
      new Promise<never>((_resolve, reject) => { rejectDeadline = reject }),
    ])
  } catch (err) {
    // Our own deadline abort must never read as a caller cancellation.
    if (timedOut) throw new Error('Request timed out')
    throw err
  } finally {
    clearTimeout(deadline)
    rejectDeadline = null
    signal?.removeEventListener('abort', forwardAbort)
  }
}

/** One rendered error message plus the identity of whatever produced it. */
interface SurfacedError {
  /** What the UI renders; null when nothing has failed. */
  value: string | null
  /** Record a failure attributed to `source`, replacing any earlier message. */
  report: (source: string, message: string) => void
  /**
   * Clear only when the visible message came from `source`. A successful config
   * reload must not erase a still-broken alias load — a banner that disappears
   * without the underlying fetch recovering is a lie.
   */
  clear: (source: string) => void
  /** Clear unconditionally — an explicit user action starting from a clean slate. */
  reset: () => void
}

function useSurfacedError(): SurfacedError {
  const [value, setValue] = useState<string | null>(null)
  const sourceRef = useRef<string | null>(null)

  const report = useCallback((source: string, message: string) => {
    sourceRef.current = source
    setValue(message)
  }, [])
  const clear = useCallback((source: string) => {
    if (sourceRef.current !== null && sourceRef.current !== source) return
    sourceRef.current = null
    setValue(null)
  }, [])
  const reset = useCallback(() => {
    sourceRef.current = null
    setValue(null)
  }, [])

  return { value, report, clear, reset }
}

export interface WorkClassRouteRow { workClass: string; model?: string; thinking?: string }
export interface TagOverrideRow { tag: string; model?: string; thinking?: string }
export interface RoutingConfigShape { routes: WorkClassRouteRow[]; tagOverrides: TagOverrideRow[] }
/** Wire shape of one budget cap rule (cost-control v2). */
export interface BudgetRuleWire {
  scope: 'global' | 'agent' | 'provider' | 'model'
  scopeId?: string
  lane: 'metered' | 'subscription'
  dailyCap?: number
  monthlyCap?: number
  warnPct?: number
  atCap?: 'defer' | 'pause'
}
/** One durable breach record (wire shape of a budget_incidents row). */
export interface BudgetIncidentWire {
  id: number
  scope: string
  scopeId: string
  lane: 'metered' | 'subscription'
  window: 'daily' | 'monthly'
  windowStartMs: number
  kind: 'warn' | 'cap'
  unit: 'usd_micros' | 'tokens'
  capValue: number
  spentValue: number
  atCap: 'defer' | 'pause'
  openedAt: number
  status: 'open' | 'acknowledged' | 'resolved'
}

export interface BillingOverrideWire { agentId?: string; provider?: string; lane: 'metered' | 'subscription' }
/** Wire shape of GET /budget/status (full mode). */
export interface BudgetStatusWire {
  paused: boolean
  configured: boolean
  perAgent: Record<string, 'ok' | 'warn' | 'deferred'>
  perTask: Record<string, 'deferred'>
  billing: Record<string, { provider: string; lane: 'metered' | 'subscription'; model: string | null }>
  overrides: BillingOverrideWire[]
  deferredProviders: string[]
  openIncidents: BudgetIncidentWire[]
}

export interface SpendRowAgent { agent: string; costUsdMicros: number | null; runs: number }
export interface SpendRowModel { model: string; costUsdMicros: number | null; runs: number }
export interface SpendRowWorkClass {
  workClass: string
  runs: number
  totalTokens: number | null
  costUsdMicros: number | null
  subscriptionTokens: number
  avgCostUsdMicros: number | null
}
export interface LaneSumsWire {
  meteredUsdMicros: number
  meteredTokens: number
  subscriptionTokens: number
  unpricedMeteredTokens: number
}
export interface ScopeSpendWire extends LaneSumsWire {
  unattributed: { meteredUsdMicros: number; meteredTokens: number; subscriptionTokens: number }
}
export interface WindowSpendWire {
  startMs: number
  global: ScopeSpendWire
  byAgent: Record<string, ScopeSpendWire>
  byProvider: Record<string, LaneSumsWire>
  byModel: Record<string, LaneSumsWire>
}
export interface PaceWire {
  meteredUsdMicros: number | null
  subscriptionTokens: number | null
  endsMs: number
}
export interface SpendTimelineWire {
  startMs: number
  endMs: number
  costUsdMicros: number | null
  subscriptionTokens: number
  unpricedMeteredTokens: number
}
export interface SpendResponse {
  window: string
  estimated: boolean
  totalUsdMicros: number
  byAgent: SpendRowAgent[]
  byModel: SpendRowModel[]
  byWorkClass?: SpendRowWorkClass[]
  timeline?: SpendTimelineWire[]
  facets?: {
    computedAt: number
    observedUsageEvidence?:
      | { status: 'available' }
      | { status: 'unavailable'; reason: 'usage_store_unavailable' }
    daily: WindowSpendWire
    monthly: WindowSpendWire
  }
  pace?: { daily: PaceWire; monthly: PaceWire }
}

/**
 * The Models page data layer: every fetcher, effect, draft-state slice, action
 * handler, and derived value. Extracted from ModelsPage so the page shell and
 * (eventually) per-tab components consume one typed object. Behavior-identical
 * to the former inline hooks — same call order, same effects.
 */
export function useModelsData() {
  const [tab, setTab] = useQueryState('tab', 'agents')
  const [agents, setAgents] = useState<AgentModelConfig[]>([])
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([])
  const [modelsCached, setModelsCached] = useState(false)
  const [modelsCachedAt, setModelsCachedAt] = useState<number | null>(null)
  const [modelsStale, setModelsStale] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [modelsLoaded, setModelsLoaded] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [aliases, setAliases] = useState<Record<string, string>>({})
  const [pendingOwn, setPendingOwn] = useState<Record<string, string>>({})
  const [pendingSub, setPendingSub] = useState<Record<string, string>>({})
  const [defaultModel, setDefaultModel] = useState('')
  const [defaultSubagentModel, setDefaultSubagentModel] = useState<string | null>(null)
  const [fallbackModels, setFallbackModels] = useState<string[]>([])
  const [pendingDefaultModel, setPendingDefaultModel] = useState<string | null>(null)
  const [pendingDefaultSubagentModel, setPendingDefaultSubagentModel] = useState<string | null | undefined>(undefined)
  const [pendingFallbackModels, setPendingFallbackModels] = useState<string[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const runtimeStatus = useRuntimeStatus()
  const [newAliasName, setNewAliasName] = useState('')
  const [newAliasTarget, setNewAliasTarget] = useState('')
  // The page-level banner (models-page.tsx) renders this message for every
  // config / alias / routing load and every save on those tabs.
  const { value: error, report: reportError, clear: clearError } = useSurfacedError()
  const [spendWindow, setSpendWindow] = useQueryState('window', '24h')
  const [spend, setSpend] = useState<SpendResponse | null>(null)
  const [spendLoading, setSpendLoading] = useState(false)
  const [routing, setRouting] = useState<RoutingConfigShape>({ routes: [], tagOverrides: [] })
  const [routingSupport, setRoutingSupport] = useState<ModelsConfigResponse['support'] | null>(null)
  const [pendingRouting, setPendingRouting] = useState<RoutingConfigShape | null>(null)
  const [budgetRules, setBudgetRules] = useState<BudgetRuleWire[]>([])
  const [pendingRules, setPendingRules] = useState<BudgetRuleWire[] | null>(null)
  const [incidents, setIncidents] = useState<BudgetIncidentWire[]>([])
  // The Spend tab's own banner: budget loads and budget mutations report here.
  const {
    value: budgetError,
    report: reportBudgetError,
    clear: clearBudgetError,
    reset: resetBudgetError,
  } = useSurfacedError()
  const [budgetWarnings, setBudgetWarnings] = useState<string[]>([])
  const [budgetStatus, setBudgetStatus] = useState<BudgetStatusWire | null>(null)

  // -------------------------------------------------------------------------
  // Data fetching
  // -------------------------------------------------------------------------
  const loadConfig = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await fetchPluginJson<ModelsConfigResponse>('config', 'Config', LOAD_TIMEOUT_MS, signal)
      if (signal?.aborted) return
      if (data.agents) setAgents(data.agents)
      setDefaultModel(data.defaultModel)
      setDefaultSubagentModel(data.defaultSubagentModel)
      setFallbackModels(data.fallbackModels ?? [])
      setRoutingSupport(data.support ?? null)
      setPendingDefaultModel(null)
      setPendingDefaultSubagentModel(undefined)
      setPendingFallbackModels(null)
      clearError('config')
    } catch (err) {
      if (isAbortError(err) || signal?.aborted) return
      reportError('config', `Failed to load agent config: ${errorMessage(err)}`)
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [clearError, reportError])

  /**
   * The retry handler the page's error banner calls. Kept parameterless on
   * purpose — it is wired straight to `onClick`, so it must never receive a
   * click event where an AbortSignal is expected.
   */
  const fetchConfig = useCallback(() => loadConfig(), [loadConfig])

  const fetchAvailable = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await fetchPluginJson<AvailableModelsPayload>('available', 'Models', LOAD_TIMEOUT_MS, signal)
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
      const data = await fetchPluginJson<AvailableModelsPayload>(
        'refresh',
        'Refresh',
        REFRESH_TIMEOUT_MS,
        undefined,
        { method: 'POST' },
      )
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

  const fetchAliases = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await fetchPluginJson<{ aliases?: Record<string, string> }>('aliases', 'Aliases', LOAD_TIMEOUT_MS, signal)
      if (signal?.aborted) return
      if (data.aliases) setAliases(data.aliases)
      clearError('aliases')
    } catch (err) {
      if (isAbortError(err) || signal?.aborted) return
      reportError('aliases', `Failed to load model aliases: ${errorMessage(err)}`)
    }
  }, [clearError, reportError])

  // `/spend` is fired by a window switch AND by SSE, with no ordering
  // guarantee. Without a generation guard a slow 24h response landing after a
  // switch to 7d overwrote the newer data — and its failure path blanked good
  // data with `setSpend(null)`.
  const spendGenerationRef = useRef(0)
  const fetchSpend = useCallback(async (window: string, signal?: AbortSignal) => {
    const generation = ++spendGenerationRef.current
    const superseded = () => spendGenerationRef.current !== generation
    setSpendLoading(true)
    try {
      const data = await fetchPluginJson<SpendResponse>(
        `spend?window=${encodeURIComponent(window)}`, 'Spend', LEDGER_TIMEOUT_MS, signal,
      )
      if (signal?.aborted || superseded()) return
      setSpend(data)
    } catch (err) {
      // A cancelled or superseded request leaves the state to whichever
      // request replaced it — blanking here would destroy newer good data.
      if (isAbortError(err) || signal?.aborted || superseded()) return
      // The Spend tab renders `spend === null` as an explicit unavailable state.
      setSpend(null)
    } finally {
      if (!signal?.aborted && !superseded()) setSpendLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    loadConfig(controller.signal)
    fetchAvailable(controller.signal)
    fetchAliases(controller.signal)
    return () => controller.abort()
  }, [loadConfig, fetchAvailable, fetchAliases])

  const fetchBudget = useCallback(async (signal?: AbortSignal) => {
    try {
      const policy = await fetchPluginJson<{ rules?: BudgetRuleWire[] }>('budget', 'Budget', LOAD_TIMEOUT_MS, signal)
      if (signal?.aborted) return
      setBudgetRules(policy.rules ?? [])
      clearBudgetError('budget-rules')
    } catch (err) {
      if (isAbortError(err) || signal?.aborted) return
      reportBudgetError('budget-rules', `Failed to load the budget policy: ${errorMessage(err)}`)
    }
  }, [clearBudgetError, reportBudgetError])

  const fetchIncidents = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await fetchPluginJson<{ incidents?: BudgetIncidentWire[] }>(
        'budget/incidents', 'Incidents', LOAD_TIMEOUT_MS, signal,
      )
      if (signal?.aborted) return
      setIncidents(data.incidents ?? [])
      clearBudgetError('budget-incidents')
    } catch (err) {
      if (isAbortError(err) || signal?.aborted) return
      reportBudgetError('budget-incidents', `Failed to load budget incidents: ${errorMessage(err)}`)
    }
  }, [clearBudgetError, reportBudgetError])

  const fetchBudgetStatus = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await fetchPluginJson<BudgetStatusWire>(
        'budget/status', 'Budget status', LEDGER_TIMEOUT_MS, signal,
      )
      if (signal?.aborted) return
      setBudgetStatus(data)
      clearBudgetError('budget-status')
    } catch (err) {
      if (isAbortError(err) || signal?.aborted) return
      // The kill switch and the deferred badges read from this payload — a
      // stale "not paused" must never pass for a fresh one.
      reportBudgetError('budget-status', `Failed to load budget status: ${errorMessage(err)}`)
    }
  }, [clearBudgetError, reportBudgetError])

  /** PUT the full rule list — every rule round-trips; nothing is dropped.
   *  Failures and unknown-id warnings surface in the UI, never only the
   *  console (a silently-rejected cap is fake safety). */
  const saveBudgetRules = async (): Promise<void> => {
    if (!pendingRules) return
    setSaving('budget')
    resetBudgetError()
    setBudgetWarnings([])
    try {
      // A rule with no caps is invalid — reject explicitly instead of
      // silently deleting the row on save.
      const capless = pendingRules.findIndex((r) => !r.dailyCap && !r.monthlyCap)
      if (capless >= 0) {
        reportBudgetError('budget-save', `Rule ${capless + 1} has no caps — set a daily or monthly cap, or remove the row.`)
        return
      }
      const res = await pluginFetch(PLUGIN_ID, 'budget', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules: pendingRules }),
      })
      const data = await res.json() as MutationResult & { warnings?: unknown }
      if (data.ok) {
        setBudgetRules(pendingRules)
        setPendingRules(null)
        setBudgetWarnings(Array.isArray(data.warnings) ? data.warnings : [])
        // Re-fetch the canonical rules — the server normalizes model-scope
        // ids, and the utilization cards must key exactly like spend rows.
        fetchBudget()
        fetchBudgetStatus()
      } else {
        reportBudgetError('budget-save', mutationError(data, res.status))
      }
    } catch (err) {
      reportBudgetError('budget-save', errorMessage(err))
    } finally {
      setSaving(null)
    }
  }

  /** Toggle the dispatch kill switch from the Spend tab. */
  const setDispatchPaused = async (paused: boolean): Promise<void> => {
    // Clear only THIS action's slot. `resetBudgetError()` wiped every source,
    // so a failed budget-policy load vanished while `budgetRules` stayed empty
    // — and the tab then rendered "Spend is not capped", turning a load failure
    // into an affirmative safety claim.
    clearBudgetError('dispatch-pause')
    try {
      // A HOST route, not a plugin route — raw fetch is correct here.
      const res = await fetch('/api/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dispatch: { paused } }),
      })
      if (!res.ok) {
        reportBudgetError('dispatch-pause', `Failed to ${paused ? 'pause' : 'resume'} dispatch (${res.status}).`)
        return
      }
      fetchBudgetStatus()
      // Client-side fan-out so the header banner reflects immediately
      // instead of waiting out its 15s poll (a settings write emits no SSE).
      emitPluginEvent({ event: 'budget.paused_changed', paused })
    } catch (err) {
      reportBudgetError('dispatch-pause', errorMessage(err))
    }
  }

  /** Save a per-agent billing-lane override ('auto' clears it). */
  const setAgentLaneOverride = async (agentId: string, lane: 'auto' | 'metered' | 'subscription'): Promise<void> => {
    resetBudgetError()
    try {
      const current = budgetStatus?.overrides ?? []
      const others = current.filter((o) => !(o.agentId === agentId && o.provider === undefined))
      const overrides = lane === 'auto' ? others : [...others, { agentId, lane }]
      const res = await pluginFetch(PLUGIN_ID, 'billing/overrides', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ overrides }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as MutationResult
        reportBudgetError(
          'billing-override',
          typeof data.error === 'string' ? data.error : `Failed to save the lane override (${res.status}).`,
        )
        return
      }
      fetchBudgetStatus()
    } catch (err) {
      reportBudgetError('billing-override', errorMessage(err))
    }
  }

  /** Resolve an incident: raise (new cap in the rule's unit), ack, or resume. */
  const resolveIncident = async (id: number, action: 'raise' | 'ack' | 'resume', cap?: number): Promise<string | null> => {
    try {
      const res = await pluginFetch(PLUGIN_ID, `budget/incidents/${id}/resolve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...(cap !== undefined ? { cap } : {}) }),
      })
      const data = await res.json() as MutationResult
      if (!res.ok) return String(data.error ?? `Resolve failed (${res.status})`)
      await Promise.all([fetchIncidents(), fetchBudget()])
      return null
    } catch (err) {
      return errorMessage(err)
    }
  }

  useEffect(() => {
    if (tab !== 'spend') return
    const controller = new AbortController()
    fetchSpend(spendWindow, controller.signal)
    fetchBudget(controller.signal)
    fetchIncidents(controller.signal)
    fetchBudgetStatus(controller.signal)
    return () => controller.abort()
  }, [tab, spendWindow, fetchSpend, fetchBudget, fetchIncidents, fetchBudgetStatus])

  // A Spend tab left open must reflect incidents as they happen — the 2am
  // breach banner cannot wait for a tab switch.
  const refreshBudgetSurfaces = useCallback(() => {
    if (tab !== 'spend') return
    fetchIncidents(); fetchBudget(); fetchSpend(spendWindow); fetchBudgetStatus()
  }, [tab, spendWindow, fetchIncidents, fetchBudget, fetchSpend, fetchBudgetStatus])
  usePluginEvent('budget.incident_opened', refreshBudgetSurfaces)
  usePluginEvent('budget.incident_resolved', refreshBudgetSurfaces)

  const fetchRouting = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await fetchPluginJson<RoutingConfigShape>('routing', 'Routing', LOAD_TIMEOUT_MS, signal)
      if (signal?.aborted) return
      setRouting({ routes: data.routes ?? [], tagOverrides: data.tagOverrides ?? [] })
      clearError('routing')
    } catch (err) {
      if (isAbortError(err) || signal?.aborted) return
      // Empty routing reads as "everything inherits the agent model" — a load
      // failure must say so instead of impersonating an unrouted install.
      reportError('routing', `Failed to load work-class routing: ${errorMessage(err)}`)
    }
  }, [clearError, reportError])

  useEffect(() => {
    if (tab !== 'routing') return
    const controller = new AbortController()
    fetchRouting(controller.signal)
    return () => controller.abort()
  }, [tab, fetchRouting])

  // Auto-refresh in the background when the served cache was stale.
  // We surface the cached data immediately; the refresh swaps rows
  // in place when it returns. handleRefresh guards against double-firing.
  useEffect(() => {
    if (modelsLoaded && modelsStale && !refreshing) {
      handleRefresh()
    }
    // Only react to the stale signal changing after initial load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelsLoaded, modelsStale])

  // -------------------------------------------------------------------------
  // Agent config actions
  // -------------------------------------------------------------------------
  const saveAgent = async (agentId: string) => {
    const ownModel = pendingOwn[agentId]
    const subagentModel = pendingSub[agentId]
    if (ownModel === undefined && subagentModel === undefined) return

    setSaving(agentId)
    clearError('agent-save')
    try {
      const body: Record<string, unknown> = { agentId }
      if (ownModel !== undefined) {
        body.ownModel = ownModel === '__default__' ? null : ownModel
      }
      if (subagentModel !== undefined) {
        body.subagentModel = subagentModel === '__default__' ? null : subagentModel
      }
      const res = await pluginFetch(PLUGIN_ID, 'config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json() as MutationResult
      if (data.ok) {
        setPendingOwn((prev) => { const n = { ...prev }; delete n[agentId]; return n })
        setPendingSub((prev) => { const n = { ...prev }; delete n[agentId]; return n })
        runtimeStatus.markDirty()
        await fetchConfig()
      } else {
        // A rejected save leaves the pending edit staged; say so, never drop it
        // on the floor while the row goes back to looking saved.
        reportError('agent-save', `Failed to save the model for ${agentId}: ${mutationError(data, res.status)}`)
      }
    } catch (err) {
      reportError('agent-save', `Failed to save the model for ${agentId}: ${errorMessage(err)}`)
    } finally {
      setSaving(null)
    }
  }

  const saveAll = async () => {
    const ids = new Set([...Object.keys(pendingOwn), ...Object.keys(pendingSub)])
    for (const id of ids) {
      await saveAgent(id)
    }
  }

  const saveDefaults = async (overrides?: { defaultModel?: string; defaultSubagentModel?: string | null; fallbackModels?: string[] }) => {
    const nextDefaultModel = overrides?.defaultModel ?? pendingDefaultModel ?? defaultModel
    const nextDefaultSubagentModel = overrides?.defaultSubagentModel ?? (pendingDefaultSubagentModel === undefined
      ? defaultSubagentModel
      : pendingDefaultSubagentModel)
    const nextFallbackModels = [...new Set((overrides?.fallbackModels ?? pendingFallbackModels ?? fallbackModels).filter((id) => id && id !== nextDefaultModel))]

    setSaving('defaults')
    clearError('defaults-save')
    try {
      const res = await pluginFetch(PLUGIN_ID, 'defaults', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          defaultModel: nextDefaultModel,
          defaultSubagentModel: nextDefaultSubagentModel,
          fallbackModels: nextFallbackModels,
        }),
      })
      const data = await res.json() as MutationResult
      if (data.ok) {
        runtimeStatus.markDirty()
        await fetchConfig()
        await fetchAvailable()
      } else {
        reportError('defaults-save', `Failed to save the default models: ${mutationError(data, res.status)}`)
      }
    } catch (err) {
      reportError('defaults-save', `Failed to save the default models: ${errorMessage(err)}`)
    } finally {
      setSaving(null)
    }
  }

  const setAsDefault = async (modelId: string) => {
    await saveDefaults({ defaultModel: modelId })
  }

  // -------------------------------------------------------------------------
  // Alias actions
  // -------------------------------------------------------------------------
  const addAlias = async () => {
    if (!newAliasName.trim() || !newAliasTarget.trim()) return
    setSaving('aliases')
    clearError('alias-save')
    try {
      const res = await pluginFetch(PLUGIN_ID, 'aliases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add', name: newAliasName.trim(), target: newAliasTarget.trim() }),
      })
      const data = await res.json() as MutationResult
      if (data.ok) {
        setNewAliasName('')
        setNewAliasTarget('')
        await fetchAliases()
        await fetchAvailable()
      } else {
        reportError('alias-save', `Failed to add the “${newAliasName.trim()}” alias: ${mutationError(data, res.status)}`)
      }
    } catch (err) {
      reportError('alias-save', `Failed to add the “${newAliasName.trim()}” alias: ${errorMessage(err)}`)
    } finally {
      setSaving(null)
    }
  }

  const deleteAlias = async (name: string) => {
    setSaving('aliases')
    clearError('alias-save')
    try {
      const res = await pluginFetch(PLUGIN_ID, 'aliases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', name }),
      })
      const data = await res.json() as MutationResult
      if (data.ok) {
        await fetchAliases()
        await fetchAvailable()
      } else {
        reportError('alias-save', `Failed to delete the “${name}” alias: ${mutationError(data, res.status)}`)
      }
    } catch (err) {
      reportError('alias-save', `Failed to delete the “${name}” alias: ${errorMessage(err)}`)
    } finally {
      setSaving(null)
    }
  }

  const prepopulateAliases = async () => {
    setSaving('aliases')
    clearError('alias-save')
    try {
      const res = await pluginFetch(PLUGIN_ID, 'aliases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'prepopulate' }),
      })
      const data = await res.json() as MutationResult
      if (data.ok) {
        await fetchAliases()
        await fetchAvailable()
      } else {
        reportError('alias-save', `Failed to add the recommended aliases: ${mutationError(data, res.status)}`)
      }
    } catch (err) {
      reportError('alias-save', `Failed to add the recommended aliases: ${errorMessage(err)}`)
    } finally {
      setSaving(null)
    }
  }

  // -------------------------------------------------------------------------
  // Routing actions
  // -------------------------------------------------------------------------
  const displayRouting = pendingRouting ?? routing

  const setRouteField = (workClass: string, field: 'model' | 'thinking', value: string) => {
    const base = pendingRouting ?? { routes: [...routing.routes], tagOverrides: [...routing.tagOverrides] }
    const routes = base.routes.filter((r) => r.workClass !== workClass)
    const existing = base.routes.find((r) => r.workClass === workClass) ?? { workClass }
    const next: WorkClassRouteRow = { ...existing, [field]: value || undefined }
    // Drop the row entirely when it carries no override (keeps storage clean).
    if (next.model || (next.thinking && next.thinking !== 'inherit')) routes.push(next)
    setPendingRouting({ ...base, routes })
  }

  const addTagOverride = () => {
    const base = pendingRouting ?? { routes: [...routing.routes], tagOverrides: [...routing.tagOverrides] }
    setPendingRouting({ ...base, tagOverrides: [...base.tagOverrides, { tag: '' }] })
  }

  const updateTagOverride = (index: number, field: 'tag' | 'model' | 'thinking', value: string) => {
    const base = pendingRouting ?? { routes: [...routing.routes], tagOverrides: [...routing.tagOverrides] }
    const tagOverrides = [...base.tagOverrides]
    tagOverrides[index] = { ...tagOverrides[index], [field]: field === 'tag' ? value : (value || undefined) }
    setPendingRouting({ ...base, tagOverrides })
  }

  const removeTagOverride = (index: number) => {
    const base = pendingRouting ?? { routes: [...routing.routes], tagOverrides: [...routing.tagOverrides] }
    setPendingRouting({ ...base, tagOverrides: base.tagOverrides.filter((_, i) => i !== index) })
  }

  /** Merge recommended routes in and persist (the Apply-recommended confirm). */
  const applyRecommendedRoutes = async (proposals: Array<{ workClass: string; model: string }>) => {
    const base = pendingRouting ?? routing
    const merged: RoutingConfigShape = {
      routes: [...base.routes, ...proposals.map((p) => ({ workClass: p.workClass, model: p.model }))],
      tagOverrides: base.tagOverrides,
    }
    const res = await pluginFetch(PLUGIN_ID, 'routing', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(merged),
    })
    const data = await res.json() as MutationResult
    if (!data.ok) throw new Error(data.error ?? 'Failed to apply recommended routes')
    setRouting(merged)
    setPendingRouting(null)
  }

  const saveRouting = async () => {
    if (!pendingRouting) return
    setSaving('routing')
    clearError('routing-save')
    try {
      // Drop blank tag rows; normalize 'inherit' thinking to unset.
      const clean: RoutingConfigShape = {
        routes: pendingRouting.routes.map((r) => ({ workClass: r.workClass, ...(r.model ? { model: r.model } : {}), ...(r.thinking && r.thinking !== 'inherit' ? { thinking: r.thinking } : {}) })),
        tagOverrides: pendingRouting.tagOverrides.filter((t) => t.tag.trim()).map((t) => ({ tag: t.tag.trim(), ...(t.model ? { model: t.model } : {}), ...(t.thinking && t.thinking !== 'inherit' ? { thinking: t.thinking } : {}) })),
      }
      const res = await pluginFetch(PLUGIN_ID, 'routing', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(clean),
      })
      const data = await res.json() as MutationResult
      if (data.ok) {
        setRouting(clean)
        setPendingRouting(null)
      } else {
        // The staged rows stay staged — the unsaved-changes banner must not be
        // the only hint that the routes never reached the server.
        reportError('routing-save', `Failed to save work-class routing: ${mutationError(data, res.status)}`)
      }
    } catch (err) {
      reportError('routing-save', `Failed to save work-class routing: ${errorMessage(err)}`)
    } finally {
      setSaving(null)
    }
  }

  const hasPending = Object.keys(pendingOwn).length > 0 || Object.keys(pendingSub).length > 0
  const defaultsDirty = pendingDefaultModel !== null || pendingDefaultSubagentModel !== undefined || pendingFallbackModels !== null

  // Model options come straight from the runtime adapter (via the cache). No fake
  // fallback — if the list is empty, dropdowns stay empty and save
  // buttons disable. The Available tab has its own loading / error UI
  // upstream of this derivation.
  const modelOptions: AvailableModel[] = availableModels
  const modelsReady = modelsLoaded && availableModels.length > 0

  const availableProviders = [...new Set(modelOptions.map((m) => m.provider))].sort((a, b) => a.localeCompare(b))
  const effectiveDefaultModel = pendingDefaultModel ?? defaultModel
  const effectiveDefaultSubagentModel = pendingDefaultSubagentModel === undefined
    ? (defaultSubagentModel || '__default__')
    : (pendingDefaultSubagentModel || '__default__')
  const effectiveFallbackModels = pendingFallbackModels ?? fallbackModels
  const fallbackCandidates = modelOptions.filter((model) => model.id !== effectiveDefaultModel)

  return {
    // tab + window navigation
    tab, setTab, spendWindow, setSpendWindow,
    // config + agents
    agents, loading, error, saving, runtimeStatus,
    fetchConfig,
    // available models
    availableModels, modelOptions, modelsReady, availableProviders,
    modelsCached, modelsCachedAt, modelsStale, modelsError, modelsLoaded, refreshing,
    handleRefresh,
    // aliases
    aliases, newAliasName, setNewAliasName, newAliasTarget, setNewAliasTarget,
    addAlias, deleteAlias, prepopulateAliases,
    // agent defaults + per-agent edits
    pendingOwn, setPendingOwn, pendingSub, setPendingSub,
    setPendingDefaultModel, setPendingDefaultSubagentModel,
    pendingFallbackModels, setPendingFallbackModels, fallbackModels,
    saveAgent, saveAll, saveDefaults, setAsDefault,
    hasPending, defaultsDirty,
    effectiveDefaultModel, effectiveDefaultSubagentModel, effectiveFallbackModels, fallbackCandidates,
    // routing
    routing, routingSupport, pendingRouting, setPendingRouting, displayRouting,
    setRouteField, addTagOverride, updateTagOverride, removeTagOverride, saveRouting, applyRecommendedRoutes,
    // spend + budget
    spend, spendLoading,
    budgetRules, pendingRules, setPendingRules, saveBudgetRules, budgetError, budgetWarnings,
    incidents, resolveIncident,
    budgetStatus, setDispatchPaused, setAgentLaneOverride,
  }
}

/** The object returned by useModelsData(), passed to the per-tab components. */
export type ModelsData = ReturnType<typeof useModelsData>
