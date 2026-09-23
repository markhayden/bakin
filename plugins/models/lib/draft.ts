/**
 * The Models page draft (spec §3.4, S5/S10): every edit becomes an op keyed
 * by ref; staging a value equal to the persisted state unstages it, so a
 * save carries ONLY the refs the user actually changed. Client- and
 * server-safe: pure over the `GET /selections` states.
 */
import type { SelectionOpWire, SelectionStateWire } from '../types'

export type DraftSet = SelectionOpWire['set']
export type Draft = ReadonlyMap<string, DraftSet>

function normalizeThinking(value: string | null | undefined): string | null {
  return value && value !== 'inherit' ? value : null
}

/** True when `set` names exactly what is persisted for `ref` (nothing to save). */
export function matchesPersisted(state: SelectionStateWire | undefined, set: DraftSet): boolean {
  const model = set.model === undefined ? (state?.model ?? null) : (set.model ?? null)
  const thinking = set.thinking === undefined ? normalizeThinking(state?.thinking) : normalizeThinking(set.thinking)
  return model === (state?.model ?? null) && thinking === normalizeThinking(state?.thinking)
}

/** Merge a change into the draft; a change back to the persisted value drops the ref. */
export function stageOp(draft: Draft, states: readonly SelectionStateWire[], ref: string, set: DraftSet): Draft {
  const next = new Map(draft)
  const merged: DraftSet = { ...(next.get(ref) ?? {}), ...set }
  const state = states.find((s) => s.ref === ref)
  if (matchesPersisted(state, merged)) next.delete(ref)
  else next.set(ref, merged)
  return next
}

export function unstageOp(draft: Draft, ref: string): Draft {
  if (!draft.has(ref)) return draft
  const next = new Map(draft)
  next.delete(ref)
  return next
}

/** The op list a save posts, in stable ref order. */
export function draftOps(draft: Draft): SelectionOpWire[] {
  return [...draft.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([ref, set]) => ({ ref, set }))
}

/** The value a control renders: the staged change when present, else the persisted state. */
export function effectiveSelection(draft: Draft, states: readonly SelectionStateWire[], ref: string): { model: string | null; thinking: string | null; staged: boolean } {
  const state = states.find((s) => s.ref === ref)
  const set = draft.get(ref)
  return {
    model: set?.model !== undefined ? (set.model ?? null) : (state?.model ?? null),
    thinking: set?.thinking !== undefined ? normalizeThinking(set.thinking) : normalizeThinking(state?.thinking),
    staged: set !== undefined,
  }
}

function sameSet(a: DraftSet | undefined, b: DraftSet | undefined): boolean {
  return a !== undefined && b !== undefined && a.model === b.model && a.thinking === b.thinking
}

/**
 * Keep only the refs a save left failed: applied + pending refs drop out
 * ONLY when the draft still holds the value that was submitted. A ref
 * edited again while the save was in flight keeps its newer value — the
 * server never saw it, so it must ride the next save.
 */
export function retainFailed(draft: Draft, outcome: { applied: string[]; pending: string[] }, submitted: Draft): Draft {
  const settled = new Set([...outcome.applied, ...outcome.pending])
  const next = new Map<string, DraftSet>()
  for (const [ref, set] of draft) {
    if (settled.has(ref) && sameSet(set, submitted.get(ref))) continue
    next.set(ref, set)
  }
  return next
}

/**
 * The states as a save in flight will leave them: `submitted` values win
 * over the persisted ones. Staging compares against THIS while a save runs,
 * so an edit back to the pre-save value stays staged (the server is about
 * to persist the submitted one) and an edit to the submitted value unstages.
 */
export function withInFlight(states: readonly SelectionStateWire[], submitted: Draft): SelectionStateWire[] {
  if (submitted.size === 0) return [...states]
  const seen = new Set<string>()
  const overlaid = states.map((state) => {
    const set = submitted.get(state.ref)
    if (!set) return state
    seen.add(state.ref)
    return {
      ...state,
      ...(set.model !== undefined ? { model: set.model } : {}),
      ...(set.thinking !== undefined ? { thinking: set.thinking ?? undefined } : {}),
    }
  })
  for (const [ref, set] of submitted) {
    if (seen.has(ref)) continue
    overlaid.push({ ref, model: set.model ?? null, ...(set.thinking ? { thinking: set.thinking } : {}), document: 'policy', label: ref })
  }
  return overlaid
}

const FALLBACK_PREFIX = 'policy:fallback:'

/** The persisted fallback list in index order — the positional context a `policy:fallback:<n>` op was staged against. */
export function fallbackList(states: readonly SelectionStateWire[]): string[] {
  return states
    .filter((s) => s.ref.startsWith(FALLBACK_PREFIX))
    .map((s) => ({ n: Number(s.ref.slice(FALLBACK_PREFIX.length)), model: s.model }))
    .filter((row) => Number.isFinite(row.n))
    .sort((a, b) => a.n - b.n)
    .map((row) => row.model ?? '')
}

export function isFallbackRef(ref: string): boolean {
  return ref.startsWith(FALLBACK_PREFIX)
}

/** Drop every positional fallback op — they were staged against a list that no longer exists. */
export function dropFallbackOps(draft: Draft): Draft {
  if (![...draft.keys()].some(isFallbackRef)) return draft
  const next = new Map<string, DraftSet>()
  for (const [ref, set] of draft) if (!isFallbackRef(ref)) next.set(ref, set)
  return next
}
