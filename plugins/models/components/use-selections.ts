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
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'

import { useQueryState } from '@makinbakin/sdk/navigation'
import { pluginFetch, pluginFetchJson } from '@makinbakin/sdk/utils'

import type { PlanResponse, SelectionOpWire, SelectionStateWire, SelectionsResponse } from '../types'
import { classifyMode, listCustomizations, refLayer, type Customization, type UiMode } from '../lib/mode'
import { applyFallbackOps, draftOps, dropFallbackOps, effectiveSelection, fallbackList, hasFallbackOps, isFallbackRef, retainFailed, sameFallbackList, stageOp, unstageOp, withInFlight, type Draft, type DraftSet } from '../lib/draft'

const PLUGIN_ID = 'models'
/** Every read is bounded: a stalled endpoint renders as an error, never as a spinner forever. */
const LOAD_TIMEOUT_MS = 10_000
/**
 * While a write awaits runtime confirmation the page re-reads on this
 * cadence: the server reconciles pending writes on every GET /selections,
 * so the read IS the settle signal — a late success drops the "saving…"
 * chip and shows the new value, a late failure/conflict is disclosed,
 * neither waits for the operator to reload.
 */
const PENDING_POLL_MS = 5_000
const FALLBACK_LIST_MOVED = 'The fallback list changed since this page loaded — your fallback changes were discarded because they named positions in the old list. Review the fallbacks shown now and stage them again.'

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
  /** The ref the page already landed on (scroll + focus) — once per arrival, whatever tab or view remounts. */
  landed: MutableRefObject<string | null>
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

export function useSelections(options: { pendingPollMs?: number } = {}): SelectionsData {
  const pendingPollMs = options.pendingPollMs ?? PENDING_POLL_MS
  const [selections, setSelections] = useState<SelectionsResponse | null>(null)
  const [plan, setPlan] = useState<PlanResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ref] = useQueryState('ref', '')
  // A view the operator chose by hand — keyed to the deep link it was chosen
  // under, so a NEW `?ref=` (Health → Models while already here) flips again.
  const [viewOverride, setViewOverride] = useState<{ ref: string | null; view: UiMode } | null>(null)
  const [draft, setDraftState] = useState<Draft>(() => new Map())
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [lastSave, setLastSave] = useState<SaveOutcome | null>(null)

  // The draft is REF-authoritative: every change goes through `updateDraft`,
  // which writes the ref synchronously and mirrors it to state. Async
  // callbacks (a reload landing mid-save) read the ref and never a render-
  // time copy that may still hold a draft React has not yet re-rendered.
  const draftRef = useRef<Draft>(draft)
  const updateDraft = useCallback((next: Draft | ((prev: Draft) => Draft)) => {
    const value = typeof next === 'function' ? next(draftRef.current) : next
    draftRef.current = value
    setDraftState(value)
  }, [])
  // What the page holds right now, readable from async callbacks.
  const statesRef = useRef<SelectionStateWire[]>([])
  /**
   * The fallback list the draft's positional ops are relative to (null while
   * none are staged). Set when the first `policy:fallback:<n>` op is staged,
   * from the list staging compared against — the persisted list, or the
   * list an in-flight save will leave.
   */
  const fallbackContextRef = useRef<string[] | null>(null)
  /**
   * The save in flight: the draft it submitted, the fallback list those ops
   * are relative to (`context`) and the list the server will leave once it
   * applies them (`expected`). Staging during the save compares against
   * `expected`; a refresh during the save may legitimately bring either.
   */
  const inFlightRef = useRef<{ submitted: Draft; context: string[]; expected: string[] } | null>(null)

  const dropPositional = useCallback(() => {
    if (!hasFallbackOps(draftRef.current)) return
    updateDraft((prev) => dropFallbackOps(prev))
    fallbackContextRef.current = null
    setSaveError(FALLBACK_LIST_MOVED)
  }, [updateDraft])

  /**
   * The ONE way fresh states enter the page — the first load, every reload
   * (mode switch, save, poll) and the stale-revision re-read. A
   * `policy:fallback:<n>` op names a POSITION in a specific list; if the
   * incoming list is not that list, the ops are dropped with an explanation
   * so no later save can carry them against a moved list — whichever path
   * refreshed the states. The lists a refresh may legitimately bring: the
   * one the ops were staged against, and — while a save is in flight — the
   * one that save leaves (its own reload is not an external change).
   */
  const adoptLoaded = useCallback((next: SelectionsResponse) => {
    const incoming = fallbackList(next.states)
    if (hasFallbackOps(draftRef.current)) {
      const acceptable = [fallbackContextRef.current, inFlightRef.current?.context, inFlightRef.current?.expected]
        .filter((list): list is string[] => list !== undefined && list !== null)
      if (!acceptable.some((list) => sameFallbackList(list, incoming))) dropPositional()
    }
    statesRef.current = next.states
    setSelections(next)
  }, [dropPositional])

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const [sel, pl] = await Promise.all([
        pluginFetchJson<SelectionsResponse>(PLUGIN_ID, 'selections', { label: 'Model selections', timeoutMs: LOAD_TIMEOUT_MS, signal }),
        pluginFetchJson<PlanResponse>(PLUGIN_ID, 'plan', { label: 'Model plan', timeoutMs: LOAD_TIMEOUT_MS, signal }),
      ])
      if (signal?.aborted) return
      adoptLoaded(sel)
      setPlan(pl)
      setError(null)
    } catch (err) {
      if (isAbortError(err) || signal?.aborted) return
      setError(`Model configuration could not be loaded: ${errorMessage(err)}`)
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [adoptLoaded])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  const reload = useCallback(() => load(), [load])

  // A write the runtime has not confirmed settles on the server's next
  // reconcile, which every GET /selections performs — so while any is
  // unsettled the page re-reads on a cadence instead of showing a stale
  // value under a "saving…" chip until someone reloads by hand.
  const hasUnsettled = (selections?.pending ?? []).some((p) => p.state === 'unsettled')
  useEffect(() => {
    if (!hasUnsettled) return
    const timer = setInterval(() => { void load() }, pendingPollMs)
    return () => clearInterval(timer)
  }, [hasUnsettled, pendingPollMs, load])

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

  const states: SelectionStateWire[] = useMemo(() => selections?.states ?? [], [selections])

  const submit = useCallback(async (ops: SelectionOpWire[], extra?: { snapshot?: 'reset' }): Promise<SaveOutcome> => {
    let revision = revisionRef.current
    if (!revision) throw new Error('Model configuration is not loaded yet.')
    // The list any positional op in THIS request is relative to — captured
    // now, because a refresh landing while the request is out can move the
    // page's own list under it (and would have dropped the draft's ops);
    // the request must then be judged against the list it was made for.
    const context = ops.some((op) => isFallbackRef(op.ref)) ? fallbackList(statesRef.current) : null
    for (let attempt = 0; ; attempt++) {
      try {
        const outcome = await postSelections(revision, ops, extra)
        adoptRevision(outcome.revision)
        return outcome
      } catch (err) {
        if ((err as { code?: string }).code !== 'stale_revision' || attempt > 0) throw err
        // Someone else saved in between. Ops keyed by a NAME (agent, route,
        // tag, alias, policy field) are explicit intents, so re-posting them
        // against the fresh revision is safe — once. A fallback op is
        // POSITIONAL (`policy:fallback:<n>`): it is re-posted only when the
        // fresh list is the list it was made for; a moved list would make it
        // remove a different model, so the request is abandoned, the fresh
        // states adopted (dropping any positional draft), and the operator
        // stages the change again over what is there now.
        const fresh = await pluginFetchJson<SelectionsResponse>(PLUGIN_ID, 'selections', { label: 'Model selections', timeoutMs: LOAD_TIMEOUT_MS })
        if (!context || sameFallbackList(context, fallbackList(fresh.states))) {
          revision = fresh.revision
          continue
        }
        inFlightRef.current = null
        adoptLoaded(fresh)
        dropPositional()
        void load()
        throw new Error(FALLBACK_LIST_MOVED)
      }
    }
  }, [adoptRevision, adoptLoaded, dropPositional, load])
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
  const landed = useRef<string | null>(null)
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

  // Staging during a save compares against the states that save will LEAVE
  // (submitted values over persisted ones; the fallback list it produces),
  // and the settle only drops a ref whose draft value is still the one sent.
  const stagingBase = useCallback(() => (inFlightRef.current ? withInFlight(states, inFlightRef.current.submitted) : states), [states])
  const stageWith = useCallback((apply: (prev: Draft, base: SelectionStateWire[]) => Draft) => {
    // A failed save's message belongs to the refs it left staged. Once
    // nothing is staged (the ops were dropped), the first fresh edit starts
    // a new draft — the old message would only mislabel its Save as a Retry.
    if (draftRef.current.size === 0) setSaveError(null)
    const base = stagingBase()
    updateDraft((prev) => apply(prev, base))
    // Positional ops are relative to the list they were compared against.
    if (!hasFallbackOps(draftRef.current)) fallbackContextRef.current = null
    else fallbackContextRef.current ??= fallbackList(base)
  }, [stagingBase, updateDraft])
  const stage = useCallback((target: string, set: DraftSet) => {
    stageWith((prev, base) => stageOp(prev, base, target, set))
  }, [stageWith])
  const stageAll = useCallback((ops: SelectionOpWire[]) => {
    stageWith((prev, base) => ops.reduce((acc, op) => stageOp(acc, base, op.ref, op.set), prev))
  }, [stageWith])
  const unstage = useCallback((target: string) => {
    updateDraft((prev) => unstageOp(prev, target))
    if (!hasFallbackOps(draftRef.current)) fallbackContextRef.current = null
  }, [updateDraft])
  const discard = useCallback(() => {
    updateDraft(new Map())
    fallbackContextRef.current = null
    setSaveError(null)
    setLastSave(null)
  }, [updateDraft])
  const effective = useCallback((target: string) => effectiveSelection(draft, states, target), [draft, states])

  const save = useCallback(async (): Promise<boolean> => {
    const submitted = draftRef.current
    const ops = draftOps(submitted)
    if (ops.length === 0 || !selections) return true
    setSaving(true)
    setSaveError(null)
    const context = fallbackList(statesRef.current)
    const expected = applyFallbackOps(context, submitted)
    inFlightRef.current = { submitted, context, expected }
    // Positional ops staged from here on are relative to the list this save leaves.
    fallbackContextRef.current = hasFallbackOps(submitted) ? expected : fallbackContextRef.current
    try {
      const outcome = await submit(ops)
      // Applied + pending refs leave the draft — unless they were edited
      // again while this save ran; failed ones stay for Retry.
      updateDraft((prev) => retainFailed(prev, outcome, submitted))
      if (outcome.failed.some((f) => isFallbackRef(f.ref))) {
        // The list did NOT become `expected`: the failed positional ops are
        // still relative to the list the save was made for, and anything
        // staged against `expected` meanwhile names positions that never
        // came to be — those are dropped.
        const failedRefs = new Set(outcome.failed.map((f) => f.ref))
        updateDraft((prev) => {
          const next = new Map<string, DraftSet>()
          for (const [r, set] of prev) if (!isFallbackRef(r) || (failedRefs.has(r) && submitted.get(r) === set)) next.set(r, set)
          return next
        })
        fallbackContextRef.current = hasFallbackOps(draftRef.current) ? context : null
      } else if (!hasFallbackOps(draftRef.current)) {
        fallbackContextRef.current = null
      }
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
      inFlightRef.current = null
      setSaving(false)
    }
  }, [selections, submit, load, updateDraft])

  return {
    selections, plan, loading, error, reload, mode, view, setView, customizations, highlightRef, landed, pendingRefs, submit,
    draft, dirty: draft.size > 0, stagedCount: draft.size, stage, stageAll, unstage, discard, effective,
    saving, saveError, lastSave, save,
  }
}
