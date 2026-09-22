/**
 * "Reset to this plan" (spec §3.4, S6) — pure over selection states, in
 * its own module because the Models page bundles it for the browser: it
 * must never drag `model-selections.ts` (and its `crypto` revision hash)
 * into a client bundle.
 */
import type { ThinkingSetting } from './model-routing'
import type { SelectionState } from './model-selections'

/** The routing knobs the active runtime persists — a knob it cannot is skipped and DISCLOSED, never silently attempted. */
export interface ResetSupport {
  fallbackModels: boolean
  defaultSubagentModel: boolean
  aliases: boolean
  perAgentSubagentModel: boolean
}

export interface ResetOp {
  ref: string
  set: { model?: string | null; thinking?: ThinkingSetting | null }
}

export interface ResetPlan {
  ops: ResetOp[]
  /** Customizations the reset leaves in place because the runtime cannot clear them. */
  skipped: Array<{ ref: string; label: string; reason: string }>
}

const CHORES_CLASSES: readonly string[] = ['auto-title', 'enrichment', 'relay', 'team-routing', 'skill-mapping']

/**
 * Everything Simple cannot express goes back to the two lanes: agent pins
 * cleared, subagent pins / fallbacks / default subagent / aliases cleared
 * where the runtime supports them, dispatch + send routes and tag
 * overrides cleared, chores-route thinking cleared, and the five chores
 * routes set to `plan.chores` (null = inherit the agent model). The agent
 * lane (`policy:defaultModel`) is "this plan" and stays as it is.
 */
/** The fields the reset reads — the core state or its wire twin (`document` is irrelevant here). */
export type ResetInputState = Pick<SelectionState, 'ref' | 'model' | 'label'> & { thinking?: string }

export function buildResetOps(states: readonly ResetInputState[], support: ResetSupport, plan: { chores: string | null }): ResetPlan {
  const ops: ResetOp[] = []
  const skipped: ResetPlan['skipped'] = []
  for (const s of states) {
    const [family, second, third] = s.ref.split(':')
    if (family === 'agent' && second) {
      if (third === 'model' && s.model) ops.push({ ref: s.ref, set: { model: null } })
      if (third === 'subagentModel' && s.model) {
        if (support.perAgentSubagentModel) ops.push({ ref: s.ref, set: { model: null } })
        else skipped.push({ ref: s.ref, label: s.label, reason: 'the active runtime does not manage per-agent subagent models' })
      }
      continue
    }
    if (family === 'policy') {
      if (second === 'defaultSubagentModel' && s.model) {
        if (support.defaultSubagentModel) ops.push({ ref: s.ref, set: { model: null } })
        else skipped.push({ ref: s.ref, label: s.label, reason: 'the active runtime does not manage a default subagent model' })
      }
      if (second === 'fallback' && s.model) {
        if (support.fallbackModels) ops.push({ ref: s.ref, set: { model: null } })
        else skipped.push({ ref: s.ref, label: s.label, reason: 'the active runtime does not manage fallback models' })
      }
      if (second === 'alias' && s.model) {
        if (support.aliases) ops.push({ ref: s.ref, set: { model: null } })
        else skipped.push({ ref: s.ref, label: s.label, reason: 'the active runtime does not manage aliases' })
      }
      continue
    }
    if (family === 'route' && second) {
      const thinkingSet = s.thinking !== undefined && s.thinking !== 'inherit'
      if (CHORES_CLASSES.includes(second)) {
        const set: ResetOp['set'] = {}
        if ((s.model ?? null) !== plan.chores) set.model = plan.chores
        if (thinkingSet) set.thinking = null
        if (Object.keys(set).length > 0) ops.push({ ref: s.ref, set })
      } else if (s.model || thinkingSet) {
        ops.push({ ref: s.ref, set: { ...(s.model ? { model: null } : {}), ...(thinkingSet ? { thinking: null } : {}) } })
      }
      continue
    }
    if (family === 'tag') {
      ops.push({ ref: s.ref, set: { model: null, thinking: null } })
    }
  }
  return { ops, skipped }
}
