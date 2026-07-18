/**
 * Team plugin — server entry point.
 *
 * Adapter layer over runtime agent workspaces. Registers REST routes,
 * cross-plugin hooks, and MCP exec tools for agent management.
 *
 * Bakin reads and writes through the active runtime adapter.
 */
import { z } from 'zod'
import { existsSync } from 'fs'
import type { BakinPlugin, PluginContext } from '@bakin/core/plugin-types'
import { definePlugin } from '@bakin/core/routing'
import { createLogger } from '../../src/core/logger'
import { readHeartbeats } from '../../src/lib/content-files'
import { getContentDir } from '../../packages/core/src/content-dir'
import { getSettings, resetSettingsCache } from '../../src/core/settings'
import { sendMessageToAgent } from '../../src/core/agents'
import { getLiveRun, LedgerUnavailableError } from '../../src/core/execution-ledger'
import { appendAudit } from '../../src/core/audit'
import { retrieveAgentPackageLessons } from '../../src/core/agent-packages/lesson-retrieval'
import { getRuntimeMainAgentId } from '@bakin/core/adapters/runtime'
import {
  agentSyncMigrationRepair,
  agentSyncRepair,
  checkAgentRoster,
  checkPersonas,
  checkAgentSync,
  checkTeamRouting,
  personaRepair,
} from './lib/health-checks'
import {
  agentToMeta,
  listRuntimeAgentMetas,
  getRuntimeAgentIds,
  getRuntimeAgentModel,
  getRuntimeAgentProfile,
  createRuntimeAgent,
  addToRuntimeAllowlists,
  removeFromRuntimeAllowlists,
  removeRuntimeAgent,
  updateRuntimeAgentIdentity,
  setRuntimeSubagentPermissions,
} from './lib/runtime-agents'
import {
  agentLessonFileToId,
  agentLessonKeyToFilePath,
  agentLessonFileToDoc,
  agentLessonReindexAll,
} from './lib/agent-lessons'
import {
  readDisplaySettings,
  writeDisplaySettings,
  readTeams,
  mergeDisplayDefaults,
} from './lib/team-settings'
import {
  setStaleSettingsContext,
  getLastAuditActivity,
  resolveAgentStatus,
  getTeamMembers,
  getOrgStructure,
} from './lib/agent-status'
import {
  DEFAULT_ROUTING_MODEL,
  resolveTeamAssignment,
  type ResolveAssignmentRequest,
} from './lib/assignment-resolver'
import { populateAgentRoutes } from './lib/routes/agents'
import { populateContextRoutes } from './lib/routes/context'
import { populateOrgTeamRoutes } from './lib/routes/teams'

const log = createLogger('team')

/** Module-level hook for batch-indexing agents — set during activate() */
let batchIndexAgents: () => Promise<void> = async () => {}

// ─── Plugin context handle (set during activate, used by module-scope helpers) ─

let pluginCtx: PluginContext | null = null


async function agentToSearchDocStatic(agent: { id: string; name: string }, model: string, status: string): Promise<Record<string, unknown>> {
  if (!pluginCtx) return { name: agent.name, agent_id: agent.id, model, status, soul: '', updated_at: new Date().toISOString() }
  const profile = await getRuntimeAgentProfile(pluginCtx.runtime, agent.id)
  return {
    name: agent.name,
    agent_id: agent.id,
    model,
    status,
    soul: profile?.soul || '',
    updated_at: new Date().toISOString(),
  }
}

function indexAgentStatic(agentId: string, agent: { id: string; name: string }, model: string, status: string): void {
  if (!pluginCtx) return
  const ctx = pluginCtx
  agentToSearchDocStatic(agent, model, status).then((doc) => ctx.search.index(agentId, doc)).catch((err) => {
    log.warn('Failed to index agent', { agentId, error: err instanceof Error ? err.message : String(err) })
  })
}

// ─── Plugin Definition ───────────────────────────────────────────────────────

const teamRoutes: any[] = []

// Registration order matters: the RouteRegistry breaks specificity-score ties
// by insertion order. Agent routes first (so e.g. GET /context/files keeps
// resolving to the agent files route), then context routes, then org-team
// routes — whose PUT /:agentId/team assignment route must register after both
// PUT /teams/:teamId and PUT /context/:scope (paths like /teams/team and
// /context/team tie on score).
populateAgentRoutes(teamRoutes, { indexAgentStatic })
populateContextRoutes(teamRoutes)
populateOrgTeamRoutes(teamRoutes)


const teamPlugin: BakinPlugin = definePlugin({
  routes: teamRoutes as unknown as Parameters<typeof definePlugin>[0]['routes'],
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
    // Reset routes on every activate (hot-reload safety).
    // teamRoutes is populated at module load now (T20+); reset would wipe the static array
    setStaleSettingsContext(ctx)
    pluginCtx = ctx

    // ─── Search Content Type Registration ─────────────────────────────

    ctx.search.registerContentType({
      table: 'team',
      schemaVersion: 1,
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
        // Agents are loaded from the runtime adapter — use batch-index on load
      },
      verifyExists: async () => true, // Agents are managed by the runtime adapter
    })

    // ─── Agent-lessons content type (Phase F-4) ────────────────────────
    //
    // Indexes lesson markdown files shipped by installed agent-packages.
    // Source: ~/.bakin/packages/agents/<id>@<version>/lessons/*.md
    //
    // Frontmatter carries title / tags / defaultEnabled; body is the
    // searchable content. The lesson's enabled state lives in the
    // lockfile — not indexed here for V1; consumers filter that
    // client-side by cross-referencing the lockfile.
    ctx.search.registerFileBackedContentType({
      table: 'agent-lessons',
      schemaVersion: 1,
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
          // Match `packages/agents/<id>@<version>/lessons/<lesson>.md`
          // under the content dir. Subdir layout for the kind:"agent"
          // install root is fixed by getPackageSourceDir.
          pattern: 'packages/agents/*/lessons/*.md',
          fileToId: (rel) => agentLessonFileToId(rel),
          fileToDoc: async (rel) => agentLessonFileToDoc(rel),
        },
      ],
      reindex: async function* () {
        for (const doc of agentLessonReindexAll()) {
          yield doc
        }
      },
      verifyExists: async (key: string) => {
        const path = agentLessonKeyToFilePath(key)
        return path !== null && existsSync(path)
      },
    })

    /** Stable content hash over the substantive fields (FNV-1a). */
    function agentContentHash(doc: Record<string, unknown>): string {
      const text = JSON.stringify([doc.name, doc.agent_id, doc.model, doc.status, doc.soul])
      let hash = 2166136261
      for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i)
        hash = Math.imul(hash, 16777619) >>> 0
      }
      return hash.toString(36)
    }

    /** Convert an agent to a search document */
    async function agentToSearchDoc(agent: { id: string; name: string }, model: string, status: string): Promise<Record<string, unknown>> {
      const profile = await getRuntimeAgentProfile(ctx.runtime, agent.id)
      const doc: Record<string, unknown> = {
        name: agent.name,
        agent_id: agent.id,
        model,
        status,
        soul: profile?.soul || '',
        updated_at: new Date().toISOString(),
      }
      doc.content_hash = agentContentHash(doc)
      return doc
    }

    /** Index a single agent in the search index */
    function indexAgent(agentId: string, agent: { id: string; name: string }, model: string, status: string): void {
      agentToSearchDoc(agent, model, status).then((doc) => ctx.search.index(agentId, doc)).catch((err) => {
        log.warn('Failed to index agent', { agentId, error: err instanceof Error ? err.message : String(err) })
      })
    }

    /**
     * Batch-index all agents from the runtime adapter. Unconditional —
     * the outbox's acked-hash dedupe drops unchanged rows before they
     * reach the engine, so no scan-and-compare is needed here.
     */
    batchIndexAgents = async () => {
      try {
        const runtimeAgents = await ctx.runtime.agents.list()
        const heartbeats = readHeartbeats()
        const lastAuditActivity = getLastAuditActivity()

        for (const runtimeAgent of runtimeAgents) {
          const a = agentToMeta(runtimeAgent)
          const { status } = resolveAgentStatus(a.id, heartbeats, lastAuditActivity)
          const model = await getRuntimeAgentModel(ctx.runtime, runtimeAgent)
          const doc = await agentToSearchDoc(a, model, status)
          ctx.search.index(a.id, doc).catch((err) => {
            log.warn('Failed to index agent', { agentId: a.id, error: err instanceof Error ? err.message : String(err) })
          })
        }
      } catch (err) {
        log.warn('Failed to batch-index agents', { error: err instanceof Error ? err.message : String(err) })
      }
    }

    // ─── Cross-Plugin Hooks ────────────────────────────────────────────

    ctx.hooks.register('team.list', () => listRuntimeAgentMetas(ctx.runtime), { label: 'List agents.', summary: 'Returns runtime agents with their display and team metadata attached. Use it when another plugin needs the agent roster as Bakin presents it.', hookKind: 'rpc' })
    ctx.hooks.register('team.getAgent', async (d: Record<string, unknown>) => {
      const id = d.id as string
      const agents = await listRuntimeAgentMetas(ctx.runtime)
      return agents.find((a) => a.id === id) ?? null
    }, { label: 'Get an agent.', summary: 'Returns one runtime agent by id, including team-aware metadata when available. Use it when a plugin already has an agent id and needs the full display record.', hookKind: 'rpc' })
    ctx.hooks.register('team.getAgentIds', () => getRuntimeAgentIds(ctx.runtime), { label: 'List agent ids.', summary: 'Returns the ids of agents currently known to the runtime. Use it for lightweight validation, assignment pickers, or loops that do not need full agent metadata.', hookKind: 'rpc' })
    ctx.hooks.register('team.resolveProfile', (d: Record<string, unknown>) => {
      return getRuntimeAgentProfile(ctx.runtime, d.id as string)
    }, { label: 'Resolve agent profile.', summary: 'Returns the runtime profile for an agent id. Use it when a plugin needs the lower-level profile data behind an agent display record.', hookKind: 'rpc' })
    ctx.hooks.register('team.getTeamMembers', (d: Record<string, unknown>) => {
      return getTeamMembers(ctx.runtime, d.teamId as string)
    }, { label: 'List team members.', summary: 'Returns the agents assigned to one team. Use it for team dashboards, routing rules, or workflow logic that needs team membership.', hookKind: 'rpc' })
    ctx.hooks.register('team.getAgentTeam', (d: Record<string, unknown>) => {
      // Team membership is stored explicitly. Reading it does not need the
      // runtime-merged color/default view (or another full roster scan).
      const teamId = readDisplaySettings()[d.id as string]?.teamId
      if (!teamId) return null
      return readTeams().find((t) => t.id === teamId) ?? null
    }, { label: 'Get agent team.', summary: 'Returns the team currently assigned to an agent, or null when the agent is unassigned. Use it to add team context to task, workflow, or activity views.', hookKind: 'rpc' })
    ctx.hooks.register('team.getOrgStructure', () => {
      return getOrgStructure(ctx.runtime)
    }, { label: 'Get org structure.', summary: 'Returns the current organization structure for teams and agents. Use it when a plugin needs the full hierarchy instead of individual team or agent records.', hookKind: 'rpc' })
    ctx.hooks.register('team.exists', (d: Record<string, unknown>) => {
      return readTeams().some((t) => t.id === (d.teamId as string))
    }, { label: 'Check team exists.', summary: 'Returns true when the given teamId is a configured team. Use it for write-time validation of team assignments.', hookKind: 'rpc' })
    ctx.hooks.register('team.resolveAssignment', async (d: Record<string, unknown>) => {
      // The router's own model comes from the work-class matrix (models
      // plugin) — the 'team-routing' row; no route = the default cheap model.
      const { resolveSystemRoute } = await import('../../src/core/system-route')
      const route = await resolveSystemRoute('team-routing')
      const heartbeats = readHeartbeats()
      const lastAuditActivity = getLastAuditActivity()
      return resolveTeamAssignment({
        runtime: ctx.runtime,
        route: { model: route.model, source: route.source },
        getStatus: (agentId) => resolveAgentStatus(agentId, heartbeats, lastAuditActivity).status,
      }, d as unknown as ResolveAssignmentRequest)
    }, { label: 'Resolve team assignment.', summary: 'Resolves a team-assigned task to the best-suited member via the routing LLM (#189). Returns {ok:true, agentId, reason, model} or {ok:false, kind: transient|structural, message} — dispatch classifies by kind. Use it from dispatch or any surface that must turn a teamId into a concrete agent.', hookKind: 'rpc' })

    // routes registered at module scope via the lib/routes/* populate functions (T20+).

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
      name: 'bakin_exec_lesson_search',
      label: 'Searched package lessons',
      description: 'Search the enabled agent-package lessons for the calling agent.',
      parameters: {
        query: z.string().describe('Search query'),
        limit: z.number().int().positive().max(10).optional().describe('Max lessons to return (default from settings, max 10)'),
      },
      handler: async (params: Record<string, unknown>, agent: string) => {
        const query = typeof params.query === 'string' ? params.query.trim() : ''
        if (!query) return { ok: false, error: 'query required' }
        if (!agent) return { ok: false, error: 'calling agent required' }

        const baseSettings = getSettings().agentPackages?.lessonsRetrieval
        const limit = typeof params.limit === 'number'
          ? Math.max(1, Math.min(10, Math.floor(params.limit)))
          : undefined
        if (baseSettings?.enabled === false || baseSettings?.mcpTool === false) {
          return { ok: true, total: 0, lessons: [], reason: 'disabled' }
        }

        try {
          const result = await retrieveAgentPackageLessons({
            contentDir: getContentDir(),
            agentId: agent,
            query,
            settings: {
              ...baseSettings,
              ...(limit === undefined ? {} : { maxLessons: limit }),
            },
          })
          return {
            ok: true,
            packageId: result.packageId,
            total: result.lessons.length,
            reason: result.reason,
            lessons: result.lessons.map((lesson) => ({
              lessonId: lesson.lessonId,
              title: lesson.title,
              score: lesson.score,
              tags: lesson.tags,
              body: lesson.body,
            })),
          }
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) }
        }
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
      description: 'Send a message to an agent via the active runtime.',
      parameters: {
        agentId: z.string().describe('Agent ID'),
        message: z.string().describe('Message to send. Do NOT use this to brief an agent about a task they were just assigned — dispatch already notified them, and a second message starts a duplicate worker in their main session.'),
      },
      handler: async (params: Record<string, unknown>, agent: string) => {
        const agentId = params.agentId as string
        const message = params.message as string
        // Duplicate-worker guard: a message naming a task the TARGET agent is
        // already running would land unthreaded in their main session and
        // spawn a parallel worker (live-test incident, task d1b213a5). Refuse
        // hard — the dispatched run is the worker; comments go on the task.
        const taskTokens = [...new Set(message.match(/\b[0-9a-f]{8}\b/g) ?? [])]
        for (const taskId of taskTokens) {
          let live: ReturnType<typeof getLiveRun>
          try {
            live = getLiveRun(taskId)
          } catch (err) {
            // Fail CLOSED: without the ledger we cannot rule out a live run,
            // and the cost of a duplicate worker is a double bill.
            if (err instanceof LedgerUnavailableError) {
              return {
                ok: false as const,
                error: `Cannot verify whether ${agentId} is already working task ${taskId} (execution ledger unavailable) — refusing to risk a duplicate worker. Add a task comment via bakin_exec_log, or retry once the ledger is healthy.`,
              }
            }
            throw err
          }
          if (live && live.agent === agentId) {
            const ageSeconds = Math.max(0, Math.round((Date.now() - live.startedAt) / 1000))
            appendAudit(getContentDir(), 'team.message_blocked', agent, {
              agentId, taskId, runId: live.runId,
            })
            return {
              ok: false as const,
              error: `${agentId} is already working task ${taskId} (run ${live.runId}, started ${ageSeconds}s ago). Sending this message would start a duplicate worker in their main session. Add a task comment via bakin_exec_log instead, or wait for the run to finish.`,
            }
          }
        }
        const result = await sendMessageToAgent(agentId, message)
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
      description: 'Create a new agent: registers it with the active runtime, writes persona files, configures dispatch permissions, optionally assigns it to a team. Returns next-step instructions.',
      parameters: {
        id: z.string().regex(/^[a-z0-9-]+$/).optional().describe('Agent ID (lowercase alphanumeric + hyphens). Auto-derived from name if omitted.'),
        name: z.string().describe('Display name (e.g. "Jessica")'),
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
        // Tool-access provisioning is adapter-owned (create wires it up).
        resetSettingsCache()

        let runtimeRestarted = false
        try {
          await ctx.runtime.restart()
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
      description: 'Remove an agent from the active runtime and clean up Bakin state. Requires confirm=true as a safety guard.',
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
        // Tool-access provisioning is adapter-owned (remove prunes it).
        resetSettingsCache()

        let runtimeRestarted = false
        try {
          await ctx.runtime.restart()
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
    const runtimeAgentReader = {
      list: () => ctx.runtime.agents.list(),
    }

    ctx.registerHealthRepairAction(personaRepair(getContentDir(), runtimeAgentReader))
    ctx.registerHealthRepairAction(agentSyncRepair())
    ctx.registerHealthRepairAction(agentSyncMigrationRepair())
    ctx.registerHealthCheck({
      id: 'agent-roster',
      name: 'Runtime agent roster',
      description: 'Checks that the runtime agent roster is readable and every agent has a unique stable id.',
      group: { key: 'agents', label: 'Agents' },
      maxAgeMs: 2 * 60_000,
      run: () => checkAgentRoster(runtimeAgentReader),
    })
    ctx.registerHealthCheck({
      id: 'personas',
      name: 'Persona files',
      description: 'Checks that every runtime agent has a persona file.',
      group: { key: 'agents', label: 'Agents' },
      maxAgeMs: 5 * 60_000,
      run: () => checkPersonas(getContentDir(), runtimeAgentReader),
    })
    ctx.registerHealthCheck({
      id: 'agent-sync',
      name: 'Agent sync (managed blocks + projections)',
      description: 'Checks managed blocks, projections, role context, edit locks, and migration state.',
      group: { key: 'agents', label: 'Agents' },
      maxAgeMs: 2 * 60_000,
      run: () => checkAgentSync(),
    })
    ctx.registerHealthCheck({
      id: 'routing',
      name: 'Task routing readiness (#189)',
      description: 'Checks that unresolved team-assigned tasks have credentials for their routing provider.',
      group: { key: 'agents', label: 'Agents' },
      maxAgeMs: 60_000,
      run: async () => {
        const { resolveSystemRoute } = await import('../../src/core/system-route')
        const route = await resolveSystemRoute('team-routing')
        return checkTeamRouting({ routingProvider: route.model?.split('/')[0] })
      },
    })
  },

  async onReady() {
    // One-shot fold of the legacy routingProvider/routingModel settings into
    // the work-class matrix ('team-routing' row). Runs in onReady so the
    // models plugin's seed hook is guaranteed registered; seeding never
    // overwrites an existing route; the legacy keys are deleted either way.
    const ctx = pluginCtx
    if (ctx) {
      const legacy = ctx.getSettings<{ routingProvider?: string; routingModel?: string }>()
      if (legacy.routingProvider !== undefined || legacy.routingModel !== undefined) {
        const provider = legacy.routingProvider === 'openai' || legacy.routingProvider === 'google' ? legacy.routingProvider : 'anthropic'
        const model = legacy.routingModel?.trim() || DEFAULT_ROUTING_MODEL
        try {
          await ctx.hooks.invoke('models.seedWorkClassRoute', { workClass: 'team-routing', model: `${provider}/${model}` })
        } catch (err) {
          log.warn('team-routing seed migration failed; matrix route not seeded', { error: err instanceof Error ? err.message : String(err) })
        }
        ctx.updateSettings({ routingProvider: undefined, routingModel: undefined })
        log.info('Folded legacy team routing settings into the work-class matrix')
      }
    }
    await batchIndexAgents()
    log.info('Ready — team plugin using runtime agent adapter')
  },

  onShutdown() {
    log.info('Shutting down team plugin')
  },
})

export default teamPlugin
