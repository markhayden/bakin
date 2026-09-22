'use client'

/**
 * The Models page's data layer over its two reads (`GET /selections`,
 * `GET /plan`) and its ONE write (`POST /selections`), spec §3.4:
 *
 * - `mode` — the persisted `ui:mode` when set, else classified from the
 *   states (Advanced if any customization exists). Persisted on first
 *   visit through a `ui:mode` op — a VIEW preference, never configuration.
 * - `view` — what the page shows right now. A `?ref=` deep link into a
 *   layer Simple cannot show flips the VIEW to Advanced without writing.
 * - `draft` — the op list every edit becomes; one save posts it under the
 *   revision the page loaded, renders applied / failed / pending per ref,
 *   retries failed refs only, and guards dirty exits.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useQueryState } from '@makinbakin/sdk/navigation'
import { pluginFetch, pluginFetchJson } from '@makinbakin/sdk/utils'

import type { PlanResponse, SelectionOpWire, SelectionStateWire, SelectionsResponse } from '../types'
import { classifyMode, listCustomizations, refLayer, type Customization, type UiMode } from '../lib/mode'

const PLUGIN_ID = 'models'
/** Every read is bounded: a stalled endpoint renders as an error, never as a spinner forever. */
const LOAD_TIMEOUT_MS = 10_000

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function isAbortError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: string }).name === 'AbortError'
}

/** Wire shape of POST /selections. */
interface MutationResultWire {
  applied?: string[]
  failed?: Array<{ ref: string; error: { code: string; message: string } }>
  pending?: Array<{ ref: string; intended: string | null }>
  warnings?: string[]
  revision?: string
  error?: string
  message?: string
  proposal?: { to: string | null }
}

export interface SaveOutcome {
  applied: string[]
  failed: Array<{ ref: string; message: string }>
  pending: string[]
  warnings: string[]
}

/** POST ops under `revision`; refusals surface as a thrown Error with the server's plain-words reason. */
export async function postSelections(revision: string, ops: SelectionOpWire[], extra?: { snapshot?: 'reset' }): Promise<SaveOutcome & { revision: string | null }> {
  const res = await pluginFetch(PLUGIN_ID, 'selections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revision, ops, ...(extra?.snapshot ? { snapshot: extra.snapshot } : {}) }),
  })
  const data = await res.json() as MutationResultWire
  if (!res.ok) {
    const proposal = data.proposal?.to ? ` Try ${data.proposal.to} instead.` : ''
    const error = new Error(`${data.message ?? data.error ?? `Save failed (${res.status})`}${proposal}`)
    ;(error as Error & { code?: string }).code = data.error
    throw error
  }
  return {
    applied: data.applied ?? [],
    failed: (data.failed ?? []).map((f) => ({ ref: f.ref, message: f.error.message })),
    pending: (data.pending ?? []).map((p) => p.ref),
    warnings: data.warnings ?? [],
    revision: data.revision ?? null,
  }
}

export interface SelectionsData {
  selections: SelectionsResponse | null
  plan: PlanResponse | null
  loading: boolean
  /** A read failed — the page renders this instead of impersonating an empty install. */
  error: string | null
  reload: () => Promise<void>
  /** Persisted (or classified) mode. */
  mode: UiMode
  /** What the page shows now — may differ from `mode` after a `?ref=` flip. */
  view: UiMode
  /** Switch the view AND persist it as the mode (one `ui:mode` op). */
  setView: (mode: UiMode) => void
  customizations: Customization[]
  /** The `?ref=` deep link, if any — highlighted by whichever view owns it. */
  highlightRef: string | null
  pendingRefs: Map<string, { state: 'unsettled' | 'failed' | 'conflict'; detail?: string }>
}

export function useSelections(): SelectionsData {
  const [selections, setSelections] = useState<SelectionsResponse | null>(null)
  const [plan, setPlan] = useState<PlanResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ref] = useQueryState('ref', '')
  const [viewOverride, setViewOverride] = useState<UiMode | null>(null)

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const [sel, pl] = await Promise.all([
        pluginFetchJson<SelectionsResponse>(PLUGIN_ID, 'selections', { label: 'Model selections', timeoutMs: LOAD_TIMEOUT_MS, signal }),
        pluginFetchJson<PlanResponse>(PLUGIN_ID, 'plan', { label: 'Model plan', timeoutMs: LOAD_TIMEOUT_MS, signal }),
      ])
      if (signal?.aborted) return
      setSelections(sel)
      setPlan(pl)
      setError(null)
    } catch (err) {
      if (isAbortError(err) || signal?.aborted) return
      setError(`Model configuration could not be loaded: ${errorMessage(err)}`)
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  const reload = useCallback(() => load(), [load])

  const states: SelectionStateWire[] = useMemo(() => selections?.states ?? [], [selections])
  const customizations = useMemo(() => listCustomizations(states), [states])
  const persistedMode = states.find((s) => s.ref === 'ui:mode')?.model
  const mode: UiMode = persistedMode === 'simple' || persistedMode === 'advanced' ? persistedMode : classifyMode(states)

  // Persist the classified mode on first visit (D4) — a view preference,
  // written once so later visits open where the operator left off.
  const persistedOnce = useRef(false)
  useEffect(() => {
    if (!selections || persistedMode || persistedOnce.current) return
    persistedOnce.current = true
    void postSelections(selections.revision, [{ ref: 'ui:mode', set: { model: mode } }]).catch(() => {
      // A failed mode write is cosmetic: the page still classifies on the next load.
    })
  }, [selections, persistedMode, mode])

  const highlightRef = ref || null
  // A ref in the Advanced layer must be visible: flip the VIEW (no write).
  const refView: UiMode | null = highlightRef && refLayer(highlightRef) === 'advanced' ? 'advanced' : null
  const view: UiMode = viewOverride ?? refView ?? mode

  const setView = useCallback((next: UiMode) => {
    setViewOverride(next)
    if (!selections) return
    void postSelections(selections.revision, [{ ref: 'ui:mode', set: { model: next } }])
      .then(() => load())
      .catch(() => {
        // The view already switched; a failed persist only affects the next visit.
      })
  }, [selections, load])

  const pendingRefs = useMemo(() => {
    const map = new Map<string, { state: 'unsettled' | 'failed' | 'conflict'; detail?: string }>()
    for (const p of selections?.pending ?? []) {
      for (const r of p.refs) map.set(r, { state: p.state, ...(p.detail ? { detail: p.detail } : {}) })
    }
    return map
  }, [selections])

  return { selections, plan, loading, error, reload, mode, view, setView, customizations, highlightRef, pendingRefs }
}
