/**
 * Team plugin — server entry point.
 *
 * Adapter layer over OpenClaw agent workspaces. Registers REST routes,
 * cross-plugin hooks, and MCP exec tools for agent management.
 *
 * Bakin reads from OpenClaw. Bakin writes to OpenClaw. Bakin never copies OpenClaw.
 */
import { z } from 'zod'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import type { BakinPlugin, PluginContext } from '../../src/lib/plugin-types'
import { createLogger } from '../../src/core/logger'
import { readHeartbeats } from '../../src/lib/content'
import { getContentDir, getBakinPaths } from '../../packages/core/src/content-dir'
import { startAgent, stopAgent } from '../../src/lib/agents'
import { resetSettingsCache } from '../../src/core/settings'
import { getMainAgentId } from '../../src/core/main-agent'
import { syncConfig as syncMcporter } from '../../src/core/mcporter'
import { sendMessageToAgent } from '../../src/core/agents'
import { restartGateway } from '../../src/core/openclaw-client'
import { getAllAgentUsage } from '../../src/core/agent-usage'
import * as adapter from './lib/openclaw-adapter'
import type { AgentWithStatus, AgentDisplaySettingsMap, HeartbeatData, OrgTeam, TeamPluginSettings } from './types'

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
 *
 * If `getMainAgentId()` itself fails (e.g. a malformed roster), we fall
 * back to returning the value as-is rather than crashing the write path.
 */
function normalizeReportsTo(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') return null
  try {
    if (value === getMainAgentId()) return null
  } catch (err) {
    log.warn('normalizeReportsTo: getMainAgentId() threw — preserving value as-is', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
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

function mergeDisplayDefaults(overrides: AgentDisplaySettingsMap): AgentDisplaySettingsMap {
  const result: AgentDisplaySettingsMap = {}
  const ids = adapter.getAgentIds()
  for (const id of ids) {
    result[id] = {
      ...overrides[id],
      accentColor: overrides[id]?.accentColor ?? DEFAULT_COLORS[id] ?? '#a1a1aa',
    }
  }
  return result
}

// ─── Status Resolution ───────────────────────────────────────────────────────

/** Cached stale threshold — refreshed from plugin settings on each call */
let staleThresholdMs = DEFAULT_STALE_THRESHOLD_MS
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
    const { openSync, readSync, fstatSync, closeSync } = require('fs') as typeof import('fs')
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
function getTeamMembers(teamId: string): string[] {
  const ds = mergeDisplayDefaults(readDisplaySettings())
  return Object.entries(ds)
    .filter(([, s]) => s.teamId === teamId)
    .map(([id]) => id)
}

/** Get the full org structure: teams with their members */
function getOrgStructure() {
  const teams = readTeams()
  const ds = mergeDisplayDefaults(readDisplaySettings())
  const agents = adapter.listAgents()
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
let batchIndexAgents: () => void = () => {}

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

    /** Convert an agent to a search document */
    function agentToSearchDoc(agent: { id: string; name: string }, model: string, status: string): Record<string, unknown> {
      const profile = adapter.getAgentProfile(agent.id)
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
      ctx.search.index(agentId, agentToSearchDoc(agent, model, status)).catch((err) => {
        log.warn('Failed to index agent', { agentId, error: err instanceof Error ? err.message : String(err) })
      })
    }

    /** Batch-index all agents from OpenClaw */
    batchIndexAgents = () => {
      try {
        const agents = adapter.listAgents()
        const heartbeats = readHeartbeats()
        const lastAuditActivity = getLastAuditActivity()
        for (const a of agents) {
          const { status } = resolveAgentStatus(a.id, heartbeats, lastAuditActivity)
          const model = adapter.getAgentModel(a.id)
          indexAgent(a.id, a, model, status)
        }
      } catch (err) {
        log.warn('Failed to batch-index agents', { error: err instanceof Error ? err.message : String(err) })
      }
    }

    // ─── Cross-Plugin Hooks ────────────────────────────────────────────

    ctx.hooks.register('team.listAgents', () => adapter.listAgents())
    ctx.hooks.register('team.getAgent', (d: Record<string, unknown>) => {
      const id = d.id as string
      const agents = adapter.listAgents()
      return agents.find((a) => a.id === id) ?? null
    })
    ctx.hooks.register('team.getAgentIds', () => adapter.getAgentIds())
    ctx.hooks.register('team.resolveProfile', (d: Record<string, unknown>) => {
      return adapter.getAgentProfile(d.id as string)
    })
    ctx.hooks.register('team.getTeamMembers', (d: Record<string, unknown>) => {
      return getTeamMembers(d.teamId as string)
    })
    ctx.hooks.register('team.getAgentTeam', (d: Record<string, unknown>) => {
      const ds = mergeDisplayDefaults(readDisplaySettings())
      const teamId = ds[d.id as string]?.teamId
      if (!teamId) return null
      return readTeams().find((t) => t.id === teamId) ?? null
    })
    ctx.hooks.register('team.getOrgStructure', () => {
      return getOrgStructure()
    })

    // ─── REST Routes ───────────────────────────────────────────────────

    // GET / — List all agents with status
    ctx.registerRoute({
      path: '/',
      method: 'GET',
      description: 'List all agents with runtime status',
      handler: async () => {
        try {
          const agents = adapter.listAgents()
          const heartbeats = readHeartbeats()
          const lastAuditActivity = getLastAuditActivity()
          const displaySettings = mergeDisplayDefaults(readDisplaySettings())

          const result: AgentWithStatus[] = agents.map((a) => {
            const { status, heartbeat, heartbeatAge } = resolveAgentStatus(a.id, heartbeats, lastAuditActivity)
            return {
              ...a,
              status,
              model: adapter.getAgentModel(a.id),
              heartbeat,
              heartbeatAge,
            }
          })

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
          return Response.json({ agents: result, displaySettings, teams, mainAgentId: getMainAgentId() })
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

          await adapter.addAgent({
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

          ctx.activity.audit('agent.created', 'system', { agent: id, name: body.name as string })
          indexAgent(id, { id, name: body.name as string }, body.model as string || '', 'offline')

          // Bust settings cache and sync mcporter so new agent gets an MCP entry
          resetSettingsCache()
          try { syncMcporter(BAKIN_PORT) } catch { /* non-fatal */ }

          // Restart OpenClaw gateway unless caller opted out
          const url = new URL(req.url)
          const skipRestart = url.searchParams.get('skipRestart') === 'true'
          if (!skipRestart) {
            restartGateway().then(() => {
              log.info('Gateway restarted after agent creation', { agent: id })
              try { ctx.hooks.invoke('models.markGatewayRestarted', {}) } catch { /* ok */ }
            }).catch((err) => {
              log.warn('Failed to restart gateway after agent creation', { error: err instanceof Error ? err.message : String(err) })
            })
          } else {
            try { ctx.hooks.invoke('models.markConfigDirty', {}) } catch { /* ok */ }
          }

          return Response.json({ ok: true, id, gatewayRestarted: !skipRestart })
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
          if (agentId === getMainAgentId()) {
            return Response.json({ error: 'Cannot delete the main orchestrator agent' }, { status: 403 })
          }

          const removed = await adapter.removeAgent(agentId)
          if (!removed) {
            return Response.json({ error: `Agent "${agentId}" not found` }, { status: 404 })
          }

          // Clean up dispatch permissions across all agents
          adapter.removeFromAllowLists(agentId)

          // Clean up display settings
          const ds = readDisplaySettings()
          if (ds[agentId]) {
            delete ds[agentId]
            writeDisplaySettings(ds)
          }

          ctx.activity.audit('agent.deleted', 'system', { agent: agentId })
          ctx.search.remove(agentId).catch(() => {})
          resetSettingsCache()
          try { syncMcporter(BAKIN_PORT) } catch { /* non-fatal */ }

          // Restart OpenClaw gateway
          restartGateway().then(() => {
            log.info('Gateway restarted after agent deletion', { agent: agentId })
            try { ctx.hooks.invoke('models.markGatewayRestarted', {}) } catch { /* ok */ }
          }).catch((err) => {
            log.warn('Failed to restart gateway after agent deletion', { error: err instanceof Error ? err.message : String(err) })
          })

          return Response.json({ ok: true, id: agentId })
        } catch (err) {
          return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
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

        const profile = adapter.getAgentProfile(agentId)
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

        const files = adapter.listWorkspaceFiles(agentId)
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

        const content = adapter.readWorkspaceFile(agentId, filename)
        if (content === null) return Response.json({ error: 'File not found' }, { status: 404 })

        return Response.json({ filename, content })
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
          adapter.writeWorkspaceFile(agentId, filename, content)
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

        const skills = adapter.listSkills(agentId)
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

        const content = adapter.readSkillFile(agentId, skillId)
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

        const files = adapter.listMemoryFiles(agentId)
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

        const content = adapter.readMemoryFile(agentId, date)
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

        const allUsage = getAllAgentUsage()
        const usage = allUsage.find((u) => u.agent === agentId)

        return Response.json({ usage: usage ?? null })
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
        return Response.json(mergeDisplayDefaults(raw))
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

        const team: OrgTeam = {
          id,
          label: body.label as string,
          reportsTo: normalizeReportsTo(body.reportsTo),
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
        if (body.reportsTo !== undefined) teams[idx].reportsTo = normalizeReportsTo(body.reportsTo)
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

        const memberIds = getTeamMembers(teamId)
        const agents = adapter.listAgents()
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
        const merged = mergeDisplayDefaults(ds)
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
        const agents = adapter.listAgents()
        const heartbeats = readHeartbeats()
        const auditActivity = getLastAuditActivity()
        return {
          ok: true,
          agents: agents.map((a) => {
            const { status } = resolveAgentStatus(a.id, heartbeats, auditActivity)
            return { ...a, status, model: adapter.getAgentModel(a.id) }
          }),
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
        const profile = adapter.getAgentProfile(params.agentId as string)
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
        const content = adapter.readWorkspaceFile(params.agentId as string, params.filename as string)
        if (content === null) return { ok: false, error: 'File not found' }
        return { ok: true, filename: params.filename, content }
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
        return { ok: true, teams: getOrgStructure() }
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
        const memberIds = getTeamMembers(teamId)
        const agents = adapter.listAgents()
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
        const ds = mergeDisplayDefaults(readDisplaySettings())
        const teamId = ds[agentId]?.teamId
        if (!teamId) return { ok: true, team: null, teammates: [] }
        const team = readTeams().find((t) => t.id === teamId)
        if (!team) return { ok: true, team: null, teammates: [] }
        const memberIds = getTeamMembers(teamId).filter((id) => id !== agentId)
        const agents = adapter.listAgents()
        return {
          ok: true,
          team,
          teammates: agents.filter((a) => memberIds.includes(a.id)),
        }
      },
    })
  },

  async onReady() {
    const agents = adapter.listAgents()
    batchIndexAgents()
    log.info(`Ready — ${agents.length} agents from OpenClaw`)
  },

  onShutdown() {
    log.info('Shutting down team plugin')
  },
}

export default teamPlugin
