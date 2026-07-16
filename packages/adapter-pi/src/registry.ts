/**
 * Bakin agent registry for Pi — the multi-agent layer Pi itself doesn't have.
 *
 * One zod-validated JSON file (<pi-home>/agent/bakin-agents.json) plus
 * per-agent directories (workspace/ = session cwd, sessions/ = session
 * store). Writes are atomic (tmp+rename) and serialized through one queue.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { z } from 'zod'

import type { AdapterLogger } from '@bakin/core/adapters/runtime'
import {
  getAgentSessionsDir,
  getAgentWorkspaceDir,
  getPiAgentDir,
  getPiRegistryPath,
} from './home'

const AgentRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.string().optional(),
  model: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /**
   * Subagent dispatch allowlist — agent ids this agent may target
   * (contract: `agents.updateAllowlist`; OpenClaw parity is
   * `subagents.allowAgents`). Recorded state surfaced on the RuntimeAgent.
   * NEVER a tool filter — applying it to the exec-tool bridge once stripped
   * every bakin_exec_* tool from main after an agent-package install.
   */
  allowlist: z.array(z.string()).optional(),
  /** Retired permission record (the deleted updatePermissions wrote here); kept so existing registry files still parse. */
  permissions: z.object({ allow: z.array(z.string()), deny: z.array(z.string()) }).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

const RegistrySchema = z.object({
  version: z.literal(1),
  agents: z.array(AgentRecordSchema),
})

export type PiAgentRecord = z.infer<typeof AgentRecordSchema>
export type PiRegistry = z.infer<typeof RegistrySchema>

const AGENT_ID_RE = /^[a-z0-9][a-z0-9-_]{0,63}$/i

export function assertValidAgentId(id: string): void {
  // Registry ids become directory names — reject anything path-unsafe.
  if (!AGENT_ID_RE.test(id)) {
    throw new Error(`adapter-pi: invalid agent id "${id}" (alphanumeric, dash, underscore; max 64 chars)`)
  }
}

let writeQueue: Promise<unknown> = Promise.resolve()

function serialized<T>(fn: () => T): Promise<T> {
  const next = writeQueue.then(fn)
  writeQueue = next.catch(() => {})
  return next
}

export function readRegistry(_logger?: AdapterLogger): PiRegistry {
  const path = getPiRegistryPath()
  if (!existsSync(path)) return { version: 1, agents: [] }
  try {
    return RegistrySchema.parse(JSON.parse(readFileSync(path, 'utf-8')))
  } catch (err) {
    // A corrupt roster must fail loudly — silently starting empty would
    // orphan every agent workspace and re-seed 'main' on top of them.
    throw new Error(`adapter-pi: registry unreadable at ${path}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function writeRegistryAtomic(registry: PiRegistry): void {
  const path = getPiRegistryPath()
  mkdirSync(getPiAgentDir(), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(registry, null, 2))
  renameSync(tmp, path)
}

export function scaffoldAgentDirs(agentId: string): void {
  mkdirSync(getAgentWorkspaceDir(agentId), { recursive: true })
  mkdirSync(getAgentSessionsDir(agentId), { recursive: true })
}

/** Serialized read-modify-write over the registry file. */
export function mutateRegistry<T>(fn: (registry: PiRegistry) => T): Promise<T> {
  return serialized(() => {
    const registry = readRegistry()
    const result = fn(registry)
    writeRegistryAtomic(registry)
    return result
  })
}

export function removeAgentDirs(agentId: string): void {
  assertValidAgentId(agentId)
  const workspace = getAgentWorkspaceDir(agentId)
  const sessions = getAgentSessionsDir(agentId)
  rmSync(workspace, { recursive: true, force: true })
  rmSync(sessions, { recursive: true, force: true })
  // Remove the now-empty parent if both children are gone.
  const parent = workspace.replace(/\/workspace$/, '')
  rmSync(parent, { recursive: true, force: true })
}
