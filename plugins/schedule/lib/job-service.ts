/**
 * Schedule job service — the CRUD verbs shared by the REST routes and the exec
 * tools, plus the core-boundary crossings (runtime cron + search). Isolating
 * them here keeps the route/exec handlers thin and the read-only guard / delete
 * semantics consistent across both surfaces.
 *
 * (The route↔exec-tool dedup the audit flagged — createScheduleJob /
 * applyPauseAction / updateScheduleJob / projectJobDetail, including the
 * pause-`pauseUntil` behavioral drift — is a deliberate behavior-touching
 * follow-up, NOT taken in this pure relocation.)
 */
import type { PluginContext } from '@bakin/core/plugin-types'
import type { BakinJobMeta, MergedJob } from '../types'
import { getPluginCtx } from './plugin-context'
import { getJob, upsertJob, removeJob, readSidecar } from './sidecar'
import { readMergedJobs } from './jobs-reader'
import { parseSchedule } from './cron-parser'
import { getSystemTimezone } from './schedule-util'
import { getRuntimeMainAgentId } from '@bakin/core/adapters/runtime'
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
  const runtime = ctx ? await ctx.runtime.cron.get(jobId).catch(() => null) : null
  return runtime
    ? { ok: false, status: 403, error: READ_ONLY_ERROR }
    : { ok: false, status: 404, error: 'Schedule not found' }
}

export interface EnsureBakinJobResult {
  ok: boolean
  jobId?: string
  cron?: string
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

  const parsed = parseSchedule(schedule)
  if (!parsed) return { ok: false, error: 'Could not parse schedule expression' }

  const tz = typeof input.tz === 'string' && input.tz.trim() ? input.tz.trim() : getSystemTimezone()
  const enabled = typeof input.enabled === 'boolean' ? input.enabled : true
  const now = new Date().toISOString()

  // Idempotent provisioning keyed by the caller-owned logical id. Bakin owns
  // the schedule outright now — no OpenClaw cron is created.
  const existing = getJob(logicalId) ?? getJobByLogicalJobId(logicalId)
  const jobId = existing?.jobId ?? logicalId
  const owner = typeof input.owner === 'string' && input.owner.trim()
    ? input.owner.trim()
    : existing?.owner ?? await getRuntimeMainAgentId(ctx.runtime)

  const meta: BakinJobMeta = {
    ...(existing ?? {}),
    jobId,
    logicalJobId: logicalId,
    isBakinJob: true,
    source: 'bakin',
    schedule: { kind: 'cron', expr: parsed.cron },
    enabled,
    displayName: name,
    description: typeof input.description === 'string' ? input.description : existing?.description,
    owner,
    requireTriage: typeof input.requireTriage === 'boolean' ? input.requireTriage : existing?.requireTriage ?? false,
    agentId: typeof input.agentId === 'string' ? input.agentId : existing?.agentId,
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

  return { ok: true, jobId, cron: parsed.cron, human: parsed.human }
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
  try {
    await ctx.runtime.cron.remove(jobId)
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
