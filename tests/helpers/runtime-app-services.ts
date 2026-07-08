import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { AgentRuntimeAdapter, RuntimeAgent, RuntimeSkill, WorkspaceFile } from '@bakin/core/adapters/runtime'
import { createMockRuntimeAdapter } from '../../packages/core/src/adapters/runtime/testing'

type AppServicesGlobal = typeof globalThis & {
  __bakinAppServices?: { runtime: AgentRuntimeAdapter }
}

type LegacyAgent = {
  id: string
  identity?: { name?: string }
  role?: string
  model?: string
  metadata?: Record<string, unknown>
}

export interface FilesystemRuntimeAppServicesOptions {
  openClawDir: string
  agents?: LegacyAgent[] | (() => LegacyAgent[])
  onCreateAgent?: (agent: RuntimeAgent) => void
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
}

function readSkillTree(root: string, prefix = ''): Record<string, string> {
  const dir = join(root, prefix)
  const files: Record<string, string> = {}
  if (!existsSync(dir)) return files
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    const abs = join(root, rel)
    if (entry.isDirectory()) {
      Object.assign(files, readSkillTree(root, rel))
    } else if (entry.isFile()) {
      if (entry.name === '.installedBy' || entry.name === '.userEdited') continue
      files[rel] = readFileSync(abs, 'utf-8')
    }
  }
  return files
}

function toRuntimeAgent(agent: LegacyAgent): RuntimeAgent {
  return {
    id: agent.id,
    name: agent.identity?.name ?? agent.id,
    role: agent.role,
    model: agent.model,
    status: 'active',
    metadata: agent.metadata,
  }
}

export function installFilesystemRuntimeAppServices(options: FilesystemRuntimeAppServicesOptions): AgentRuntimeAdapter {
  const createdAgents = new Map<string, RuntimeAgent>()
  const base = createMockRuntimeAdapter()

  const configuredAgents = (): RuntimeAgent[] => {
    const source = typeof options.agents === 'function' ? options.agents() : (options.agents ?? [])
    return source.map(toRuntimeAgent)
  }

  const listAgents = async (): Promise<RuntimeAgent[]> => {
    const seen = new Set<string>()
    const all: RuntimeAgent[] = []
    for (const agent of [...configuredAgents(), ...createdAgents.values()]) {
      if (seen.has(agent.id)) continue
      seen.add(agent.id)
      all.push(agent)
    }
    return all
  }

  const workspacePath = (agentId: string, path: string) => join(options.openClawDir, 'workspaces', agentId, path)
  const skillDir = (name: string, agentId?: string) => agentId
    ? join(options.openClawDir, 'workspaces', agentId, 'skills', name)
    : join(options.openClawDir, 'skills', name)

  const runtime: AgentRuntimeAdapter = {
    ...base,
    agents: {
      ...base.agents,
      list: listAgents,
      get: async (agentId) => (await listAgents()).find((agent) => agent.id === agentId) ?? null,
      create: async (input) => {
        const agent: RuntimeAgent = {
          id: input.id ?? input.name.toLowerCase(),
          name: input.name,
          role: input.role,
          model: input.model,
          status: 'active',
          metadata: input.metadata,
        }
        createdAgents.set(agent.id, agent)
        options.onCreateAgent?.(agent)
        return agent
      },
      update: async (agentId, input) => {
        const existing = (await runtime.agents.get(agentId)) ?? { id: agentId, name: agentId, status: 'active' as const }
        // model/subagentModel use null-to-clear semantics (P2.3) — strip
        // nullish values so the result stays a valid RuntimeAgent.
        const { model, subagentModel, ...rest } = input
        const next = {
          ...existing,
          ...rest,
          ...(typeof model === 'string' ? { model } : {}),
          ...(typeof subagentModel === 'string' ? { subagentModel } : {}),
        }
        createdAgents.set(agentId, next)
        return next
      },
      remove: async (agentId) => {
        createdAgents.delete(agentId)
      },
      listWorkspaceFiles: async (agentId) => {
        const root = join(options.openClawDir, 'workspaces', agentId)
        if (!existsSync(root)) return []
        const files: string[] = []
        const walk = (dir: string, prefix = '') => {
          for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (entry.isSymbolicLink()) continue
            if (entry.name.endsWith('.installedBy') || entry.name.endsWith('.userEdited')) continue
            const rel = prefix ? `${prefix}/${entry.name}` : entry.name
            const abs = join(dir, entry.name)
            if (entry.isDirectory()) {
              walk(abs, rel)
            } else if (entry.isFile()) {
              files.push(rel)
            }
          }
        }
        walk(root)
        return files
      },
      readWorkspaceFile: async (agentId, path) => {
        const target = workspacePath(agentId, path)
        if (!existsSync(target)) return null
        return {
          path,
          content: readFileSync(target, 'utf-8'),
          updatedAt: statSync(target).mtime.toISOString(),
          metadata: {
            installedBy: readJson(`${target}.installedBy`),
            userEdited: existsSync(`${target}.userEdited`),
          },
        }
      },
      writeWorkspaceFile: async (agentId, file) => {
        const target = workspacePath(agentId, file.path)
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, file.content, 'utf-8')
        if (file.metadata?.installedBy) {
          writeFileSync(`${target}.installedBy`, JSON.stringify(file.metadata.installedBy, null, 2), 'utf-8')
        } else {
          rmSync(`${target}.installedBy`, { force: true })
        }
      },
      removeWorkspaceFile: async (agentId, path) => {
        const target = workspacePath(agentId, path)
        rmSync(target, { force: true })
        rmSync(`${target}.installedBy`, { force: true })
      },
    },
    skills: {
      ...base.skills,
      get: async (name, agentId): Promise<RuntimeSkill | null> => {
        const dir = skillDir(name, agentId)
        const skillPath = join(dir, 'SKILL.md')
        if (!existsSync(skillPath)) return null
        return {
          name,
          path: skillPath,
          instructions: readFileSync(skillPath, 'utf-8'),
          files: readSkillTree(dir),
          metadata: {
            installedBy: readJson(join(dir, '.installedBy')),
            userEdited: existsSync(join(dir, '.userEdited')),
          },
        }
      },
      write: async (skill, agentId) => {
        const dir = skillDir(skill.name, agentId)
        const files = skill.files ?? { 'SKILL.md': skill.instructions ?? '' }
        for (const [rel, content] of Object.entries(files)) {
          const target = join(dir, rel)
          mkdirSync(dirname(target), { recursive: true })
          writeFileSync(target, content, 'utf-8')
        }
        if (skill.metadata?.installedBy) {
          writeFileSync(join(dir, '.installedBy'), JSON.stringify(skill.metadata.installedBy, null, 2), 'utf-8')
        } else {
          rmSync(join(dir, '.installedBy'), { force: true })
        }
      },
      remove: async (name, agentId) => {
        rmSync(skillDir(name, agentId), { recursive: true, force: true })
      },
    },
  }

  ;(globalThis as AppServicesGlobal).__bakinAppServices = { runtime }
  return runtime
}
