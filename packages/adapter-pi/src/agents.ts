/**
 * agents.* contract implementation — identity from the registry, workspace
 * file CRUD as plain file ops in the agent's workspace dir, stats for the
 * startup-context report (#357: names + sizes, never content).
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs'
import { dirname, join, relative, resolve, sep } from 'path'

import type {
  AgentRuntimeAdapter,
  CreateRuntimeAgentInput,
  RuntimeAgent,
  RuntimeAllowlistPatch,
  RuntimePermissionPatch,
  UpdateRuntimeAgentInput,
  WorkspaceFile,
  WorkspaceFileStat,
} from '@bakin/core/adapters/runtime'
import { getAgentWorkspaceDir } from './home'
import {
  assertValidAgentId,
  mutateRegistry,
  readRegistry,
  removeAgentDirs,
  scaffoldAgentDirs,
  type PiAgentRecord,
} from './registry'

function toRuntimeAgent(record: PiAgentRecord): RuntimeAgent {
  return {
    id: record.id,
    name: record.name,
    role: record.role,
    model: record.model,
    status: 'active',
    metadata: {
      workspace: getAgentWorkspaceDir(record.id),
      ...(record.allowlist ? { allowlist: record.allowlist } : {}),
      ...(record.metadata ?? {}),
    },
  }
}

/** Resolve a workspace-relative path, refusing traversal outside the workspace. */
function workspaceFilePath(agentId: string, relPath: string): string {
  assertValidAgentId(agentId)
  const root = getAgentWorkspaceDir(agentId)
  const abs = resolve(root, relPath)
  if (abs !== root && !abs.startsWith(root + sep)) {
    throw new Error(`adapter-pi: workspace path escapes the workspace: ${relPath}`)
  }
  return abs
}

function walkFiles(root: string, dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.pi') continue
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) walkFiles(root, abs, out)
    else out.push(relative(root, abs))
  }
}

/** Canonical session-bootstrap files (workspace root *.md); skills live under .pi/skills. */
function classify(relPath: string): WorkspaceFileStat['kind'] {
  if (relPath.startsWith(`.pi${sep}skills${sep}`)) return 'skill'
  if (!relPath.includes(sep) && relPath.toLowerCase().endsWith('.md')) return 'canonical'
  return 'memory'
}

export function createAgentsSurface(): AgentRuntimeAdapter['agents'] {
  return {
    async list(): Promise<RuntimeAgent[]> {
      return readRegistry().agents.map(toRuntimeAgent)
    },

    async get(agentId: string): Promise<RuntimeAgent | null> {
      const record = readRegistry().agents.find((a) => a.id === agentId)
      return record ? toRuntimeAgent(record) : null
    },

    async create(input: CreateRuntimeAgentInput): Promise<RuntimeAgent> {
      const id = (input.id ?? input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')).slice(0, 64)
      assertValidAgentId(id)
      return mutateRegistry((registry) => {
        if (registry.agents.some((a) => a.id === id)) {
          throw new Error(`adapter-pi: agent already exists: ${id}`)
        }
        const now = new Date().toISOString()
        const record: PiAgentRecord = {
          id,
          name: input.name,
          role: input.role,
          model: input.model,
          createdAt: now,
          updatedAt: now,
          metadata: input.metadata as PiAgentRecord['metadata'],
        }
        registry.agents.push(record)
        scaffoldAgentDirs(id)
        return toRuntimeAgent(record)
      })
    },

    async update(agentId: string, input: UpdateRuntimeAgentInput): Promise<RuntimeAgent> {
      // Pi has no subagent concept — reject rather than silently store (the
      // routingSupport declaration tells UIs to hide the control).
      if (input.subagentModel !== undefined) {
        throw new Error('adapter-pi: per-agent subagent models are not supported by the pi runtime')
      }
      return mutateRegistry((registry) => {
        const record = registry.agents.find((a) => a.id === agentId)
        if (!record) throw new Error(`adapter-pi: unknown agent: ${agentId}`)
        if (input.name !== undefined) record.name = input.name
        if (input.role !== undefined) record.role = input.role
        // null clears the assignment → agent falls back to routing.defaultModel.
        if (input.model !== undefined) record.model = input.model ?? undefined
        if (input.metadata !== undefined) {
          record.metadata = { ...(record.metadata ?? {}), ...(input.metadata as Record<string, unknown>) }
        }
        record.updatedAt = new Date().toISOString()
        return toRuntimeAgent(record)
      })
    },

    async remove(agentId: string): Promise<void> {
      await mutateRegistry((registry) => {
        const before = registry.agents.length
        registry.agents = registry.agents.filter((a) => a.id !== agentId)
        if (registry.agents.length === before) {
          throw new Error(`adapter-pi: unknown agent: ${agentId}`)
        }
      })
      removeAgentDirs(agentId)
    },

    async listWorkspaceFiles(agentId: string): Promise<string[]> {
      assertValidAgentId(agentId)
      const root = getAgentWorkspaceDir(agentId)
      if (!existsSync(root)) return []
      const out: string[] = []
      walkFiles(root, root, out)
      return out.sort()
    },

    async readWorkspaceFile(agentId: string, path: string): Promise<WorkspaceFile | null> {
      const abs = workspaceFilePath(agentId, path)
      if (!existsSync(abs)) return null
      const stat = statSync(abs)
      return {
        path,
        content: readFileSync(abs, 'utf-8'),
        updatedAt: stat.mtime.toISOString(),
      }
    },

    async writeWorkspaceFile(agentId: string, file: WorkspaceFile): Promise<void> {
      const abs = workspaceFilePath(agentId, file.path)
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, file.content)
    },

    async removeWorkspaceFile(agentId: string, path: string): Promise<void> {
      const abs = workspaceFilePath(agentId, path)
      rmSync(abs, { force: true })
    },

    async workspaceFileStats(agentId: string): Promise<WorkspaceFileStat[] | null> {
      assertValidAgentId(agentId)
      const root = getAgentWorkspaceDir(agentId)
      if (!existsSync(root)) return null
      const names: string[] = []
      walkFiles(root, root, names)
      return names.sort().map((name) => {
        const stat = statSync(join(root, name))
        return { name, bytes: stat.size, mtimeMs: stat.mtimeMs, kind: classify(name) }
      })
    },

    async updatePermissions(agentId: string, patch: RuntimePermissionPatch): Promise<void> {
      await mutateRegistry((registry) => {
        const record = registry.agents.find((a) => a.id === agentId)
        if (!record) throw new Error(`adapter-pi: unknown agent: ${agentId}`)
        const current = record.permissions ?? { allow: [], deny: [] }
        const next = patch.replace ? { allow: [], deny: [] } : current
        for (const item of patch.allow ?? []) {
          if (!next.allow.includes(item)) next.allow.push(item)
          next.deny = next.deny.filter((d) => d !== item)
        }
        for (const item of patch.deny ?? []) {
          if (!next.deny.includes(item)) next.deny.push(item)
          next.allow = next.allow.filter((a) => a !== item)
        }
        record.permissions = next
        record.updatedAt = new Date().toISOString()
      })
    },

    async updateAllowlist(agentId: string, patch: RuntimeAllowlistPatch): Promise<void> {
      await mutateRegistry((registry) => {
        const record = registry.agents.find((a) => a.id === agentId)
        if (!record) throw new Error(`adapter-pi: unknown agent: ${agentId}`)
        if (patch.replace) {
          record.allowlist = [...patch.replace]
        } else {
          const set = new Set(record.allowlist ?? [])
          for (const item of patch.add ?? []) set.add(item)
          for (const item of patch.remove ?? []) set.delete(item)
          record.allowlist = [...set]
        }
        if (record.allowlist.length === 0) delete record.allowlist
        record.updatedAt = new Date().toISOString()
      })
    },
  }
}
