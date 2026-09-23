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
import { draftOps, effectiveSelection, retainFailed, stageOp, unstageOp, type Draft, type DraftSet } from '../lib/draft'

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
  snapshot?: string
  error?: string
  message?: string
  proposal?: { to: string | null }
}

export interface SaveOutcome {
  applied: string[]
  failed: Array<{ ref: string; message: string }>
  pending: string[]
  warnings: string[]
  /** Snapshot file written before a Reset — the undo handle. */
  snapshot?: string
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
    ...(data.snapshot ? { snapshot: data.snapshot } : {}),
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
  /**
   * The ONE client write: POST `ops` under the revision the page holds,
   * re-posting once against a fresh revision if someone else saved in
   * between, and adopting the returned revision so the NEXT write plans
   * against live state. `save` (the draft), the view persist and Reset all
   * go through it.
   */
  submit: (ops: SelectionOpWire[], extra?: { snapshot?: 'reset' }) => Promise<SaveOutcome>
  // ── the draft (S5/S10) ────────────────────────────────────────────────
  draft: Draft
  dirty: boolean
  /** Number of refs the next save will carry. */
  stagedCount: number
  stage: (ref: string, set: DraftSet) => void
  /** Stage several ops at once (a recommended-plan diff, "Set all to…"). */
  stageAll: (ops: SelectionOpWire[]) => void
  unstage: (ref: string) => void
  discard: () => void
  /** The value a control renders for `ref`: staged when present, else persisted. */
  effective: (ref: string) => { model: string | null; thinking: string | null; staged: boolean }
  saving: boolean
  /** A refusal or transport failure of the LAST save, in plain words (the bar's retryable error). */
  saveError: string | null
  /** Per-ref outcome of the last save — failed refs stay staged for Retry. */
  lastSave: SaveOutcome | null
  /** Post the draft under the loaded revision; resolves true when nothing was left failed. */
  save: () => Promise<boolean>
}

export function useSelections(): SelectionsData {
  const [selections, setSelections] = useState<SelectionsResponse | null>(null)
  const [plan, setPlan] = useState<PlanResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ref] = useQueryState('ref', '')
  // A view the operator chose by hand — keyed to the deep link it was chosen
  // under, so a NEW `?ref=` (Health → Models while already here) flips again.
  const [viewOverride, setViewOverride] = useState<{ ref: string | null; view: UiMode } | null>(null)
  const [draft, setDraft] = useState<Draft>(() => new Map())
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [lastSave, setLastSave] = useState<SaveOutcome | null>(null)

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

  // The revision every write plans under — the loaded one, moved forward by
  // each write's answer (the page's own ui:mode persist moves it too: the
  // hash covers every ref, so a Reset planned under the loaded revision
  // would be refused as stale).
  const revisionRef = useRef<string | null>(null)
  revisionRef.current = selections?.revision ?? null
  const adoptRevision = useCallback((revision: string | null) => {
    if (!revision) return
    revisionRef.current = revision
    setSelections((prev) => (prev && prev.revision !== revision ? { ...prev, revision } : prev))
  }, [])

  const submit = useCallback(async (ops: SelectionOpWire[], extra?: { snapshot?: 'reset' }): Promise<SaveOutcome> => {
    let revision = revisionRef.current
    if (!revision) throw new Error('Model configuration is not loaded yet.')
    for (let attempt = 0; ; attempt++) {
      try {
        const outcome = await postSelections(revision, ops, extra)
        adoptRevision(outcome.revision)
        return outcome
      } catch (err) {
        // Someone else saved in between: the ops are explicit intents, so
        // re-posting them against the fresh revision is safe — once.
        if ((err as { code?: string }).code === 'stale_revision' && attempt === 0) {
          const fresh = await pluginFetchJson<SelectionsResponse>(PLUGIN_ID, 'selections', { label: 'Model selections', timeoutMs: LOAD_TIMEOUT_MS })
          revision = fresh.revision
          continue
        }
        throw err
      }
    }
  }, [adoptRevision])

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
    void submit([{ ref: 'ui:mode', set: { model: mode } }]).catch(() => {
      // A failed mode write is cosmetic: the page still classifies on the next load.
    })
  }, [selections, persistedMode, mode, submit])

  const highlightRef = ref || null
  // A ref in the Advanced layer must be visible: flip the VIEW (no write).
  const refView: UiMode | null = highlightRef && refLayer(highlightRef, states) === 'advanced' ? 'advanced' : null
  const chosen = viewOverride && viewOverride.ref === highlightRef ? viewOverride.view : null
  const view: UiMode = chosen ?? refView ?? mode

  const setView = useCallback((next: UiMode) => {
    setViewOverride({ ref: highlightRef, view: next })
    void submit([{ ref: 'ui:mode', set: { model: next } }])
      .then(() => load())
      .catch(() => {
        // The view already switched; a failed persist only affects the next visit.
      })
  }, [highlightRef, submit, load])

  const pendingRefs = useMemo(() => {
    const map = new Map<string, { state: 'unsettled' | 'failed' | 'conflict'; detail?: string }>()
    for (const p of selections?.pending ?? []) {
      for (const r of p.refs) map.set(r, { state: p.state, ...(p.detail ? { detail: p.detail } : {}) })
    }
    return map
  }, [selections])

  const stage = useCallback((target: string, set: DraftSet) => {
    setDraft((prev) => stageOp(prev, states, target, set))
  }, [states])
  const stageAll = useCallback((ops: SelectionOpWire[]) => {
    setDraft((prev) => ops.reduce((acc, op) => stageOp(acc, states, op.ref, op.set), prev))
  }, [states])
  const unstage = useCallback((target: string) => setDraft((prev) => unstageOp(prev, target)), [])
  const discard = useCallback(() => {
    setDraft(new Map())
    setSaveError(null)
    setLastSave(null)
  }, [])
  const effective = useCallback((target: string) => effectiveSelection(draft, states, target), [draft, states])

  const save = useCallback(async (): Promise<boolean> => {
    const ops = draftOps(draft)
    if (ops.length === 0 || !selections) return true
    setSaving(true)
    setSaveError(null)
    try {
      const outcome = await submit(ops)
      // Applied + pending refs leave the draft; failed ones stay for Retry.
      setDraft((prev) => retainFailed(prev, outcome))
      setLastSave(outcome)
      if (outcome.failed.length > 0) {
        setSaveError(`${outcome.failed.length} change${outcome.failed.length === 1 ? '' : 's'} could not be written: ${outcome.failed.map((f) => `${f.ref} — ${f.message}`).join('; ')}`)
      }
      await load()
      return outcome.failed.length === 0
    } catch (err) {
      setSaveError(errorMessage(err))
      return false
    } finally {
      setSaving(false)
    }
  }, [draft, selections, submit, load])

  return {
    selections, plan, loading, error, reload, mode, view, setView, customizations, highlightRef, pendingRefs, submit,
    draft, dirty: draft.size > 0, stagedCount: draft.size, stage, stageAll, unstage, discard, effective,
    saving, saveError, lastSave, save,
  }
}
