/**
 * OpenClaw agent + workspace config — the openclaw.json mutators (agent upsert/
 * identity/allowlist/remove + artifact teardown), the config writer, and the
 * workspace/skill file readers + identity-field parsing. The class's agents
 * and skills methods own the exec/validation and import these; reads/writes go
 * through the config + home + cron-store siblings, so no cycle back to runtime.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { join, resolve, sep } from 'path'
import type { RuntimeAgent } from '@bakin/core/adapters/runtime'
import { RuntimeError } from '@bakin/core/adapters/runtime'
import {
  readOpenClawConfig,
  resetOpenClawConfigCache,
  materializeImplicitMainAgent,
  findAgentById,
  type OpenClawConfig,
  type OpenClawAgent,
} from './config'
import { getOpenClawHome, getOpenClawPath } from './home'
import { tryGetMainAgentId } from './main-agent'
import { readCronStore, writeCronStore } from './cron-store'

export function writeOpenClawConfig(config: Record<string, unknown>): void {
  mkdirSync(getOpenClawHome(), { recursive: true })
  // tmp + rename: a torn openclaw.json is what makes the next boot's
  // read-modify-write see "corrupt" — never leave a half-written file.
  const target = getOpenClawPath('openclaw.json')
  const tmp = `${target}.tmp-${process.pid}`
  writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf-8')
  renameSync(tmp, target)
  resetOpenClawConfigCache()
}

export function agentModelPrimary(model: OpenClawAgent['model']): string | undefined {
  if (typeof model === 'string') return model
  return model?.primary
}

export function openClawAgentsList(config: OpenClawConfig): OpenClawAgent[] {
  config.agents ??= {}
  config.agents.list ??= []
  return config.agents.list
}

export function upsertOpenClawAgentConfig(input: {
  id: string
  name: string
  workspace: string
  model?: string
  emoji?: string
}): void {
  const config: OpenClawConfig = readOpenClawConfig() ?? {}
  const list = openClawAgentsList(config)
  const existing = list.find((agent) => agent.id === input.id)
  const agentDir = getOpenClawPath('agents', input.id, 'agent')
  const identity = input.name || input.emoji
    ? {
        ...(existing?.identity ?? {}),
        ...(input.name ? { name: input.name } : {}),
        ...(input.emoji ? { emoji: input.emoji } : {}),
      }
    : existing?.identity

  if (!existing && list.length === 0 && input.id !== 'main') {
    list.push({ id: 'main' })
  }

  const next = {
    ...(existing ?? { id: input.id }),
    name: input.name,
    workspace: input.workspace,
    agentDir,
    ...(input.model ? { model: input.model } : {}),
    ...(identity ? { identity } : {}),
  }

  if (existing) Object.assign(existing, next)
  else list.push(next)

  mkdirSync(agentDir, { recursive: true })
  mkdirSync(join(agentDir, 'sessions'), { recursive: true })
  mkdirSync(input.workspace, { recursive: true })
  writeOpenClawConfig(config as unknown as Record<string, unknown>)
}

export function updateOpenClawAgentIdentity(agentId: string, input: { name?: string; emoji?: string }): void {
  const config = readOpenClawConfig()
  const agent = config?.agents?.list?.find((entry) => entry.id === agentId)
  if (!agent) throw new RuntimeError(`Agent not found: ${agentId}`, { kind: 'not_found' })
  agent.identity = {
    ...(agent.identity ?? {}),
    ...(input.name ? { name: input.name } : {}),
    ...(input.emoji ? { emoji: input.emoji } : {}),
  }
  writeOpenClawConfig(config as unknown as Record<string, unknown>)
}

export function updateAgentAllowlist(agentId: string, updater: (current: string[]) => string[]): void {
  const config = readOpenClawConfig()
  const agent = agentId === 'main' && config
    ? materializeImplicitMainAgent(config)
    : config?.agents?.list?.find((entry) => entry.id === agentId)
  if (!agent) throw new RuntimeError(`Agent not found: ${agentId}`, { kind: 'not_found' })
  agent.subagents ??= {}
  agent.subagents.allowAgents = updater(agent.subagents.allowAgents ?? [])
  writeOpenClawConfig(config as unknown as Record<string, unknown>)
}

export function removeOpenClawAgentConfig(agentId: string): void {
  const config = readOpenClawConfig()
  const agents = config?.agents?.list
  if (!config?.agents || !agents) return

  let changed = false
  const filtered = agents.filter((agent) => agent.id !== agentId)
  if (filtered.length !== agents.length) {
    config.agents.list = filtered
    changed = true
  }

  for (const agent of config.agents.list ?? []) {
    const allowAgents = agent.subagents?.allowAgents
    if (!allowAgents?.includes(agentId)) continue
    agent.subagents!.allowAgents = allowAgents.filter((id) => id !== agentId)
    changed = true
  }

  if (changed) writeOpenClawConfig(config as unknown as Record<string, unknown>)
}

export function removeOpenClawAgentArtifacts(agentId: string, workspace: string): void {
  removeOpenClawOwnedPath(workspace)
  removeOpenClawOwnedPath(getOpenClawPath('agents', agentId))
}

export function removeOpenClawAgentCronArtifacts(agentId: string): void {
  const store = readCronStore()
  const jobs = store.jobs ?? []
  const removedJobIds = new Set<string>()
  const keptJobs = jobs.filter((job) => {
    const matches = job.agentId === agentId
      || job.sessionTarget === agentId
      || job.sessionTarget === `agent:${agentId}`
    if (matches && job.id) removedJobIds.add(job.id)
    return !matches
  })
  if (keptJobs.length === jobs.length) return

  writeCronStore({ ...store, jobs: keptJobs })
  for (const jobId of removedJobIds) {
    removeOpenClawOwnedPath(getOpenClawPath('cron', 'runs', `${jobId}.jsonl`))
  }
}

export function removeOpenClawOwnedPath(path: string | undefined): void {
  if (!path) return
  const home = resolve(getOpenClawHome())
  const target = resolve(path)
  if (target === home || !target.startsWith(`${home}${sep}`)) return
  rmSync(target, { recursive: true, force: true })
}

export function agentToRuntime(agent: NonNullable<ReturnType<typeof findAgentById>>): RuntimeAgent {
  return {
    id: agent.id,
    name: agent.identity?.name ?? agent.name ?? agent.id,
    role: resolveRole(agent.id),
    model: agentModelPrimary(agent.model),
    ...(agent.subagents?.model ? { subagentModel: agent.subagents.model } : {}),
    status: 'active',
    metadata: {
      emoji: agent.identity?.emoji ?? '',
      workspacePath: getWorkspacePath(agent.id),
      subagentAllowAgents: agent.subagents?.allowAgents ?? null,
    },
  }
}

/**
 * True when a configured workspace path lives under an `.openclaw` home
 * DIFFERENT from the one this process resolves — e.g. host-side Bakin
 * reading a container-onboarded config in the dockerized dev rig, where
 * openclaw.json stores `/home/node/.openclaw/workspace`. Custom paths
 * outside any `.openclaw` home are never flagged.
 */
function isForeignOpenClawPath(path: string): boolean {
  if (!path.includes(`${sep}.openclaw${sep}`)) return false
  const home = getOpenClawHome()
  return path !== home && !path.startsWith(home + sep)
}

export function getWorkspacePath(agentId: string): string {
  const config = readOpenClawConfig()
  const isMain = agentId === tryGetMainAgentId()
  const agent = config?.agents?.list?.find((entry) => entry.id === agentId)
  const configured = agent?.workspace ?? (isMain ? config?.agents?.defaults?.workspace : undefined)
  // Trust the configured path unless it belongs to a foreign OpenClaw home
  // that doesn't exist here (the dockerized-rig scenario) — writes through
  // this path must NOT silently land in the default workspace just because
  // a legitimately configured directory hasn't been created yet.
  if (configured && (existsSync(configured) || !isForeignOpenClawPath(configured))) {
    return configured
  }
  return isMain
    ? join(getOpenClawHome(), 'workspace')
    : join(getOpenClawHome(), 'workspaces', agentId)
}

export function readGatewayToken(): string | null {
  const config = readOpenClawConfig() as { gateway?: { auth?: { token?: unknown } } } | null
  const token = config?.gateway?.auth?.token
  return typeof token === 'string' && token.length > 0 ? token : null
}

export function isSafeWorkspaceFile(path: string): boolean {
  return !path.includes('..') && !path.startsWith('/') && !path.includes('\\')
}

export function readWorkspaceRootFile(agentId: string, filename: string): string | null {
  if (!isSafeWorkspaceFile(filename)) return null
  try {
    return readFileSync(join(getWorkspacePath(agentId), filename), 'utf-8')
  } catch {
    return null
  }
}

export function matchIdentityField(identity: string, key: string): string | null {
  const inlineRe = new RegExp(
    `^\\s*[-*]?\\s*\\*{0,2}${key}\\*{0,2}\\s*:\\s*\\*{0,2}\\s*(.+?)\\s*\\*{0,2}\\s*$`,
    'mi',
  )
  const inline = identity.match(inlineRe)
  if (inline) {
    const value = inline[1].trim().replace(/^\*+|\*+$/g, '').trim()
    if (value.length > 0) return value
  }
  const heading = identity.match(new RegExp(`^#{1,6}\\s+${key}\\s*$\\n+([^\\n]+)`, 'mi'))
  if (heading) {
    const value = heading[1].trim().replace(/^\*+|\*+$/g, '').trim()
    if (value.length > 0) return value
  }
  return null
}

export function resolveRole(agentId: string): string {
  const identity = readWorkspaceRootFile(agentId, 'IDENTITY.md')
  if (identity) {
    const role = matchIdentityField(identity, 'Role')
    if (role) return role
    const vibe = matchIdentityField(identity, 'Vibe')
    if (vibe) return vibe
  }

  const soul = readWorkspaceRootFile(agentId, 'SOUL.md')
  if (soul) {
    const firstLine = soul.split('\n').find((line) => line.startsWith('You are ') || line.startsWith('# '))
    if (firstLine) {
      const dashPart = firstLine.split('—')[1] || firstLine.split('-')[1]
      if (dashPart) {
        const role = dashPart.replace(/\.\s*$/, '').trim()
        if (role.length > 0 && role.length < 60) return role
      }
    }
  }

  return agentId === tryGetMainAgentId() ? 'Orchestrator' : ''
}
