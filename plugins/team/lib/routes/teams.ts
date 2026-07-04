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
import type { OrgTeam } from '../../types'
import { passthroughTeam, errorResponseTeam } from './shared'

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

  // POST /teams/:teamId/sync — sync every member of a team
  arr.push(defineRoute({
    path: '/teams/:teamId/sync',
    method: 'POST',
    description: 'Sync every member agent of a team (recompose blocks, re-project, verify)',
    summary: 'Sync every member agent of a team',
    params: z.object({ teamId: z.string() }),
    responses: { 200: passthroughTeam, 201: passthroughTeam, 400: errorResponseTeam, 403: errorResponseTeam, 404: errorResponseTeam, 409: errorResponseTeam, 500: errorResponseTeam },
    handler: async (req: Request, ctx: PluginContextLite) => {
      const url = new URL(req.url)
      const teamId = url.searchParams.get('teamId')
      if (!teamId) return Response.json({ ok: false, error: 'teamId required' }, { status: 400 })
      if (!readTeams().some((t) => t.id === teamId)) {
        return Response.json({ ok: false, error: `Team "${teamId}" not found` }, { status: 404 })
      }

      const body = await req.json().catch(() => ({})) as { check?: boolean; fetch?: boolean }
      const { syncAgent } = await import('../../../../src/core/agent-packages/sync')
      const { reloadAgentPackageRegistries } = await import('../../../../src/core/agent-packages/post-sync-reload')

      const memberIds = await getTeamMembers(ctx.runtime, teamId)
      const results: Array<{ agentId: string; receipt?: unknown; error?: string }> = []
      for (const agentId of memberIds) {
        try {
          results.push({
            agentId,
            receipt: await syncAgent(agentId, {
              check: body.check,
              fetch: body.fetch ?? false,
              trigger: 'rest',
            }),
          })
        } catch (err) {
          results.push({ agentId, error: err instanceof Error ? err.message : String(err) })
        }
      }
      if (!body.check) await reloadAgentPackageRegistries({ kind: 'synced' })
      return Response.json({ ok: true, teamId, results })
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
