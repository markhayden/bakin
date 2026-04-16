/**
 * OpenClaw adapter — reads/writes the OpenClaw filesystem.
 *
 * Bakin reads from OpenClaw. Bakin writes to OpenClaw. Bakin never copies OpenClaw.
 *
 * This module centralizes all access to ~/.openclaw/ for agent data:
 * - openclaw.json → agent roster, models, identity, subagent perms
 * - workspace/ → main agent workspace files (id resolved via getMainAgentId)
 * - workspaces/{id}/ → subagent workspace files
 * - agents/{id}/sessions/ → session JSONL for usage tracking
 *
 * Agent ids flow through unchanged — Bakin uses the same canonical ids as
 * OpenClaw. Display names are resolved from `identity.name` at render time.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync, statSync, mkdirSync, renameSync } from 'fs'
import { join } from 'path'
import { createLogger } from '../../../src/core/logger'
import { getSettings } from '../../../src/core/settings'
import { getOpenClawHome, getOpenClawPath } from '@bakin/core/openclaw-home'
import { tryGetMainAgentId } from '@bakin/core/main-agent'
import {
  readOpenClawConfig,
  resetOpenClawConfigCache,
  type OpenClawAgent,
  type OpenClawConfig,
} from '@bakin/core/openclaw-config'
import type { AgentMeta, AgentProfile, SkillSummary } from '../types'

const log = createLogger('team:openclaw')

// ─── Paths ───────────────────────────────────────────────────────────────────

const OPENCLAW_ROOT = getOpenClawHome()
const OPENCLAW_JSON = getOpenClawPath('openclaw.json')

// ─── Config Reading ──────────────────────────────────────────────────────────

/**
 * Read openclaw.json. Thin adapter over the centralized reader in
 * `@bakin/core/openclaw-config` — returns `{}` on failure for historical
 * compatibility with call sites that expect a non-null object.
 */
export function getOpenClawConfig(): OpenClawConfig {
  return readOpenClawConfig() ?? {}
}

// ─── Agent List ──────────────────────────────────────────────────────────────

/**
 * List all agents as lightweight AgentMeta (for dropdowns, badges, etc.).
 *
 * This is a validation pass over `openclaw.json`, not a passthrough:
 *   - Rejects duplicate agent ids (first occurrence wins).
 *   - Rejects duplicate resolved workspaces — an agent's explicit
 *     `workspace` or the inherited `agents.defaults.workspace`. When two
 *     entries land on the same directory we keep the first and drop the
 *     rest so the UI doesn't render ghost cards pointing at shared files.
 *   - Requires a canonical `main` agent. If the roster has no `id: "main"`
 *     we return an empty list so the UI surfaces the broken config instead
 *     of silently hiding the orchestrator.
 *
 * All three violations log at `error` level — these are config bugs.
 */
export function listAgents(): AgentMeta[] {
  const config = getOpenClawConfig()
  const raw = config.agents?.list ?? []
  const defaultWorkspace = config.agents?.defaults?.workspace ?? null

  const seenIds = new Set<string>()
  const workspaceToFirstId = new Map<string, string>()
  const accepted: AgentMeta[] = []

  for (const agent of raw) {
    if (seenIds.has(agent.id)) {
      log.error(`openclaw.json contains duplicate agent id "${agent.id}" — dropping the later entry. See \`bakin check openclaw\`.`)
      continue
    }

    const resolvedWorkspace = agent.workspace ?? defaultWorkspace
    if (resolvedWorkspace !== null) {
      const owner = workspaceToFirstId.get(resolvedWorkspace)
      if (owner !== undefined) {
        log.error(`openclaw.json agent "${agent.id}" resolves to workspace "${resolvedWorkspace}" already claimed by "${owner}" — dropping "${agent.id}". See \`bakin check openclaw\`.`)
        continue
      }
    }

    seenIds.add(agent.id)
    if (resolvedWorkspace !== null) {
      workspaceToFirstId.set(resolvedWorkspace, agent.id)
    }

    const name = agent.identity?.name ?? agent.name ?? agent.id
    const emoji = agent.identity?.emoji ?? ''
    const role = resolveRole(agent.id)
    accepted.push({
      id: agent.id,
      name,
      emoji,
      role,
      headshot: `/api/plugins/team/${agent.id}/avatar`,
    })
  }

  if (!seenIds.has('main')) {
    const seen = Array.from(seenIds)
    log.error(`openclaw.json must contain an agent with id "main" — got ids: [${seen.join(', ')}]. See \`bakin check openclaw\`.`)
    return []
  }

  return accepted
}

/** Get IDs of all configured agents */
export function getAgentIds(): string[] {
  return listAgents().map((a) => a.id)
}

// ─── Workspace Resolution ────────────────────────────────────────────────────

/**
 * Resolve the workspace path for an agent.
 * Main agent (resolved via tryGetMainAgentId) uses ~/.openclaw/workspace/
 * Subagents use ~/.openclaw/workspaces/{id}/
 */
export function getWorkspacePath(agentId: string): string {
  const config = getOpenClawConfig()
  const agent = config.agents?.list?.find((a) => a.id === agentId)

  // If agent has an explicit workspace path, use it
  if (agent?.workspace) return agent.workspace

  // Main agent default — resolve orchestrator id dynamically
  if (agentId === tryGetMainAgentId()) {
    return config.agents?.defaults?.workspace ?? join(OPENCLAW_ROOT, 'workspace')
  }

  // Subagent default
  return join(OPENCLAW_ROOT, 'workspaces', agentId)
}

// ─── Workspace File Operations ───────────────────────────────────────────────

const WORKSPACE_FILES = ['SOUL.md', 'IDENTITY.md', 'AGENTS.md', 'TOOLS.md', 'HEARTBEAT.md', 'USER.md', 'BOOTSTRAP.md'] as const

/** Read a workspace file for an agent. Returns null if missing. */
export function readWorkspaceFile(agentId: string, filename: string): string | null {
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    log.warn('Blocked path traversal attempt', { agent: agentId, filename })
    return null
  }
  const wsPath = getWorkspacePath(agentId)
  const filePath = join(wsPath, filename)
  try {
    return readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
}

/** Write a workspace file for an agent. Creates if missing. */
export function writeWorkspaceFile(agentId: string, filename: string, content: string): void {
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    throw new Error(`Invalid filename: "${filename}" — path traversal not allowed`)
  }
  const wsPath = getWorkspacePath(agentId)
  const filePath = join(wsPath, filename)
  writeFileSync(filePath, content, 'utf-8')
  log.info('Wrote workspace file', { agent: agentId, file: filename, bytes: content.length })
}

/** List all files in an agent's workspace root (not recursive). */
export function listWorkspaceFiles(agentId: string): string[] {
  const wsPath = getWorkspacePath(agentId)
  try {
    return readdirSync(wsPath)
      .filter((f) => {
        const fullPath = join(wsPath, f)
        try {
          return statSync(fullPath).isFile()
        } catch {
          return false
        }
      })
      .sort()
  } catch {
    return []
  }
}

// ─── Skills ──────────────────────────────────────────────────────────────────

/** List installed skills for an agent */
export function listSkills(agentId: string): SkillSummary[] {
  const wsPath = getWorkspacePath(agentId)
  const skillsDir = join(wsPath, 'skills')
  try {
    return readdirSync(skillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => ({
        id: d.name,
        name: d.name,
        hasSkillMd: existsSync(join(skillsDir, d.name, 'SKILL.md')),
      }))
  } catch {
    return []
  }
}

/** Read the SKILL.md for a specific skill */
export function readSkillFile(agentId: string, skillId: string): string | null {
  const wsPath = getWorkspacePath(agentId)
  const filePath = join(wsPath, 'skills', skillId, 'SKILL.md')
  try {
    return readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
}

// ─── Memory ──────────────────────────────────────────────────────────────────

/** List memory files (YYYY-MM-DD.md) for an agent, newest first */
export function listMemoryFiles(agentId: string): string[] {
  const wsPath = getWorkspacePath(agentId)
  const memoryDir = join(wsPath, 'memory')
  try {
    return readdirSync(memoryDir)
      .filter((f) => f.endsWith('.md'))
      .sort()
      .reverse()
  } catch {
    return []
  }
}

/** Read a specific memory file */
export function readMemoryFile(agentId: string, filename: string): string | null {
  const wsPath = getWorkspacePath(agentId)
  const filePath = join(wsPath, 'memory', filename)
  try {
    return readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
}

// ─── Full Profile ────────────────────────────────────────────────────────────

/** Get full agent profile by merging OpenClaw config + workspace files */
export function getAgentProfile(agentId: string): AgentProfile | null {
  const config = getOpenClawConfig()
  const agent = config.agents?.list?.find((a) => a.id === agentId)
  if (!agent) return null

  const defaultModel = config.agents?.defaults?.model?.primary ?? 'unknown'
  const model = agent.model?.primary ?? defaultModel
  const name = agent.identity?.name ?? agent.name ?? agent.id
  const emoji = agent.identity?.emoji ?? ''

  return {
    id: agent.id,
    name,
    emoji,
    role: resolveRole(agent.id),
    headshot: `/api/plugins/team/${agent.id}/avatar`,
    model,
    workspacePath: getWorkspacePath(agent.id),
    soul: readWorkspaceFile(agent.id, 'SOUL.md'),
    identity: readWorkspaceFile(agent.id, 'IDENTITY.md'),
    rules: readWorkspaceFile(agent.id, 'AGENTS.md'),
    tools: readWorkspaceFile(agent.id, 'TOOLS.md'),
    heartbeatMd: readWorkspaceFile(agent.id, 'HEARTBEAT.md'),
    subagentPerms: agent.subagents?.allowAgents ?? null,
  }
}

// ─── Model Resolution ────────────────────────────────────────────────────────

/** Get the model assigned to an agent (stripped of provider prefix) */
export function getAgentModel(agentId: string): string {
  const config = getOpenClawConfig()
  const agent = config.agents?.list?.find((a) => a.id === agentId)
  const defaultModel = config.agents?.defaults?.model?.primary ?? 'unknown'
  const raw = agent?.model?.primary ?? defaultModel
  return raw
}

// ─── OpenClaw CLI Helper ────────────────────────────────────────────────────

/**
 * Shell out to the `openclaw` CLI. Uses `settings.openclaw.binaryPath`.
 * Returns stdout on success, throws on non-zero exit with stderr.
 */
export async function openclawExec(args: string[]): Promise<string> {
  const { execFile } = await import('child_process')
  const { promisify } = await import('util')
  const execFileAsync = promisify(execFile)
  const settings = getSettings()

  const { stdout } = await execFileAsync(settings.openclaw.binaryPath, args)
  return stdout
}

// ─── IDENTITY.md Synthesis ──────────────────────────────────────────────────

export interface IdentityFields {
  name?: string
  emoji?: string
  role?: string
  vibe?: string
  primaryFunction?: string
  defaultMode?: string
}

/**
 * Build IDENTITY.md content from structured fields.
 * Only non-empty fields are included.
 */
export function synthesizeIdentityMd(fields: IdentityFields): string {
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

// ─── Agent Creation ─────────────────────────────────────────────────────────

export interface CreateAgentInput {
  id: string
  name: string
  emoji?: string
  role?: string
  vibe?: string
  primaryFunction?: string
  defaultMode?: string
  model?: string
  soul?: string
  tools?: string
}

/**
 * Add a new agent via the OpenClaw CLI and write persona files.
 * Shells out to `openclaw agents add` + `openclaw agents set-identity`.
 */
export async function addAgent(input: CreateAgentInput): Promise<{ id: string; workspace: string }> {
  const config = getOpenClawConfig()
  if (config.agents?.list?.some((a) => a.id === input.id)) {
    throw new Error(`Agent "${input.id}" already exists in openclaw.json`)
  }

  const wsPath = join(OPENCLAW_ROOT, 'workspaces', input.id)

  // Register agent in OpenClaw via CLI
  const addArgs = ['agents', 'add', input.id, '--workspace', wsPath, '--non-interactive', '--json']
  if (input.model) addArgs.splice(3, 0, '--model', input.model)
  await openclawExec(addArgs)

  // Set identity (name + emoji) via CLI
  const identityArgs = ['agents', 'set-identity', '--agent', input.id]
  if (input.name) identityArgs.push('--name', input.name)
  if (input.emoji) identityArgs.push('--emoji', input.emoji)
  if (identityArgs.length > 4) {
    await openclawExec(identityArgs)
  }

  resetOpenClawConfigCache()

  // Write persona files to the workspace
  if (!existsSync(wsPath)) mkdirSync(wsPath, { recursive: true })

  const identityMd = synthesizeIdentityMd({
    name: input.name,
    emoji: input.emoji,
    role: input.role,
    vibe: input.vibe,
    primaryFunction: input.primaryFunction,
    defaultMode: input.defaultMode,
  })
  writeFileSync(join(wsPath, 'IDENTITY.md'), identityMd, 'utf-8')

  if (input.soul) {
    writeFileSync(join(wsPath, 'SOUL.md'), input.soul, 'utf-8')
  }
  if (input.tools) {
    writeFileSync(join(wsPath, 'TOOLS.md'), input.tools, 'utf-8')
  }

  log.info('Created agent via CLI', { id: input.id, name: input.name, workspace: wsPath })
  return { id: input.id, workspace: wsPath }
}

/**
 * Remove an agent via the OpenClaw CLI.
 * The CLI handles workspace-to-trash move natively.
 */
export async function removeAgent(agentId: string): Promise<boolean> {
  const config = getOpenClawConfig()
  if (!config.agents?.list?.some((a) => a.id === agentId)) return false

  try {
    await openclawExec(['agents', 'delete', agentId, '--force', '--json'])
  } catch (err) {
    log.error('Failed to delete agent via CLI', { id: agentId, error: err instanceof Error ? err.message : String(err) })
    return false
  }

  resetOpenClawConfigCache()
  log.info('Removed agent via CLI', { id: agentId })
  return true
}

// ─── Subagent Allow List Management ─────────────────────────────────────────

/**
 * Remove an agent from ALL agents' subagents.allowAgents lists.
 * Called on agent deletion to clean up stale references.
 */
export function removeFromAllowLists(agentId: string): void {
  const config = getOpenClawConfig()
  if (!config.agents?.list) return

  let modified = false
  for (const agent of config.agents.list) {
    const allow = agent.subagents?.allowAgents
    if (!allow) continue
    const idx = allow.indexOf(agentId)
    if (idx !== -1) {
      allow.splice(idx, 1)
      modified = true
    }
  }

  if (modified) {
    writeFileSync(OPENCLAW_JSON, JSON.stringify(config, null, 2), 'utf-8')
    resetOpenClawConfigCache()
    log.info('Removed agent from allow lists', { agentId })
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Resolve agent role from IDENTITY.md or SOUL.md content.
 * Falls back to a generic role derived from position in the roster.
 */
function resolveRole(agentId: string): string {
  // Try IDENTITY.md first (has structured fields)
  const identity = readWorkspaceFile(agentId, 'IDENTITY.md')
  if (identity) {
    // Parse simple key: value or YAML frontmatter
    const vibeMatch = identity.match(/^[-*]\s*\*?Vibe\*?:\s*(.+)/mi)
    if (vibeMatch) return vibeMatch[1].trim()
  }

  // Try SOUL.md — look for a role-like first line
  const soul = readWorkspaceFile(agentId, 'SOUL.md')
  if (soul) {
    const firstLine = soul.split('\n').find((l) => l.startsWith('You are ') || l.startsWith('# '))
    if (firstLine) {
      // "You are Pixel — the image artist." → "Image Artist"
      const dashPart = firstLine.split('—')[1] || firstLine.split('-')[1]
      if (dashPart) {
        const role = dashPart.replace(/\.\s*$/, '').trim()
        if (role.length > 0 && role.length < 60) return role
      }
    }
  }

  // Main agent fallback
  if (agentId === tryGetMainAgentId()) return 'Orchestrator'
  return 'Agent'
}
