/**
 * Team → agent assignment resolver (#189).
 *
 * Turns a team-assigned task into a concrete dispatch target: assemble the
 * candidate pool (team members ∩ runtime roster — existence is the ONLY hard
 * filter; status/workload are prompt signals so "best suited" beats
 * "available right now"), build byte-budgeted member profiles from
 * SOUL/IDENTITY prose, and ask a cheap routing LLM for {agentId, reason}.
 *
 * Results are typed by kind — dispatch classifies failures structurally
 * ('transient' retries next cycle, 'structural' blocks the task), never by
 * message text. Collaborators are injectable so tests never make live calls.
 */
import { z } from 'zod'
import {
  callDirectTextProvider,
  DirectTextError,
} from '@bakin/core/llm/direct-text-provider'
import {
  resolveProviderKeySource,
  type DirectProviderId,
} from '@bakin/core/llm/provider-keys'
import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import { createLogger } from '../../../src/core/logger'
import { getTeamMembers as defaultGetTeamMembers } from './agent-status'
import { readTeams as defaultReadTeams } from './team-settings'
import type { OrgTeam } from '../types'

const log = createLogger('team-assignment')

export const DEFAULT_ROUTING_PROVIDER: DirectProviderId = 'anthropic'
export const DEFAULT_ROUTING_MODEL = 'claude-haiku-4-5-20251001'

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
  /** Canonical `provider/model` id; absent = default router model. */
  model?: string
  source?: string
}

const PickSchema = z.object({
  agentId: z.string().min(1),
  reason: z.string().min(1).max(500),
})

type Transport = <T>(request: {
  provider: DirectProviderId
  model: string
  apiKey: string
  system?: string
  prompt: string
  schema: z.ZodType<T>
  maxTokens?: number
}) => Promise<T>

export interface ResolverDeps {
  runtime: AgentRuntimeAdapter
  /** Resolved 'team-routing' matrix route; absent/empty = defaults. */
  route?: TeamRoutingRoute
  /** Injectable for tests; defaults are the real collaborators. */
  transport?: Transport
  keySource?: typeof resolveProviderKeySource
  readTeams?: () => OrgTeam[]
  getTeamMembers?: (runtime: AgentRuntimeAdapter, teamId: string) => Promise<string[]>
  getStatus?: (agentId: string) => string
}

const DIRECT_PROVIDERS: readonly DirectProviderId[] = ['anthropic', 'openai', 'google']

/**
 * Split a matrix `provider/model` id into the direct-provider call pair.
 * An unsupported provider is an HONEST structural error (never silently
 * re-routed to a different provider than the operator configured).
 */
function parseRoutedModel(id: string | undefined):
  | { ok: true; provider: DirectProviderId; model: string }
  | { ok: false; message: string }
  | null {
  const trimmed = id?.trim()
  if (!trimmed) return null
  const slash = trimmed.indexOf('/')
  const provider = slash === -1 ? '' : trimmed.slice(0, slash)
  const model = slash === -1 ? trimmed : trimmed.slice(slash + 1)
  if (!(DIRECT_PROVIDERS as readonly string[]).includes(provider)) {
    return { ok: false, message: `Team-routing route model "${trimmed}" uses provider "${provider || 'unknown'}" — team routing supports ${DIRECT_PROVIDERS.join('/')} direct calls. Fix the route in Models → Routing.` }
  }
  if (!model) return { ok: false, message: `Team-routing route model "${trimmed}" has no model segment` }
  return { ok: true, provider: provider as DirectProviderId, model }
}

function excerpt(text: string | null, budget: number): string {
  if (!text) return ''
  const trimmed = text.trim()
  if (trimmed.length <= budget) return trimmed
  return `${trimmed.slice(0, budget)}\n[truncated]`
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

function buildPrompt(request: ResolveAssignmentRequest, pool: PoolMember[]): string {
  const task = request.task
  const tags = task.tags?.length ? `\nTags: ${task.tags.join(', ')}` : ''
  const description = task.description ? `\nDescription: ${task.description}` : ''
  return [
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

const SYSTEM_PROMPT = 'You route tasks to the most suitable AI agent on a team. You always answer with strict JSON.'

/**
 * Resolve a team assignment to a concrete agent. Never throws — every
 * failure returns a typed {ok:false} result for dispatch to classify.
 */
export async function resolveTeamAssignment(
  deps: ResolverDeps,
  request: ResolveAssignmentRequest,
): Promise<ResolveAssignmentResult> {
  const transport = deps.transport ?? (callDirectTextProvider as Transport)
  const keySource = deps.keySource ?? resolveProviderKeySource
  const readTeams = deps.readTeams ?? defaultReadTeams
  const getTeamMembers = deps.getTeamMembers ?? defaultGetTeamMembers

  try {
    const routed = parseRoutedModel(deps.route?.model)
    if (routed && !routed.ok) return { ok: false, kind: 'structural', message: routed.message }
    const provider = routed?.provider ?? DEFAULT_ROUTING_PROVIDER
    const model = routed?.model ?? DEFAULT_ROUTING_MODEL

    if (!readTeams().some((t) => t.id === request.teamId)) {
      return { ok: false, kind: 'structural', message: `Team "${request.teamId}" does not exist` }
    }

    const key = keySource(provider)
    if (!key) {
      return { ok: false, kind: 'structural', message: `No API key configured for routing provider "${provider}" (env or secret store)` }
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
    const call = () => transport({
      provider,
      model,
      apiKey: key.apiKey,
      system: SYSTEM_PROMPT,
      prompt: buildPrompt(request, pool),
      schema: PickSchema,
      maxTokens: 300,
    })

    let pick = await call()
    if (!poolIds.has(pick.agentId)) {
      // One fresh retry — the transport already retried malformed output;
      // this guards a syntactically valid but out-of-pool hallucination.
      log.warn('Routing pick outside candidate pool; retrying once', { taskId: request.task.id, pick: pick.agentId })
      pick = await call()
      if (!poolIds.has(pick.agentId)) {
        return { ok: false, kind: 'transient', message: `Router picked "${pick.agentId}", which is not in the ${request.teamId} pool` }
      }
    }

    return { ok: true, agentId: pick.agentId, reason: pick.reason, model: `${provider}/${model}` }
  } catch (err) {
    if (err instanceof DirectTextError) {
      return { ok: false, kind: err.kind, message: err.message }
    }
    log.error('Unexpected assignment-resolver failure', err, { teamId: request.teamId, taskId: request.task.id })
    return { ok: false, kind: 'transient', message: err instanceof Error ? err.message : String(err) }
  }
}
