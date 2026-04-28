/**
 * Team plugin — server entry point.
 *
 * Adapter layer over OpenClaw agent workspaces. Registers REST routes,
 * cross-plugin hooks, and MCP exec tools for agent management.
 *
 * Bakin reads from OpenClaw. Bakin writes to OpenClaw. Bakin never copies OpenClaw.
 */
import { z } from 'zod'
import {
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'fs'
import { basename, dirname, join, relative } from 'path'
import type { BakinPlugin, PluginContext } from '../../src/lib/plugin-types'
import { createLogger } from '../../src/core/logger'
import { readHeartbeats } from '../../src/lib/content'
import { getContentDir, getBakinPaths } from '../../packages/core/src/content-dir'
import { startAgent, stopAgent } from '../../src/lib/agents'
import { resetSettingsCache } from '../../src/core/settings'
import { syncConfig as syncMcporter } from '../../src/core/mcporter'
import { sendMessageToAgent } from '../../src/core/agents'
import { restartRuntime } from '../../src/core/runtime-registry'
import { getAllAgentUsage } from '../../src/core/agent-usage'
import { getStatsByMs } from '../../src/core/usage'
import { getRuntimeMainAgentId, type AgentRuntimeAdapter, type RuntimeAgent } from '@bakin/core/adapters/runtime'
import { readLatestSessionTranscript } from './lib/session-reader'
import { checkAgentRoster, checkPersonas, checkAgentAssets } from './lib/health-checks'
import type {
  AgentMeta,
  AgentProfile,
  AgentWithStatus,
  AgentDisplaySettingsMap,
  HeartbeatData,
  HeartbeatRaw,
  OrgTeam,
  SkillSummary,
  TeamPluginSettings,
} from './types'

const log = createLogger('team')
const BAKIN_PORT = Number(process.env.PORT || 3737)
const DEFAULT_STALE_THRESHOLD_MS = 15 * 60 * 1000

// ─── Display Settings (Bakin-owned) ──────────────────────────────────────────

const DEFAULT_COLORS: Record<string, string> = {
  main: '#60a5fa',
  basil: '#4ade80',
  pixel: '#a78bfa',
  rolo: '#fb923c',
  patch: '#a1a1aa',
  scout: '#34d399',
  nemo: '#22d3ee',
  zen: '#fbbf24',
}

function getSettingsPath(): string {
  return join(getContentDir(), 'plugin-settings', 'team.json')
}

function readPluginSettings(): TeamPluginSettings {
  const path = getSettingsPath()
  try {
    if (existsSync(path)) {
      const raw = JSON.parse(readFileSync(path, 'utf-8'))
      // Migrate: old format was just AgentDisplaySettingsMap at root
      if (raw && !raw.displaySettings && !raw.teams) {
        return { displaySettings: raw as AgentDisplaySettingsMap, teams: [] }
      }
      return {
        displaySettings: raw.displaySettings ?? {},
        teams: raw.teams ?? [],
      }
    }
  } catch { /* ignore */ }
  return { displaySettings: {}, teams: [] }
}

function writePluginSettings(settings: TeamPluginSettings): void {
  const path = getSettingsPath()
  const dir = join(getContentDir(), 'plugin-settings')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(path, JSON.stringify(settings, null, 2))
}

function readDisplaySettings(): AgentDisplaySettingsMap {
  return readPluginSettings().displaySettings
}

function writeDisplaySettings(settings: AgentDisplaySettingsMap): void {
  const current = readPluginSettings()
  writePluginSettings({ ...current, displaySettings: settings })
}

function readTeams(): OrgTeam[] {
  return readPluginSettings().teams
}

function writeTeams(teams: OrgTeam[]): void {
  const current = readPluginSettings()
  writePluginSettings({ ...current, teams })
}

/**
 * Normalize a `reportsTo` value for persistence in team.json.
 *
 * Stores `null` when the incoming value is undefined/null or equals the
 * current main agent id. This decouples team.json from the specific
 * orchestrator name so installs sharing the file don't get pinned to
 * "main" (or whatever id the local main agent happens to use).
 */
function normalizeReportsTo(value: unknown, mainAgentId: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') return null
  if (value === mainAgentId) return null
  return value
}

/**
 * Degrade teams whose `reportsTo` points at an agent that no longer
 * exists in the roster. The render-time resolver treats `null` as
 * "report to main", so this keeps legacy team.json files rendering
 * cleanly after a rename or removal. Read-only — never rewrites the
 * file from the read path.
 */
function degradeUnknownReportsTo(teams: OrgTeam[], knownIds: Set<string>): OrgTeam[] {
  return teams.map((team) => {
    const reportsTo = team.reportsTo
    if (typeof reportsTo === 'string' && !knownIds.has(reportsTo)) {
      log.warn('team.json has a team reporting to unknown agent id — treating as null', {
        teamId: team.id,
        reportsTo,
      })
      return { ...team, reportsTo: null }
    }
    return team
  })
}

async function mergeDisplayDefaults(runtime: AgentRuntimeAdapter, overrides: AgentDisplaySettingsMap): Promise<AgentDisplaySettingsMap> {
  const result: AgentDisplaySettingsMap = {}
  const ids = (await runtime.agents.list()).map((agent) => agent.id)
  for (const id of ids) {
    result[id] = {
      ...overrides[id],
      accentColor: overrides[id]?.accentColor ?? DEFAULT_COLORS[id] ?? '#a1a1aa',
    }
  }
  return result
}

interface IdentityFields {
  name?: string
  emoji?: string
  role?: string
  vibe?: string
  primaryFunction?: string
  defaultMode?: string
}

interface CreateAgentInput extends IdentityFields {
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

function agentToMeta(agent: RuntimeAgent): AgentMeta {
  return {
    id: agent.id,
    name: agent.name || agent.id,
    emoji: metadataString(agent, 'emoji') ?? '',
    role: agent.role ?? metadataString(agent, 'role') ?? '',
    headshot: `/api/plugins/team/${agent.id}/avatar`,
  }
}

async function listRuntimeAgentMetas(runtime: AgentRuntimeAdapter): Promise<AgentMeta[]> {
  return (await runtime.agents.list()).map(agentToMeta)
}

async function getRuntimeAgentIds(runtime: AgentRuntimeAdapter): Promise<string[]> {
  return (await runtime.agents.list()).map((agent) => agent.id)
}

async function getRuntimeAgentModel(runtime: AgentRuntimeAdapter, agent: RuntimeAgent): Promise<string> {
  if (agent.model) return agent.model
  const config = await runtime.config.get<{
    agents?: { defaults?: { model?: { primary?: string } } }
  }>()
  return config.agents?.defaults?.model?.primary ?? 'unknown'
}

async function readRuntimeWorkspaceText(
  runtime: AgentRuntimeAdapter,
  agentId: string,
  path: string,
): Promise<string | null> {
  return (await runtime.agents.readWorkspaceFile(agentId, path))?.content ?? null
}

async function getRuntimeAgentProfile(runtime: AgentRuntimeAdapter, agentId: string): Promise<AgentProfile | null> {
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

async function createRuntimeAgent(
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

async function addToRuntimeAllowlists(
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

async function removeFromRuntimeAllowlists(runtime: AgentRuntimeAdapter, agentId: string): Promise<void> {
  const agents = await runtime.agents.list()
  await Promise.all(agents.map((agent) => runtime.agents.updateAllowlist(agent.id, { remove: [agentId] })))
}

async function removeRuntimeAgent(runtime: AgentRuntimeAdapter, agentId: string): Promise<boolean> {
  if (!(await runtime.agents.get(agentId))) return false
  await runtime.agents.remove(agentId)
  return true
}

async function updateRuntimeAgentIdentity(
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

async function setRuntimeSubagentPermissions(
  runtime: AgentRuntimeAdapter,
  agentId: string,
  allowAgents: string[],
): Promise<void> {
  if (allowAgents.includes(agentId)) {
    throw new Error(`Agent "${agentId}" cannot dispatch to itself`)
  }
  await runtime.agents.updateAllowlist(agentId, { replace: allowAgents })
}

async function listRuntimeSkills(runtime: AgentRuntimeAdapter, agentId: string): Promise<SkillSummary[]> {
  return (await runtime.skills.list(agentId)).map((skill) => ({
    id: skill.name,
    name: skill.name,
    hasSkillMd: typeof skill.metadata?.hasSkillMd === 'boolean'
      ? skill.metadata.hasSkillMd
      : Boolean(skill.instructions || skill.path),
  }))
}

async function readRuntimeSkillFile(runtime: AgentRuntimeAdapter, agentId: string, skillId: string): Promise<string | null> {
  return (await runtime.skills.get(skillId, agentId))?.instructions ?? null
}

async function listRuntimeMemoryFiles(runtime: AgentRuntimeAdapter, agentId: string): Promise<string[]> {
  return (await runtime.memory.listEntries('workspace-memory', { agentId }))
    .map((entry) => basename(entry.path ?? entry.id))
    .sort()
    .reverse()
}

async function readRuntimeMemoryFile(runtime: AgentRuntimeAdapter, agentId: string, date: string): Promise<string | null> {
  const entry = await runtime.memory.getEntry('workspace-memory', date, { agentId })
  if (entry) return entry.content
  return readRuntimeWorkspaceText(runtime, agentId, `memory/${date}`)
}

async function readRuntimeHeartbeatRaw(runtime: AgentRuntimeAdapter, agentId: string): Promise<HeartbeatRaw | null> {
  const heartbeat = await runtime.agents.readWorkspaceFile(agentId, 'HEARTBEAT.md')
  return heartbeat ? { content: heartbeat.content, lastUpdated: heartbeat.updatedAt ?? null } : null
}

// ─── Status Resolution ───────────────────────────────────────────────────────

let staleSettingsCtx: PluginContext | null = null

function getStaleThresholdMs(): number {
  if (staleSettingsCtx) {
    const settings = staleSettingsCtx.getSettings<{ staleThresholdMinutes?: number }>()
    if (settings.staleThresholdMinutes && settings.staleThresholdMinutes > 0) {
      return settings.staleThresholdMinutes * 60 * 1000
    }
  }
  return DEFAULT_STALE_THRESHOLD_MS
}

/**
 * Read the tail of audit.jsonl and return the most recent timestamp per agent.
 * Only scans the last ~64KB to stay fast on large files.
 */
function getLastAuditActivity(): Record<string, number> {
  const auditPath = join(getContentDir(), 'audit.jsonl')
  const result: Record<string, number> = {}
  try {
    if (!existsSync(auditPath)) return result
    const fd = openSync(auditPath, 'r')
    const stat = fstatSync(fd)
    const TAIL_BYTES = 64 * 1024
    const start = Math.max(0, stat.size - TAIL_BYTES)
    const buf = Buffer.alloc(Math.min(TAIL_BYTES, stat.size))
    readSync(fd, buf, 0, buf.length, start)
    closeSync(fd)

    const text = buf.toString('utf-8')
    // If we started mid-line, skip the first partial line
    const lines = text.split('\n')
    if (start > 0) lines.shift()

    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const entry = JSON.parse(line) as { ts?: string; agent?: string }
        if (entry.ts && entry.agent) {
          const t = new Date(entry.ts).getTime()
          if (!isNaN(t) && (!result[entry.agent] || t > result[entry.agent])) {
            result[entry.agent] = t
          }
        }
      } catch { /* skip malformed lines */ }
    }
  } catch (err) {
    log.warn('Failed to read audit.jsonl for activity detection', { error: err instanceof Error ? err.message : String(err) })
  }
  return result
}

function resolveAgentStatus(
  bakinId: string,
  heartbeats: Record<string, unknown>,
  lastAuditActivity: Record<string, number>,
): {
  status: 'online' | 'working' | 'available' | 'offline'
  heartbeat: HeartbeatData | null
  heartbeatAge: number | null
} {
  const now = Date.now()
  const threshold = getStaleThresholdMs()

  // ── Heartbeat signal ──
  const hb = heartbeats[bakinId] as Record<string, unknown> | undefined
  const hbTs = (hb?.timestamp ?? hb?.ts) as string | undefined
  const hbTime = hbTs ? new Date(hbTs).getTime() : 0
  const hbAge = hbTs ? now - hbTime : null

  const heartbeat: HeartbeatData | null = hbTs
    ? { timestamp: hbTs, status: (hb!.status as string) ?? 'unknown', currentTask: hb!.currentTask as string | undefined }
    : null

  // ── Audit activity signal (fallback) ──
  const auditTime = lastAuditActivity[bakinId] ?? 0

  // Use whichever is more recent
  const lastSeen = Math.max(hbTime, auditTime)
  if (lastSeen === 0) {
    return { status: 'offline', heartbeat: null, heartbeatAge: null }
  }

  const age = now - lastSeen
  const effectiveAge = hbAge !== null ? Math.min(hbAge, age) : age

  if (age > threshold) {
    return { status: 'offline', heartbeat, heartbeatAge: effectiveAge }
  }

  // Within threshold — determine working vs online
  if (hb?.status === 'working' || hb?.currentTask) {
    return { status: 'working', heartbeat, heartbeatAge: effectiveAge }
  }

  // Has recent audit activity but no "working" heartbeat — mark as online
  return { status: 'online', heartbeat, heartbeatAge: effectiveAge }
}

// ─── Org Helpers ────────────────────────────────────────────────────────────

/** Get agent IDs that belong to a given team */
async function getTeamMembers(runtime: AgentRuntimeAdapter, teamId: string): Promise<string[]> {
  const ds = await mergeDisplayDefaults(runtime, readDisplaySettings())
  return Object.entries(ds)
    .filter(([, s]) => s.teamId === teamId)
    .map(([id]) => id)
}

/** Get the full org structure: teams with their members */
async function getOrgStructure(runtime: AgentRuntimeAdapter) {
  const teams = readTeams()
  const ds = await mergeDisplayDefaults(runtime, readDisplaySettings())
  const agents = await listRuntimeAgentMetas(runtime)
  const agentMap = new Map(agents.map((a) => [a.id, a]))

  return teams.map((team) => {
    const memberIds = Object.entries(ds)
      .filter(([, s]) => s.teamId === team.id)
      .map(([id]) => id)
    return {
      ...team,
      members: memberIds.map((id) => ({
        id,
        name: agentMap.get(id)?.name ?? id,
      })),
    }
  })
}

/** Module-level hook for batch-indexing agents — set during activate() */
let batchIndexAgents: () => Promise<void> = async () => {}

// ─── Agent-knowledge indexing helpers ────────────────────────────────────────

/**
 * Decompose a packages/agents/<dir>@<version>/knowledge/<lesson>.md path
 * into the parts needed to build a search id + doc. Returns null on a
 * non-conforming path (the watcher passes us anything that matches the
 * glob; we trust the glob for happy-path inputs but defensively handle
 * the edge cases).
 */
interface KnowledgeFileParts {
  packageId: string
  version: string
  lessonId: string
  agentId: string
}

function parseKnowledgeFilePath(rel: string): KnowledgeFileParts | null {
  // rel example: 'packages/agents/pixel@0.1.0/knowledge/style.md'
  const segments = rel.split('/')
  if (segments.length < 5) return null
  if (segments[0] !== 'packages' || segments[1] !== 'agents') return null
  if (segments[3] !== 'knowledge') return null
  const dirName = segments[2]
  const lessonFile = segments[4]
  if (!lessonFile.endsWith('.md')) return null
  const at = dirName.lastIndexOf('@')
  if (at === -1) return null
  const packageId = dirName.slice(0, at)
  const version = dirName.slice(at + 1)
  const lessonId = lessonFile.replace(/\.md$/i, '')
  // For kind:"agent" packages the package id IS the agent id; this matches
  // the projection convention in src/core/agent-packages/projector.ts.
  return { packageId, version, agentId: packageId, lessonId }
}

function agentKnowledgeFileToId(rel: string): string {
  const parts = parseKnowledgeFilePath(rel)
  if (!parts) return rel.replace(/[^a-zA-Z0-9_]+/g, '_')
  return `${parts.packageId}@${parts.version}/${parts.lessonId}`
}

function agentKnowledgeKeyToFilePath(key: string): string | null {
  const slash = key.indexOf('/')
  if (slash === -1) return null
  const dirPart = key.slice(0, slash)
  const lesson = key.slice(slash + 1)
  return join(getContentDir(), 'packages', 'agents', dirPart, 'knowledge', `${lesson}.md`)
}

interface KnowledgeDoc extends Record<string, unknown> {
  title: string
  body: string
  package_id: string
  agent_id: string
  lesson_id: string
  tags: string[]
  default_enabled: 'true' | 'false'
  updated_at: string
}

function parseKnowledgeFrontmatter(raw: string): {
  title: string
  body: string
  tags: string[]
  defaultEnabled: boolean
} {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) return { title: '', body: raw.trim(), tags: [], defaultEnabled: false }
  const body = match[2].trim()
  let title = ''
  let defaultEnabled = false
  let tags: string[] = []
  for (const line of match[1].split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('title:')) {
      title = trimmed.slice('title:'.length).trim().replace(/^['"]|['"]$/g, '')
    } else if (trimmed.startsWith('defaultEnabled:')) {
      defaultEnabled = trimmed.slice('defaultEnabled:'.length).trim() === 'true'
    } else if (trimmed.startsWith('tags:')) {
      const rest = trimmed.slice('tags:'.length).trim()
      if (rest.startsWith('[') && rest.endsWith(']')) {
        tags = rest
          .slice(1, -1)
          .split(',')
          .map((t) => t.trim().replace(/^['"]|['"]$/g, ''))
          .filter((t) => t.length > 0)
      }
    }
  }
  return { title, body, tags, defaultEnabled }
}

async function agentKnowledgeFileToDoc(rel: string): Promise<KnowledgeDoc | null> {
  const parts = parseKnowledgeFilePath(rel)
  if (!parts) return null
  const abs = join(getContentDir(), rel)
  if (!existsSync(abs)) return null
  let raw: string
  try {
    raw = readFileSync(abs, 'utf-8')
  } catch {
    return null
  }
  const { title, body, tags, defaultEnabled } = parseKnowledgeFrontmatter(raw)
  return {
    title: title || parts.lessonId,
    body,
    package_id: parts.packageId,
    agent_id: parts.agentId,
    lesson_id: parts.lessonId,
    tags,
    default_enabled: defaultEnabled ? 'true' : 'false',
    updated_at: new Date().toISOString(),
  }
}

/**
 * Walk every installed agent package's knowledge/ dir and yield
 * (key, doc) pairs for the search index reindexer.
 */
function* agentKnowledgeReindexAll(): Generator<{ key: string; doc: KnowledgeDoc }> {
  const root = join(getContentDir(), 'packages', 'agents')
  if (!existsSync(root)) return
  for (const dirent of readdirSync(root, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue
    const knowledgeDir = join(root, dirent.name, 'knowledge')
    if (!existsSync(knowledgeDir)) continue
    let stat
    try { stat = statSync(knowledgeDir) } catch { continue }
    if (!stat.isDirectory()) continue
    for (const file of readdirSync(knowledgeDir)) {
      if (!file.endsWith('.md')) continue
      const rel = relative(getContentDir(), join(knowledgeDir, file))
      const parts = parseKnowledgeFilePath(rel)
      if (!parts) continue
      const raw = readFileSync(join(knowledgeDir, file), 'utf-8')
      const { title, body, tags, defaultEnabled } = parseKnowledgeFrontmatter(raw)
      const key = `${parts.packageId}@${parts.version}/${parts.lessonId}`
      yield {
        key,
        doc: {
          title: title || parts.lessonId,
          body,
          package_id: parts.packageId,
          agent_id: parts.agentId,
          lesson_id: parts.lessonId,
          tags,
          default_enabled: defaultEnabled ? 'true' : 'false',
          updated_at: new Date().toISOString(),
        },
      }
    }
  }
}

// Reference imports so unused-import linting doesn't fire when the
// helpers above don't exercise every utility on every code path.
void basename
void dirname

// ─── Plugin Definition ───────────────────────────────────────────────────────

const teamPlugin: BakinPlugin = {
  id: 'team',
  name: 'Team',
  version: '1.0.0',

  settingsSchema: {
    fields: [
      {
        key: 'staleThresholdMinutes',
        type: 'number',
        label: 'Heartbeat stale threshold (minutes)',
        description: 'Mark agents as offline after this many minutes without a heartbeat or audit activity',
        default: 15,
      },
    ],
  },

  navItems: [
    { id: 'team', label: 'Team', icon: 'Users', href: '/team', order: 60 },
  ],

  activate(ctx: PluginContext) {
    staleSettingsCtx = ctx

    // ─── Search Content Type Registration ─────────────────────────────

    ctx.search.registerContentType({
      table: 'team',
      schema: {
        name: { type: 'text' },
        agent_id: { type: 'keyword' },
        model: { type: 'keyword' },
        status: { type: 'keyword' },
        soul: { type: 'text' },
        updated_at: { type: 'datetime' },
      },
      searchableFields: ['name', 'soul'],
      rerankField: 'soul',
      embeddingTemplate: '{{name}} {{soul}}',
      facets: ['model', 'status'],
      reindex: async function* () {
        // Agents are loaded from OpenClaw at runtime — use batch-index on load
      },
      verifyExists: async () => true, // Agents are managed by OpenClaw
    })

    // ─── Agent-knowledge content type (Phase F-4) ────────────────────────
    //
    // Indexes lesson markdown files shipped by installed agent-packages.
    // Source: ~/.bakin/packages/agents/<id>@<version>/knowledge/*.md
    //
    // Frontmatter carries title / tags / defaultEnabled; body is the
    // searchable content. The lesson's enabled state lives in the
    // lockfile — not indexed here for V1; consumers filter that
    // client-side by cross-referencing the lockfile.
    ctx.search.registerFileBackedContentType({
      table: 'agent-knowledge',
      schema: {
        title: { type: 'text' },
        body: { type: 'text' },
        package_id: { type: 'keyword' },
        agent_id: { type: 'keyword' },
        lesson_id: { type: 'keyword' },
        tags: { type: 'keyword' },
        default_enabled: { type: 'keyword' },
        updated_at: { type: 'datetime' },
      },
      searchableFields: ['title', 'body'],
      rerankField: 'body',
      embeddingTemplate: '{{title}} {{body}}',
      facets: ['package_id', 'agent_id', 'tags'],
      chunker: { enabled: true, targetTokens: 250, overlapTokens: 30 },
      filePatterns: [
        {
          // Match `packages/agents/<id>@<version>/knowledge/<lesson>.md`
          // under the content dir. Subdir layout for the kind:"agent"
          // install root is fixed by getPackageSourceDir.
          pattern: 'packages/agents/*/knowledge/*.md',
          fileToId: (rel) => agentKnowledgeFileToId(rel),
          fileToDoc: async (rel) => agentKnowledgeFileToDoc(rel),
        },
      ],
      reindex: async function* () {
        for (const doc of agentKnowledgeReindexAll()) {
          yield doc
        }
      },
      verifyExists: async (key: string) => {
        const path = agentKnowledgeKeyToFilePath(key)
        return path !== null && existsSync(path)
      },
    })

    /** Convert an agent to a search document */
    async function agentToSearchDoc(agent: { id: string; name: string }, model: string, status: string): Promise<Record<string, unknown>> {
      const profile = await getRuntimeAgentProfile(ctx.runtime, agent.id)
      return {
        name: agent.name,
        agent_id: agent.id,
        model,
        status,
        soul: profile?.soul || '',
        updated_at: new Date().toISOString(),
      }
    }

    /** Index a single agent in the search index */
    function indexAgent(agentId: string, agent: { id: string; name: string }, model: string, status: string): void {
      agentToSearchDoc(agent, model, status).then((doc) => ctx.search.index(agentId, doc)).catch((err) => {
        log.warn('Failed to index agent', { agentId, error: err instanceof Error ? err.message : String(err) })
      })
    }

    /** Batch-index all agents from OpenClaw */
    batchIndexAgents = async () => {
      try {
        const runtimeAgents = await ctx.runtime.agents.list()
        const heartbeats = readHeartbeats()
        const lastAuditActivity = getLastAuditActivity()
        for (const runtimeAgent of runtimeAgents) {
          const a = agentToMeta(runtimeAgent)
          const { status } = resolveAgentStatus(a.id, heartbeats, lastAuditActivity)
          const model = await getRuntimeAgentModel(ctx.runtime, runtimeAgent)
          indexAgent(a.id, a, model, status)
        }
      } catch (err) {
        log.warn('Failed to batch-index agents', { error: err instanceof Error ? err.message : String(err) })
      }
    }

    // ─── Cross-Plugin Hooks ────────────────────────────────────────────

    ctx.hooks.register('team.listAgents', () => listRuntimeAgentMetas(ctx.runtime))
    ctx.hooks.register('team.getAgent', async (d: Record<string, unknown>) => {
      const id = d.id as string
      const agents = await listRuntimeAgentMetas(ctx.runtime)
      return agents.find((a) => a.id === id) ?? null
    })
    ctx.hooks.register('team.getAgentIds', () => getRuntimeAgentIds(ctx.runtime))
    ctx.hooks.register('team.resolveProfile', (d: Record<string, unknown>) => {
      return getRuntimeAgentProfile(ctx.runtime, d.id as string)
    })
    ctx.hooks.register('team.getTeamMembers', (d: Record<string, unknown>) => {
      return getTeamMembers(ctx.runtime, d.teamId as string)
    })
    ctx.hooks.register('team.getAgentTeam', async (d: Record<string, unknown>) => {
      const ds = await mergeDisplayDefaults(ctx.runtime, readDisplaySettings())
      const teamId = ds[d.id as string]?.teamId
      if (!teamId) return null
      return readTeams().find((t) => t.id === teamId) ?? null
    })
    ctx.hooks.register('team.getOrgStructure', () => {
      return getOrgStructure(ctx.runtime)
    })

    // ─── REST Routes ───────────────────────────────────────────────────

    // GET / — List all agents with status
    ctx.registerRoute({
      path: '/',
      method: 'GET',
      description: 'List all agents with runtime status',
      handler: async () => {
        try {
          const runtimeAgents = await ctx.runtime.agents.list()
          const agents = runtimeAgents.map(agentToMeta)
          const heartbeats = readHeartbeats()
          const lastAuditActivity = getLastAuditActivity()
          const displaySettings = await mergeDisplayDefaults(ctx.runtime, readDisplaySettings())

          const result: AgentWithStatus[] = await Promise.all(agents.map(async (a, index) => {
            const { status, heartbeat, heartbeatAge } = resolveAgentStatus(a.id, heartbeats, lastAuditActivity)
            return {
              ...a,
              status,
              model: await getRuntimeAgentModel(ctx.runtime, runtimeAgents[index]),
              heartbeat,
              heartbeatAge,
            }
          }))

          // Update search index with latest status (metadata-only, no re-embedding)
          for (const a of result) {
            ctx.search.transform(a.id, [
              { op: '$set', field: 'status', value: a.status },
              { op: '$set', field: 'model', value: a.model },
              { op: '$set', field: 'updated_at', value: new Date().toISOString() },
            ]).catch(() => {})
          }

          const knownIds = new Set(agents.map((a) => a.id))
          const teams = degradeUnknownReportsTo(readTeams(), knownIds)
          return Response.json({
            agents: result,
            displaySettings,
            teams,
            mainAgentId: await getRuntimeMainAgentId(ctx.runtime),
          })
        } catch (err) {
          log.error('Failed to list agents', err)
          return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
        }
      },
    })

    // POST / — Create a new agent
    ctx.registerRoute({
      path: '/',
      method: 'POST',
      description: 'Create a new agent in OpenClaw',
      handler: async (req: Request) => {
        try {
          const body = await req.json() as Record<string, unknown>
          const id = (body.id as string || '').toLowerCase().replace(/[^a-z0-9-]/g, '')
          if (!id) return Response.json({ error: 'id is required (lowercase alphanumeric)' }, { status: 400 })
          if (!body.name) return Response.json({ error: 'name is required' }, { status: 400 })

          await createRuntimeAgent(ctx.runtime, {
            id,
            name: body.name as string,
            emoji: body.emoji as string | undefined,
            role: body.role as string | undefined,
            vibe: body.vibe as string | undefined,
            primaryFunction: body.primaryFunction as string | undefined,
            defaultMode: body.defaultMode as string | undefined,
            model: body.model as string | undefined,
            soul: body.soul as string | undefined,
            tools: body.tools as string | undefined,
          })

          // Handle dispatch permissions
          const dispatchable = body.dispatchable as string | string[] | undefined
          if (dispatchable) {
            await addToRuntimeAllowlists(ctx.runtime, id, dispatchable as 'all' | 'main' | string[])
          } else {
            await addToRuntimeAllowlists(ctx.runtime, id, 'main')
          }

          // Handle team assignment
          const teamId = body.teamId as string | undefined
          if (teamId) {
            const ds = readDisplaySettings()
            ds[id] = { ...ds[id], teamId }
            writeDisplaySettings(ds)
          }

          ctx.activity.audit('agent.created', 'system', { agent: id, name: body.name as string })
          indexAgent(id, { id, name: body.name as string }, body.model as string || '', 'offline')

          // Bust settings cache and sync mcporter so new agent gets an MCP entry
          resetSettingsCache()
          try { await syncMcporter(BAKIN_PORT) } catch { /* non-fatal */ }

          // Restart the active runtime unless caller opted out
          const url = new URL(req.url)
          const skipRestart = url.searchParams.get('skipRestart') === 'true'
          if (!skipRestart) {
            restartRuntime().then(() => {
              log.info('Runtime restarted after agent creation', { agent: id })
              try { ctx.hooks.invoke('models.markRuntimeRestarted', {}) } catch { /* ok */ }
            }).catch((err) => {
              log.warn('Failed to restart runtime after agent creation', { error: err instanceof Error ? err.message : String(err) })
            })
          } else {
            try { ctx.hooks.invoke('models.markConfigDirty', {}) } catch { /* ok */ }
          }

          return Response.json({ ok: true, id, runtimeRestarted: !skipRestart })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          const status = msg.includes('already exists') ? 409 : 500
          return Response.json({ error: msg }, { status })
        }
      },
    })

    // DELETE /:agentId — Remove an agent from OpenClaw
    ctx.registerRoute({
      path: '/:agentId',
      method: 'DELETE',
      description: 'Remove an agent from OpenClaw and move workspace to trash',
      handler: async (req: Request) => {
        try {
          const url = new URL(req.url)
          const agentId = url.searchParams.get('agentId')
          if (!agentId) return Response.json({ error: 'agentId is required' }, { status: 400 })

          // Prevent deleting the main agent
          if (agentId === await getRuntimeMainAgentId(ctx.runtime)) {
            return Response.json({ error: 'Cannot delete the main orchestrator agent' }, { status: 403 })
          }

          const removed = await removeRuntimeAgent(ctx.runtime, agentId)
          if (!removed) {
            return Response.json({ error: `Agent "${agentId}" not found` }, { status: 404 })
          }

          // Clean up dispatch permissions across all agents
          await removeFromRuntimeAllowlists(ctx.runtime, agentId)

          // Clean up display settings
          const ds = readDisplaySettings()
          if (ds[agentId]) {
            delete ds[agentId]
            writeDisplaySettings(ds)
          }

          ctx.activity.audit('agent.deleted', 'system', { agent: agentId })
          ctx.search.remove(agentId).catch(() => {})
          resetSettingsCache()
          try { await syncMcporter(BAKIN_PORT) } catch { /* non-fatal */ }

          // Restart the active runtime
          restartRuntime().then(() => {
            log.info('Runtime restarted after agent deletion', { agent: agentId })
            try { ctx.hooks.invoke('models.markRuntimeRestarted', {}) } catch { /* ok */ }
          }).catch((err) => {
            log.warn('Failed to restart runtime after agent deletion', { error: err instanceof Error ? err.message : String(err) })
          })

          return Response.json({ ok: true, id: agentId })
        } catch (err) {
          return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
        }
      },
    })

    // PUT /:agentId/identity — Update agent identity fields
    ctx.registerRoute({
      path: '/:agentId/identity',
      method: 'PUT',
      description: 'Update agent identity fields and persona files',
      handler: async (req: Request) => {
        try {
          const url = new URL(req.url)
          const agentId = url.searchParams.get('agentId')
          if (!agentId) return Response.json({ error: 'agentId is required' }, { status: 400 })

          const body = await req.json() as Record<string, unknown>
          const updated = await updateRuntimeAgentIdentity(ctx.runtime, agentId, {
            name: body.name as string | undefined,
            emoji: body.emoji as string | undefined,
            role: body.role as string | undefined,
            vibe: body.vibe as string | undefined,
            primaryFunction: body.primaryFunction as string | undefined,
            defaultMode: body.defaultMode as string | undefined,
            soul: body.soul as string | undefined,
            tools: body.tools as string | undefined,
          })

          ctx.activity.audit('agent.identity_updated', 'system', { agent: agentId, updated })
          resetSettingsCache()

          return Response.json({ ok: true, id: agentId, updated })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          const status = msg.includes('not found') ? 404 : 500
          return Response.json({ error: msg }, { status })
        }
      },
    })

    // PUT /:agentId/permissions — Update dispatch permissions
    ctx.registerRoute({
      path: '/:agentId/permissions',
      method: 'PUT',
      description: 'Update agent dispatch permissions (subagents.allowAgents)',
      handler: async (req: Request) => {
        try {
          const url = new URL(req.url)
          const agentId = url.searchParams.get('agentId')
          if (!agentId) return Response.json({ error: 'agentId is required' }, { status: 400 })

          const body = await req.json() as Record<string, unknown>
          const allowAgents = body.allowAgents as string[]
          if (!Array.isArray(allowAgents)) {
            return Response.json({ error: 'allowAgents must be a string array' }, { status: 400 })
          }

          // Validate all target IDs exist
          const ids = await getRuntimeAgentIds(ctx.runtime)
          const invalid = allowAgents.filter((id) => !ids.includes(id))
          if (invalid.length > 0) {
            return Response.json({ error: `Unknown agent IDs: ${invalid.join(', ')}` }, { status: 400 })
          }

          await setRuntimeSubagentPermissions(ctx.runtime, agentId, allowAgents)
          ctx.activity.audit('agent.permissions_updated', 'system', { agent: agentId, allowAgents })
          resetSettingsCache()

          return Response.json({ ok: true, agentId, allowAgents })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          const status = msg.includes('not found') ? 404 : msg.includes('cannot dispatch') ? 400 : 500
          return Response.json({ error: msg }, { status })
        }
      },
    })

    // POST /:agentId/avatar — Upload avatar image
    ctx.registerRoute({
      path: '/:agentId/avatar',
      method: 'POST',
      description: 'Upload agent avatar image',
      handler: async (req: Request) => {
        const url = new URL(req.url)
        const agentId = url.searchParams.get('agentId')
        if (!agentId) return Response.json({ error: 'agentId required' }, { status: 400 })

        try {
          const contentType = req.headers.get('content-type') || ''
          let imageBuffer: Buffer

          if (contentType.includes('multipart/form-data')) {
            const formData = await req.formData()
            const file = formData.get('avatar') as File | null
            if (!file) return Response.json({ error: 'No avatar file provided' }, { status: 400 })
            imageBuffer = Buffer.from(await file.arrayBuffer())
          } else {
            // Raw binary upload
            imageBuffer = Buffer.from(await req.arrayBuffer())
          }

          if (imageBuffer.length === 0) {
            return Response.json({ error: 'Empty file' }, { status: 400 })
          }

          const { agents } = getBakinPaths()
          const agentDir = join(agents, agentId)
          if (!existsSync(agentDir)) mkdirSync(agentDir, { recursive: true })
          writeFileSync(join(agentDir, 'avatar.jpg'), imageBuffer)

          ctx.activity.audit('agent.avatar.updated', 'system', { agent: agentId })
          return Response.json({ ok: true })
        } catch (err) {
          return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
        }
      },
    })

    // GET /:agentId — Full agent profile
    ctx.registerRoute({
      path: '/:agentId',
      method: 'GET',
      description: 'Get full agent profile merged from OpenClaw',
      handler: async (req: Request) => {
        const url = new URL(req.url)
        const agentId = url.searchParams.get('agentId')
        if (!agentId) return Response.json({ error: 'agentId required' }, { status: 400 })

        const profile = await getRuntimeAgentProfile(ctx.runtime, agentId)
        if (!profile) return Response.json({ error: 'Agent not found' }, { status: 404 })

        return Response.json(profile)
      },
    })

    // GET /:agentId/files — List workspace files
    ctx.registerRoute({
      path: '/:agentId/files',
      method: 'GET',
      description: 'List workspace files for an agent',
      handler: async (req: Request) => {
        const url = new URL(req.url)
        const agentId = url.searchParams.get('agentId')
        if (!agentId) return Response.json({ error: 'agentId required' }, { status: 400 })

        const files = await ctx.runtime.agents.listWorkspaceFiles(agentId)
        return Response.json({ files })
      },
    })

    // GET /:agentId/files/:filename — Read a workspace file
    ctx.registerRoute({
      path: '/:agentId/files/:filename',
      method: 'GET',
      description: 'Read a specific workspace file',
      handler: async (req: Request) => {
        const url = new URL(req.url)
        const agentId = url.searchParams.get('agentId')
        const filename = url.searchParams.get('filename')
        if (!agentId || !filename) return Response.json({ error: 'agentId and filename required' }, { status: 400 })

        const file = await ctx.runtime.agents.readWorkspaceFile(agentId, filename)
        if (file === null) return Response.json({ error: 'File not found' }, { status: 404 })

        return Response.json({ filename, content: file.content })
      },
    })

    // PUT /:agentId/files/:filename — Write a workspace file
    ctx.registerRoute({
      path: '/:agentId/files/:filename',
      method: 'PUT',
      description: 'Write a workspace file (edits OpenClaw directly)',
      handler: async (req: Request) => {
        const url = new URL(req.url)
        const agentId = url.searchParams.get('agentId')
        const filename = url.searchParams.get('filename')
        if (!agentId || !filename) return Response.json({ error: 'agentId and filename required' }, { status: 400 })

        const body = await req.json()
        const { content } = body as { content: string }
        if (typeof content !== 'string') return Response.json({ error: 'content string required' }, { status: 400 })

        try {
          await ctx.runtime.agents.writeWorkspaceFile(agentId, { path: filename, content })
          ctx.activity.audit('team.file.updated', 'system', { agent: agentId, file: filename })
          return Response.json({ ok: true })
        } catch (err) {
          return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
        }
      },
    })

    // GET /:agentId/skills — List installed skills
    ctx.registerRoute({
      path: '/:agentId/skills',
      method: 'GET',
      description: 'List installed skills for an agent',
      handler: async (req: Request) => {
        const url = new URL(req.url)
        const agentId = url.searchParams.get('agentId')
        if (!agentId) return Response.json({ error: 'agentId required' }, { status: 400 })

        const skills = await listRuntimeSkills(ctx.runtime, agentId)
        return Response.json({ skills })
      },
    })

    // GET /:agentId/skills/:skillId — Read SKILL.md
    ctx.registerRoute({
      path: '/:agentId/skills/:skillId',
      method: 'GET',
      description: 'Read SKILL.md for a specific skill',
      handler: async (req: Request) => {
        const url = new URL(req.url)
        const agentId = url.searchParams.get('agentId')
        const skillId = url.searchParams.get('skillId')
        if (!agentId || !skillId) return Response.json({ error: 'agentId and skillId required' }, { status: 400 })

        const content = await readRuntimeSkillFile(ctx.runtime, agentId, skillId)
        if (content === null) return Response.json({ error: 'Skill not found' }, { status: 404 })

        return Response.json({ skillId, content })
      },
    })

    // GET /:agentId/memory — List memory files
    ctx.registerRoute({
      path: '/:agentId/memory',
      method: 'GET',
      description: 'List memory files for an agent',
      handler: async (req: Request) => {
        const url = new URL(req.url)
        const agentId = url.searchParams.get('agentId')
        if (!agentId) return Response.json({ error: 'agentId required' }, { status: 400 })

        const files = await listRuntimeMemoryFiles(ctx.runtime, agentId)
        return Response.json({ files })
      },
    })

    // GET /:agentId/memory/:date — Read a memory file
    ctx.registerRoute({
      path: '/:agentId/memory/:date',
      method: 'GET',
      description: 'Read a specific memory file',
      handler: async (req: Request) => {
        const url = new URL(req.url)
        const agentId = url.searchParams.get('agentId')
        const date = url.searchParams.get('date')
        if (!agentId || !date) return Response.json({ error: 'agentId and date required' }, { status: 400 })

        const content = await readRuntimeMemoryFile(ctx.runtime, agentId, date)
        if (content === null) return Response.json({ error: 'Memory file not found' }, { status: 404 })

        return Response.json({ date, content })
      },
    })

    // GET /:agentId/stats — Token usage and cost
    ctx.registerRoute({
      path: '/:agentId/stats',
      method: 'GET',
      description: 'Get token usage and cost stats for an agent',
      handler: async (req: Request) => {
        const url = new URL(req.url)
        const agentId = url.searchParams.get('agentId')
        if (!agentId) return Response.json({ error: 'agentId required' }, { status: 400 })

        const allUsage = await getAllAgentUsage(ctx.runtime)
        const usage = allUsage.find((u) => u.agent === agentId)

        return Response.json({ usage: usage ?? null })
      },
    })

    // GET /:agentId/heartbeat — Raw HEARTBEAT.md content + lastUpdated
    ctx.registerRoute({
      path: '/:agentId/heartbeat',
      method: 'GET',
      description: 'Read the agent\'s HEARTBEAT.md narrative + file mtime',
      handler: async (req: Request) => {
        const url = new URL(req.url)
        const agentId = url.searchParams.get('agentId')
        if (!agentId) return Response.json({ ok: false, error: 'agentId required' }, { status: 400 })

        try {
          const heartbeat = await readRuntimeHeartbeatRaw(ctx.runtime, agentId)
          return Response.json({ ok: true, heartbeat })
        } catch (err) {
          log.error('Failed to read heartbeat', err, { agentId })
          return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 })
        }
      },
    })

    // GET /:agentId/active-context — Latest session transcript (read-only)
    ctx.registerRoute({
      path: '/:agentId/active-context',
      method: 'GET',
      description: 'Read the most recent session JSONL parsed into a message stream',
      handler: async (req: Request) => {
        const url = new URL(req.url)
        const agentId = url.searchParams.get('agentId')
        if (!agentId) return Response.json({ ok: false, error: 'agentId required' }, { status: 400 })

        const maxParam = url.searchParams.get('max')
        const maxMessages = maxParam ? Math.max(1, Math.min(1000, parseInt(maxParam, 10) || 200)) : 200

        try {
          const transcript = await readLatestSessionTranscript(ctx.runtime.memory, agentId, { maxMessages })
          return Response.json({ ok: true, transcript })
        } catch (err) {
          log.error('Failed to read active context', err, { agentId })
          return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 })
        }
      },
    })

    // GET /:agentId/recent-activity — In-memory dispatch counts per window
    ctx.registerRoute({
      path: '/:agentId/recent-activity',
      method: 'GET',
      description: 'Per-agent dispatch + error counts across 5m / 1h / 24h windows (resets on server restart)',
      handler: async (req: Request) => {
        const url = new URL(req.url)
        const agentId = url.searchParams.get('agentId')
        if (!agentId) return Response.json({ ok: false, error: 'agentId required' }, { status: 400 })

        try {
          const windows = { '5m': 5 * 60 * 1000, '1h': 60 * 60 * 1000, '24h': 24 * 60 * 60 * 1000 } as const
          const windowMs: Record<'5m' | '1h' | '24h', number> = { '5m': 0, '1h': 0, '24h': 0 }
          const errors: Record<'5m' | '1h' | '24h', number> = { '5m': 0, '1h': 0, '24h': 0 }
          for (const [key, ms] of Object.entries(windows) as Array<['5m' | '1h' | '24h', number]>) {
            const stats = getStatsByMs({ kind: 'agent', windowMs: ms, agent: agentId })
            windowMs[key] = stats.total
            errors[key] = stats.errors
          }
          const sinceServerStart = new Date(Date.now() - process.uptime() * 1000).toISOString()
          return Response.json({ ok: true, activity: { windowMs, errors, sinceServerStart } })
        } catch (err) {
          log.error('Failed to compute recent activity', err, { agentId })
          return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 })
        }
      },
    })

    // GET /:agentId/avatar — Serve avatar JPEG
    ctx.registerRoute({
      path: '/:agentId/avatar',
      method: 'GET',
      description: 'Serve agent avatar image',
      handler: async (req: Request) => {
        const url = new URL(req.url)
        const agentId = url.searchParams.get('agentId')
        if (!agentId) return new Response(null, { status: 400 })

        const { agents } = getBakinPaths()
        const avatarPath = join(agents, agentId, 'avatar.jpg')

        if (!existsSync(avatarPath)) {
          return new Response(null, { status: 404 })
        }

        const data = readFileSync(avatarPath)
        return new Response(data, {
          headers: {
            'Content-Type': 'image/jpeg',
            'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
          },
        })
      },
    })

    // POST /:agentId/start — Start agent
    ctx.registerRoute({
      path: '/:agentId/start',
      method: 'POST',
      description: 'Start an agent via OpenClaw',
      handler: async (req: Request) => {
        const url = new URL(req.url)
        const agentId = url.searchParams.get('agentId')
        if (!agentId) return Response.json({ error: 'agentId required' }, { status: 400 })

        const body = await req.json().catch(() => ({})) as Record<string, unknown>
        const result = await startAgent(agentId, body.message as string | undefined)
        if (result.ok) {
          ctx.activity.audit('agent.start', 'system', { agent: agentId })
        }
        return Response.json(result)
      },
    })

    // POST /:agentId/stop — Stop agent
    ctx.registerRoute({
      path: '/:agentId/stop',
      method: 'POST',
      description: 'Stop an agent',
      handler: async (req: Request) => {
        const url = new URL(req.url)
        const agentId = url.searchParams.get('agentId')
        if (!agentId) return Response.json({ error: 'agentId required' }, { status: 400 })

        const result = await stopAgent(agentId)
        return Response.json(result)
      },
    })

    // GET /settings — Display settings
    ctx.registerRoute({
      path: '/settings',
      method: 'GET',
      description: 'Get agent display settings',
      handler: async () => {
        const raw = readDisplaySettings()
        return Response.json(await mergeDisplayDefaults(ctx.runtime, raw))
      },
    })

    // PUT /settings — Update display settings
    ctx.registerRoute({
      path: '/settings',
      method: 'PUT',
      description: 'Update agent display settings',
      handler: async (req: Request) => {
        const body = await req.json() as AgentDisplaySettingsMap
        writeDisplaySettings(body)
        return Response.json({ ok: true })
      },
    })

    // ─── Team (Org) Routes ──────────────────────────────────────────────

    // GET /teams — List all org teams
    ctx.registerRoute({
      path: '/teams',
      method: 'GET',
      description: 'List organizational teams',
      handler: async () => {
        return Response.json({ teams: readTeams() })
      },
    })

    // POST /teams — Create a team
    ctx.registerRoute({
      path: '/teams',
      method: 'POST',
      description: 'Create an organizational team',
      handler: async (req: Request) => {
        const body = await req.json() as Record<string, unknown>
        const id = (body.id as string || '').toLowerCase().replace(/[^a-z0-9-]/g, '')
        if (!id) return Response.json({ error: 'id required' }, { status: 400 })
        if (!body.label) return Response.json({ error: 'label required' }, { status: 400 })

        const teams = readTeams()
        if (teams.some((t) => t.id === id)) {
          return Response.json({ error: `Team "${id}" already exists` }, { status: 409 })
        }

        const mainAgentId = await getRuntimeMainAgentId(ctx.runtime)
        const team: OrgTeam = {
          id,
          label: body.label as string,
          reportsTo: normalizeReportsTo(body.reportsTo, mainAgentId),
          color: body.color as string | undefined,
          order: typeof body.order === 'number' ? body.order : teams.length,
        }
        teams.push(team)
        writeTeams(teams)

        ctx.activity.audit('team.org.created', 'system', { teamId: id, label: team.label })
        return Response.json({ ok: true, team })
      },
    })

    // PUT /teams/:teamId — Update a team
    ctx.registerRoute({
      path: '/teams/:teamId',
      method: 'PUT',
      description: 'Update an organizational team',
      handler: async (req: Request) => {
        const url = new URL(req.url)
        const teamId = url.searchParams.get('teamId')
        if (!teamId) return Response.json({ error: 'teamId required' }, { status: 400 })

        const teams = readTeams()
        const idx = teams.findIndex((t) => t.id === teamId)
        if (idx === -1) return Response.json({ error: 'Team not found' }, { status: 404 })

        const body = await req.json() as Record<string, unknown>
        if (body.label !== undefined) teams[idx].label = body.label as string
        if (body.reportsTo !== undefined) {
          teams[idx].reportsTo = normalizeReportsTo(body.reportsTo, await getRuntimeMainAgentId(ctx.runtime))
        }
        if (body.color !== undefined) teams[idx].color = body.color as string
        if (body.order !== undefined) teams[idx].order = body.order as number

        writeTeams(teams)
        return Response.json({ ok: true, team: teams[idx] })
      },
    })

    // DELETE /teams/:teamId — Delete a team (unassigns agents)
    ctx.registerRoute({
      path: '/teams/:teamId',
      method: 'DELETE',
      description: 'Delete an organizational team',
      handler: async (req: Request) => {
        const url = new URL(req.url)
        const teamId = url.searchParams.get('teamId')
        if (!teamId) return Response.json({ error: 'teamId required' }, { status: 400 })

        const teams = readTeams()
        const filtered = teams.filter((t) => t.id !== teamId)
        if (filtered.length === teams.length) return Response.json({ error: 'Team not found' }, { status: 404 })

        writeTeams(filtered)

        // Unassign agents from this team
        const ds = readDisplaySettings()
        let changed = false
        for (const [agentId, settings] of Object.entries(ds)) {
          if (settings.teamId === teamId) {
            delete ds[agentId].teamId
            changed = true
          }
        }
        if (changed) writeDisplaySettings(ds)

        ctx.activity.audit('team.org.deleted', 'system', { teamId })
        return Response.json({ ok: true })
      },
    })

    // GET /teams/:teamId/members — List agents in a team
    ctx.registerRoute({
      path: '/teams/:teamId/members',
      method: 'GET',
      description: 'List agents belonging to a team',
      handler: async (req: Request) => {
        const url = new URL(req.url)
        const teamId = url.searchParams.get('teamId')
        if (!teamId) return Response.json({ error: 'teamId required' }, { status: 400 })

        const teams = readTeams()
        const team = teams.find((t) => t.id === teamId)
        if (!team) return Response.json({ error: 'Team not found' }, { status: 404 })

        const memberIds = await getTeamMembers(ctx.runtime, teamId)
        const agents = await listRuntimeAgentMetas(ctx.runtime)
        const members = agents.filter((a) => memberIds.includes(a.id))

        return Response.json({ team, members })
      },
    })

    // PUT /:agentId/team — Assign agent to a team
    ctx.registerRoute({
      path: '/:agentId/team',
      method: 'PUT',
      description: 'Assign an agent to an organizational team',
      handler: async (req: Request) => {
        const url = new URL(req.url)
        const agentId = url.searchParams.get('agentId')
        if (!agentId) return Response.json({ error: 'agentId required' }, { status: 400 })

        const body = await req.json() as Record<string, unknown>
        const teamId = body.teamId as string | null

        const ds = readDisplaySettings()
        const merged = await mergeDisplayDefaults(ctx.runtime, ds)
        if (!merged[agentId]) return Response.json({ error: 'Agent not found' }, { status: 404 })

        if (teamId) {
          const teams = readTeams()
          if (!teams.some((t) => t.id === teamId)) {
            return Response.json({ error: `Team "${teamId}" not found` }, { status: 404 })
          }
          ds[agentId] = { ...ds[agentId], teamId }
        } else {
          // Unassign
          if (ds[agentId]) delete ds[agentId].teamId
        }

        writeDisplaySettings(ds)
        return Response.json({ ok: true })
      },
    })

    // ─── MCP Exec Tools ────────────────────────────────────────────────

    ctx.registerExecTool({
      name: 'bakin_exec_team_list',
      label: 'Listed team',
      description: 'List all agents with their current status (online/working/available/offline).',
      parameters: {},
      handler: async () => {
        const runtimeAgents = await ctx.runtime.agents.list()
        const agents = runtimeAgents.map(agentToMeta)
        const heartbeats = readHeartbeats()
        const auditActivity = getLastAuditActivity()
        return {
          ok: true,
          agents: await Promise.all(agents.map(async (a, index) => {
            const { status } = resolveAgentStatus(a.id, heartbeats, auditActivity)
            return { ...a, status, model: await getRuntimeAgentModel(ctx.runtime, runtimeAgents[index]) }
          })),
        }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_team_profile',
      label: 'Read agent profile',
      description: 'Get the full profile for an agent including soul, rules, and tools.',
      parameters: {
        agentId: z.string().describe('Agent ID'),
      },
      handler: async (params: Record<string, unknown>) => {
        const profile = await getRuntimeAgentProfile(ctx.runtime, params.agentId as string)
        if (!profile) return { ok: false, error: 'Agent not found' }
        return { ok: true, ...profile }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_team_status',
      label: 'Checked agent status',
      description: 'Get the heartbeat and health status for an agent.',
      parameters: {
        agentId: z.string().describe('Agent ID'),
      },
      handler: async (params: Record<string, unknown>) => {
        const heartbeats = readHeartbeats()
        const auditActivity = getLastAuditActivity()
        const { status, heartbeat, heartbeatAge } = resolveAgentStatus(params.agentId as string, heartbeats, auditActivity)
        return { ok: true, agentId: params.agentId, status, heartbeat, heartbeatAge }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_team_read_file',
      label: 'Read agent file',
      description: 'Read a workspace file for an agent (e.g., SOUL.md, AGENTS.md, TOOLS.md).',
      parameters: {
        agentId: z.string().describe('Agent ID'),
        filename: z.string().describe('File name (e.g., SOUL.md)'),
      },
      handler: async (params: Record<string, unknown>) => {
        const file = await ctx.runtime.agents.readWorkspaceFile(params.agentId as string, params.filename as string)
        if (file === null) return { ok: false, error: 'File not found' }
        return { ok: true, filename: params.filename, content: file.content }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_team_message',
      label: 'Sent a message',
      description: 'Send a message to an agent via OpenClaw.',
      parameters: {
        agentId: z.string().describe('Agent ID'),
        message: z.string().describe('Message to send'),
      },
      handler: async (params: Record<string, unknown>) => {
        const result = await sendMessageToAgent(params.agentId as string, params.message as string)
        return result
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_team_org',
      label: 'Read organization',
      description: 'Get the full org structure: teams with their members. Use this to understand who is on which team and reporting lines.',
      parameters: {},
      handler: async () => {
        return { ok: true, teams: await getOrgStructure(ctx.runtime) }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_team_members',
      label: 'Listed team members',
      description: 'Get agents that belong to a specific team (e.g. "builders", "creators").',
      parameters: {
        teamId: z.string().describe('Team ID (e.g. "builders", "creators")'),
      },
      handler: async (params: Record<string, unknown>) => {
        const teamId = params.teamId as string
        const teams = readTeams()
        const team = teams.find((t) => t.id === teamId)
        if (!team) return { ok: false, error: `Team "${teamId}" not found` }
        const memberIds = await getTeamMembers(ctx.runtime, teamId)
        const agents = await listRuntimeAgentMetas(ctx.runtime)
        const members = agents.filter((a) => memberIds.includes(a.id))
        return { ok: true, team, members }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_team_my_team',
      label: 'Read own team',
      description: 'Get the team that a specific agent belongs to, including all teammates.',
      parameters: {
        agentId: z.string().describe('Agent ID'),
      },
      handler: async (params: Record<string, unknown>) => {
        const agentId = params.agentId as string
        const ds = await mergeDisplayDefaults(ctx.runtime, readDisplaySettings())
        const teamId = ds[agentId]?.teamId
        if (!teamId) return { ok: true, team: null, teammates: [] }
        const team = readTeams().find((t) => t.id === teamId)
        if (!team) return { ok: true, team: null, teammates: [] }
        const memberIds = (await getTeamMembers(ctx.runtime, teamId)).filter((id) => id !== agentId)
        const agents = await listRuntimeAgentMetas(ctx.runtime)
        return {
          ok: true,
          team,
          teammates: agents.filter((a) => memberIds.includes(a.id)),
        }
      },
    })

    // ─── Agent Lifecycle MCP Exec Tools ──────────────────────────────────

    ctx.registerExecTool({
      name: 'bakin_exec_team_create_agent',
      label: 'Created agent',
      description: 'Create a new agent: registers in OpenClaw, writes persona files, configures dispatch permissions, optionally assigns to a team. Returns next-step instructions.',
      parameters: {
        id: z.string().regex(/^[a-z0-9-]+$/).optional().describe('Agent ID (lowercase alphanumeric + hyphens). Auto-derived from name if omitted.'),
        name: z.string().describe('Display name (e.g. "Jessica Fetcher")'),
        emoji: z.string().optional().describe('Single emoji (e.g. "🔎")'),
        role: z.string().optional().describe('One-line role description'),
        vibe: z.string().optional().describe('Personality vibe'),
        primaryFunction: z.string().optional().describe('What the agent does'),
        defaultMode: z.string().optional().describe('How the agent operates by default'),
        model: z.string().optional().describe('Full provider/model string. Uses default if omitted.'),
        soul: z.string().optional().describe('Raw markdown for SOUL.md'),
        tools: z.string().optional().describe('Raw markdown for TOOLS.md'),
        teamId: z.string().optional().describe('Bakin team to assign the agent to'),
        dispatchable: z.union([z.literal('all'), z.literal('main'), z.array(z.string())]).optional().describe('Who can dispatch tasks to this agent. Default: "main".'),
      },
      handler: async (params: Record<string, unknown>) => {
        const name = params.name as string
        const id = (params.id as string || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''))
        if (!id) return { ok: false, error: 'Could not derive agent ID from name' }
        if (id === 'main') return { ok: false, error: 'Cannot use "main" as agent ID' }

        const existingIds = await getRuntimeAgentIds(ctx.runtime)
        if (existingIds.includes(id)) return { ok: false, error: `Agent "${id}" already exists` }

        const result = await createRuntimeAgent(ctx.runtime, {
          id,
          name,
          emoji: params.emoji as string | undefined,
          role: params.role as string | undefined,
          vibe: params.vibe as string | undefined,
          primaryFunction: params.primaryFunction as string | undefined,
          defaultMode: params.defaultMode as string | undefined,
          model: params.model as string | undefined,
          soul: params.soul as string | undefined,
          tools: params.tools as string | undefined,
        })

        const dispatchable = (params.dispatchable || 'main') as 'all' | 'main' | string[]
        await addToRuntimeAllowlists(ctx.runtime, id, dispatchable)

        const teamId = params.teamId as string | undefined
        if (teamId) {
          const ds = readDisplaySettings()
          ds[id] = { ...ds[id], teamId }
          writeDisplaySettings(ds)
        }

        ctx.activity.audit('agent.created', 'system', { agent: id, name })
        indexAgent(id, { id, name }, params.model as string || '', 'offline')
        resetSettingsCache()
        try { await syncMcporter(BAKIN_PORT) } catch { /* non-fatal */ }

        let runtimeRestarted = false
        try {
          await restartRuntime()
          runtimeRestarted = true
          log.info('Runtime restarted after agent creation', { agent: id })
          try { ctx.hooks.invoke('models.markRuntimeRestarted', {}) } catch { /* ok */ }
        } catch (err) {
          log.warn('Failed to restart runtime', { error: err instanceof Error ? err.message : String(err) })
        }

        return {
          ok: true,
          id,
          workspace: result.workspace,
          runtimeRestarted,
          instructions: `Agent created. You can now assign tasks to ${id} via bakin_exec_tasks_create. Consider writing a detailed SOUL.md to define their personality.`,
        }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_team_update_identity',
      label: 'Updated agent identity',
      description: 'Update an existing agent\'s identity fields (name, emoji, role, vibe, etc.) and/or workspace files (SOUL.md, TOOLS.md).',
      parameters: {
        agentId: z.string().describe('Target agent ID'),
        name: z.string().optional().describe('New display name'),
        emoji: z.string().optional().describe('New emoji'),
        role: z.string().optional().describe('Updated role'),
        vibe: z.string().optional().describe('Updated vibe'),
        primaryFunction: z.string().optional().describe('Updated primary function'),
        defaultMode: z.string().optional().describe('Updated default mode'),
        soul: z.string().optional().describe('Replace SOUL.md content'),
        tools: z.string().optional().describe('Replace TOOLS.md content'),
      },
      handler: async (params: Record<string, unknown>) => {
        const agentId = params.agentId as string
        const updated = await updateRuntimeAgentIdentity(ctx.runtime, agentId, {
          name: params.name as string | undefined,
          emoji: params.emoji as string | undefined,
          role: params.role as string | undefined,
          vibe: params.vibe as string | undefined,
          primaryFunction: params.primaryFunction as string | undefined,
          defaultMode: params.defaultMode as string | undefined,
          soul: params.soul as string | undefined,
          tools: params.tools as string | undefined,
        })

        ctx.activity.audit('agent.identity_updated', 'system', { agent: agentId, updated })
        resetSettingsCache()

        return { ok: true, id: agentId, updated }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_team_delete_agent',
      label: 'Deleted agent',
      description: 'Remove an agent from OpenClaw and clean up Bakin state. Requires confirm=true as a safety guard.',
      parameters: {
        agentId: z.string().describe('Agent to delete'),
        confirm: z.boolean().describe('Must be true — safety guard against accidental deletion'),
      },
      handler: async (params: Record<string, unknown>) => {
        const agentId = params.agentId as string
        const confirm = params.confirm as boolean

        if (agentId === await getRuntimeMainAgentId(ctx.runtime)) return { ok: false, error: 'Cannot delete the main orchestrator agent' }
        if (confirm !== true) return { ok: false, error: 'confirm must be true to delete an agent' }

        const removed = await removeRuntimeAgent(ctx.runtime, agentId)
        if (!removed) return { ok: false, error: `Agent "${agentId}" not found` }

        await removeFromRuntimeAllowlists(ctx.runtime, agentId)

        const ds = readDisplaySettings()
        if (ds[agentId]) {
          delete ds[agentId]
          writeDisplaySettings(ds)
        }

        ctx.activity.audit('agent.deleted', 'system', { agent: agentId })
        ctx.search.remove(agentId).catch(() => {})
        resetSettingsCache()
        try { await syncMcporter(BAKIN_PORT) } catch { /* non-fatal */ }

        let runtimeRestarted = false
        try {
          await restartRuntime()
          runtimeRestarted = true
          log.info('Runtime restarted after agent deletion', { agent: agentId })
          try { ctx.hooks.invoke('models.markRuntimeRestarted', {}) } catch { /* ok */ }
        } catch (err) {
          log.warn('Failed to restart runtime', { error: err instanceof Error ? err.message : String(err) })
        }

        return { ok: true, id: agentId, trashed: true, runtimeRestarted }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_team_set_permissions',
      label: 'Updated permissions',
      description: 'Update dispatch permissions — which agents a given agent can dispatch tasks to (subagents.allowAgents).',
      parameters: {
        agentId: z.string().describe('Agent whose allowAgents to modify'),
        allowAgents: z.array(z.string()).describe('Full replacement list of agent IDs this agent can dispatch to'),
      },
      handler: async (params: Record<string, unknown>) => {
        const agentId = params.agentId as string
        const allowAgents = params.allowAgents as string[]

        const ids = await getRuntimeAgentIds(ctx.runtime)
        if (!ids.includes(agentId)) return { ok: false, error: `Agent "${agentId}" not found in roster` }

        const invalid = allowAgents.filter((id) => !ids.includes(id))
        if (invalid.length > 0) return { ok: false, error: `Unknown agent IDs: ${invalid.join(', ')}` }

        if (allowAgents.includes(agentId)) return { ok: false, error: `Agent cannot dispatch to itself` }

        await setRuntimeSubagentPermissions(ctx.runtime, agentId, allowAgents)
        ctx.activity.audit('agent.permissions_updated', 'system', { agent: agentId, allowAgents })
        resetSettingsCache()

        return { ok: true, agentId, allowAgents }
      },
    })

    // ─── Health checks (migrated out of core/doctor.ts per #139) ────────
    ctx.registerHealthCheck({
      id: 'agent-roster',
      name: 'Runtime agent roster',
      run: () => checkAgentRoster(ctx.runtime.agents),
    })
    ctx.registerHealthCheck({
      id: 'personas',
      name: 'Persona files',
      autoFix: true,
      run: () => checkPersonas(getContentDir(), ctx.runtime.agents),
    })
    ctx.registerHealthCheck({
      id: 'agent-assets',
      name: 'Agent-package projection drift',
      autoFix: true,
      run: () => checkAgentAssets(),
    })
  },

  async onReady() {
    await batchIndexAgents()
    log.info('Ready — team plugin using runtime agent adapter')
  },

  onShutdown() {
    log.info('Shutting down team plugin')
  },
}

export default teamPlugin
