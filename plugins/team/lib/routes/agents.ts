/**
 * Agent routes — lifecycle, identity, permissions, avatar, workspace files,
 * skills, memory, stats, heartbeat, activity, and display settings.
 *
 * Split out of `lib/team-routes.ts` (FW4). `populateAgentRoutes` pushes every
 * agent-scoped route into the shared array at module load (the T20
 * declarative-routes pattern). Handlers receive their PluginContextLite per
 * request; the one piece of plugin-scope wiring they need — the search-index
 * helper — is injected via `deps` so this module stays free of the plugin's
 * live context state.
 */
import { z } from 'zod'
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'

import { defineRoute } from '@bakin/core/routing'
import type { PluginContextLite } from '@bakin/core/routing'
import { serveAvatar, detectImageExtension } from '@bakin/core/agents/avatar'
import { removeInstalledBy } from '@bakin/core/agent-packages/markers'
import { getRuntimeMainAgentId, RuntimeError } from '@bakin/core/adapters/runtime'

import { createLogger } from '../../../../src/core/logger'
import { readHeartbeats } from '../../../../src/lib/content-files'
import { getBakinPaths } from '../../../../packages/core/src/content-dir'
import { startAgent, stopAgent } from '../../../../src/lib/agents'
import { resetSettingsCache } from '../../../../src/core/settings'
import { getAllAgentUsage } from '../../../../src/core/agent-usage'
import { getStatsByMs } from '../../../../src/core/usage'
import { readLatestSessionTranscript } from '../session-reader'
import { listRunsByAgent } from '../../../../src/core/execution-ledger'
import { queryAuditEvents } from '../../../../src/core/audit'
import {
  assembleTimeline,
  TIMELINE_AUDIT_KINDS,
  TIMELINE_MAX_RUNS,
  TIMELINE_MAX_EVENTS,
  type TimelineTaskInfo,
} from '../timeline'

import {
  agentToMeta,
  getRuntimeAgentIds,
  getRuntimeAgentModel,
  getRuntimeAgentProfile,
  createRuntimeAgent,
  addToRuntimeAllowlists,
  removeFromRuntimeAllowlists,
  removeRuntimeAgent,
  updateRuntimeAgentIdentity,
  setRuntimeSubagentPermissions,
  SelfDispatchError,
  listRuntimeSkills,
  readRuntimeSkillFile,
  listRuntimeMemoryFiles,
  readRuntimeMemoryFile,
  readRuntimeHeartbeatRaw,
} from '../runtime-agents'
import {
  readDisplaySettings,
  writeDisplaySettings,
  readTeams,
  degradeUnknownReportsTo,
  mergeDisplayDefaults,
} from '../team-settings'
import {
  getLastAuditActivity,
  resolveAgentStatus,
} from '../agent-status'
import type {
  AgentWithStatus,
  AgentDisplaySettingsMap,
} from '../../types'
import { passthroughTeam, errorResponseTeam } from './shared'

const log = createLogger('team')

export interface TeamRouteDeps {
  /** Fire-and-forget search-index upsert for an agent (plugin-context-backed). */
  indexAgentStatic: (agentId: string, agent: { id: string; name: string }, model: string, status: string) => void
}

export function populateAgentRoutes(arr: any[], deps: TeamRouteDeps): void {

  // GET / — List all agents with status
  arr.push(defineRoute({
    path: '/',
    method: 'GET',
    activityClass: 'routine',
    description: 'List all agents with runtime status',
    summary: 'List all agents with runtime status',
    responses: { 200: passthroughTeam, 201: passthroughTeam, 400: errorResponseTeam, 403: errorResponseTeam, 404: errorResponseTeam, 409: errorResponseTeam, 500: errorResponseTeam },
    handler: async (_req: Request, ctx: PluginContextLite) => {
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
  }))

  // POST / — Create a new agent
  arr.push(defineRoute({
    path: '/',
    method: 'POST',
    description: 'Create a new agent in the active runtime',
    summary: 'Create a new agent in the active runtime',
    responses: { 200: passthroughTeam, 201: passthroughTeam, 400: errorResponseTeam, 403: errorResponseTeam, 404: errorResponseTeam, 409: errorResponseTeam, 500: errorResponseTeam },
    handler: async (req: Request, ctx: PluginContextLite) => {
      try {
        const body = await req.json() as Record<string, unknown>
        const id = (body.id as string || '').toLowerCase().replace(/[^a-z0-9-]/g, '')
        if (!id) return Response.json({ error: 'id is required (lowercase alphanumeric)' }, { status: 400 })
        if (!body.name) return Response.json({ error: 'name is required' }, { status: 400 })

        // Existence pre-check for the 409 — typed and adapter-neutral
        // (adapters throw kind 'runtime_failed' for creates on existing ids,
        // which is not distinguishable from other failures; absence-as-null
        // via get() is the contract's honest existence probe).
        if (await ctx.runtime.agents.get(id)) {
          return Response.json({ error: `Agent already exists: ${id}` }, { status: 409 })
        }

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
        deps.indexAgentStatic(id, { id, name: body.name as string }, body.model as string || '', 'offline')

        // The runtime adapter provisions the new agent's tool-access wiring
        // during create (OpenClaw MCP entry / Pi no-op) — nothing to sync here.
        resetSettingsCache()

        // Restart the active runtime unless caller opted out
        const url = new URL(req.url)
        const skipRestart = url.searchParams.get('skipRestart') === 'true'
        if (!skipRestart) {
          ctx.runtime.restart().then(() => {
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
        return Response.json({ error: msg }, { status: 500 })
      }
    },
  }))

  // DELETE /:agentId — Remove an agent from the active runtime
  arr.push(defineRoute({
    path: '/:agentId',
    method: 'DELETE',
    description: 'Remove an agent from the active runtime and move workspace to trash',
    summary: 'Remove an agent from the active runtime and move workspace to trash',
    params: z.object({ agentId: z.string() }),
    responses: { 200: passthroughTeam, 201: passthroughTeam, 400: errorResponseTeam, 403: errorResponseTeam, 404: errorResponseTeam, 409: errorResponseTeam, 500: errorResponseTeam },
    handler: async (req: Request, ctx: PluginContextLite) => {
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
        // The runtime adapter prunes the departed agent's tool-access wiring
        // during remove (stale OpenClaw MCP entry / Pi no-op).
        resetSettingsCache()

        // Restart the active runtime
        ctx.runtime.restart().then(() => {
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
  }))

  // PUT /:agentId/identity — Update agent identity fields
  arr.push(defineRoute({
    path: '/:agentId/identity',
    method: 'PUT',
    description: 'Update agent identity fields and persona files',
    summary: 'Update agent identity fields and persona files',
    params: z.object({ agentId: z.string() }),
    responses: { 200: passthroughTeam, 201: passthroughTeam, 400: errorResponseTeam, 403: errorResponseTeam, 404: errorResponseTeam, 409: errorResponseTeam, 500: errorResponseTeam },
    handler: async (req: Request, ctx: PluginContextLite) => {
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
        // Typed classification (R28): kind, never message text — both
        // adapters and the roster pre-check reject missing agents with
        // RuntimeError kind 'not_found'.
        const msg = err instanceof Error ? err.message : String(err)
        const status = err instanceof RuntimeError && err.kind === 'not_found' ? 404 : 500
        return Response.json({ error: msg }, { status })
      }
    },
  }))

  // PUT /:agentId/permissions — Update dispatch permissions
  arr.push(defineRoute({
    path: '/:agentId/permissions',
    method: 'PUT',
    description: 'Update agent dispatch permissions (subagents.allowAgents)',
    summary: 'Update agent dispatch permissions (subagents.allowAgents)',
    params: z.object({ agentId: z.string() }),
    responses: { 200: passthroughTeam, 201: passthroughTeam, 400: errorResponseTeam, 403: errorResponseTeam, 404: errorResponseTeam, 409: errorResponseTeam, 500: errorResponseTeam },
    handler: async (req: Request, ctx: PluginContextLite) => {
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
        const status = err instanceof RuntimeError && err.kind === 'not_found'
          ? 404
          : err instanceof SelfDispatchError
            ? 400
            : 500
        return Response.json({ error: msg }, { status })
      }
    },
  }))

  // POST /:agentId/avatar — Upload avatar image
  arr.push(defineRoute({
    path: '/:agentId/avatar',
    method: 'POST',
    description: 'Upload agent avatar image',
    summary: 'Upload agent avatar image',
    params: z.object({ agentId: z.string() }),
    responses: { 200: passthroughTeam, 201: passthroughTeam, 400: errorResponseTeam, 403: errorResponseTeam, 404: errorResponseTeam, 409: errorResponseTeam, 500: errorResponseTeam },
    handler: async (req: Request, ctx: PluginContextLite) => {
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

        const ext = detectImageExtension(imageBuffer)
        if (!ext) {
          return Response.json({ error: 'Unsupported image format' }, { status: 400 })
        }

        const { agents } = getBakinPaths()
        const agentDir = join(agents, agentId)
        if (!existsSync(agentDir)) mkdirSync(agentDir, { recursive: true })
        writeFileSync(join(agentDir, `avatar.${ext}`), imageBuffer)

        // Keep exactly one canonical avatar: drop any other-format siblings
        // (and their package `.installedBy` sidecars) so a new upload always wins.
        for (const other of ['webp', 'png', 'jpg']) {
          if (other === ext) continue
          const sibling = join(agentDir, `avatar.${other}`)
          if (existsSync(sibling)) {
            unlinkSync(sibling)
            removeInstalledBy(sibling)
          }
        }

        ctx.activity.audit('agent.avatar.updated', 'system', { agent: agentId })
        return Response.json({ ok: true })
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    },
  }))

  // GET /:agentId — Full agent profile
  arr.push(defineRoute({
    path: '/:agentId',
    method: 'GET',
    description: 'Get full agent profile merged from runtime state',
    summary: 'Get full agent profile merged from runtime state',
    params: z.object({ agentId: z.string() }),
    responses: { 200: passthroughTeam, 201: passthroughTeam, 400: errorResponseTeam, 403: errorResponseTeam, 404: errorResponseTeam, 409: errorResponseTeam, 500: errorResponseTeam },
    handler: async (req: Request, ctx: PluginContextLite) => {
      const url = new URL(req.url)
      const agentId = url.searchParams.get('agentId')
      if (!agentId) return Response.json({ error: 'agentId required' }, { status: 400 })

      const profile = await getRuntimeAgentProfile(ctx.runtime, agentId)
      if (!profile) return Response.json({ error: 'Agent not found' }, { status: 404 })

      return Response.json(profile)
    },
  }))

  // GET /:agentId/files — List workspace files
  arr.push(defineRoute({
    path: '/:agentId/files',
    method: 'GET',
    description: 'List workspace files for an agent',
    summary: 'List workspace files for an agent',
    params: z.object({ agentId: z.string() }),
    responses: { 200: passthroughTeam, 201: passthroughTeam, 400: errorResponseTeam, 403: errorResponseTeam, 404: errorResponseTeam, 409: errorResponseTeam, 500: errorResponseTeam },
    handler: async (req: Request, ctx: PluginContextLite) => {
      const url = new URL(req.url)
      const agentId = url.searchParams.get('agentId')
      if (!agentId) return Response.json({ error: 'agentId required' }, { status: 400 })

      const files = await ctx.runtime.agents.listWorkspaceFiles(agentId)
      return Response.json({ files })
    },
  }))

  // GET /:agentId/files/:filename — Read a workspace file
  arr.push(defineRoute({
    path: '/:agentId/files/:filename',
    method: 'GET',
    description: 'Read a specific workspace file',
    summary: 'Read a specific workspace file',
    params: z.object({ agentId: z.string(), filename: z.string() }),
    responses: { 200: passthroughTeam, 201: passthroughTeam, 400: errorResponseTeam, 403: errorResponseTeam, 404: errorResponseTeam, 409: errorResponseTeam, 500: errorResponseTeam },
    handler: async (req: Request, ctx: PluginContextLite) => {
      const url = new URL(req.url)
      const agentId = url.searchParams.get('agentId')
      const filename = url.searchParams.get('filename')
      if (!agentId || !filename) return Response.json({ error: 'agentId and filename required' }, { status: 400 })

      const file = await ctx.runtime.agents.readWorkspaceFile(agentId, filename)
      if (file === null) return Response.json({ error: 'File not found' }, { status: 404 })

      return Response.json({ filename, content: file.content })
    },
  }))

  // PUT /:agentId/files/:filename — Write a workspace file
  arr.push(defineRoute({
    path: '/:agentId/files/:filename',
    method: 'PUT',
    description: 'Write a workspace file through the active runtime',
    summary: 'Write a workspace file through the active runtime',
    params: z.object({ agentId: z.string(), filename: z.string() }),
    responses: { 200: passthroughTeam, 201: passthroughTeam, 400: errorResponseTeam, 403: errorResponseTeam, 404: errorResponseTeam, 409: errorResponseTeam, 500: errorResponseTeam },
    handler: async (req: Request, ctx: PluginContextLite) => {
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
  }))

  // GET /:agentId/skills — List installed skills
  arr.push(defineRoute({
    path: '/:agentId/skills',
    method: 'GET',
    description: 'List installed skills for an agent',
    summary: 'List installed skills for an agent',
    params: z.object({ agentId: z.string() }),
    responses: { 200: passthroughTeam, 201: passthroughTeam, 400: errorResponseTeam, 403: errorResponseTeam, 404: errorResponseTeam, 409: errorResponseTeam, 500: errorResponseTeam },
    handler: async (req: Request, ctx: PluginContextLite) => {
      const url = new URL(req.url)
      const agentId = url.searchParams.get('agentId')
      if (!agentId) return Response.json({ error: 'agentId required' }, { status: 400 })

      const skills = await listRuntimeSkills(ctx.runtime, agentId)
      return Response.json({ skills })
    },
  }))

  // GET /:agentId/skills/:skillId — Read SKILL.md
  arr.push(defineRoute({
    path: '/:agentId/skills/:skillId',
    method: 'GET',
    description: 'Read SKILL.md for a specific skill',
    summary: 'Read SKILL.md for a specific skill',
    params: z.object({ agentId: z.string(), skillId: z.string() }),
    responses: { 200: passthroughTeam, 201: passthroughTeam, 400: errorResponseTeam, 403: errorResponseTeam, 404: errorResponseTeam, 409: errorResponseTeam, 500: errorResponseTeam },
    handler: async (req: Request, ctx: PluginContextLite) => {
      const url = new URL(req.url)
      const agentId = url.searchParams.get('agentId')
      const skillId = url.searchParams.get('skillId')
      if (!agentId || !skillId) return Response.json({ error: 'agentId and skillId required' }, { status: 400 })

      const content = await readRuntimeSkillFile(ctx.runtime, agentId, skillId)
      if (content === null) return Response.json({ error: 'Skill not found' }, { status: 404 })

      return Response.json({ skillId, content })
    },
  }))

  // GET /:agentId/memory — List memory files
  arr.push(defineRoute({
    path: '/:agentId/memory',
    method: 'GET',
    description: 'List memory files for an agent',
    summary: 'List memory files for an agent',
    params: z.object({ agentId: z.string() }),
    responses: { 200: passthroughTeam, 201: passthroughTeam, 400: errorResponseTeam, 403: errorResponseTeam, 404: errorResponseTeam, 409: errorResponseTeam, 500: errorResponseTeam },
    handler: async (req: Request, ctx: PluginContextLite) => {
      const url = new URL(req.url)
      const agentId = url.searchParams.get('agentId')
      if (!agentId) return Response.json({ error: 'agentId required' }, { status: 400 })

      const files = await listRuntimeMemoryFiles(ctx.runtime, agentId)
      return Response.json({ files })
    },
  }))

  // GET /:agentId/memory/:date — Read a memory file
  arr.push(defineRoute({
    path: '/:agentId/memory/:date',
    method: 'GET',
    description: 'Read a specific memory file',
    summary: 'Read a specific memory file',
    params: z.object({ agentId: z.string(), date: z.string() }),
    responses: { 200: passthroughTeam, 201: passthroughTeam, 400: errorResponseTeam, 403: errorResponseTeam, 404: errorResponseTeam, 409: errorResponseTeam, 500: errorResponseTeam },
    handler: async (req: Request, ctx: PluginContextLite) => {
      const url = new URL(req.url)
      const agentId = url.searchParams.get('agentId')
      const date = url.searchParams.get('date')
      if (!agentId || !date) return Response.json({ error: 'agentId and date required' }, { status: 400 })

      const content = await readRuntimeMemoryFile(ctx.runtime, agentId, date)
      if (content === null) return Response.json({ error: 'Memory file not found' }, { status: 404 })

      return Response.json({ date, content })
    },
  }))

  // GET /:agentId/stats — Token usage and cost
  arr.push(defineRoute({
    path: '/:agentId/stats',
    method: 'GET',
    description: 'Get token usage and cost stats for an agent',
    summary: 'Get token usage and cost stats for an agent',
    params: z.object({ agentId: z.string() }),
    responses: { 200: passthroughTeam, 201: passthroughTeam, 400: errorResponseTeam, 403: errorResponseTeam, 404: errorResponseTeam, 409: errorResponseTeam, 500: errorResponseTeam },
    handler: async (req: Request, ctx: PluginContextLite) => {
      const url = new URL(req.url)
      const agentId = url.searchParams.get('agentId')
      if (!agentId) return Response.json({ error: 'agentId required' }, { status: 400 })

      const allUsage = await getAllAgentUsage(ctx.runtime)
      const usage = allUsage.find((u) => u.agent === agentId)

      return Response.json({ usage: usage ?? null })
    },
  }))

  // GET /:agentId/heartbeat — Raw HEARTBEAT.md content + lastUpdated
  arr.push(defineRoute({
    path: '/:agentId/heartbeat',
    method: 'GET',
    description: 'Read the agent HEARTBEAT.md narrative + file mtime',
    summary: 'Read the agent heartbeat narrative',
    params: z.object({ agentId: z.string() }),
    responses: { 200: passthroughTeam, 201: passthroughTeam, 400: errorResponseTeam, 403: errorResponseTeam, 404: errorResponseTeam, 409: errorResponseTeam, 500: errorResponseTeam },
    handler: async (req: Request, ctx: PluginContextLite) => {
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
  }))

  // GET /:agentId/active-context — Latest session transcript (read-only)
  arr.push(defineRoute({
    path: '/:agentId/active-context',
    method: 'GET',
    description: 'Read the most recent session JSONL parsed into a message stream',
    summary: 'Read the most recent session JSONL parsed into a message stream',
    params: z.object({ agentId: z.string() }),
    responses: { 200: passthroughTeam, 201: passthroughTeam, 400: errorResponseTeam, 403: errorResponseTeam, 404: errorResponseTeam, 409: errorResponseTeam, 500: errorResponseTeam },
    handler: async (req: Request, ctx: PluginContextLite) => {
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
  }))

  // GET /:agentId/recent-activity — In-memory dispatch counts per window
  arr.push(defineRoute({
    path: '/:agentId/recent-activity',
    method: 'GET',
    description: 'Per-agent dispatch + error counts across 5m / 1h / 24h windows (resets on server restart)',
    summary: 'Per-agent dispatch + error counts across 5m / 1h / 24h windows (resets on server restart)',
    params: z.object({ agentId: z.string() }),
    responses: { 200: passthroughTeam, 201: passthroughTeam, 400: errorResponseTeam, 403: errorResponseTeam, 404: errorResponseTeam, 409: errorResponseTeam, 500: errorResponseTeam },
    handler: async (req: Request, _ctx: PluginContextLite) => {
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
  }))

  // GET /:agentId/timeline — Run spine + notable audit events (#385)
  arr.push(defineRoute({
    path: '/:agentId/timeline',
    method: 'GET',
    description: 'Per-agent activity timeline: dispatch runs with tokens/cost/outcome (execution ledger) interleaved with notable audit events, plus per-run progress-log lines',
    summary: 'Per-agent activity timeline (runs + notable events)',
    params: z.object({ agentId: z.string() }),
    responses: { 200: passthroughTeam, 400: errorResponseTeam, 500: errorResponseTeam },
    handler: async (req: Request, ctx: PluginContextLite) => {
      const url = new URL(req.url)
      const agentId = url.searchParams.get('agentId')
      if (!agentId) return Response.json({ ok: false, error: 'agentId required' }, { status: 400 })
      const windowParam = url.searchParams.get('window') ?? '24h'
      const windowMs = windowParam === '7d' ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000
      if (windowParam !== '24h' && windowParam !== '7d') {
        return Response.json({ ok: false, error: 'window must be 24h or 7d' }, { status: 400 })
      }

      try {
        const now = Date.now()
        const runs = listRunsByAgent(agentId, { sinceMs: now - windowMs, limit: TIMELINE_MAX_RUNS })
        const auditEvents = queryAuditEvents(getBakinPaths().home, {
          agent: agentId,
          kinds: [...TIMELINE_AUDIT_KINDS],
          sinceMs: windowMs,
          limit: TIMELINE_MAX_EVENTS,
        })
        // Bypass events are written by the WATCHDOG actor (top-level agent =
        // 'watchdog'; the offending agent is in data.agent) — fetch them
        // separately and filter by attribution.
        const bypassEvents = queryAuditEvents(getBakinPaths().home, {
          kinds: ['task.bypass_detected'],
          sinceMs: windowMs,
          limit: TIMELINE_MAX_EVENTS,
        }).filter((e) => e.agent !== agentId && e.data.agent === agentId)
        const taskById = new Map<string, TimelineTaskInfo>()
        for (const taskId of new Set(runs.map((r) => r.taskId))) {
          try {
            const task = await ctx.tasks.get(taskId)
            if (task) taskById.set(taskId, { title: task.title, log: task.log ?? [] })
          } catch { /* purged task — run row still renders without title/logs */ }
        }
        const events = assembleTimeline({ runs, auditEvents: [...auditEvents, ...bypassEvents], taskById, now })
        return Response.json({ ok: true, agent: agentId, window: windowParam, events })
      } catch (err) {
        log.error('Failed to assemble agent timeline', err, { agentId })
        return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    },
  }))

  // GET /:agentId/avatar — Serve agent avatar (webp/png/jpg, via shared resolver)
  arr.push(defineRoute({
    path: '/:agentId/avatar',
    method: 'GET',
    activityClass: 'routine',
    description: 'Serve agent avatar image',
    summary: 'Serve agent avatar image',
    params: z.object({ agentId: z.string() }),
    // 304: serveAvatar honors If-None-Match/If-Modified-Since (RFC 7232) —
    // undeclared, every conditional browser refetch logs a dev-validator warn.
    responses: { 200: { contentType: 'application/octet-stream' }, 304: { contentType: 'none' }, 400: errorResponseTeam, 404: errorResponseTeam, 500: errorResponseTeam },
    handler: async (req: Request, _ctx: PluginContextLite) => {
      const url = new URL(req.url)
      const agentId = url.searchParams.get('agentId')
      if (!agentId) return Response.json({ error: 'agentId required' }, { status: 400 })

      return serveAvatar(req, agentId)
    },
  }))

  // POST /:agentId/start — Start agent
  arr.push(defineRoute({
    path: '/:agentId/start',
    method: 'POST',
    description: 'Start an agent via the active runtime',
    summary: 'Start an agent via the active runtime',
    params: z.object({ agentId: z.string() }),
    responses: { 200: passthroughTeam, 201: passthroughTeam, 400: errorResponseTeam, 403: errorResponseTeam, 404: errorResponseTeam, 409: errorResponseTeam, 500: errorResponseTeam },
    handler: async (req: Request, ctx: PluginContextLite) => {
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
  }))

  // POST /:agentId/stop — Stop agent
  arr.push(defineRoute({
    path: '/:agentId/stop',
    method: 'POST',
    description: 'Stop an agent',
    summary: 'Stop an agent',
    params: z.object({ agentId: z.string() }),
    responses: { 200: passthroughTeam, 201: passthroughTeam, 400: errorResponseTeam, 403: errorResponseTeam, 404: errorResponseTeam, 409: errorResponseTeam, 500: errorResponseTeam },
    handler: async (req: Request, _ctx: PluginContextLite) => {
      const url = new URL(req.url)
      const agentId = url.searchParams.get('agentId')
      if (!agentId) return Response.json({ error: 'agentId required' }, { status: 400 })

      const result = await stopAgent(agentId)
      return Response.json(result)
    },
  }))

  // GET /settings — Display settings
  arr.push(defineRoute({
    path: '/settings',
    method: 'GET',
    description: 'Get agent display settings',
    summary: 'Get agent display settings',
    responses: { 200: passthroughTeam, 201: passthroughTeam, 400: errorResponseTeam, 403: errorResponseTeam, 404: errorResponseTeam, 409: errorResponseTeam, 500: errorResponseTeam },
    handler: async (_req: Request, ctx: PluginContextLite) => {
      const raw = readDisplaySettings()
      return Response.json(await mergeDisplayDefaults(ctx.runtime, raw))
    },
  }))

  // PUT /settings — Update display settings
  arr.push(defineRoute({
    path: '/settings',
    method: 'PUT',
    description: 'Update agent display settings',
    summary: 'Update agent display settings',
    responses: { 200: passthroughTeam, 201: passthroughTeam, 400: errorResponseTeam, 403: errorResponseTeam, 404: errorResponseTeam, 409: errorResponseTeam, 500: errorResponseTeam },
    handler: async (req: Request, _ctx: PluginContextLite) => {
      const body = await req.json() as AgentDisplaySettingsMap
      writeDisplaySettings(body)
      return Response.json({ ok: true })
    },
  }))
}
