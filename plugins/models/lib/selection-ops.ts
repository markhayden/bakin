/**
 * Pure builders that turn UI intents into selection ops for the ONE write
 * path (`POST /selections`). Client- and server-safe: no I/O, no React.
 * Every builder emits ONLY the refs that actually change, so a save never
 * touches configuration the user did not edit (D24).
 */
import type { MutationOp } from '../../../src/core/model-mutations'
import { ROUTABLE_WORK_CLASSES, type RoutingConfig, type ThinkingSetting } from '../../../src/core/model-routing'

// Re-exported so client code stays on plugin-local imports (UI legacy-style ratchet).
export type { MutationOp }

export interface PolicyDefaults {
  defaultModel: string
  defaultSubagentModel: string | null
  fallbackModels: string[]
}

/** Default / subagent default / fallback list → ops (fallbacks diffed per index; removed tail indices cleared). */
export function policyDefaultsOps(current: PolicyDefaults, next: Partial<PolicyDefaults>): MutationOp[] {
  const ops: MutationOp[] = []
  if (next.defaultModel !== undefined && next.defaultModel !== current.defaultModel) {
    ops.push({ ref: 'policy:defaultModel', set: { model: next.defaultModel || null } })
  }
  if (next.defaultSubagentModel !== undefined && (next.defaultSubagentModel ?? null) !== (current.defaultSubagentModel ?? null)) {
    ops.push({ ref: 'policy:defaultSubagentModel', set: { model: next.defaultSubagentModel ?? null } })
  }
  if (next.fallbackModels !== undefined) {
    const max = Math.max(current.fallbackModels.length, next.fallbackModels.length)
    for (let n = 0; n < max; n++) {
      const before = current.fallbackModels[n] ?? null
      const after = next.fallbackModels[n] ?? null
      if (before !== after) ops.push({ ref: `policy:fallback:${n}`, set: { model: after } })
    }
  }
  return ops
}

/** Alias map diff → ops (added/changed set, removed cleared). */
export function aliasOps(current: Record<string, string>, next: Record<string, string>): MutationOp[] {
  const ops: MutationOp[] = []
  for (const [name, target] of Object.entries(next)) {
    if (current[name] !== target) ops.push({ ref: `policy:alias:${name}`, set: { model: target } })
  }
  for (const name of Object.keys(current)) {
    if (!(name in next)) ops.push({ ref: `policy:alias:${name}`, set: { model: null } })
  }
  return ops
}

const normThinking = (t: ThinkingSetting | undefined): ThinkingSetting | null => (t && t !== 'inherit' ? t : null)

/** Work-class routes + tag overrides diff → ops. Only refs whose model or thinking changed. */
export function routingDiffOps(before: RoutingConfig, after: RoutingConfig): MutationOp[] {
  const ops: MutationOp[] = []
  const b = new Map(before.routes.map((r) => [r.workClass, r]))
  const a = new Map(after.routes.map((r) => [r.workClass, r]))
  for (const workClass of ROUTABLE_WORK_CLASSES) {
    const x = b.get(workClass)
    const y = a.get(workClass)
    const set: MutationOp['set'] = {}
    if ((x?.model ?? null) !== (y?.model ?? null)) set.model = y?.model ?? null
    if (normThinking(x?.thinking) !== normThinking(y?.thinking)) set.thinking = normThinking(y?.thinking)
    if (Object.keys(set).length > 0) ops.push({ ref: `route:${workClass}`, set })
  }
  const bt = new Map(before.tagOverrides.map((t) => [t.tag, t]))
  const at = new Map(after.tagOverrides.filter((t) => t.tag.trim()).map((t) => [t.tag.trim(), t]))
  for (const [tag, y] of at) {
    const x = bt.get(tag)
    const set: MutationOp['set'] = {}
    if ((x?.model ?? null) !== (y.model ?? null)) set.model = y.model ?? null
    if (normThinking(x?.thinking) !== normThinking(y.thinking)) set.thinking = normThinking(y.thinking)
    if (!x || Object.keys(set).length > 0) {
      if (!x) { set.model = y.model ?? null; set.thinking = normThinking(y.thinking) }
      ops.push({ ref: `tag:${tag}`, set })
    }
  }
  for (const tag of bt.keys()) {
    if (!at.has(tag)) ops.push({ ref: `tag:${tag}`, set: { model: null, thinking: null } })
  }
  return ops
}
