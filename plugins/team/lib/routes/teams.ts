/**
 * Team (org) routes — org-team CRUD, membership listing, team-wide agent
 * sync, and agent-team assignment.
 *
 * Split out of `lib/team-routes.ts` (FW4). `populateOrgTeamRoutes` pushes the
 * org-team routes into the shared array at module load (the T20
 * declarative-routes pattern).
 *
 * REGISTRATION ORDER: this populate must run LAST (after
 * `populateAgentRoutes` and `populateContextRoutes`). The RouteRegistry
 * breaks specificity-score ties by insertion order, and the agent-team
 * assignment route `PUT /:agentId/team` ties with both `PUT /teams/:teamId`
 * (path `/teams/team`) and `PUT /context/:scope` (path `/context/team`) — it
 * must register after both, exactly as it did at the tail of team-routes.ts.
 */
import { z } from 'zod'

import { defineRoute } from '@bakin/core/routing'
import type { PluginContextLite } from '@bakin/core/routing'
import { getRuntimeMainAgentId } from '@bakin/core/adapters/runtime'

import { listRuntimeAgentMetas } from '../runtime-agents'
import {
  readDisplaySettings,
  writeDisplaySettings,
  readTeams,
  writeTeams,
  normalizeReportsTo,
  mergeDisplayDefaults,
} from '../team-settings'
import { getTeamMembers } from '../agent-status'
import { readTaskboard } from '../../../../src/core/task-store'
import type { OrgTeam } from '../../types'
import { passthroughTeam, errorResponseTeam } from './shared'

/** The Global context page's pseudo-team: every runtime agent. */
const GLOBAL_TEAM_ID = 'global'

export function populateOrgTeamRoutes(arr: any[]): void {

  // GET /teams — List all org teams
  arr.push(defineRoute({
    path: '/teams',
    method: 'GET',
    description: 'List organizational teams',
    summary: 'List organizational teams',
    responses: { 200: passthroughTeam, 201: passthroughTeam, 400: errorResponseTeam, 403: errorResponseTeam, 404: errorResponseTeam, 409: errorResponseTeam, 500: errorResponseTeam },
    handler: async (_req: Request, _ctx: PluginContextLite) => {
      return Response.json({ teams: readTeams() })
    },
  }))

  // POST /teams — Create a team
  arr.push(defineRoute({
    path: '/teams',
    method: 'POST',
    description: 'Create an organizational team',
    summary: 'Create an organizational team',
    responses: { 200: passthroughTeam, 201: passthroughTeam, 400: errorResponseTeam, 403: errorResponseTeam, 404: errorResponseTeam, 409: errorResponseTeam, 500: errorResponseTeam },
    handler: async (req: Request, ctx: PluginContextLite) => {
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
  }))

  // PUT /teams/:teamId — Update a team
  arr.push(defineRoute({
    path: '/teams/:teamId',
    method: 'PUT',
    description: 'Update an organizational team',
    summary: 'Update an organizational team',
    params: z.object({ teamId: z.string() }),
    responses: { 200: passthroughTeam, 201: passthroughTeam, 400: errorResponseTeam, 403: errorResponseTeam, 404: errorResponseTeam, 409: errorResponseTeam, 500: errorResponseTeam },
    handler: async (req: Request, ctx: PluginContextLite) => {
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
  }))

  // DELETE /teams/:teamId — Delete a team (unassigns agents)
  arr.push(defineRoute({
    path: '/teams/:teamId',
    method: 'DELETE',
    description: 'Delete an organizational team',
    summary: 'Delete an organizational team',
    params: z.object({ teamId: z.string() }),
    responses: { 200: passthroughTeam, 201: passthroughTeam, 400: errorResponseTeam, 403: errorResponseTeam, 404: errorResponseTeam, 409: errorResponseTeam, 500: errorResponseTeam },
    handler: async (req: Request, ctx: PluginContextLite) => {
      const url = new URL(req.url)
      const teamId = url.searchParams.get('teamId')
      if (!teamId) return Response.json({ error: 'teamId required' }, { status: 400 })

      const teams = readTeams()
      const filtered = teams.filter((t) => t.id !== teamId)
      if (filtered.length === teams.length) return Response.json({ error: 'Team not found' }, { status: 404 })

      // Refuse while ACTIVE tasks still reference this team (review R6):
      // unresolved team tasks would structurally block at dispatch, and
      // resolved ones would lose their requested-team context. Schedule
      // jobs referencing a deleted team are handled at fire time instead —
      // the occurrence lands blocked with an honest reason.
      const { columns } = readTaskboard()
      const activeColumns = ['backlog', 'todo', 'inProgress', 'review', 'blocked'] as const
      const referencing = activeColumns.flatMap(
        (col) => (columns[col] ?? []).filter((t) => t.team === teamId),
      )
      if (referencing.length > 0) {
        return Response.json({
          error: `Team "${teamId}" is still assigned to ${referencing.length} active task(s) — re-assign or complete them first`,
          taskIds: referencing.map((t) => t.id),
        }, { status: 409 })
      }

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
  }))

  // GET /teams/:teamId/members — List agents in a team
  arr.push(defineRoute({
    path: '/teams/:teamId/members',
    method: 'GET',
    description: 'List agents belonging to a team',
    summary: 'List agents belonging to a team',
    params: z.object({ teamId: z.string() }),
    responses: { 200: passthroughTeam, 201: passthroughTeam, 400: errorResponseTeam, 403: errorResponseTeam, 404: errorResponseTeam, 409: errorResponseTeam, 500: errorResponseTeam },
    handler: async (req: Request, ctx: PluginContextLite) => {
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
  }))

  // POST /teams/:teamId/sync — sync every member of a team (`global`: every agent)
  arr.push(defineRoute({
    path: '/teams/:teamId/sync',
    method: 'POST',
    description: 'Sync every member agent of a team as one operation (recompose blocks, re-project, verify) — 202 { operationId, bootId }',
    summary: 'Sync every member agent of a team',
    params: z.object({ teamId: z.string() }),
    responses: { 200: passthroughTeam, 201: passthroughTeam, 202: passthroughTeam, 400: errorResponseTeam, 403: errorResponseTeam, 404: errorResponseTeam, 409: errorResponseTeam, 500: errorResponseTeam },
    handler: async (req: Request, ctx: PluginContextLite) => {
      const url = new URL(req.url)
      const teamId = url.searchParams.get('teamId')
      if (!teamId) return Response.json({ ok: false, error: 'teamId required' }, { status: 400 })
      // `global` is every runtime agent — the Global context page syncs them all.
      const isGlobal = teamId === GLOBAL_TEAM_ID
      if (!isGlobal && !readTeams().some((t) => t.id === teamId)) {
        return Response.json({ ok: false, error: `Team "${teamId}" not found` }, { status: 404 })
      }

      const body = await req.json().catch(() => ({})) as { check?: boolean; fetch?: boolean }
      const check = body.check === true
      const fetch = body.fetch ?? false
      const { syncAgent } = await import('../../../../src/core/agent-packages/sync')
      const { reloadAgentPackageRegistries } = await import('../../../../src/core/agent-packages/post-sync-reload')
      const { TEAM_SYNC_STAGE, teamSyncPlan } = await import('../../../../src/core/agent-packages/operation-plans')

      // One operation for the whole team (#895): members are items; a failed
      // member never strands the rest. A check holds nothing.
      const started = await ctx.operations.start({
        kind: 'sync',
        title: isGlobal ? `${check ? 'Check' : 'Sync'} all agents` : `${check ? 'Check' : 'Sync'} team ${teamId}`,
        href: `/team/teams/${encodeURIComponent(teamId)}`,
        fingerprint: `team-sync:${teamId}|${check ? 'check' : ''}|${fetch ? 'fetch' : ''}`,
        resources: check ? [] : ['install-state'],
        plan: teamSyncPlan(check),
        request: req,
        run: async (op) => {
          const memberIds = isGlobal
            ? (await listRuntimeAgentMetas(ctx.runtime)).map((agent) => agent.id)
            : await getTeamMembers(ctx.runtime, teamId)
          op.stage(TEAM_SYNC_STAGE)
          for (const agentId of memberIds) op.item(TEAM_SYNC_STAGE, { id: agentId, label: agentId })
          const results: Array<{ agentId: string; receipt?: unknown; error?: string }> = []
          for (const agentId of memberIds) {
            op.item(TEAM_SYNC_STAGE, { id: agentId, label: agentId, status: 'active' })
            try {
              results.push({ agentId, receipt: await syncAgent(agentId, { check, fetch, trigger: 'rest' }) })
              op.item(TEAM_SYNC_STAGE, { id: agentId, label: agentId, status: 'done' })
            } catch (err) {
              const error = err instanceof Error ? err.message : String(err)
              results.push({ agentId, error })
              op.item(TEAM_SYNC_STAGE, { id: agentId, label: agentId, status: 'failed', message: error })
            }
          }
          if (!check) await reloadAgentPackageRegistries({ kind: 'synced' })
          const failed = results.filter((r) => r.error).length
          return {
            status: failed > 0 && failed === results.length ? 'failed' : 'succeeded',
            code: failed === 0 ? 'ok' : failed === results.length ? 'failed' : 'partially_applied',
            ...(failed > 0 ? { message: `${failed} of ${results.length} member(s) failed to sync` } : {}),
            httpStatus: 200,
            body: { ok: true, teamId, results },
          }
        },
      })
      return Response.json(started, { status: started.attached ? 200 : 202 })
    },
  }))

  // PUT /:agentId/team — Assign agent to a team
  arr.push(defineRoute({
    path: '/:agentId/team',
    method: 'PUT',
    description: 'Assign an agent to an organizational team',
    summary: 'Assign an agent to an organizational team',
    params: z.object({ agentId: z.string() }),
    responses: { 200: passthroughTeam, 201: passthroughTeam, 400: errorResponseTeam, 403: errorResponseTeam, 404: errorResponseTeam, 409: errorResponseTeam, 500: errorResponseTeam },
    handler: async (req: Request, ctx: PluginContextLite) => {
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
  }))
}
