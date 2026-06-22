'use client'

// React
import { useEffect, useState, useCallback } from 'react'
// SDK
import { useQueryState } from "@makinbakin/sdk/hooks"
import { useRuntimeStatus } from "@makinbakin/sdk/hooks"
// Relative
import type { AgentModelConfig, AvailableModel, ModelsConfigResponse } from '../types'

export interface RoutingPolicyRow { origin: string; model?: string; thinking?: string }
export interface TagOverrideRow { tag: string; model?: string; thinking?: string }
export interface RoutingConfigShape { policies: RoutingPolicyRow[]; tagOverrides: TagOverrideRow[] }
export interface BudgetShape { global?: { dailyUsd?: number; monthlyUsd?: number; warnPct?: number }; perAgent?: Record<string, { dailyUsd?: number; monthlyUsd?: number }> }

export interface SpendRowAgent { agent: string; costUsdMicros: number; runs: number }
export interface SpendRowModel { model: string; costUsdMicros: number; runs: number }
export interface SpendResponse {
  window: string
  estimated: boolean
  totalUsdMicros: number
  byAgent: SpendRowAgent[]
  byModel: SpendRowModel[]
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
  const [routing, setRouting] = useState<RoutingConfigShape>({ policies: [], tagOverrides: [] })
  const [pendingRouting, setPendingRouting] = useState<RoutingConfigShape | null>(null)
  const [budget, setBudget] = useState<BudgetShape>({})
  const [pendingBudget, setPendingBudget] = useState<BudgetShape | null>(null)

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
      setBudget(await res.json() as BudgetShape)
    } catch (err) {
      console.error('Failed to fetch budget:', err)
    }
  }, [])

  const saveBudget = async () => {
    if (!pendingBudget) return
    setSaving('budget')
    try {
      // Drop blank/zero caps so an empty field clears the limit.
      const g = pendingBudget.global ?? {}
      const global: BudgetShape['global'] = {
        ...(g.dailyUsd ? { dailyUsd: g.dailyUsd } : {}),
        ...(g.monthlyUsd ? { monthlyUsd: g.monthlyUsd } : {}),
        ...(g.warnPct ? { warnPct: g.warnPct } : {}),
      }
      const clean: BudgetShape = Object.keys(global).length ? { global } : {}
      const res = await fetch('/api/plugins/models/budget', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(clean),
      })
      const data = await res.json()
      if (data.ok) { setBudget(clean); setPendingBudget(null) }
    } catch (err) {
      console.error('Failed to save budget:', err)
    } finally {
      setSaving(null)
    }
  }

  useEffect(() => {
    if (tab === 'spend') { fetchSpend(spendWindow); fetchBudget() }
  }, [tab, spendWindow, fetchSpend, fetchBudget])

  const fetchRouting = useCallback(async () => {
    try {
      const res = await fetch('/api/plugins/models/routing')
      if (!res.ok) throw new Error(`Routing fetch failed (${res.status})`)
      const data = await res.json() as RoutingConfigShape
      setRouting({ policies: data.policies ?? [], tagOverrides: data.tagOverrides ?? [] })
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

  const setOriginField = (origin: string, field: 'model' | 'thinking', value: string) => {
    const base = pendingRouting ?? { policies: [...routing.policies], tagOverrides: [...routing.tagOverrides] }
    const policies = base.policies.filter((p) => p.origin !== origin)
    const existing = base.policies.find((p) => p.origin === origin) ?? { origin }
    const next: RoutingPolicyRow = { ...existing, [field]: value || undefined }
    // Drop the row entirely when it carries no override (keeps storage clean).
    if (next.model || (next.thinking && next.thinking !== 'inherit')) policies.push(next)
    setPendingRouting({ ...base, policies })
  }

  const addTagOverride = () => {
    const base = pendingRouting ?? { policies: [...routing.policies], tagOverrides: [...routing.tagOverrides] }
    setPendingRouting({ ...base, tagOverrides: [...base.tagOverrides, { tag: '' }] })
  }

  const updateTagOverride = (index: number, field: 'tag' | 'model' | 'thinking', value: string) => {
    const base = pendingRouting ?? { policies: [...routing.policies], tagOverrides: [...routing.tagOverrides] }
    const tagOverrides = [...base.tagOverrides]
    tagOverrides[index] = { ...tagOverrides[index], [field]: field === 'tag' ? value : (value || undefined) }
    setPendingRouting({ ...base, tagOverrides })
  }

  const removeTagOverride = (index: number) => {
    const base = pendingRouting ?? { policies: [...routing.policies], tagOverrides: [...routing.tagOverrides] }
    setPendingRouting({ ...base, tagOverrides: base.tagOverrides.filter((_, i) => i !== index) })
  }

  const saveRouting = async () => {
    if (!pendingRouting) return
    setSaving('routing')
    try {
      // Drop blank tag rows; normalize 'inherit' thinking to unset.
      const clean: RoutingConfigShape = {
        policies: pendingRouting.policies.map((p) => ({ origin: p.origin, ...(p.model ? { model: p.model } : {}), ...(p.thinking && p.thinking !== 'inherit' ? { thinking: p.thinking } : {}) })),
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
    setOriginField, addTagOverride, updateTagOverride, removeTagOverride, saveRouting,
    // spend + budget
    spend, spendLoading, budget, pendingBudget, setPendingBudget, saveBudget,
  }
}
