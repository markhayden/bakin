/**
 * Simple/Advanced classification for the Models page (spec §3.4, D4).
 * Client- and server-safe: pure over the `GET /selections` states.
 *
 * Simple is a VIEW over two lanes — the agent model (`policy:defaultModel`)
 * and the five chores routes' MODEL. Everything Simple cannot express is a
 * customization: agent pins other than the default, subagent pins,
 * dispatch-class and `send` routes, any route thinking, tag overrides,
 * fallbacks, aliases, and chores routes naming different models. Advanced
 * if any customization exists; else Simple. The mode is persisted through
 * the `ui:mode` ref only after classification (never a write on read).
 */
import { DISPATCH_WORK_CLASSES, WORK_CLASSES, type WorkClass } from '../../../src/core/model-routing'

export type UiMode = 'simple' | 'advanced'

import type { SelectionStateWire } from '../types'

export type { SelectionStateWire }

export interface Customization {
  ref: string
  /** Where the customization lives — Simple's "View in Advanced" lands on this ref. */
  label: string
  /** Plain words: "pixel pinned to openai-codex/gpt-5.4-mini". */
  detail: string
}

/** The five chores classes, in table order. */
export const CHORES_CLASSES: readonly WorkClass[] = WORK_CLASSES
  .filter((cls) => cls.routable && cls.recommendedTier !== undefined)
  .map((cls) => cls.id)

const DISPATCH = new Set<string>(DISPATCH_WORK_CLASSES)
const CHORES = new Set<string>(CHORES_CLASSES)

function labelOf(workClass: string): string {
  return WORK_CLASSES.find((c) => c.id === workClass)?.label ?? workClass
}

/** Which view shows a ref: Simple owns the agent lane + chores route models; all else is Advanced. */
export function refLayer(ref: string): 'simple' | 'advanced' {
  if (ref === 'policy:defaultModel') return 'simple'
  if (ref.startsWith('route:') && CHORES.has(ref.slice('route:'.length))) return 'simple'
  return 'advanced'
}

export function listCustomizations(states: readonly SelectionStateWire[]): Customization[] {
  const defaultModel = states.find((s) => s.ref === 'policy:defaultModel')?.model ?? null
  const found: Customization[] = []
  const choresModels = new Set<string>()
  for (const s of states) {
    const [family, second, third] = s.ref.split(':')
    if (family === 'agent' && second) {
      if (third === 'model' && s.model && s.model !== defaultModel) found.push({ ref: s.ref, label: s.label, detail: `${second} pinned to ${s.model}` })
      if (third === 'subagentModel' && s.model) found.push({ ref: s.ref, label: s.label, detail: `${second} subagents use ${s.model}` })
      continue
    }
    if (family === 'policy') {
      if (second === 'defaultSubagentModel' && s.model) found.push({ ref: s.ref, label: s.label, detail: `Default subagent model ${s.model}` })
      if (second === 'fallback' && s.model) found.push({ ref: s.ref, label: s.label, detail: `Fallback ${Number(third) + 1}: ${s.model}` })
      if (second === 'alias' && s.model) found.push({ ref: s.ref, label: s.label, detail: `Alias ${third} → ${s.model}` })
      continue
    }
    if (family === 'route' && second) {
      if (CHORES.has(second)) {
        choresModels.add(s.model ?? defaultModel ?? 'inherit')
        if (s.thinking && s.thinking !== 'inherit') found.push({ ref: s.ref, label: s.label, detail: `${labelOf(second)} thinking set to ${s.thinking}` })
      } else if ((DISPATCH.has(second) || second === 'send') && (s.model || (s.thinking && s.thinking !== 'inherit'))) {
        found.push({ ref: s.ref, label: s.label, detail: `${labelOf(second)} (${second}) routed${s.model ? ` to ${s.model}` : ''}${s.thinking && s.thinking !== 'inherit' ? ` at ${s.thinking} thinking` : ''}` })
      }
      continue
    }
    if (family === 'tag' && second) {
      found.push({ ref: s.ref, label: s.label, detail: `Tag override ${s.ref.slice('tag:'.length)}${s.model ? ` → ${s.model}` : ''}` })
    }
  }
  if (choresModels.size > 1) {
    found.push({ ref: 'route:chores', label: 'Background chores', detail: `Background chores use ${choresModels.size} different models` })
  }
  return found
}

export function classifyMode(states: readonly SelectionStateWire[]): UiMode {
  return listCustomizations(states).length > 0 ? 'advanced' : 'simple'
}
