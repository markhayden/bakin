/**
 * OpenClaw runtime config reader.
 *
 * Provider config parsing belongs to the OpenClaw adapter package. Bakin core
 * sees this through AgentRuntimeAdapter.config instead of importing this file.
 */
import { readFileSync, statSync } from 'fs'

import { getOpenClawPath } from './home'

export interface OpenClawAgent {
  id: string
  name?: string
  workspace?: string
  agentDir?: string
  model?: string | { primary?: string }
  identity?: { name?: string; emoji?: string }
  subagents?: { allowAgents?: string[]; model?: string }
}

export interface OpenClawConfig {
  agents?: {
    defaults?: {
      model?: { primary?: string }
      workspace?: string
    }
    list?: OpenClawAgent[]
  }
  gateway?: {
    auth?: { token?: string }
  }
  channels?: Record<string, unknown>
  skills?: Record<string, unknown>
}

let cachedConfig: { path: string; mtimeMs: number; config: OpenClawConfig | null; corrupt: boolean } | null = null

type ConfigReadState =
  | { kind: 'ok'; config: OpenClawConfig }
  | { kind: 'absent' }
  | { kind: 'corrupt' }

function readConfigState(): ConfigReadState {
  let path: string
  try {
    path = getOpenClawPath('openclaw.json')
  } catch {
    cachedConfig = null
    return { kind: 'absent' }
  }

  let mtimeMs: number
  try {
    mtimeMs = statSync(path).mtimeMs
  } catch {
    cachedConfig = null
    return { kind: 'absent' }
  }

  if (cachedConfig && cachedConfig.path === path && cachedConfig.mtimeMs === mtimeMs) {
    if (cachedConfig.corrupt) return { kind: 'corrupt' }
    return cachedConfig.config ? { kind: 'ok', config: cachedConfig.config } : { kind: 'absent' }
  }

  try {
    const config = JSON.parse(readFileSync(path, 'utf-8')) as OpenClawConfig
    cachedConfig = { path, mtimeMs, config, corrupt: false }
    return { kind: 'ok', config }
  } catch {
    cachedConfig = { path, mtimeMs, config: null, corrupt: true }
    return { kind: 'corrupt' }
  }
}

/**
 * Lenient read for presence checks and other read-only consumers: a missing
 * OR unparseable file reads as `null` and callers degrade gracefully.
 * Mutators must NOT use this — see readOpenClawConfigForMutation.
 */
export function readOpenClawConfig(): OpenClawConfig | null {
  const state = readConfigState()
  return state.kind === 'ok' ? state.config : null
}

/**
 * Strict read for read-modify-write paths. An ABSENT file starts from `{}`;
 * an UNPARSEABLE file THROWS — writers previously coalesced both to `{}` and
 * a single torn read let automatic provisioning replace the user's entire
 * runtime config (credentials included) with just Bakin's entries.
 */
export function readOpenClawConfigForMutation(): OpenClawConfig {
  const state = readConfigState()
  if (state.kind === 'corrupt') {
    throw new Error(
      'openclaw.json exists but is not valid JSON — refusing to modify it. Fix or restore the file, then retry.',
    )
  }
  return state.kind === 'ok' ? state.config : {}
}

/**
 * Resolve the agent list from a config object, synthesizing an implicit `main`
 * agent when none is declared (a minimal OpenClaw config has only
 * `agents.defaults`). Pure — callers that already hold a config (e.g. the
 * runtime `config.get`) reuse this instead of consumers assuming `agents.list`.
 */
export function agentListFrom(config: OpenClawConfig | null): OpenClawAgent[] {
  if (!config) return []
  const list = config.agents?.list
  if (Array.isArray(list) && list.length > 0) return list
  return [implicitMainAgent(config)]
}

export function getAgentList(): OpenClawAgent[] {
  return agentListFrom(readOpenClawConfig())
}

export function getAgentIds(): string[] {
  return getAgentList().map((agent) => agent.id)
}

export function findAgentById(id: string): OpenClawAgent | null {
  return getAgentList().find((agent) => agent.id === id) ?? null
}

export function resetOpenClawConfigCache(): void {
  cachedConfig = null
}

function implicitMainAgent(config: OpenClawConfig): OpenClawAgent {
  const defaults = config.agents?.defaults
  return {
    id: 'main',
    name: 'Main',
    workspace: defaults?.workspace,
    agentDir: getOpenClawPath('agents', 'main', 'agent'),
    model: defaults?.model,
  }
}

export function materializeImplicitMainAgent(config: OpenClawConfig): OpenClawAgent {
  const existing = config.agents?.list?.find((agent) => agent.id === 'main')
  if (existing) return existing
  config.agents ??= {}
  config.agents.list ??= []
  const agent = implicitMainAgent(config)
  config.agents.list.push(agent)
  return agent
}
