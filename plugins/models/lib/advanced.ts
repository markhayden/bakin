/**
 * Advanced-view readers over the DRAFT (spec §3.4): the effective fallback
 * list, alias map, tag-override rows, and agent rows are all derived from
 * the persisted states with staged ops applied — so a control renders what
 * the next save will write. Pure; client- and server-safe.
 */
import type { Draft } from './draft'
import type { SelectionStateWire } from '../types'

type Effective = { model: string | null; thinking: string | null; staged: boolean }

/** Every ref the draft or the persisted states know under a family prefix. */
function refsOf(states: readonly SelectionStateWire[], draft: Draft, prefix: string): string[] {
  const refs = new Set<string>()
  for (const s of states) if (s.ref.startsWith(prefix)) refs.add(s.ref)
  for (const ref of draft.keys()) if (ref.startsWith(prefix)) refs.add(ref)
  return [...refs]
}

/** Ordered fallback models as the next save leaves them (holes from cleared indices are dropped). */
export function effectiveFallbacks(states: readonly SelectionStateWire[], draft: Draft, effective: (ref: string) => Effective): string[] {
  const indexed = refsOf(states, draft, 'policy:fallback:')
    .map((ref) => ({ n: Number(ref.slice('policy:fallback:'.length)), model: effective(ref).model }))
    .filter((row) => Number.isFinite(row.n))
    .sort((a, b) => a.n - b.n)
  return indexed.map((row) => row.model).filter((m): m is string => Boolean(m))
}

/** Alias name → target as the next save leaves them (cleared aliases omitted). */
export function effectiveAliases(states: readonly SelectionStateWire[], draft: Draft, effective: (ref: string) => Effective): Record<string, string> {
  const out: Record<string, string> = {}
  for (const ref of refsOf(states, draft, 'policy:alias:').sort()) {
    const model = effective(ref).model
    if (model) out[ref.slice('policy:alias:'.length)] = model
  }
  return out
}

export interface TagOverrideRow {
  tag: string
  ref: string
  model: string | null
  thinking: string | null
  staged: boolean
  /** Not persisted yet — exists only in the draft. */
  added: boolean
}

/** Tag overrides as the next save leaves them (a row cleared to model+thinking null is gone). */
export function effectiveTagOverrides(states: readonly SelectionStateWire[], draft: Draft, effective: (ref: string) => Effective): TagOverrideRow[] {
  const persisted = new Set(states.filter((s) => s.ref.startsWith('tag:')).map((s) => s.ref))
  const rows: TagOverrideRow[] = []
  for (const ref of refsOf(states, draft, 'tag:').sort()) {
    const eff = effective(ref)
    const added = !persisted.has(ref)
    // Cleared (or never given anything) ⇒ gone from the next save's view.
    if (eff.model === null && eff.thinking === null) continue
    rows.push({ tag: ref.slice('tag:'.length), ref, ...eff, added })
  }
  return rows
}

export interface AgentRow {
  agentId: string
  name: string
  modelRef: string
  subagentRef: string
}

/** One row per agent the roster reported (`agent:<id>:model` states carry the display name). */
export function agentRows(states: readonly SelectionStateWire[]): AgentRow[] {
  return states
    .filter((s) => s.ref.startsWith('agent:') && s.ref.endsWith(':model'))
    .map((s) => {
      const agentId = s.ref.slice('agent:'.length, -':model'.length)
      return { agentId, name: s.label, modelRef: s.ref, subagentRef: `agent:${agentId}:subagentModel` }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}
