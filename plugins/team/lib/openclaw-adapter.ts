/**
 * OpenClaw adapter — reads/writes the OpenClaw filesystem.
 *
 * Bakin reads from OpenClaw. Bakin writes to OpenClaw. Bakin never copies OpenClaw.
 *
 * This module centralizes all access to ~/.openclaw/ for agent data:
 * - openclaw.json → agent roster, models, identity, subagent perms
 * - workspace/ → main agent (main-operator) workspace files
 * - workspaces/{id}/ → subagent workspace files
 * - agents/{id}/sessions/ → session JSONL for usage tracking
 */
import { readFileSync, readdirSync, writeFileSync, existsSync, statSync, mkdirSync, renameSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { createLogger } from '../../../src/core/logger'
import type { AgentMeta, AgentProfile, SkillSummary } from '../types'

const log = createLogger('team:openclaw')

// ─── Paths ───────────────────────────────────────────────────────────────────

const OPENCLAW_ROOT = join(homedir(), '.openclaw')
const OPENCLAW_JSON = join(OPENCLAW_ROOT, 'openclaw.json')

// ─── ID Mapping ──────────────────────────────────────────────────────────────

const BAKIN_TO_OPENCLAW: Record<string, string> = { main-operator: 'main' }
const OPENCLAW_TO_BAKIN: Record<string, string> = { main: 'main-operator' }

/** Convert a Bakin-facing ID to the OpenClaw internal ID */
export function toOpenClawId(bakinId: string): string {
  return BAKIN_TO_OPENCLAW[bakinId] ?? bakinId
}

/** Convert an OpenClaw internal ID to the Bakin-facing ID */
export function toBakinId(openclawId: string): string {
  return OPENCLAW_TO_BAKIN[openclawId] ?? openclawId
}

// ─── Config Reading ──────────────────────────────────────────────────────────

interface OpenClawAgent {
  id: string
  name?: string
  workspace?: string
  agentDir?: string
  model?: { primary?: string }
  identity?: { name?: string; emoji?: string }
  subagents?: { allowAgents?: string[]; model?: string }
}

interface OpenClawConfig {
  agents?: {
    defaults?: {
      model?: { primary?: string }
      workspace?: string
    }
    list?: OpenClawAgent[]
  }
}

let configCache: { data: OpenClawConfig; mtime: number } | null = null

/** Read and cache openclaw.json. Re-reads when file changes. */
export function getOpenClawConfig(): OpenClawConfig {
  try {
    const stat = statSync(OPENCLAW_JSON)
    if (configCache && configCache.mtime === stat.mtimeMs) {
      return configCache.data
    }
    const data = JSON.parse(readFileSync(OPENCLAW_JSON, 'utf-8')) as OpenClawConfig
    configCache = { data, mtime: stat.mtimeMs }
    return data
  } catch (err) {
    log.warn('Failed to read openclaw.json', { error: err instanceof Error ? err.message : String(err) })
    return {}
  }
}

// ─── Agent List ──────────────────────────────────────────────────────────────

/** List all agents as lightweight AgentMeta (for dropdowns, badges, etc.) */
export function listAgents(): AgentMeta[] {
  const config = getOpenClawConfig()
  const agents = config.agents?.list ?? []

  return agents.map((a) => {
    const id = toBakinId(a.id)
    const name = a.identity?.name ?? a.name ?? id
    const emoji = a.identity?.emoji ?? ''
    const role = resolveRole(id)
    return {
      id,
      name,
      emoji,
      role,
      headshot: `/api/plugins/team/${id}/avatar`,
    }
  })
}

/** Get IDs of all configured agents */
export function getAgentIds(): string[] {
  return listAgents().map((a) => a.id)
}

// ─── Workspace Resolution ────────────────────────────────────────────────────

/**
 * Resolve the workspace path for an agent.
 * Main agent uses ~/.openclaw/workspace/
 * Subagents use ~/.openclaw/workspaces/{id}/
 */
export function getWorkspacePath(bakinId: string): string {
  const config = getOpenClawConfig()
  const openclawId = toOpenClawId(bakinId)
  const agent = config.agents?.list?.find((a) => a.id === openclawId)

  // If agent has an explicit workspace path, use it
  if (agent?.workspace) return agent.workspace

  // Main agent default
  if (openclawId === 'main') {
    return config.agents?.defaults?.workspace ?? join(OPENCLAW_ROOT, 'workspace')
  }

  // Subagent default
  return join(OPENCLAW_ROOT, 'workspaces', openclawId)
}

// ─── Workspace File Operations ───────────────────────────────────────────────

const WORKSPACE_FILES = ['SOUL.md', 'IDENTITY.md', 'AGENTS.md', 'TOOLS.md', 'HEARTBEAT.md', 'USER.md', 'BOOTSTRAP.md'] as const

/** Read a workspace file for an agent. Returns null if missing. */
export function readWorkspaceFile(bakinId: string, filename: string): string | null {
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    log.warn('Blocked path traversal attempt', { agent: bakinId, filename })
    return null
  }
  const wsPath = getWorkspacePath(bakinId)
  const filePath = join(wsPath, filename)
  try {
    return readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
}

/** Write a workspace file for an agent. Creates if missing. */
export function writeWorkspaceFile(bakinId: string, filename: string, content: string): void {
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    throw new Error(`Invalid filename: "${filename}" — path traversal not allowed`)
  }
  const wsPath = getWorkspacePath(bakinId)
  const filePath = join(wsPath, filename)
  writeFileSync(filePath, content, 'utf-8')
  log.info('Wrote workspace file', { agent: bakinId, file: filename, bytes: content.length })
}

/** List all files in an agent's workspace root (not recursive). */
export function listWorkspaceFiles(bakinId: string): string[] {
  const wsPath = getWorkspacePath(bakinId)
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
export function listSkills(bakinId: string): SkillSummary[] {
  const wsPath = getWorkspacePath(bakinId)
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
export function readSkillFile(bakinId: string, skillId: string): string | null {
  const wsPath = getWorkspacePath(bakinId)
  const filePath = join(wsPath, 'skills', skillId, 'SKILL.md')
  try {
    return readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
}

// ─── Memory ──────────────────────────────────────────────────────────────────

/** List memory files (YYYY-MM-DD.md) for an agent, newest first */
export function listMemoryFiles(bakinId: string): string[] {
  const wsPath = getWorkspacePath(bakinId)
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
export function readMemoryFile(bakinId: string, filename: string): string | null {
  const wsPath = getWorkspacePath(bakinId)
  const filePath = join(wsPath, 'memory', filename)
  try {
    return readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
}

// ─── Full Profile ────────────────────────────────────────────────────────────

/** Get full agent profile by merging OpenClaw config + workspace files */
export function getAgentProfile(bakinId: string): AgentProfile | null {
  const config = getOpenClawConfig()
  const openclawId = toOpenClawId(bakinId)
  const agent = config.agents?.list?.find((a) => a.id === openclawId)
  if (!agent) return null

  const id = toBakinId(agent.id)
  const defaultModel = config.agents?.defaults?.model?.primary ?? 'unknown'
  const model = agent.model?.primary ?? defaultModel
  const name = agent.identity?.name ?? agent.name ?? id
  const emoji = agent.identity?.emoji ?? ''

  return {
    id,
    name,
    emoji,
    role: resolveRole(id),
    headshot: `/api/plugins/team/${id}/avatar`,
    model,
    workspacePath: getWorkspacePath(bakinId),
    soul: readWorkspaceFile(bakinId, 'SOUL.md'),
    identity: readWorkspaceFile(bakinId, 'IDENTITY.md'),
    rules: readWorkspaceFile(bakinId, 'AGENTS.md'),
    tools: readWorkspaceFile(bakinId, 'TOOLS.md'),
    heartbeatMd: readWorkspaceFile(bakinId, 'HEARTBEAT.md'),
    subagentPerms: agent.subagents?.allowAgents?.map(toBakinId) ?? null,
  }
}

// ─── Model Resolution ────────────────────────────────────────────────────────

/** Get the model assigned to an agent (stripped of provider prefix) */
export function getAgentModel(bakinId: string): string {
  const config = getOpenClawConfig()
  const openclawId = toOpenClawId(bakinId)
  const agent = config.agents?.list?.find((a) => a.id === openclawId)
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
  configCache = null // bust cache
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
export function removeAgent(bakinId: string): boolean {
  const config = getOpenClawConfig()
  if (!config.agents?.list) return false

  const openclawId = toOpenClawId(bakinId)
  const before = config.agents.list.length
  config.agents.list = config.agents.list.filter((a) => a.id !== openclawId)
  if (config.agents.list.length === before) return false

  writeFileSync(OPENCLAW_JSON, JSON.stringify(config, null, 2), 'utf-8')
  configCache = null
  log.info('Removed agent from openclaw.json', { id: bakinId })

  // Move workspace to trash
  const wsPath = join(OPENCLAW_ROOT, 'workspaces', openclawId)
  if (existsSync(wsPath)) {
    const trashDir = join(OPENCLAW_ROOT, '.trash')
    if (!existsSync(trashDir)) mkdirSync(trashDir, { recursive: true })
    const trashName = `${openclawId}__deleted-${Date.now()}`
    try {
      renameSync(wsPath, join(trashDir, trashName))
      log.info('Workspace moved to trash', { id: bakinId, trashName })
    } catch (err) {
      log.warn('Failed to move workspace to trash', { id: bakinId, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return true
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Resolve agent role from IDENTITY.md or SOUL.md content.
 * Falls back to a generic role derived from position in the roster.
 */
function resolveRole(bakinId: string): string {
  // Try IDENTITY.md first (has structured fields)
  const identity = readWorkspaceFile(bakinId, 'IDENTITY.md')
  if (identity) {
    // Parse simple key: value or YAML frontmatter
    const vibeMatch = identity.match(/^[-*]\s*\*?Vibe\*?:\s*(.+)/mi)
    if (vibeMatch) return vibeMatch[1].trim()
  }

  // Try SOUL.md — look for a role-like first line
  const soul = readWorkspaceFile(bakinId, 'SOUL.md')
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

  // Fallback based on position
  const config = getOpenClawConfig()
  const openclawId = toOpenClawId(bakinId)
  const agent = config.agents?.list?.find((a) => a.id === openclawId)
  if (agent?.id === 'main') return 'Orchestrator'

  return 'Agent'
}
