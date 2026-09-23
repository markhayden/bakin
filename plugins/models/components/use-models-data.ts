'use client'

// React
import { useCallback, useEffect, useRef, useState } from 'react'
// SDK
import { toModelSelectOptions } from "@makinbakin/sdk/hooks"
import { useRuntimeStatus } from "@makinbakin/sdk/hooks"
import { useQueryState } from "@makinbakin/sdk/navigation"
import { pluginFetch, pluginFetchJson } from "@makinbakin/sdk/utils"
// Relative
import type { AgentModelConfig, AvailableModel, ModelsConfigResponse } from '../types'
import type { RoutingConfig as RoutingConfigArg } from '../types'
import { aliasOps, policyDefaultsOps, routingDiffOps, type MutationOp } from '../lib/selection-ops'

/** This plugin's id — every own-route call goes through `pluginFetch(PLUGIN_ID, …)`. */
const PLUGIN_ID = 'models'

/**
 * Deadline for the page's configuration reads. Every GET is bounded: a stalled
 * endpoint must surface as an error the page can render, never as a spinner
 * that spins forever.
 */
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

/** Wire shape of POST /selections (the ONE write path, #907). */
interface SelectionsMutationWire {
  applied?: string[]
  failed?: Array<{ ref: string; error: { code: string; message: string } }>
  pending?: Array<{ ref: string; intended: string | null }>
  warnings?: string[]
  revision?: string
  // refusal shape
  error?: string
  message?: string
  current?: string
  proposal?: { to: string | null }
}

export type SelectionsMutationOutcome =
  | { ok: true; applied: string[]; pending: Array<{ ref: string; intended: string | null }>; warnings: string[]; revision: string | null }
  | { ok: false; error: string; stale?: boolean }

const STALE_MESSAGE = 'The configuration changed since this page loaded — it has been reloaded; review your change and try again.'

/** Read the revision the current selections carry — the revision an editor snapshot is taken under. */
async function readRevision(): Promise<string | null> {
  const current = await pluginFetch(PLUGIN_ID, 'selections')
  if (!current.ok) return null
  const { revision } = await current.json() as { revision?: string }
  return typeof revision === 'string' ? revision : null
}

/**
 * Apply selection ops through POST /selections under the revision the ops
 * were BUILT against (the editor snapshot's), never a fresher one: the ops
 * are diffs of that snapshot — a fallback op is positional, so re-posting
 * them against a state someone else moved can remove the wrong entry. A
 * 409 stale_revision therefore comes back as `{ ok: false, stale: true }`
 * for the caller to reload and let the operator look again. Refusals
 * (400/409) carry the server's plain-words reason.
 */
async function postSelectionOps(ops: MutationOp[], revision: string | null): Promise<SelectionsMutationOutcome> {
  if (ops.length === 0) return { ok: true, applied: [], pending: [], warnings: [], revision }
  if (!revision) return { ok: false, error: 'Could not read the current configuration — reload and try again.' }
  const res = await pluginFetch(PLUGIN_ID, 'selections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revision, ops }),
  })
  const data = await res.json() as SelectionsMutationWire
  if (res.status === 409 && data.error === 'stale_revision') return { ok: false, error: STALE_MESSAGE, stale: true }
  if (!res.ok) {
    const proposal = data.proposal?.to ? ` Try ${data.proposal.to} instead.` : ''
    return { ok: false, error: `${data.message ?? data.error ?? `Save failed (${res.status})`}${proposal}` }
  }
  const failed = data.failed ?? []
  if (failed.length > 0) {
    return { ok: false, error: failed.map((f) => `${f.ref}: ${f.error.message}`).join('; ') }
  }
  return { ok: true, applied: data.applied ?? [], pending: data.pending ?? [], warnings: data.warnings ?? [], revision: data.revision ?? null }
}

/** GET one of this plugin's own routes as JSON under a hard deadline. */
function fetchPluginJson<T>(
  path: string,
  label: string,
  timeoutMs: number,
  signal?: AbortSignal,
  init?: RequestInit,
): Promise<T> {
  return pluginFetchJson<T>(PLUGIN_ID, path, { label, timeoutMs, signal, init })
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
/**
 * The Models page data layer: every fetcher, effect, draft-state slice, action
 * handler, and derived value. Extracted from ModelsPage so the page shell and
 * (eventually) per-tab components consume one typed object. Behavior-identical
 * to the former inline hooks — same call order, same effects.
 */
export function useModelsData() {
  /**
   * The selections revision the DEFAULTS snapshot (config: default /
   * subagent / positional fallbacks) was loaded under — every save posts
   * under it. Only `loadConfig` refreshes it: the alias and routing tabs
   * load their own snapshots without touching the revision, because a
   * fresher revision paired with a stale fallback snapshot would let the
   * server accept positional fallback ops built against the wrong list.
   * A save adopts the returned revision; a stale refusal reloads all three.
   */
  const revisionRef = useRef<string | null>(null)
  const [tab, setTab] = useQueryState('tab', 'agents')
  const [agents, setAgents] = useState<AgentModelConfig[]>([])
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([])
  const [modelsCached, setModelsCached] = useState(false)
  const [modelsCachedAt, setModelsCachedAt] = useState<number | null>(null)
  const [modelsStale, setModelsStale] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [modelsLoaded, setModelsLoaded] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [probeVerdicts, setProbeVerdicts] = useState<ProbeVerdictWire[] | null>(null)
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
  const [routing, setRouting] = useState<RoutingConfigShape>({ routes: [], tagOverrides: [] })
  const [routingSupport, setRoutingSupport] = useState<ModelsConfigResponse['support'] | null>(null)
  const [pendingRouting, setPendingRouting] = useState<RoutingConfigShape | null>(null)
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
      revisionRef.current = await readRevision()
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

  const handleVerify = useCallback(async () => {
    // Probing is billed (~pennies) and EXPLICIT (#852): only this action ever
    // passes probe=1 — handleRefresh and the stale auto-refresh never do.
    if (verifying || refreshing) return
    setVerifying(true)
    try {
      const data = await fetchPluginJson<AvailableModelsPayload & { probe?: { supported: boolean; verdicts: ProbeVerdictWire[] } }>(
        'refresh?probe=1',
        'Verify availability',
        VERIFY_TIMEOUT_MS,
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
      setProbeVerdicts(data.probe?.verdicts ?? null)
    } catch (err) {
      setModelsError(err instanceof Error ? err.message : String(err))
    } finally {
      setVerifying(false)
    }
  }, [verifying, refreshing])

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

  useEffect(() => {
    const controller = new AbortController()
    loadConfig(controller.signal)
    fetchAvailable(controller.signal)
    fetchAliases(controller.signal)
    return () => controller.abort()
  }, [loadConfig, fetchAvailable, fetchAliases])

  // Each agent row's picker is judged under THAT agent's credentials (#907
  // review): the unscoped catalog answers "can this install run it", but an
  // agent pin is validated by the write path under the agent's own keys, so
  // the picker that stages it must disable by the same verdict. One scoped
  // read per agent off the same cached catalog, re-run whenever the roster
  // or the catalog changes; the unscoped list stands in until a row's read
  // lands (or fails — never a blank picker).
  const [agentCatalogs, setAgentCatalogs] = useState<Record<string, AvailableModel[]>>({})
  useEffect(() => {
    if (agents.length === 0 || !modelsLoaded) return
    const controller = new AbortController()
    void Promise.all(agents.map(async (agent) => {
      try {
        const data = await fetchPluginJson<AvailableModelsPayload>(`available?agentId=${encodeURIComponent(agent.agentId)}`, 'Models', LOAD_TIMEOUT_MS, controller.signal)
        return [agent.agentId, data.models ?? []] as const
      } catch (err) {
        if (!isAbortError(err) && !controller.signal.aborted) console.warn(`Agent-scoped model catalog for ${agent.agentId} failed; using the unscoped catalog: ${errorMessage(err)}`)
        return null
      }
    })).then((entries) => {
      if (controller.signal.aborted) return
      setAgentCatalogs(Object.fromEntries(entries.filter((e): e is readonly [string, AvailableModel[]] => e !== null)))
    })
    return () => controller.abort()
  }, [agents, availableModels, modelsLoaded])

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

  /**
   * The ONE client write: ops go out under the revision the editor snapshot
   * loaded (`revisionRef`), a success adopts the returned revision, and a
   * stale refusal reloads every editor so the operator re-decides against
   * the moved state — it is never re-posted blind.
   */
  const mutateSelections = useCallback(async (ops: MutationOp[]): Promise<SelectionsMutationOutcome> => {
    const outcome = await postSelectionOps(ops, revisionRef.current)
    if (outcome.ok) revisionRef.current = outcome.revision ?? revisionRef.current
    else if (outcome.stale) void Promise.all([fetchConfig(), fetchAliases(), fetchRouting()])
    return outcome
  }, [fetchConfig, fetchAliases, fetchRouting])

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
      const ops: MutationOp[] = []
      if (ownModel !== undefined) ops.push({ ref: `agent:${agentId}:model`, set: { model: ownModel === '__default__' ? null : ownModel } })
      if (subagentModel !== undefined) ops.push({ ref: `agent:${agentId}:subagentModel`, set: { model: subagentModel === '__default__' ? null : subagentModel } })
      const outcome = await mutateSelections(ops)
      if (outcome.ok) {
        setPendingOwn((prev) => { const n = { ...prev }; delete n[agentId]; return n })
        setPendingSub((prev) => { const n = { ...prev }; delete n[agentId]; return n })
        await runtimeStatus.refresh()
        await fetchConfig()
      } else {
        // A rejected save leaves the pending edit staged; say so, never drop it
        // on the floor while the row goes back to looking saved.
        reportError('agent-save', `Failed to save the model for ${agentId}: ${outcome.error}`)
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
      const outcome = await mutateSelections(policyDefaultsOps(
        { defaultModel, defaultSubagentModel: defaultSubagentModel ?? null, fallbackModels },
        { defaultModel: nextDefaultModel, defaultSubagentModel: nextDefaultSubagentModel ?? null, fallbackModels: nextFallbackModels },
      ))
      if (outcome.ok) {
        await runtimeStatus.refresh()
        await fetchConfig()
        await fetchAvailable()
      } else {
        reportError('defaults-save', `Failed to save the default models: ${outcome.error}`)
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
  const saveAliases = async (next: Record<string, string>, label: string, onOk?: () => void) => {
    setSaving('aliases')
    clearError('alias-save')
    try {
      const outcome = await mutateSelections(aliasOps(aliases, next))
      if (outcome.ok) {
        onOk?.()
        await fetchAliases()
        await fetchAvailable()
      } else {
        reportError('alias-save', `${label}: ${outcome.error}`)
      }
    } catch (err) {
      reportError('alias-save', `${label}: ${errorMessage(err)}`)
    } finally {
      setSaving(null)
    }
  }

  const addAlias = async () => {
    if (!newAliasName.trim() || !newAliasTarget.trim()) return
    const name = newAliasName.trim()
    await saveAliases({ ...aliases, [name]: newAliasTarget.trim() }, `Failed to add the “${name}” alias`, () => {
      setNewAliasName('')
      setNewAliasTarget('')
    })
  }

  const deleteAlias = async (name: string) => {
    const next = { ...aliases }
    delete next[name]
    await saveAliases(next, `Failed to delete the “${name}” alias`)
  }

  const prepopulateAliases = async () => {
    // The recommended set is server-owned data; read it, merge without
    // clobbering the user's own aliases, write through the one path.
    setSaving('aliases')
    clearError('alias-save')
    try {
      const res = await pluginFetch(PLUGIN_ID, 'aliases/recommended')
      const data = await res.json() as { aliases?: Record<string, string>; error?: string }
      if (!res.ok || !data.aliases) {
        reportError('alias-save', `Failed to add the recommended aliases: ${data.error ?? `HTTP ${res.status}`}`)
        return
      }
      const merged = { ...data.aliases, ...aliases }
      const outcome = await mutateSelections(aliasOps(aliases, merged))
      if (outcome.ok) {
        await fetchAliases()
        await fetchAvailable()
      } else {
        reportError('alias-save', `Failed to add the recommended aliases: ${outcome.error}`)
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
    const outcome = await mutateSelections(routingDiffOps(routing as RoutingConfigArg, merged as RoutingConfigArg))
    if (!outcome.ok) throw new Error(outcome.error)
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
      const outcome = await mutateSelections(routingDiffOps(routing as RoutingConfigArg, clean as RoutingConfigArg))
      if (outcome.ok) {
        setRouting(clean)
        setPendingRouting(null)
      } else {
        // The staged rows stay staged — the unsaved-changes banner must not be
        // the only hint that the routes never reached the server.
        reportError('routing-save', `Failed to save work-class routing: ${outcome.error}`)
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
  // Picker options: ineligible rows disabled with their reason (#907) — the
  // ONE mapping every ModelSelect on this page uses. Agent rows take the
  // agent-scoped verdicts (their own credentials), falling back to the
  // unscoped catalog until the scoped read lands.
  const modelSelectOptions = toModelSelectOptions(modelOptions)
  const agentModelSelectOptions = (agentId: string) => toModelSelectOptions(agentCatalogs[agentId] ?? modelOptions)

  const availableProviders = [...new Set(modelOptions.map((m) => m.provider))].sort((a, b) => a.localeCompare(b))
  const effectiveDefaultModel = pendingDefaultModel ?? defaultModel
  const effectiveDefaultSubagentModel = pendingDefaultSubagentModel === undefined
    ? (defaultSubagentModel || '__default__')
    : (pendingDefaultSubagentModel || '__default__')
  const effectiveFallbackModels = pendingFallbackModels ?? fallbackModels
  const fallbackCandidates = modelOptions.filter((model) => model.id !== effectiveDefaultModel)
  const fallbackCandidateOptions = toModelSelectOptions(fallbackCandidates)

  return {
    // tab navigation
    tab, setTab,
    // config + agents
    modelSelectOptions, agentModelSelectOptions, fallbackCandidateOptions,
    agents, loading, error, saving, runtimeStatus,
    fetchConfig,
    // available models
    availableModels, modelOptions, modelsReady, availableProviders,
    modelsCached, modelsCachedAt, modelsStale, modelsError, modelsLoaded, refreshing,
    handleRefresh,
    verifying, probeVerdicts, handleVerify,
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
  }
}

/** The object returned by useModelsData(), passed to the per-tab components. */
export type ModelsData = ReturnType<typeof useModelsData>
