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
  model?: { primary?: string }
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

let cachedConfig: { path: string; mtimeMs: number; config: OpenClawConfig | null } | null = null

export function readOpenClawConfig(): OpenClawConfig | null {
  let path: string
  try {
    path = getOpenClawPath('openclaw.json')
  } catch {
    cachedConfig = null
    return null
  }

  let mtimeMs: number
  try {
    mtimeMs = statSync(path).mtimeMs
  } catch {
    cachedConfig = null
    return null
  }

  if (cachedConfig && cachedConfig.path === path && cachedConfig.mtimeMs === mtimeMs) return cachedConfig.config

  let config: OpenClawConfig | null
  try {
    config = JSON.parse(readFileSync(path, 'utf-8')) as OpenClawConfig
  } catch {
    config = null
  }
  cachedConfig = { path, mtimeMs, config }
  return config
}

export function getAgentList(): OpenClawAgent[] {
  const config = readOpenClawConfig()
  if (!config) return []
  const list = config.agents?.list
  if (Array.isArray(list) && list.length > 0) return list
  return [implicitMainAgent(config)]
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
