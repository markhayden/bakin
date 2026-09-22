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

/** Keep only the refs a save left failed (applied + pending drop out; the rest stays as-is). */
export function retainFailed(draft: Draft, outcome: { applied: string[]; pending: string[] }): Draft {
  const settled = new Set([...outcome.applied, ...outcome.pending])
  const next = new Map<string, DraftSet>()
  for (const [ref, set] of draft) if (!settled.has(ref)) next.set(ref, set)
  return next
}
