'use client'

// React
import { useCallback, useEffect, useRef, useState } from 'react'
// SDK
import { emitPluginEvent, useAgentList, usePluginEvent } from '@makinbakin/sdk/hooks'
import { useQueryState } from '@makinbakin/sdk/navigation'
import { pluginFetch, pluginFetchJson } from '@makinbakin/sdk/utils'
// Relative
import type {
  BudgetIncidentWire,
  BudgetRuleWire,
  BudgetStatusWire,
  SpendResponse,
} from '../types'

/** This plugin's id — every own-route call goes through `pluginFetch(PLUGIN_ID, …)`. */
const PLUGIN_ID = 'spend'

/** Deadline for configuration reads — a stalled endpoint renders as an error, never an endless spinner. */
const LOAD_TIMEOUT_MS = 10_000
/** `/spend` and `/status` read the ledger + durable usage history: slower, still bounded. */
const LEDGER_TIMEOUT_MS = 20_000

function isAbortError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: string }).name === 'AbortError'
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Shape every mutation route answers with — `message` is the plain-words reason when the server has one. */
interface MutationResult { ok?: boolean; error?: string; message?: string }

function mutationError(data: MutationResult, status: number): string {
  if (typeof data.message === 'string' && data.message) return data.message
  return typeof data.error === 'string' ? data.error : `Save failed (${status})`
}

function fetchPluginJson<T>(path: string, label: string, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  return pluginFetchJson<T>(PLUGIN_ID, path, { label, timeoutMs, signal })
}

/** One rendered error message plus the identity of whatever produced it. */
interface SurfacedError {
  value: string | null
  report: (source: string, message: string) => void
  /** Clear only when the visible message came from `source` — a successful load must not erase a still-broken one. */
  clear: (source: string) => void
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

/** The roster row the limit editor and billing-lanes panel need (id + display name). */
export interface SpendAgentRow { agentId: string; name: string }

/** A rule's identity — one rule per (scope, scopeId, lane); daily + monthly live on that one rule. */
export function ruleIdentity(rule: Pick<BudgetRuleWire, 'scope' | 'scopeId' | 'lane'>): string {
  return `${rule.scope}\u0000${rule.scopeId ?? ''}\u0000${rule.lane}`
}

/** Strip the client-only staging key before a rule goes on the wire. */
function toWire(rule: BudgetRuleWire): BudgetRuleWire {
  const { stagedKey: _stagedKey, ...wire } = rule
  return wire
}

/**
 * The Spend page data layer: spend rollups for the selected window, the cap
 * rule list (+ staged edits), incidents, billing status, and the actions
 * that mutate them.
 *
 * The rule list is `null` until GET /limits has SUCCEEDED (a failed or
 * pending load is not "no limits"), and every write posts under the
 * revision that load returned — a snapshot that never saw the current
 * limits cannot replace them (the server refuses 409; the page reloads and
 * says so, never re-posts blind).
 */
export function useSpendData() {
  const [spendWindow, setSpendWindow] = useQueryState('window', '24h')
  const [spend, setSpend] = useState<SpendResponse | null>(null)
  const [spendLoading, setSpendLoading] = useState(false)
  /** The latest /spend read failed while an earlier one is still shown — labelled stale, never blanked. */
  const [spendStale, setSpendStale] = useState<string | null>(null)
  const [budgetRules, setBudgetRules] = useState<BudgetRuleWire[] | null>(null)
  const [limitsRevision, setLimitsRevision] = useState<string | null>(null)
  const [pendingRules, setPendingRules] = useState<BudgetRuleWire[] | null>(null)
  const [incidents, setIncidents] = useState<BudgetIncidentWire[]>([])
  const { value: budgetError, report: reportBudgetError, clear: clearBudgetError, reset: resetBudgetError } = useSurfacedError()
  const [budgetWarnings, setBudgetWarnings] = useState<string[]>([])
  const [budgetStatus, setBudgetStatus] = useState<BudgetStatusWire | null>(null)
  const [saving, setSaving] = useState<'budget' | null>(null)
  const [availableProviders, setAvailableProviders] = useState<string[]>([])
  const [modelIds, setModelIds] = useState<string[]>([])
  const agents: SpendAgentRow[] = useAgentList().map((agent) => ({ agentId: agent.id, name: agent.name }))

  // `/spend` is fired by a window switch AND by SSE, with no ordering
  // guarantee. Without a generation guard a slow 24h response landing after a
  // switch to 7d overwrote the newer data.
  const spendGenerationRef = useRef(0)
  const spendRef = useRef<SpendResponse | null>(null)
  const fetchSpend = useCallback(async (window: string, signal?: AbortSignal) => {
    const generation = ++spendGenerationRef.current
    const superseded = () => spendGenerationRef.current !== generation
    setSpendLoading(true)
    try {
      const data = await fetchPluginJson<SpendResponse>(
        `spend?window=${encodeURIComponent(window)}`, 'Spend', LEDGER_TIMEOUT_MS, signal,
      )
      if (signal?.aborted || superseded()) return
      spendRef.current = data
      setSpend(data)
      setSpendStale(null)
    } catch (err) {
      if (isAbortError(err) || signal?.aborted || superseded()) return
      // A refresh that fails keeps the last good reading on screen with a
      // stale label; only a page that never loaded renders the unavailable
      // state (`spend === null`).
      if (spendRef.current && spendRef.current.window === window) setSpendStale(errorMessage(err))
      else { spendRef.current = null; setSpend(null); setSpendStale(null) }
    } finally {
      if (!signal?.aborted && !superseded()) setSpendLoading(false)
    }
  }, [])

  const fetchBudget = useCallback(async (signal?: AbortSignal) => {
    try {
      const policy = await fetchPluginJson<{ rules?: BudgetRuleWire[]; revision?: string }>('limits', 'Limits', LOAD_TIMEOUT_MS, signal)
      if (signal?.aborted) return
      setBudgetRules(policy.rules ?? [])
      setLimitsRevision(policy.revision ?? null)
      clearBudgetError('budget-rules')
    } catch (err) {
      if (isAbortError(err) || signal?.aborted) return
      // The list stays whatever it was (null on a first load) — an unknown
      // policy must never render as the healthy "No spending limits".
      reportBudgetError('budget-rules', `Failed to load the spend limits: ${errorMessage(err)}`)
    }
  }, [clearBudgetError, reportBudgetError])

  const fetchIncidents = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await fetchPluginJson<{ incidents?: BudgetIncidentWire[] }>('incidents', 'Incidents', LOAD_TIMEOUT_MS, signal)
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
      const data = await fetchPluginJson<BudgetStatusWire>('status', 'Budget status', LEDGER_TIMEOUT_MS, signal)
      if (signal?.aborted) return
      setBudgetStatus(data)
      clearBudgetError('budget-status')
    } catch (err) {
      if (isAbortError(err) || signal?.aborted) return
      // The kill switch reads from this payload — a stale "not paused" must never pass for a fresh one.
      reportBudgetError('budget-status', `Failed to load budget status: ${errorMessage(err)}`)
    }
  }, [clearBudgetError, reportBudgetError])

  // Scope candidates for the rule editor (provider + model ids) come from
  // the models plugin's catalog — display data only; a failed read leaves
  // the free-text scope input usable.
  const fetchCatalogScopes = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await pluginFetchJson<{ models?: Array<{ id: string; provider: string }> }>('models', 'available', { label: 'Models', timeoutMs: LOAD_TIMEOUT_MS, signal })
      if (signal?.aborted) return
      const models = data.models ?? []
      setModelIds(models.map((model) => model.id))
      setAvailableProviders([...new Set(models.map((model) => model.provider))].sort((a, b) => a.localeCompare(b)))
    } catch (err) {
      if (isAbortError(err) || signal?.aborted) return
      console.warn('Spend: model catalog unavailable for scope suggestions', err)
    }
  }, [])

  /**
   * PUT the full rule list under the loaded revision. A 409 (someone else
   * saved since this page loaded) reloads the list and says so — the edit
   * is never re-posted against limits the operator has not seen.
   */
  const putRules = async (rules: BudgetRuleWire[]): Promise<{ ok: true; warnings: string[] } | { ok: false; error: string }> => {
    if (limitsRevision === null) return { ok: false, error: 'The current limits have not loaded yet — retry in a moment.' }
    const res = await pluginFetch(PLUGIN_ID, 'limits', { method: 'PUT', body: { revision: limitsRevision, rules: rules.map(toWire) } })
    const data = await res.json() as MutationResult & { warnings?: unknown; revision?: string }
    if (res.status === 409) {
      void fetchBudget()
      return { ok: false, error: 'The limits changed since this page loaded (another editor saved). They have been reloaded — check them and save again.' }
    }
    if (!res.ok || !data.ok) return { ok: false, error: mutationError(data, res.status) }
    if (typeof data.revision === 'string') setLimitsRevision(data.revision)
    return { ok: true, warnings: Array.isArray(data.warnings) ? data.warnings.filter((w): w is string => typeof w === 'string') : [] }
  }

  /** Save the staged editor rows. Resolves true when they were persisted. */
  const saveBudgetRules = async (): Promise<boolean> => {
    if (!pendingRules) return true
    setSaving('budget')
    resetBudgetError()
    setBudgetWarnings([])
    try {
      // A rule with no caps is invalid — reject explicitly instead of
      // silently deleting the row on save.
      const capless = pendingRules.findIndex((r) => !r.dailyCap && !r.monthlyCap)
      if (capless >= 0) {
        reportBudgetError('budget-save', `Rule ${capless + 1} has no caps — set a daily or monthly cap, or remove the row.`)
        return false
      }
      const outcome = await putRules(pendingRules)
      if (!outcome.ok) {
        reportBudgetError('budget-save', outcome.error)
        return false
      }
      setPendingRules(null)
      setBudgetWarnings(outcome.warnings)
      // Re-fetch the canonical rules — the server normalizes model-scope
      // ids, and the utilization cards must key exactly like spend rows.
      await Promise.all([fetchBudget(), fetchBudgetStatus()])
      return true
    } catch (err) {
      reportBudgetError('budget-save', errorMessage(err))
      return false
    } finally {
      setSaving(null)
    }
  }

  /**
   * The guided dialog's rule, through the same PUT /limits the editor uses.
   * One rule per identity: a draft for an identity that already has a rule
   * EDITS that rule (its id and ladder survive; the drafted caps/reaction
   * replace the old ones) — never a second global metered rule beside it.
   * Refused until the current limits have loaded (nothing to merge into).
   */
  const addLimit = async (draft: Pick<BudgetRuleWire, 'scope' | 'scopeId' | 'lane' | 'monthlyCap' | 'dailyCap' | 'atCap'>): Promise<{ ok: true } | { ok: false; error: string }> => {
    if (budgetRules === null) return { ok: false, error: 'The current limits have not loaded yet — retry in a moment.' }
    try {
      const identity = ruleIdentity(draft)
      const existing = budgetRules.find((rule) => ruleIdentity(rule) === identity)
      const merged = existing
        ? budgetRules.map((rule) => (rule === existing ? { ...rule, ...draft } : rule))
        : [...budgetRules, draft]
      const outcome = await putRules(merged)
      if (!outcome.ok) return outcome
      setPendingRules(null)
      setBudgetWarnings(outcome.warnings)
      await Promise.all([fetchBudget(), fetchBudgetStatus()])
      return { ok: true }
    } catch (err) {
      return { ok: false, error: errorMessage(err) }
    }
  }

  /** Toggle the dispatch kill switch. */
  const setDispatchPaused = async (paused: boolean): Promise<void> => {
    // Clear only THIS action's slot: a failed policy load must stay visible,
    // or "Spend is not capped" turns a load failure into a safety claim.
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
      const res = await pluginFetch(PLUGIN_ID, 'billing/overrides', { method: 'PUT', body: { overrides } })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as MutationResult
        reportBudgetError('billing-override', mutationError(data, res.status))
        return
      }
      fetchBudgetStatus()
    } catch (err) {
      reportBudgetError('billing-override', errorMessage(err))
    }
  }

  /** Resolve an incident: raise (new cap in the rule's unit), ack, or resume. Returns the plain-words refusal, or null. */
  const resolveIncident = async (id: number, action: 'raise' | 'ack' | 'resume', cap?: number): Promise<string | null> => {
    try {
      const res = await pluginFetch(PLUGIN_ID, `incidents/${id}/resolve`, {
        method: 'POST', body: { action, ...(cap !== undefined ? { cap } : {}) },
      })
      const data = await res.json() as MutationResult
      if (!res.ok) return mutationError(data, res.status)
      await Promise.all([fetchIncidents(), fetchBudget()])
      return null
    } catch (err) {
      return errorMessage(err)
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    fetchSpend(spendWindow, controller.signal)
    fetchBudget(controller.signal)
    fetchIncidents(controller.signal)
    fetchBudgetStatus(controller.signal)
    fetchCatalogScopes(controller.signal)
    return () => controller.abort()
  }, [spendWindow, fetchSpend, fetchBudget, fetchIncidents, fetchBudgetStatus, fetchCatalogScopes])

  // A page left open must reflect incidents as they happen — the 2am
  // breach banner cannot wait for a reload.
  const refreshBudgetSurfaces = useCallback(() => {
    fetchIncidents(); fetchBudget(); fetchSpend(spendWindow); fetchBudgetStatus()
  }, [spendWindow, fetchIncidents, fetchBudget, fetchSpend, fetchBudgetStatus])
  usePluginEvent('budget.incident_opened', refreshBudgetSurfaces)
  usePluginEvent('budget.incident_resolved', refreshBudgetSurfaces)

  return {
    spendWindow, setSpendWindow,
    spend, spendLoading, spendStale, refreshSpend: () => fetchSpend(spendWindow),
    budgetRules, limitsRevision, pendingRules, setPendingRules, saveBudgetRules, addLimit, saving, budgetError, budgetWarnings,
    incidents, resolveIncident,
    budgetStatus, setDispatchPaused, setAgentLaneOverride,
    agents, availableProviders, modelIds,
  }
}

/** The object returned by useSpendData(), passed to the tab components. */
export type SpendData = ReturnType<typeof useSpendData>
