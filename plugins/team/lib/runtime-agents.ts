/**
 * Runtime-adapter agent helpers for the team plugin.
 *
 * Extracted from index.ts. Every function takes the `AgentRuntimeAdapter`
 * explicitly (or is a pure identity-markdown transform), so this module has no
 * dependency on the plugin's module-level context — it's a thin, testable
 * wrapper layer over the runtime's agent/skills/memory surface that the team
 * REST routes and activate() call into.
 */
import { basename } from 'path'

import { resolveAgentAvatar } from '@bakin/core/agents/avatar'
import { getRuntimeMainAgentId, type AgentRuntimeAdapter, type RuntimeAgent } from '@bakin/core/adapters/runtime'

import type {
  AgentMeta,
  AgentProfile,
  HeartbeatRaw,
  SkillSummary,
} from '../types'

export interface IdentityFields {
  name?: string
  emoji?: string
  role?: string
  vibe?: string
  primaryFunction?: string
  defaultMode?: string
}

export interface CreateAgentInput extends IdentityFields {
  id: string
  name: string
  model?: string
  soul?: string
  tools?: string
}

function metadataString(agent: RuntimeAgent, key: string): string | undefined {
  const value = agent.metadata?.[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function metadataStringArray(agent: RuntimeAgent, key: string): string[] | null {
  const value = agent.metadata?.[key]
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string') ? value : null
}

export function agentToMeta(agent: RuntimeAgent): AgentMeta {
  const headshot = resolveAgentAvatar(agent.id) ? `/api/plugins/team/${agent.id}/avatar` : ''

  return {
    id: agent.id,
    name: agent.name || agent.id,
    emoji: metadataString(agent, 'emoji') ?? '',
    role: agent.role ?? metadataString(agent, 'role') ?? '',
    headshot,
  }
}

export async function listRuntimeAgentMetas(runtime: AgentRuntimeAdapter): Promise<AgentMeta[]> {
  return (await runtime.agents.list()).map(agentToMeta)
}

export async function getRuntimeAgentIds(runtime: AgentRuntimeAdapter): Promise<string[]> {
  return (await runtime.agents.list()).map((agent) => agent.id)
}

export async function getRuntimeAgentModel(runtime: AgentRuntimeAdapter, agent: RuntimeAgent): Promise<string> {
  if (agent.model) return agent.model
  // No explicit assignment → the runtime's routing default (P2.4: read
  // through the neutral policy surface, never raw runtime config).
  const policy = await runtime.models.routingPolicy()
  return policy.defaultModel || 'unknown'
}

async function readRuntimeWorkspaceText(
  runtime: AgentRuntimeAdapter,
  agentId: string,
  path: string,
): Promise<string | null> {
  return (await runtime.agents.readWorkspaceFile(agentId, path))?.content ?? null
}

export async function getRuntimeAgentProfile(runtime: AgentRuntimeAdapter, agentId: string): Promise<AgentProfile | null> {
  const agent = await runtime.agents.get(agentId)
  if (!agent) return null
  const meta = agentToMeta(agent)
  const model = await getRuntimeAgentModel(runtime, agent)
  return {
    ...meta,
    model,
    workspacePath: metadataString(agent, 'workspacePath') ?? '',
    soul: await readRuntimeWorkspaceText(runtime, agent.id, 'SOUL.md'),
    identity: await readRuntimeWorkspaceText(runtime, agent.id, 'IDENTITY.md'),
    rules: await readRuntimeWorkspaceText(runtime, agent.id, 'AGENTS.md'),
    tools: await readRuntimeWorkspaceText(runtime, agent.id, 'TOOLS.md'),
    heartbeatMd: await readRuntimeWorkspaceText(runtime, agent.id, 'HEARTBEAT.md'),
    subagentPerms: metadataStringArray(agent, 'subagentAllowAgents'),
  }
}

function synthesizeIdentityMd(fields: IdentityFields): string {
  const lines = ['# IDENTITY.md', '']
  const entries: [string, string | undefined][] = [
    ['Name', fields.name],
    ['Role', fields.role],
    ['Emoji', fields.emoji],
    ['Vibe', fields.vibe],
    ['Primary Function', fields.primaryFunction],
    ['Default Mode', fields.defaultMode],
  ]
  for (const [label, value] of entries) {
    if (value) lines.push(`- **${label}:** ${value}`)
  }
  lines.push('')
  return lines.join('\n')
}

function parseIdentityMd(content: string): Record<string, string> {
  const fields: Record<string, string> = {}
  const regex = /^[-*]\s*\*\*(.+?):\*\*\s*(.+)/gm
  let match
  while ((match = regex.exec(content)) !== null) {
    fields[match[1]] = match[2].trim()
  }
  return fields
}

export async function createRuntimeAgent(
  runtime: AgentRuntimeAdapter,
  input: CreateAgentInput,
): Promise<{ id: string; workspace: string }> {
  const agent = await runtime.agents.create({
    id: input.id,
    name: input.name,
    role: input.role,
    model: input.model,
    metadata: {
      emoji: input.emoji,
      role: input.role,
      vibe: input.vibe,
      primaryFunction: input.primaryFunction,
      defaultMode: input.defaultMode,
    },
  })

  await runtime.agents.writeWorkspaceFile(input.id, {
    path: 'IDENTITY.md',
    content: synthesizeIdentityMd(input),
  })
  if (input.soul) {
    await runtime.agents.writeWorkspaceFile(input.id, { path: 'SOUL.md', content: input.soul })
  }
  if (input.tools) {
    await runtime.agents.writeWorkspaceFile(input.id, { path: 'TOOLS.md', content: input.tools })
  }

  return { id: input.id, workspace: metadataString(agent, 'workspacePath') ?? '' }
}

export async function addToRuntimeAllowlists(
  runtime: AgentRuntimeAdapter,
  newAgentId: string,
  dispatchable: 'all' | 'main' | string[],
): Promise<void> {
  const mainAgentId = await getRuntimeMainAgentId(runtime)
  if (dispatchable === 'main') {
    await runtime.agents.updateAllowlist(mainAgentId, { add: [newAgentId] })
    return
  }

  const agents = await runtime.agents.list()
  if (dispatchable === 'all') {
    await Promise.all(
      agents
        .filter((agent) => agent.id !== newAgentId)
        .map((agent) => runtime.agents.updateAllowlist(agent.id, { add: [newAgentId] })),
    )
    return
  }

  const targetIds = new Set(dispatchable)
  targetIds.add(mainAgentId)
  targetIds.delete(newAgentId)
  await Promise.all(Array.from(targetIds).map((agentId) => runtime.agents.updateAllowlist(agentId, { add: [newAgentId] })))
}

export async function removeFromRuntimeAllowlists(runtime: AgentRuntimeAdapter, agentId: string): Promise<void> {
  const agents = await runtime.agents.list()
  await Promise.all(agents.map((agent) => runtime.agents.updateAllowlist(agent.id, { remove: [agentId] })))
}

export async function removeRuntimeAgent(runtime: AgentRuntimeAdapter, agentId: string): Promise<boolean> {
  if (!(await runtime.agents.get(agentId))) return false
  await runtime.agents.remove(agentId)
  return true
}

export async function updateRuntimeAgentIdentity(
  runtime: AgentRuntimeAdapter,
  agentId: string,
  fields: IdentityFields & { soul?: string; tools?: string },
): Promise<string[]> {
  const agent = await runtime.agents.get(agentId)
  if (!agent) throw new Error(`Agent "${agentId}" not found in roster`)

  const updated: string[] = []
  if (fields.name || fields.emoji || fields.role || fields.vibe || fields.primaryFunction || fields.defaultMode) {
    await runtime.agents.update(agentId, {
      name: fields.name,
      role: fields.role,
      metadata: {
        ...(agent.metadata ?? {}),
        ...(fields.emoji ? { emoji: fields.emoji } : {}),
        ...(fields.role ? { role: fields.role } : {}),
        ...(fields.vibe ? { vibe: fields.vibe } : {}),
        ...(fields.primaryFunction ? { primaryFunction: fields.primaryFunction } : {}),
        ...(fields.defaultMode ? { defaultMode: fields.defaultMode } : {}),
      },
    })
    if (fields.name) updated.push('name')
    if (fields.emoji) updated.push('emoji')
  }

  const structuredFields = ['role', 'vibe', 'primaryFunction', 'defaultMode'] as const
  const hasStructuredUpdate = structuredFields.some((field) => fields[field])
  if (hasStructuredUpdate || fields.name || fields.emoji) {
    const existing = await readRuntimeWorkspaceText(runtime, agentId, 'IDENTITY.md')
    const parsed = existing ? parseIdentityMd(existing) : {}
    const merged: IdentityFields = {
      name: fields.name ?? parsed['Name'],
      emoji: fields.emoji ?? parsed['Emoji'],
      role: fields.role ?? parsed['Role'],
      vibe: fields.vibe ?? parsed['Vibe'],
      primaryFunction: fields.primaryFunction ?? parsed['Primary Function'],
      defaultMode: fields.defaultMode ?? parsed['Default Mode'],
    }
    await runtime.agents.writeWorkspaceFile(agentId, { path: 'IDENTITY.md', content: synthesizeIdentityMd(merged) })
    for (const field of structuredFields) {
      if (fields[field]) updated.push(field)
    }
  }

  if (fields.soul) {
    await runtime.agents.writeWorkspaceFile(agentId, { path: 'SOUL.md', content: fields.soul })
    updated.push('soul')
  }
  if (fields.tools) {
    await runtime.agents.writeWorkspaceFile(agentId, { path: 'TOOLS.md', content: fields.tools })
    updated.push('tools')
  }

  return updated
}

export async function setRuntimeSubagentPermissions(
  runtime: AgentRuntimeAdapter,
  agentId: string,
  allowAgents: string[],
): Promise<void> {
  if (allowAgents.includes(agentId)) {
    throw new Error(`Agent "${agentId}" cannot dispatch to itself`)
  }
  await runtime.agents.updateAllowlist(agentId, { replace: allowAgents })
}

export async function listRuntimeSkills(runtime: AgentRuntimeAdapter, agentId: string): Promise<SkillSummary[]> {
  return (await runtime.skills.list(agentId)).map((skill) => ({
    id: skill.name,
    name: skill.name,
    hasSkillMd: typeof skill.metadata?.hasSkillMd === 'boolean'
      ? skill.metadata.hasSkillMd
      : Boolean(skill.instructions || skill.path),
  }))
}

export async function readRuntimeSkillFile(runtime: AgentRuntimeAdapter, agentId: string, skillId: string): Promise<string | null> {
  return (await runtime.skills.get(skillId, agentId))?.instructions ?? null
}

export async function listRuntimeMemoryFiles(runtime: AgentRuntimeAdapter, agentId: string): Promise<string[]> {
  return (await runtime.memory.listEntries('workspace-memory', { agentId }))
    .map((entry) => basename(entry.path ?? entry.id))
    .sort()
    .reverse()
}

export async function readRuntimeMemoryFile(runtime: AgentRuntimeAdapter, agentId: string, date: string): Promise<string | null> {
  const entry = await runtime.memory.getEntry('workspace-memory', date, { agentId })
  if (entry) return entry.content
  return readRuntimeWorkspaceText(runtime, agentId, `memory/${date}`)
}

export async function readRuntimeHeartbeatRaw(runtime: AgentRuntimeAdapter, agentId: string): Promise<HeartbeatRaw | null> {
  const heartbeat = await runtime.agents.readWorkspaceFile(agentId, 'HEARTBEAT.md')
  return heartbeat ? { content: heartbeat.content, lastUpdated: heartbeat.updatedAt ?? null } : null
}
