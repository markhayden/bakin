/**
 * Schedule job service — the CRUD verbs shared by the REST routes and the exec
 * tools, plus the core-boundary crossings (runtime cron + search). Isolating
 * them here keeps the route/exec handlers thin and the read-only guard /
 * create / update / pause / delete / detail-projection semantics consistent
 * across both surfaces (createScheduleJob / applyPauseAction /
 * updateScheduleJob / projectJobDetail were deduped from the route and
 * exec-tool copies after FW1 fixed the pause-`pauseUntil` drift).
 *
 * Surface-specific behavior stays with the callers: audit/activity logging,
 * post-mutation `indexJob` re-indexing (the REST routes reindex after
 * update/pause; the exec tools historically only reindex after update), and
 * status-code mapping.
 */
import type { PluginContext } from '@bakin/core/plugin-types'
import type { BakinJobMeta, MergedJob } from '../types'
import { getPluginCtx } from './plugin-context'
import { getJob, upsertJob, removeJob, readSidecar, newScheduleId, withDefaults } from './sidecar'
import { readMergedJobs } from './jobs-reader'
import { parseSchedule, cronToHuman } from './cron-parser'
import { scheduleNextRun } from './cron-eval'
import type { ParseResult } from '../types'

/** One-shots must name a future instant — a past 'at' would land straight in
 *  catch-up triage; reject at creation instead. */
function oneShotInPast(parsed: ParseResult, now = Date.now()): boolean {
  return parsed.kind === 'at' && Date.parse(parsed.expr) <= now
}
import { checkSchedulePrompt, type PromptWarning } from './prompt-guard'
import { getLastRun } from './runs-reader'
import { getSystemTimezone } from './schedule-util'
import { getRuntimeMainAgentId } from '@bakin/core/adapters/runtime'
import { validateTeamAssignment, TaskValidationError } from '../../../src/core/task-service'
import { createLogger } from '../../../src/core/logger'

const log = createLogger('schedule')

export type BakinMutationGuard =
  | { ok: true; meta: BakinJobMeta }
  | { ok: false; status: number; error: string }

export const READ_ONLY_ERROR = 'Runtime cron jobs are read-only in Bakin — adopt it first to manage it.'

/**
 * Mutations apply only to Bakin-owned schedules. Resolves a jobId to one of:
 * the Bakin schedule (proceed), a native runtime cron that exists but isn't
 * Bakin-owned (read-only → 403), or an unknown id (→ 404). Keeps PUT / pause /
 * delete (route + exec) consistent instead of each guarding differently.
 */
export async function guardBakinMutation(jobId: string): Promise<BakinMutationGuard> {
  const meta = getJob(jobId)
  if (meta?.isBakinJob) return { ok: true, meta }
  const ctx = getPluginCtx()
  // cron is optional (P2.1): without a native surface, an unknown id is 404.
  const runtime = ctx ? await ctx.runtime.cron?.get(jobId).catch(() => null) : null
  return runtime
    ? { ok: false, status: 403, error: READ_ONLY_ERROR }
    : { ok: false, status: 404, error: 'Schedule not found' }
}

export interface EnsureBakinJobResult {
  ok: boolean
  jobId?: string
  kind?: 'cron' | 'at'
  expr?: string
  human?: string
  error?: string
}

export type ScheduleDeleteContext = Pick<PluginContext, 'runtime' | 'search'>

export async function ensureBakinJob(ctx: PluginContext, input: Record<string, unknown>): Promise<EnsureBakinJobResult> {
  const logicalId = typeof input.jobId === 'string' && input.jobId.trim() ? input.jobId.trim() : undefined
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const schedule = typeof input.schedule === 'string' ? input.schedule.trim() : ''
  const command = typeof input.command === 'string' ? input.command.trim() : ''
  if (!logicalId || !name || !schedule || !command) {
    return { ok: false, error: 'jobId, name, schedule, and command are required' }
  }

  const tz = typeof input.tz === 'string' && input.tz.trim() ? input.tz.trim() : getSystemTimezone()
  const parsed = parseSchedule(schedule, { tz })
  if (!parsed) return { ok: false, error: 'Could not parse schedule expression' }
  if (oneShotInPast(parsed)) return { ok: false, error: `One-shot schedule is in the past (${parsed.expr})` }
  const enabled = typeof input.enabled === 'boolean' ? input.enabled : true
  const now = new Date().toISOString()

  // Idempotent provisioning keyed by the caller-owned logical id. Bakin owns
  // the schedule outright now — no OpenClaw cron is created.
  const existing = getJob(logicalId) ?? getJobByLogicalJobId(logicalId)
  const jobId = existing?.jobId ?? logicalId
  const owner = typeof input.owner === 'string' && input.owner.trim()
    ? input.owner.trim()
    : existing?.owner ?? await getRuntimeMainAgentId(ctx.runtime)

  // Assignment merge with the same exclusion + validation the REST routes
  // enforce (review R5): an input-provided side wins and clears the other
  // (including a carried-over existing value); '' clears its own side; a
  // both-set input or an unknown team rejects the provisioning call.
  const inputAgentId = typeof input.agentId === 'string' ? (input.agentId || undefined) : undefined
  const inputTeamId = typeof input.teamId === 'string' ? (input.teamId || undefined) : undefined
  let agentId = typeof input.agentId === 'string' ? inputAgentId : existing?.agentId
  let teamId = typeof input.teamId === 'string' ? inputTeamId : existing?.teamId
  if (inputAgentId && !inputTeamId) teamId = undefined
  if (inputTeamId && !inputAgentId) agentId = undefined
  try {
    await validateTeamAssignment({ assignee: agentId, team: inputTeamId })
  } catch (err) {
    if (err instanceof TaskValidationError) return { ok: false, error: err.message }
    throw err
  }

  const meta: BakinJobMeta = {
    ...(existing ?? {}),
    jobId,
    logicalJobId: logicalId,
    isBakinJob: true,
    source: 'bakin',
    schedule: { kind: parsed.kind, expr: parsed.expr },
    enabled,
    displayName: name,
    description: typeof input.description === 'string' ? input.description : existing?.description,
    owner,
    requireTriage: typeof input.requireTriage === 'boolean' ? input.requireTriage : existing?.requireTriage ?? false,
    agentId,
    teamId,
    workflowId: typeof input.workflowId === 'string' ? input.workflowId : existing?.workflowId,
    taskPrompt: typeof input.taskPrompt === 'string' ? input.taskPrompt : existing?.taskPrompt ?? command,
    taskTitle: typeof input.taskTitle === 'string' ? input.taskTitle : existing?.taskTitle,
    allowOverlap: typeof input.allowOverlap === 'boolean' ? input.allowOverlap : existing?.allowOverlap ?? false,
    maxFailures: typeof input.maxFailures === 'number' ? input.maxFailures : existing?.maxFailures ?? 3,
    consecutiveFailures: existing?.consecutiveFailures ?? 0,
    tz,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  upsertJob(meta)
  indexJob(jobId)

  return { ok: true, jobId, kind: parsed.kind, expr: parsed.expr, human: parsed.human }
}

export interface CreateScheduleJobInput {
  name: string
  schedule: string
  agentId?: string
  /** Team assignment (#189) — mutually exclusive with agentId. */
  teamId?: string
  workflowId?: string
  taskPrompt?: string
  taskTitle?: string
  owner?: string
  requireTriage?: boolean
  allowOverlap?: boolean
  maxFailures?: number
  tz?: string
}

export type CreateScheduleJobResult =
  | { ok: true; jobId: string; kind: 'cron' | 'at'; expr: string; human: string; tz: string; warnings: PromptWarning[] }
  | { ok: false; error: string }

/** Create a Bakin-owned schedule: parse, build meta, persist, index. */
export async function createScheduleJob(
  ctx: Pick<PluginContext, 'runtime'>,
  input: CreateScheduleJobInput,
): Promise<CreateScheduleJobResult> {
  const tz = input.tz || getSystemTimezone()
  const parsed = parseSchedule(input.schedule, { tz })
  if (!parsed) return { ok: false, error: 'Could not parse schedule expression' }
  if (oneShotInPast(parsed)) return { ok: false, error: `One-shot schedule is in the past (${parsed.expr})` }

  // Assignment validation lives HERE, not at each surface (round-4 review):
  // every caller — REST, exec tool, future bulk/import — inherits it.
  try {
    await validateTeamAssignment({ assignee: input.agentId, team: input.teamId })
  } catch (err) {
    if (err instanceof TaskValidationError) return { ok: false, error: err.message }
    throw err
  }

  const jobId = newScheduleId()
  const owner = input.owner ?? await getRuntimeMainAgentId(ctx.runtime)
  const now = new Date().toISOString()
  const meta: BakinJobMeta = {
    jobId,
    isBakinJob: true,
    source: 'bakin',
    schedule: { kind: parsed.kind, expr: parsed.expr },
    enabled: true,
    displayName: input.name,
    agentId: input.agentId,
    teamId: input.teamId,
    owner,
    requireTriage: input.requireTriage ?? false,
    workflowId: input.workflowId,
    taskPrompt: input.taskPrompt,
    taskTitle: input.taskTitle,
    allowOverlap: input.allowOverlap ?? false,
    maxFailures: input.maxFailures ?? 3,
    consecutiveFailures: 0,
    tz,
    createdAt: now,
    updatedAt: now,
  }
  upsertJob(meta)
  indexJob(jobId)
  return { ok: true, jobId, kind: parsed.kind, expr: parsed.expr, human: parsed.human, tz, warnings: checkSchedulePrompt(input.taskPrompt) }
}

export type PauseAction = 'pause' | 'resume' | 'skip'

/**
 * Apply pause/resume/skip to an already-guarded Bakin job meta and persist it.
 * Callers own re-indexing + audit.
 */
export function applyPauseAction(
  meta: BakinJobMeta,
  action: PauseAction,
  opts: { pauseUntil?: string; skipN?: number } = {},
): { ok: true } | { ok: false; error: string } {
  switch (action) {
    case 'pause':
      meta.paused = true
      meta.pauseReason = 'manual'
      // Unconditional: a fresh pause without a date clears any stale
      // auto-resume left in place by a prior pause.
      meta.pauseUntil = opts.pauseUntil
      meta.enabled = false
      break
    case 'resume':
      meta.paused = false
      meta.pauseReason = undefined
      meta.pauseUntil = undefined
      meta.skipNextN = undefined
      meta.skippedCount = undefined
      meta.consecutiveFailures = 0
      meta.enabled = true
      break
    case 'skip':
      if (!meta.isBakinJob) return { ok: false, error: 'Skip is only available for Bakin schedules' }
      meta.skipNextN = opts.skipN ?? 1
      meta.skippedCount = 0
      break
  }
  upsertJob(meta)
  return { ok: true }
}

/**
 * Apply a partial update to an already-guarded Bakin job meta and persist it.
 * `fields` is the calling surface's allowlist of sidecar fields (the REST
 * route accepts more fields than the exec tool). `name` maps to displayName
 * before the field loop, so an explicit `displayName` in `updates` wins —
 * both surfaces now share that precedence. Callers own re-indexing + audit.
 */
export async function updateScheduleJob(
  meta: BakinJobMeta,
  updates: Record<string, unknown>,
  fields: readonly string[],
): Promise<{ ok: true; warnings: PromptWarning[] } | { ok: false; error: string }> {
  // Assignment validation lives HERE, not at each surface (round-4 review).
  try {
    await validateTeamAssignment({
      assignee: typeof updates.agentId === 'string' && updates.agentId ? updates.agentId : undefined,
      team: typeof updates.teamId === 'string' && updates.teamId ? updates.teamId : undefined,
    })
  } catch (err) {
    if (err instanceof TaskValidationError) return { ok: false, error: err.message }
    throw err
  }
  if (updates.schedule && typeof updates.schedule === 'string') {
    const tz = typeof updates.tz === 'string' && updates.tz ? updates.tz : meta.tz
    const parsed = parseSchedule(updates.schedule, { tz })
    if (!parsed) return { ok: false, error: 'Could not parse schedule' }
    if (oneShotInPast(parsed)) return { ok: false, error: `One-shot schedule is in the past (${parsed.expr})` }
    meta.schedule = { kind: parsed.kind, expr: parsed.expr }
    // A new schedule re-arms a completed one-shot: its consumed occurrence
    // stays in history, but the job is live again for the new instant.
    meta.completedAt = undefined
  }
  if (updates.name && typeof updates.name === 'string') {
    meta.displayName = updates.name
  }
  for (const field of fields) {
    if (updates[field] !== undefined) {
      ;(meta as unknown as Record<string, unknown>)[field] = updates[field]
    }
  }
  // agentId/teamId are mutually exclusive (#189): whichever this update set
  // to a non-empty value wins; empty-string updates just clear their field.
  if (typeof updates.agentId === 'string' && updates.agentId) meta.teamId = undefined
  if (typeof updates.teamId === 'string' && updates.teamId) meta.agentId = undefined
  if (meta.agentId === '') meta.agentId = undefined
  if (meta.teamId === '') meta.teamId = undefined
  upsertJob(meta)
  return { ok: true, warnings: checkSchedulePrompt(meta.taskPrompt) }
}

/** The detail projection shared by GET /:jobId and bakin_exec_schedule_get. */
export async function projectJobDetail(
  ctx: Pick<PluginContext, 'runtime'>,
  jobId: string,
  meta: BakinJobMeta,
): Promise<Record<string, unknown>> {
  const defaults = withDefaults(meta, await getRuntimeMainAgentId(ctx.runtime))
  const lastRun = await getLastRun(ctx.runtime.cron, jobId)
  const sched = meta.schedule
  const hasSchedule = !!sched?.expr
  return {
    id: meta.jobId,
    name: meta.displayName,
    agent: meta.agentId,
    team: meta.teamId,
    // When the job runs — the list projection carries these; a client on the
    // detail endpoint alone must be able to display the schedule too.
    schedule: meta.schedule,
    cron: hasSchedule && sched!.kind === 'cron' ? sched!.expr : undefined,
    humanSchedule: !hasSchedule ? undefined : sched!.kind === 'cron' ? cronToHuman(sched!.expr) : `Once at ${sched!.expr}`,
    nextRun: hasSchedule && !(meta.paused ?? false) && !meta.completedAt
      ? scheduleNextRun(sched!, meta.tz, new Date())?.toISOString()
      : undefined,
    completed: sched?.kind === 'at' && !!meta.completedAt,
    completedAt: meta.completedAt,
    enabled: meta.enabled !== false,
    owner: defaults.owner,
    paused: meta.paused ?? false,
    pauseReason: meta.pauseReason,
    pauseUntil: meta.pauseUntil,
    workflowId: meta.workflowId,
    taskPrompt: meta.taskPrompt,
    taskTitle: meta.taskTitle,
    allowOverlap: defaults.allowOverlap,
    maxFailures: defaults.maxFailures,
    consecutiveFailures: meta.consecutiveFailures ?? 0,
    lastTaskId: meta.lastTaskId,
    lastRun: lastRun ?? null,
    tz: meta.tz,
    createdAt: meta.createdAt,
  }
}

export function getJobByLogicalJobId(logicalJobId: string): BakinJobMeta | null {
  const matches = Object.values(readSidecar().jobs)
    .filter(job => job.logicalJobId === logicalJobId)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  return matches[0] ?? null
}

function isCronAlreadyGoneError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /\bnot found\b/i.test(message) && /\b(cron|job)\b/i.test(message)
}

export async function deleteScheduleJob(ctx: ScheduleDeleteContext, jobId: string): Promise<{ runtimeMissing: boolean }> {
  let runtimeMissing = false
  // cron is optional (P2.1): no native surface → nothing runtime-side to
  // remove; the delete is purely a Bakin-record removal.
  try {
    if (ctx.runtime.cron) await ctx.runtime.cron.remove(jobId)
    else runtimeMissing = true
  } catch (err) {
    if (!isCronAlreadyGoneError(err)) throw err
    runtimeMissing = true
    log.warn('Schedule runtime cron was already gone during delete; removing Bakin records', {
      jobId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
  removeJob(jobId)
  ctx.search.remove(jobId).catch(() => {})
  return { runtimeMissing }
}

export async function readMergedRuntimeJobs(): Promise<MergedJob[]> {
  const ctx = getPluginCtx()
  if (!ctx) throw new Error('schedule plugin not activated')
  return readMergedJobs(ctx.runtime.cron, await getRuntimeMainAgentId(ctx.runtime))
}

export function jobToSearchDoc(job: MergedJob): Record<string, unknown> {
  return {
    name: job.displayName || job.name || job.id,
    schedule: job.humanSchedule || job.schedule.value || '',
    command: job.taskPrompt || job.taskTitle || '',
    agent: job.agentId || '',
    enabled: job.paused ? 'false' : String(job.enabled !== false),
    updated_at: job.createdAt || new Date().toISOString(),
  }
}

export function indexJob(jobId: string): void {
  const ctx = getPluginCtx()
  if (!ctx) return
  readMergedRuntimeJobs().then((jobs) => {
    const job = jobs.find(j => j.id === jobId)
    if (!job) return
    return ctx.search.index(jobId, jobToSearchDoc(job))
  }).catch((err) => {
    log.warn('Failed to index job', { jobId, error: err instanceof Error ? err.message : String(err) })
  })
}
