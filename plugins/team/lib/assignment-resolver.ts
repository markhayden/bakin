/**
 * Team → agent assignment resolver (#189).
 *
 * Turns a team-assigned task into a concrete dispatch target: assemble the
 * candidate pool (team members ∩ runtime roster — existence is the ONLY hard
 * filter; status/workload are prompt signals so "best suited" beats
 * "available right now"), build byte-budgeted member profiles from
 * SOUL/IDENTITY prose, and ask a cheap routing LLM for {agentId, reason}.
 *
 * The routing call rides the ACTIVE RUNTIME — an ephemeral one-shot turn as
 * the main agent (`task:<id>:route` thread), with the 'team-routing'
 * work-class route as a per-turn model override and spend metered under that
 * class. No direct provider calls, no API keys: the runtime's own
 * credentials serve every box (subscription or metered).
 *
 * Results are typed by kind — dispatch classifies failures structurally
 * ('transient' retries next cycle, 'structural' blocks the task), never by
 * message text. RuntimeError maps 'not_found' → structural (the send target
 * is missing); every other kind is transient — the dispatch ladder bounds
 * retries. Collaborators are injectable so tests never make live calls.
 */
import { z } from 'zod'
import type { AgentRuntimeAdapter, MessageResult } from '@bakin/core/adapters/runtime'
import { getRuntimeMainAgentId, RuntimeError } from '@bakin/core/adapters/runtime'
import { createLogger } from '../../../src/core/logger'
import { getTeamMembers as defaultGetTeamMembers } from './agent-status'
import { readTeams as defaultReadTeams } from './team-settings'
import type { OrgTeam } from '../types'

const log = createLogger('team-assignment')

/** Per-member cap on SOUL/IDENTITY prose sent to the router — routing is a
 * classification call; whole souls don't improve it, they just bill more. */
export const MEMBER_PROFILE_BYTE_BUDGET = 2048

export interface ResolveAssignmentRequest {
  teamId: string
  task: { id: string; title: string; description?: string; tags?: string[] }
}

export type ResolveAssignmentResult =
  | { ok: true; agentId: string; reason: string; model: string }
  | { ok: false; kind: 'transient' | 'structural'; message: string }

/** The team-routing work-class route (from the models routing matrix). */
export interface TeamRoutingRoute {
  /** Canonical `provider/model` id, passed whole to the runtime as a
   * per-turn override; absent = inherit (main agent's default). */
  model?: string
  thinking?: string
  source?: string
}

const PickSchema = z.object({
  agentId: z.string().min(1),
  reason: z.string().min(1).max(500),
})

type Meter = (opts: {
  runId: string
  agent: string
  activityClass: 'system'
  workClass: 'team-routing'
  routeSource?: string
  resolvedModel?: string
  result: MessageResult
  name: string
}) => Promise<void>

export interface ResolverDeps {
  runtime: AgentRuntimeAdapter
  /** Resolved 'team-routing' matrix route; absent/empty = inherit. */
  route?: TeamRoutingRoute
  /** Injectable for tests; defaults are the real collaborators. */
  meter?: Meter
  getMainAgentId?: (runtime: AgentRuntimeAdapter) => Promise<string>
  readTeams?: () => OrgTeam[]
  getTeamMembers?: (runtime: AgentRuntimeAdapter, teamId: string) => Promise<string[]>
  getStatus?: (agentId: string) => string
}

function excerpt(text: string | null, budget: number): string {
  if (!text) return ''
  const trimmed = text.trim()
  if (trimmed.length <= budget) return trimmed
  return `${trimmed.slice(0, budget)}\n[truncated]`
}

/** Strip a ```json fence if the model wrapped its reply in one. */
function stripFences(raw: string): string {
  const trimmed = raw.trim()
  const fence = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/)
  return (fence ? fence[1] : trimmed).trim()
}

interface PoolMember {
  id: string
  name: string
  role: string
  model: string
  status: string
  profile: string
}

function memberBlock(m: PoolMember): string {
  const lines = [
    `### ${m.id}`,
    `name: ${m.name} | role: ${m.role || 'unspecified'} | model: ${m.model || 'unknown'} | status: ${m.status}`,
  ]
  if (m.profile) lines.push(m.profile)
  return lines.join('\n')
}

const SYSTEM_PROMPT = 'You route tasks to the most suitable AI agent on a team. You always answer with strict JSON.'

function buildPrompt(request: ResolveAssignmentRequest, pool: PoolMember[]): string {
  const task = request.task
  const tags = task.tags?.length ? `\nTags: ${task.tags.join(', ')}` : ''
  const description = task.description ? `\nDescription: ${task.description}` : ''
  return [
    SYSTEM_PROMPT,
    '',
    `A task needs to be routed to the best-suited member of the "${request.teamId}" team.`,
    '',
    `Task: ${task.title}${description}${tags}`,
    '',
    'Team members:',
    ...pool.map(memberBlock),
    '',
    `Pick the single member whose role and profile best match the work. Status is a signal, not a filter — prefer the best-suited member even if busy. Respond with ONLY a JSON object (no markdown fences): {"agentId": "<one of: ${pool.map((m) => m.id).join(', ')}>", "reason": "<one short sentence>"}.`,
  ].join('\n')
}

function correctiveReask(pool: PoolMember[]): string {
  return `Your last reply was not a usable pick. Respond with ONLY a JSON object (no markdown fences, no prose): {"agentId": "<one of: ${pool.map((m) => m.id).join(', ')}>", "reason": "<one short sentence>"}.`
}

function parsePick(content: string | undefined): z.infer<typeof PickSchema> | null {
  if (!content?.trim()) return null
  try {
    const parsed = PickSchema.safeParse(JSON.parse(stripFences(content)))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

const defaultMeter: Meter = async (opts) => {
  const { meterAgentTurn } = await import('../../../src/core/agent-cost')
  await meterAgentTurn(opts)
}

/**
 * Resolve a team assignment to a concrete agent. Never throws — every
 * failure returns a typed {ok:false} result for dispatch to classify.
 */
export async function resolveTeamAssignment(
  deps: ResolverDeps,
  request: ResolveAssignmentRequest,
): Promise<ResolveAssignmentResult> {
  const readTeams = deps.readTeams ?? defaultReadTeams
  const getTeamMembers = deps.getTeamMembers ?? defaultGetTeamMembers
  const getMainAgentId = deps.getMainAgentId ?? getRuntimeMainAgentId
  const meter = deps.meter ?? defaultMeter

  try {
    if (!readTeams().some((t) => t.id === request.teamId)) {
      return { ok: false, kind: 'structural', message: `Team "${request.teamId}" does not exist` }
    }

    const memberIds = await getTeamMembers(deps.runtime, request.teamId)
    const roster = await deps.runtime.agents.list()
    const rosterById = new Map(roster.map((a) => [a.id, a]))
    const eligible = memberIds.filter((id) => rosterById.has(id))
    if (eligible.length === 0) {
      return {
        ok: false,
        kind: 'structural',
        message: `Team "${request.teamId}" has no members present in the runtime roster`,
      }
    }

    const pool: PoolMember[] = await Promise.all(eligible.map(async (id) => {
      const agent = rosterById.get(id)!
      const [soul, identity] = await Promise.all([
        deps.runtime.agents.readWorkspaceFile(id, 'SOUL.md').then((f) => f?.content ?? null).catch(() => null),
        deps.runtime.agents.readWorkspaceFile(id, 'IDENTITY.md').then((f) => f?.content ?? null).catch(() => null),
      ])
      return {
        id,
        name: agent.name ?? id,
        role: agent.role ?? '',
        model: agent.model ?? '',
        status: deps.getStatus?.(id) ?? 'unknown',
        profile: excerpt([identity, soul].filter(Boolean).join('\n\n'), MEMBER_PROFILE_BYTE_BUDGET),
      }
    }))
    const poolIds = new Set(pool.map((m) => m.id))

    const mainAgentId = await getMainAgentId(deps.runtime)
    const threadId = `task:${request.task.id}:route`
    const send = async (content: string): Promise<MessageResult> => {
      const result = await deps.runtime.messaging.send({
        agentId: mainAgentId,
        activityClass: 'system',
        ephemeral: true,
        threadId,
        ...(deps.route?.model ? { model: deps.route.model } : {}),
        ...(deps.route?.thinking ? { thinking: deps.route.thinking } : {}),
        content,
      })
      await meter({
        runId: threadId,
        agent: mainAgentId,
        activityClass: 'system',
        workClass: 'team-routing',
        routeSource: deps.route?.source,
        resolvedModel: deps.route?.model,
        result,
        name: 'team-routing',
      })
      return result
    }

    // Two sends max: the first pick, then ONE corrective re-ask on the same
    // thread covering both failure shapes (malformed reply / out-of-pool
    // hallucination), then honest transient failure — never a fabricated pick.
    let pick = parsePick((await send(buildPrompt(request, pool))).content)
    if (!pick || !poolIds.has(pick.agentId)) {
      log.warn('Routing reply unusable; corrective re-ask', {
        taskId: request.task.id,
        pick: pick?.agentId ?? '(unparseable)',
      })
      pick = parsePick((await send(correctiveReask(pool))).content)
      if (!pick) {
        return { ok: false, kind: 'transient', message: 'Router reply was not a valid pick after a corrective re-ask' }
      }
      if (!poolIds.has(pick.agentId)) {
        return { ok: false, kind: 'transient', message: `Router picked "${pick.agentId}", which is not in the ${request.teamId} pool` }
      }
    }

    return { ok: true, agentId: pick.agentId, reason: pick.reason, model: deps.route?.model ?? 'inherit' }
  } catch (err) {
    if (err instanceof RuntimeError) {
      // 'not_found' = the send target is missing on the runtime — structural.
      // Everything else (transport, timeout, cooldown, runtime_failed,
      // aborted, session_death) is a retry-later condition; the dispatch
      // ladder bounds the retries and escalates honestly.
      const kind = err.kind === 'not_found' ? 'structural' : 'transient'
      return { ok: false, kind, message: err.message }
    }
    log.error('Unexpected assignment-resolver failure', err, { teamId: request.teamId, taskId: request.task.id })
    return { ok: false, kind: 'transient', message: err instanceof Error ? err.message : String(err) }
  }
}
