/**
 * Layered context file routes (layered-context spec, C9).
 *
 * Split out of `lib/team-routes.ts` (FW4). `populateContextRoutes` pushes the
 * context-file routes into the shared array at module load (the T20
 * declarative-routes pattern).
 *
 * REGISTRATION ORDER: this populate must run AFTER `populateAgentRoutes` and
 * BEFORE `populateOrgTeamRoutes`. The RouteRegistry breaks specificity-score
 * ties by insertion order, and paths like `/context/files` (agent files route
 * vs `/context/:scope`) and `/context/team` (`/context/:scope` vs the
 * agent-team assignment route `/:agentId/team`) rely on it.
 */
import { z } from 'zod'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'

import { defineRoute } from '@bakin/core/routing'

import { readTeams } from '../team-settings'
import { passthroughTeam, errorResponseTeam } from './shared'

export function populateContextRoutes(arr: any[]): void {

  // ─── Layered context files (layered-context spec, C9) ────────────────────
  // Scope segment: 'global' | 'role' (with :id orchestrator|subagent) |
  // 'team' (with :id = teamId). PUT replaces the file; role files get their
  // Bakin-managed block re-asserted afterwards so a mangled block can't
  // brick the role defaults.

  // GET /context — full overview for the UI
  arr.push(defineRoute({
    path: '/context',
    method: 'GET',
    description: 'List layered context files (global, roles, teams)',
    summary: 'List layered context files',
    responses: { 200: passthroughTeam, 201: passthroughTeam, 400: errorResponseTeam, 403: errorResponseTeam, 404: errorResponseTeam, 409: errorResponseTeam, 500: errorResponseTeam },
    handler: async () => {
      const { getGlobalContextPath, getRoleContextPath, getTeamContextPath, seedContextFiles } = await import('../../../../src/core/team-context')
      seedContextFiles()
      const read = (path: string) => existsSync(path) ? readFileSync(path, 'utf-8') : null
      const teams = readTeams()
      return Response.json({
        ok: true,
        global: { path: getGlobalContextPath(), content: read(getGlobalContextPath()) },
        roles: {
          orchestrator: { path: getRoleContextPath('orchestrator'), content: read(getRoleContextPath('orchestrator')) },
          subagent: { path: getRoleContextPath('subagent'), content: read(getRoleContextPath('subagent')) },
        },
        teams: teams.map((t) => ({
          teamId: t.id,
          label: t.label,
          path: getTeamContextPath(t.id),
          content: read(getTeamContextPath(t.id)),
        })),
      })
    },
  }))

  // GET/PUT /context/:scope/:id? — read or write one context file
  for (const method of ['GET', 'PUT'] as const) {
    arr.push(defineRoute({
      path: '/context/:scope',
      method,
      description: `${method === 'GET' ? 'Read' : 'Write'} a layered context file (scope: global, or role/team via ?id=)`,
      summary: `${method === 'GET' ? 'Read' : 'Write'} a layered context file`,
      params: z.object({ scope: z.string() }),
      responses: { 200: passthroughTeam, 201: passthroughTeam, 400: errorResponseTeam, 403: errorResponseTeam, 404: errorResponseTeam, 409: errorResponseTeam, 500: errorResponseTeam },
      handler: async (req: Request) => {
        const url = new URL(req.url)
        const scope = url.searchParams.get('scope') ?? ''
        const id = url.searchParams.get('id') ?? ''
        const ctxMod = await import('../../../../src/core/team-context')

        let path: string
        if (scope === 'global') path = ctxMod.getGlobalContextPath()
        else if (scope === 'role' && (id === 'orchestrator' || id === 'subagent')) path = ctxMod.getRoleContextPath(id)
        else if (scope === 'team' && id) {
          if (!readTeams().some((t) => t.id === id)) {
            return Response.json({ ok: false, error: `Team "${id}" not found` }, { status: 404 })
          }
          path = ctxMod.getTeamContextPath(id)
        } else {
          return Response.json({ ok: false, error: 'scope must be global, role (id=orchestrator|subagent), or team (id=<teamId>)' }, { status: 400 })
        }

        if (req.method === 'GET') {
          ctxMod.seedContextFiles()
          return Response.json({
            ok: true,
            path,
            content: existsSync(path) ? readFileSync(path, 'utf-8') : null,
          })
        }

        const body = await req.json().catch(() => null) as { content?: unknown } | null
        if (!body || typeof body.content !== 'string') {
          return Response.json({ ok: false, error: 'Body must be { content: string }' }, { status: 400 })
        }
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, body.content, 'utf-8')
        if (scope === 'role') {
          // Re-assert the Bakin-managed block — user edits outside it are
          // preserved; a deleted/mangled block is restored to the shipped
          // defaults.
          ctxMod.refreshRoleContextBlocks()
        }
        return Response.json({ ok: true, path, content: readFileSync(path, 'utf-8') })
      },
    }))
  }
}
