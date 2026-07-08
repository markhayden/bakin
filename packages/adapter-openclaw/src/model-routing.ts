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
  readOpenClawConfig,
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

/** Flatten the three alias spellings (string / { alias } / bare key). */
function readAliasMap(models: Record<string, unknown> | undefined): Record<string, string> {
  if (!models || typeof models !== 'object') return {}
  const result: Record<string, string> = {}
  for (const [key, val] of Object.entries(models)) {
    if (typeof val === 'string') {
      result[key] = val
    } else if (val && typeof val === 'object' && 'alias' in val) {
      result[key] = String((val as { alias: unknown }).alias)
    } else {
      result[key] = key
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
  const config: OpenClawConfig = readOpenClawConfig() ?? {}
  const agents = (config.agents ?? {}) as Record<string, unknown> & OpenClawConfig['agents']
  const defaults = (agents!.defaults ?? {}) as OpenClawModelDefaults

  if (patch.defaultModel !== undefined) {
    defaults.model = { ...(defaults.model ?? {}), primary: patch.defaultModel }
  }
  if (patch.fallbackModels !== undefined) {
    defaults.model = { ...(defaults.model ?? { primary: '' }), fallbacks: patch.fallbackModels }
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
    defaults.models = Object.fromEntries(
      Object.entries(patch.aliases).map(([name, target]) => [name, { alias: target }]),
    )
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
  const config: OpenClawConfig = readOpenClawConfig() ?? {}
  const list = config.agents?.list
  const agent = list?.find((a) => a.id === agentId)
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
