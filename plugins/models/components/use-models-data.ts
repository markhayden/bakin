'use client'

// React
import { useEffect, useState, useCallback } from 'react'
// SDK
import { useQueryState, usePluginEvent, emitPluginEvent } from "@makinbakin/sdk/hooks"
import { useRuntimeStatus } from "@makinbakin/sdk/hooks"
// Relative
import type { AgentModelConfig, AvailableModel, ModelsConfigResponse } from '../types'

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
export interface SpendResponse {
  window: string
  estimated: boolean
  totalUsdMicros: number
  byAgent: SpendRowAgent[]
  byModel: SpendRowModel[]
  byWorkClass?: SpendRowWorkClass[]
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
  const [error, setError] = useState<string | null>(null)
  const [spendWindow, setSpendWindow] = useQueryState('window', '24h')
  const [spend, setSpend] = useState<SpendResponse | null>(null)
  const [spendLoading, setSpendLoading] = useState(false)
  const [routing, setRouting] = useState<RoutingConfigShape>({ routes: [], tagOverrides: [] })
  const [pendingRouting, setPendingRouting] = useState<RoutingConfigShape | null>(null)
  const [budgetRules, setBudgetRules] = useState<BudgetRuleWire[]>([])
  const [pendingRules, setPendingRules] = useState<BudgetRuleWire[] | null>(null)
  const [incidents, setIncidents] = useState<BudgetIncidentWire[]>([])
  const [budgetError, setBudgetError] = useState<string | null>(null)
  const [budgetWarnings, setBudgetWarnings] = useState<string[]>([])
  const [budgetStatus, setBudgetStatus] = useState<BudgetStatusWire | null>(null)

  // -------------------------------------------------------------------------
  // Data fetching
  // -------------------------------------------------------------------------
  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/plugins/models/config')
      if (!res.ok) throw new Error(`Config fetch failed (${res.status})`)
      const data = await res.json() as ModelsConfigResponse
      if (data.agents) setAgents(data.agents)
      setDefaultModel(data.defaultModel)
      setDefaultSubagentModel(data.defaultSubagentModel)
      setFallbackModels(data.fallbackModels ?? [])
      setPendingDefaultModel(null)
      setPendingDefaultSubagentModel(undefined)
      setPendingFallbackModels(null)
      setError(null)
    } catch (err) {
      setError(`Failed to load agent config: ${err instanceof Error ? err.message : err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchAvailable = useCallback(async () => {
    try {
      const res = await fetch('/api/plugins/models/available')
      if (!res.ok) throw new Error(`Models fetch failed (${res.status})`)
      const data = await res.json()
      setAvailableModels(data.models ?? [])
      setModelsCached(!!data.cached)
      setModelsCachedAt(data.cachedAt ?? null)
      setModelsStale(!!data.stale)
      setModelsError(data.error ?? null)
    } catch (err) {
      console.error('Failed to fetch available models:', err)
      setModelsError(err instanceof Error ? err.message : String(err))
    } finally {
      setModelsLoaded(true)
    }
  }, [])

  const handleRefresh = useCallback(async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      const res = await fetch('/api/plugins/models/refresh', { method: 'POST' })
      const data = await res.json()
      if (Array.isArray(data.models)) {
        setAvailableModels(data.models)
      }
      setModelsCached(!!data.cached)
      setModelsCachedAt(data.cachedAt ?? null)
      setModelsStale(!!data.stale)
      setModelsError(res.ok ? null : (data.error ?? `Refresh failed (${res.status})`))
    } catch (err) {
      setModelsError(err instanceof Error ? err.message : String(err))
    } finally {
      setRefreshing(false)
    }
  }, [refreshing])

  const fetchAliases = useCallback(async () => {
    try {
      const res = await fetch('/api/plugins/models/aliases')
      if (!res.ok) throw new Error(`Aliases fetch failed (${res.status})`)
      const data = await res.json()
      if (data.aliases) setAliases(data.aliases)
    } catch (err) {
      console.error('Failed to fetch aliases:', err)
    }
  }, [])

  const fetchSpend = useCallback(async (window: string) => {
    setSpendLoading(true)
    try {
      const res = await fetch(`/api/plugins/models/spend?window=${encodeURIComponent(window)}`)
      if (!res.ok) throw new Error(`Spend fetch failed (${res.status})`)
      setSpend(await res.json() as SpendResponse)
    } catch (err) {
      console.error('Failed to fetch spend:', err)
      setSpend(null)
    } finally {
      setSpendLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchConfig()
    fetchAvailable()
    fetchAliases()
  }, [fetchConfig, fetchAvailable, fetchAliases])

  const fetchBudget = useCallback(async () => {
    try {
      const res = await fetch('/api/plugins/models/budget')
      if (!res.ok) throw new Error(`Budget fetch failed (${res.status})`)
      const policy = (await res.json()) as { rules?: BudgetRuleWire[] }
      setBudgetRules(policy.rules ?? [])
    } catch (err) {
      console.error('Failed to fetch budget:', err)
    }
  }, [])

  const fetchIncidents = useCallback(async () => {
    try {
      const res = await fetch('/api/plugins/models/budget/incidents')
      if (!res.ok) throw new Error(`Incidents fetch failed (${res.status})`)
      const data = (await res.json()) as { incidents?: BudgetIncidentWire[] }
      setIncidents(data.incidents ?? [])
    } catch (err) {
      console.error('Failed to fetch budget incidents:', err)
    }
  }, [])

  const fetchBudgetStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/plugins/models/budget/status')
      if (!res.ok) return
      setBudgetStatus((await res.json()) as BudgetStatusWire)
    } catch (err) {
      console.error('Failed to fetch budget status:', err)
    }
  }, [])

  /** PUT the full rule list — every rule round-trips; nothing is dropped.
   *  Failures and unknown-id warnings surface in the UI, never only the
   *  console (a silently-rejected cap is fake safety). */
  const saveBudgetRules = async (): Promise<void> => {
    if (!pendingRules) return
    setSaving('budget')
    setBudgetError(null)
    setBudgetWarnings([])
    try {
      // A rule with no caps is invalid — reject explicitly instead of
      // silently deleting the row on save.
      const capless = pendingRules.findIndex((r) => !r.dailyCap && !r.monthlyCap)
      if (capless >= 0) {
        setBudgetError(`Rule ${capless + 1} has no caps — set a daily or monthly cap, or remove the row.`)
        return
      }
      const res = await fetch('/api/plugins/models/budget', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules: pendingRules }),
      })
      const data = await res.json()
      if (data.ok) {
        setBudgetRules(pendingRules)
        setPendingRules(null)
        setBudgetWarnings(Array.isArray(data.warnings) ? data.warnings : [])
        // Re-fetch the canonical rules — the server normalizes model-scope
        // ids, and the utilization cards must key exactly like spend rows.
        fetchBudget()
        fetchBudgetStatus()
      } else {
        setBudgetError(typeof data.error === 'string' ? data.error : `Save failed (${res.status})`)
      }
    } catch (err) {
      setBudgetError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(null)
    }
  }

  /** Toggle the dispatch kill switch from the Spend tab. */
  const setDispatchPaused = async (paused: boolean): Promise<void> => {
    setBudgetError(null)
    try {
      const res = await fetch('/api/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dispatch: { paused } }),
      })
      if (!res.ok) {
        setBudgetError(`Failed to ${paused ? 'pause' : 'resume'} dispatch (${res.status}).`)
        return
      }
      fetchBudgetStatus()
      // Client-side fan-out so the header banner reflects immediately
      // instead of waiting out its 15s poll (a settings write emits no SSE).
      emitPluginEvent({ event: 'budget.paused_changed', paused })
    } catch (err) {
      setBudgetError(err instanceof Error ? err.message : String(err))
    }
  }

  /** Save a per-agent billing-lane override ('auto' clears it). */
  const setAgentLaneOverride = async (agentId: string, lane: 'auto' | 'metered' | 'subscription'): Promise<void> => {
    setBudgetError(null)
    try {
      const current = budgetStatus?.overrides ?? []
      const others = current.filter((o) => !(o.agentId === agentId && o.provider === undefined))
      const overrides = lane === 'auto' ? others : [...others, { agentId, lane }]
      const res = await fetch('/api/plugins/models/billing/overrides', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ overrides }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setBudgetError(typeof data.error === 'string' ? data.error : `Failed to save the lane override (${res.status}).`)
        return
      }
      fetchBudgetStatus()
    } catch (err) {
      setBudgetError(err instanceof Error ? err.message : String(err))
    }
  }

  /** Resolve an incident: raise (new cap in the rule's unit), ack, or resume. */
  const resolveIncident = async (id: number, action: 'raise' | 'ack' | 'resume', cap?: number): Promise<string | null> => {
    try {
      const res = await fetch(`/api/plugins/models/budget/incidents/${id}/resolve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...(cap !== undefined ? { cap } : {}) }),
      })
      const data = await res.json()
      if (!res.ok) return String(data.error ?? `Resolve failed (${res.status})`)
      await Promise.all([fetchIncidents(), fetchBudget()])
      return null
    } catch (err) {
      return err instanceof Error ? err.message : String(err)
    }
  }

  useEffect(() => {
    if (tab === 'spend') { fetchSpend(spendWindow); fetchBudget(); fetchIncidents(); fetchBudgetStatus() }
  }, [tab, spendWindow, fetchSpend, fetchBudget, fetchIncidents, fetchBudgetStatus])

  // A Spend tab left open must reflect incidents as they happen — the 2am
  // breach banner cannot wait for a tab switch.
  const refreshBudgetSurfaces = useCallback(() => {
    if (tab !== 'spend') return
    fetchIncidents(); fetchBudget(); fetchSpend(spendWindow); fetchBudgetStatus()
  }, [tab, spendWindow, fetchIncidents, fetchBudget, fetchSpend, fetchBudgetStatus])
  usePluginEvent('budget.incident_opened', refreshBudgetSurfaces)
  usePluginEvent('budget.incident_resolved', refreshBudgetSurfaces)

  const fetchRouting = useCallback(async () => {
    try {
      const res = await fetch('/api/plugins/models/routing')
      if (!res.ok) throw new Error(`Routing fetch failed (${res.status})`)
      const data = await res.json() as RoutingConfigShape
      setRouting({ routes: data.routes ?? [], tagOverrides: data.tagOverrides ?? [] })
    } catch (err) {
      console.error('Failed to fetch routing:', err)
    }
  }, [])

  useEffect(() => {
    if (tab === 'routing') fetchRouting()
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
    try {
      const body: Record<string, unknown> = { agentId }
      if (ownModel !== undefined) {
        body.ownModel = ownModel === '__default__' ? null : ownModel
      }
      if (subagentModel !== undefined) {
        body.subagentModel = subagentModel === '__default__' ? null : subagentModel
      }
      const res = await fetch('/api/plugins/models/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.ok) {
        setPendingOwn((prev) => { const n = { ...prev }; delete n[agentId]; return n })
        setPendingSub((prev) => { const n = { ...prev }; delete n[agentId]; return n })
        runtimeStatus.markDirty()
        await fetchConfig()
      }
    } catch (err) {
      console.error('Failed to save:', err)
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
    try {
      const res = await fetch('/api/plugins/models/defaults', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          defaultModel: nextDefaultModel,
          defaultSubagentModel: nextDefaultSubagentModel,
          fallbackModels: nextFallbackModels,
        }),
      })
      const data = await res.json()
      if (data.ok) {
        runtimeStatus.markDirty()
        await fetchConfig()
        await fetchAvailable()
      }
    } catch (err) {
      console.error('Failed to set default:', err)
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
    try {
      const res = await fetch('/api/plugins/models/aliases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add', name: newAliasName.trim(), target: newAliasTarget.trim() }),
      })
      const data = await res.json()
      if (data.ok) {
        setNewAliasName('')
        setNewAliasTarget('')
        await fetchAliases()
        await fetchAvailable()
      }
    } catch (err) {
      console.error('Failed to add alias:', err)
    }
  }

  const deleteAlias = async (name: string) => {
    try {
      const res = await fetch('/api/plugins/models/aliases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', name }),
      })
      const data = await res.json()
      if (data.ok) {
        await fetchAliases()
        await fetchAvailable()
      }
    } catch (err) {
      console.error('Failed to delete alias:', err)
    }
  }

  const prepopulateAliases = async () => {
    try {
      const res = await fetch('/api/plugins/models/aliases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'prepopulate' }),
      })
      const data = await res.json()
      if (data.ok) {
        await fetchAliases()
        await fetchAvailable()
      }
    } catch (err) {
      console.error('Failed to prepopulate aliases:', err)
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

  const saveRouting = async () => {
    if (!pendingRouting) return
    setSaving('routing')
    try {
      // Drop blank tag rows; normalize 'inherit' thinking to unset.
      const clean: RoutingConfigShape = {
        routes: pendingRouting.routes.map((r) => ({ workClass: r.workClass, ...(r.model ? { model: r.model } : {}), ...(r.thinking && r.thinking !== 'inherit' ? { thinking: r.thinking } : {}) })),
        tagOverrides: pendingRouting.tagOverrides.filter((t) => t.tag.trim()).map((t) => ({ tag: t.tag.trim(), ...(t.model ? { model: t.model } : {}), ...(t.thinking && t.thinking !== 'inherit' ? { thinking: t.thinking } : {}) })),
      }
      const res = await fetch('/api/plugins/models/routing', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(clean),
      })
      const data = await res.json()
      if (data.ok) {
        setRouting(clean)
        setPendingRouting(null)
      }
    } catch (err) {
      console.error('Failed to save routing:', err)
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
    routing, pendingRouting, setPendingRouting, displayRouting,
    setRouteField, addTagOverride, updateTagOverride, removeTagOverride, saveRouting,
    // spend + budget
    spend, spendLoading,
    budgetRules, pendingRules, setPendingRules, saveBudgetRules, budgetError, budgetWarnings,
    incidents, resolveIncident,
    budgetStatus, setDispatchPaused, setAgentLaneOverride,
  }
}

/** The object returned by useModelsData(), passed to the per-tab components. */
export type ModelsData = ReturnType<typeof useModelsData>
