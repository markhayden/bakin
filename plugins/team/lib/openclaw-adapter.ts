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

// ─── Agent Creation ─────────────────────────────────────────────────────────

export interface NewAgentInput {
  id: string
  name: string
  emoji?: string
  model?: string   // full provider/model string, e.g. "anthropic/claude-sonnet-4-20250514"
  soul?: string    // initial SOUL.md content
}

/**
 * Add a new agent to openclaw.json and create its workspace directory.
 * Writes directly to OpenClaw — Bakin never copies OpenClaw.
 */
export function addAgent(input: NewAgentInput): void {
  const config = getOpenClawConfig()
  if (!config.agents) config.agents = {}
  if (!config.agents.list) config.agents.list = []

  // Check for duplicate
  if (config.agents.list.some((a) => a.id === input.id)) {
    throw new Error(`Agent "${input.id}" already exists in openclaw.json`)
  }

  const entry: OpenClawAgent = {
    id: input.id,
    identity: {
      name: input.name,
      emoji: input.emoji,
    },
  }
  if (input.model) {
    entry.model = { primary: input.model }
  }

  config.agents.list.push(entry)

  // Write updated config
  writeFileSync(OPENCLAW_JSON, JSON.stringify(config, null, 2), 'utf-8')
  resetOpenClawConfigCache() // bust cache
  log.info('Added agent to openclaw.json', { id: input.id, name: input.name })

  // Create workspace directory with initial files
  const wsPath = join(OPENCLAW_ROOT, 'workspaces', input.id)
  if (!existsSync(wsPath)) {
    mkdirSync(wsPath, { recursive: true })
  }
  if (input.soul) {
    writeFileSync(join(wsPath, 'SOUL.md'), input.soul, 'utf-8')
  }
  // Create empty IDENTITY.md with structured fields
  const identityContent = [
    `# ${input.name}`,
    '',
    `- **Emoji:** ${input.emoji ?? ''}`,
    `- **Vibe:** Agent`,
    '',
  ].join('\n')
  writeFileSync(join(wsPath, 'IDENTITY.md'), identityContent, 'utf-8')

  log.info('Created workspace', { id: input.id, path: wsPath })
}

/**
 * Remove an agent from openclaw.json and move workspace to trash.
 * Workspace is moved to ~/.openclaw/.trash/{id}__deleted-{timestamp}/
 * so it can be recovered if needed.
 */
export function removeAgent(agentId: string): boolean {
  const config = getOpenClawConfig()
  if (!config.agents?.list) return false

  const before = config.agents.list.length
  config.agents.list = config.agents.list.filter((a) => a.id !== agentId)
  if (config.agents.list.length === before) return false

  writeFileSync(OPENCLAW_JSON, JSON.stringify(config, null, 2), 'utf-8')
  resetOpenClawConfigCache()
  log.info('Removed agent from openclaw.json', { id: agentId })

  // Move workspace to trash
  const wsPath = join(OPENCLAW_ROOT, 'workspaces', agentId)
  if (existsSync(wsPath)) {
    const trashDir = join(OPENCLAW_ROOT, '.trash')
    if (!existsSync(trashDir)) mkdirSync(trashDir, { recursive: true })
    const trashName = `${agentId}__deleted-${Date.now()}`
    try {
      renameSync(wsPath, join(trashDir, trashName))
      log.info('Workspace moved to trash', { id: agentId, trashName })
    } catch (err) {
      log.warn('Failed to move workspace to trash', { id: agentId, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return true
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
