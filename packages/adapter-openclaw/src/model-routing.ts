/**
 * OpenClaw model routing (P2.3) — the runtime-owned routing policy behind the
 * neutral `models.routingPolicy()/setRoutingPolicy()` contract surface.
 *
 * OpenClaw honors these knobs natively at session time; they live in
 * openclaw.json:
 *   defaultModel         → agents.defaults.model.primary
 *   fallbackModels       → agents.defaults.model.fallbacks
 *   defaultSubagentModel → agents.defaults.subagents.model
 *   aliases              → agents.defaults.models ({ name: { alias: target } })
 * Per-agent assignments (model / subagentModel) live on agents.list[] and are
 * written through `setAgentModels` (backing agents.update).
 *
 * Bakin never sees these shapes — the parsing that used to live in the models
 * plugin's config-io moved here, behind the adapter boundary.
 */
import type { RuntimeRoutingPolicy } from '@bakin/core/adapters/runtime'

import {
  materializeImplicitMainAgent,
  readOpenClawConfig,
  readOpenClawConfigForMutation,
  resetOpenClawConfigCache,
  type OpenClawConfig,
} from './config'
import { writeOpenClawConfig } from './agent-config'

interface OpenClawModelDefaults {
  model?: { primary?: string; fallbacks?: string[] }
  subagents?: { model?: string; [k: string]: unknown }
  models?: Record<string, unknown>
  [k: string]: unknown
}

function defaultsOf(config: OpenClawConfig): OpenClawModelDefaults {
  const agents = (config.agents ?? {}) as Record<string, unknown>
  return (agents.defaults ?? {}) as OpenClawModelDefaults
}

/**
 * Read the alias spellings (string / { alias }). Bare-object entries are
 * per-model PARAMS, not aliases — reporting them as self-aliases made the
 * round-trip rewrite them as `{ alias }` and destroy their settings.
 */
function isAliasEntry(val: unknown): boolean {
  return typeof val === 'string' || (val !== null && typeof val === 'object' && 'alias' in val)
}

function readAliasMap(models: Record<string, unknown> | undefined): Record<string, string> {
  if (!models || typeof models !== 'object') return {}
  const result: Record<string, string> = {}
  for (const [key, val] of Object.entries(models)) {
    if (typeof val === 'string') {
      result[key] = val
    } else if (val !== null && typeof val === 'object' && 'alias' in val) {
      result[key] = String((val as { alias: unknown }).alias)
    }
  }
  return result
}

export function readRoutingPolicy(): RuntimeRoutingPolicy {
  const defaults = defaultsOf(readOpenClawConfig() ?? {})
  return {
    defaultModel: defaults.model?.primary ?? '',
    fallbackModels: defaults.model?.fallbacks ?? [],
    defaultSubagentModel: defaults.subagents?.model ?? null,
    aliases: readAliasMap(defaults.models),
  }
}

/** Merge a partial policy into openclaw.json (read-modify-write). */
export function applyRoutingPolicy(patch: Partial<RuntimeRoutingPolicy>): void {
  const config: OpenClawConfig = readOpenClawConfigForMutation()
  const agents = (config.agents ?? {}) as Record<string, unknown> & OpenClawConfig['agents']
  const defaults = (agents!.defaults ?? {}) as OpenClawModelDefaults

  if (patch.defaultModel !== undefined) {
    defaults.model = { ...(defaults.model ?? {}), primary: patch.defaultModel }
  }
  if (patch.fallbackModels !== undefined) {
    // Never synthesize primary: '' — an explicit empty model is a broken
    // assignment, not "unset".
    defaults.model = { ...(defaults.model ?? {}), fallbacks: patch.fallbackModels }
  }
  if (patch.defaultSubagentModel !== undefined) {
    if (patch.defaultSubagentModel === null) {
      if (defaults.subagents) delete defaults.subagents.model
    } else {
      defaults.subagents = { ...(defaults.subagents ?? {}), model: patch.defaultSubagentModel }
    }
  }
  if (patch.aliases !== undefined) {
    // Canonical write shape: { name: { alias: target } } (the CLI's own form).
    // Preserve non-alias entries (per-model params) and any extra properties
    // on existing alias entries — this map is shared, not alias-exclusive.
    const existing = (defaults.models ?? {}) as Record<string, unknown>
    const next: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(existing)) {
      if (!isAliasEntry(val)) next[key] = val
    }
    for (const [name, target] of Object.entries(patch.aliases)) {
      const prior = existing[name]
      next[name] = prior !== null && typeof prior === 'object'
        ? { ...(prior as Record<string, unknown>), alias: target }
        : { alias: target }
    }
    defaults.models = next
  }

  config.agents = { ...(agents ?? {}), defaults } as OpenClawConfig['agents']
  writeOpenClawConfig(config as unknown as Record<string, unknown>)
  resetOpenClawConfigCache()
}

/** Persist per-agent model assignments onto agents.list[] (null clears). */
export function setAgentModels(
  agentId: string,
  patch: { model?: string | null; subagentModel?: string | null },
): void {
  const config: OpenClawConfig = readOpenClawConfigForMutation()
  // A minimal config declares no agents.list — `main` exists implicitly.
  // Materialize it exactly like updateAgentAllowlist does, or assigning a
  // model to main on a fresh install always throws.
  const agent = agentId === 'main'
    ? materializeImplicitMainAgent(config)
    : config.agents?.list?.find((a) => a.id === agentId)
  if (!agent) throw new Error(`Agent not found in runtime config: ${agentId}`)

  if (patch.model !== undefined) {
    if (patch.model === null) {
      delete agent.model
    } else if (typeof agent.model === 'object' && agent.model !== null) {
      agent.model = { ...agent.model, primary: patch.model }
    } else {
      agent.model = { primary: patch.model }
    }
  }
  if (patch.subagentModel !== undefined) {
    if (patch.subagentModel === null) {
      if (agent.subagents) delete agent.subagents.model
    } else {
      agent.subagents = { ...(agent.subagents ?? {}), model: patch.subagentModel }
    }
  }

  writeOpenClawConfig(config as unknown as Record<string, unknown>)
  resetOpenClawConfigCache()
}
