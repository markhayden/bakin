/**
 * Simple-view lane rules (spec §3.4, D24), pure over an `effective(ref)`
 * reader so they see the DRAFT (staged values win over persisted ones).
 */
import { CHORES_CLASSES } from './mode'
import type { SelectionOpWire } from '../types'

// Re-exported so client components stay on plugin-local imports (UI legacy-style ratchet).
export { buildResetOps, type ResetPlan, type ResetSupport } from '../../../src/core/model-selections'

export type EffectiveReader = (ref: string) => { model: string | null; thinking: string | null; staged: boolean }

export interface ChoresLaneState {
  /** ONE model when all five chores routes resolve to the same model and none sets thinking; else null. */
  model: string | null
  /** Distinct effective models (an unrouted class resolves to the agent model). */
  models: string[]
  mixed: boolean
  thinkingSet: boolean
  /** At least one chores route names a model explicitly (vs. every one inheriting). */
  explicit: boolean
}

export function choresLane(effective: EffectiveReader): ChoresLaneState {
  const agent = effective('policy:defaultModel').model
  const models = new Set<string>()
  let thinkingSet = false
  let explicit = false
  for (const workClass of CHORES_CLASSES) {
    const eff = effective(`route:${workClass}`)
    models.add(eff.model ?? agent ?? 'inherit')
    if (eff.thinking) thinkingSet = true
    if (eff.model) explicit = true
  }
  const list = [...models]
  const mixed = list.length !== 1 || thinkingSet
  return { model: mixed ? null : list[0]!, models: list, mixed, thinkingSet, explicit }
}

/** Five `route:<chores>` model ops — `null` = inherit the agent model. Thinking untouched (D24). */
export function setAllChoresOps(model: string | null): SelectionOpWire[] {
  return CHORES_CLASSES.map((workClass) => ({ ref: `route:${workClass}`, set: { model } }))
}
