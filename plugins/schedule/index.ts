/**
 * Schedule plugin — server entry point.
 * Registers API routes, exec tools, and the cron→task bridge.
 */
import { randomUUID } from 'crypto'
import { z } from 'zod'
import type { BakinPlugin, PluginContext } from '@bakin/core/plugin-types'
import { definePlugin, defineRoute, searchRoute } from '@bakin/core/routing'
import { readMergedJobs } from './lib/jobs-reader'
import { getLastRun, readRuns } from './lib/runs-reader'
import { upsertJob, removeJob, getJob, readSidecar, isPaused, shouldSkip, recordFailure, recordSuccess, withDefaults, newScheduleId } from './lib/sidecar'
import { claimCronFire, getCronFire, attachCronTask, markCronFireSkipped, findHealableCronClaims } from '../../src/core/execution-ledger'
import { parseSchedule } from './lib/cron-parser'
import { runSchedulerTick, DEFAULT_TICK_WINDOW_MS, type SchedulerDeps } from './lib/scheduler'
import { migrateBakinSchedulesOffOpenClawCron } from './lib/cutover'
import { createTaskWithEffects } from '../../src/core/task-service'
import { createLogger } from '../../src/core/logger'
import { readTaskboard } from '../../src/core/task-store'
import { getRuntimeMainAgentId } from '@bakin/core/adapters/runtime'
import type { BakinJobMeta, BridgeResult, MergedJob } from './types'

const log = createLogger('schedule')

/** Detect system IANA timezone. Falls back to UTC. */
function getSystemTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return 'UTC'
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function expandTemplate(template: string, vars: Record<string, string>): string {
  let result = template
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value)
  }
  return result
}

/** Schedule plugin settings. */
interface ScheduleSettings {
  /** Scheduler tick cadence in seconds (floor-clamped). Default 30. */
  tickIntervalSeconds?: number
  /** Catch-up safety window in minutes: a missed occurrence fires into `todo`
   *  if within this window of now, else lands in `blocked`. Default 60. */
  catchUpWindowMinutes?: number
}

const DEFAULT_TICK_INTERVAL_SECONDS = 30
const MIN_TICK_INTERVAL_SECONDS = 5

/** Resolved tick interval in ms, clamped to a safe floor. */
function tickIntervalMs(): number {
  const raw = pluginCtx?.getSettings<ScheduleSettings>()?.tickIntervalSeconds
  const seconds = typeof raw === 'number' && raw >= MIN_TICK_INTERVAL_SECONDS ? raw : DEFAULT_TICK_INTERVAL_SECONDS
  return seconds * 1000
}

interface EnsureBakinJobResult {
  ok: boolean
  jobId?: string
  cron?: string
  human?: string
  error?: string
}

type ScheduleDeleteContext = Pick<PluginContext, 'runtime' | 'search'>

async function getScheduleDefaultOwner(): Promise<string> {
  return pluginCtx?.runtime ? getRuntimeMainAgentId(pluginCtx.runtime) : 'main'
}

async function ensureBakinJob(ctx: PluginContext, input: Record<string, unknown>): Promise<EnsureBakinJobResult> {
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

function getJobByLogicalJobId(logicalJobId: string): BakinJobMeta | null {
  const matches = Object.values(readSidecar().jobs)
    .filter(job => job.logicalJobId === logicalJobId)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  return matches[0] ?? null
}

function isCronAlreadyGoneError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /\bnot found\b/i.test(message) && /\b(cron|job)\b/i.test(message)
}

async function deleteScheduleJob(ctx: ScheduleDeleteContext, jobId: string): Promise<{ runtimeMissing: boolean }> {
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

// ---------------------------------------------------------------------------
// Bridge logic (cron → task)
// ---------------------------------------------------------------------------

/** Module-level ctx set during activate(), used by routes + the scheduler. */
let pluginCtx: PluginContext | null = null

// ─── Module-scope helpers (use pluginCtx for runtime access) ─────────────

async function readMergedRuntimeJobs(): Promise<MergedJob[]> {
  if (!pluginCtx) throw new Error('schedule plugin not activated')
  return readMergedJobs(pluginCtx.runtime.cron, await getRuntimeMainAgentId(pluginCtx.runtime))
}

function jobToSearchDoc(job: MergedJob): Record<string, unknown> {
  return {
    name: job.displayName || job.name || job.id,
    schedule: job.humanSchedule || job.schedule.value || '',
    command: job.taskPrompt || job.taskTitle || '',
    agent: job.agentId || '',
    enabled: job.paused ? 'false' : String(job.enabled !== false),
    updated_at: job.createdAt || new Date().toISOString(),
  }
}

function indexJob(jobId: string): void {
  if (!pluginCtx) return
  const ctx = pluginCtx
  readMergedRuntimeJobs().then((jobs) => {
    const job = jobs.find(j => j.id === jobId)
    if (!job) return
    return ctx.search.index(jobId, jobToSearchDoc(job))
  }).catch((err) => {
    log.warn('Failed to index job', { jobId, error: err instanceof Error ? err.message : String(err) })
  })
}

// ─── Schemas ─────────────────────────────────────────────────────────────

const jobIdParams = z.object({ jobId: z.string().min(1) })
const okResponse = z.object({ ok: z.literal(true) }).passthrough()
const errorResponse = z.object({ error: z.string() }).passthrough()
const passthrough = z.object({}).passthrough()

const createJobBody = z.object({
  name: z.string().min(1),
  schedule: z.string().min(1),
  agentId: z.string().optional(),
  workflowId: z.string().optional(),
  taskPrompt: z.string().optional(),
  taskTitle: z.string().optional(),
  owner: z.string().optional(),
  requireTriage: z.boolean().optional(),
  allowOverlap: z.boolean().optional(),
  maxFailures: z.number().optional(),
  tz: z.string().optional(),
})

const updateJobBody = z.object({
  jobId: z.string().optional(),
}).passthrough()

const deleteJobBody = z.object({
  jobId: z.string().optional(),
}).passthrough().optional()

const pauseJobBody = z.object({
  jobId: z.string().optional(),
  action: z.enum(['pause', 'resume', 'skip']),
  pauseUntil: z.string().optional(),
  skipN: z.number().optional(),
})

const runNowBody = z.object({
  jobId: z.string().optional(),
}).passthrough().optional()

const runsHistoryQuery = z.object({
  limit: z.coerce.number().int().positive().optional(),
})

const parseBody = z.object({
  input: z.string().min(1),
})

const adoptJobBody = z.object({
  jobId: z.string().optional(),
  name: z.string().optional(),
  schedule: z.string().optional(),
  agentId: z.string().nullable().optional(),
  workflowId: z.string().nullable().optional(),
  taskPrompt: z.string().nullable().optional(),
  taskTitle: z.string().nullable().optional(),
  owner: z.string().nullable().optional(),
  requireTriage: z.boolean().optional(),
  allowOverlap: z.boolean().optional(),
  maxFailures: z.number().optional(),
  tz: z.string().optional(),
}).passthrough()

const restoreNativeBody = z.object({
  jobId: z.string().optional(),
}).passthrough().optional()

interface ProcessRunResult {
  status: number
  body: BridgeResult
}

/** Claim a run, then fire it through the shared post-claim path. A lost claim
 *  (duplicate) is suppressed + audited, never an error — the (job_id, run_id)
 *  ledger key is the lock. */
async function fireScheduledRun(meta: BakinJobMeta, jobId: string, runId: string, firedAtMs: number): Promise<ProcessRunResult> {
  const claim = claimCronFire(jobId, runId, firedAtMs)
  if (!claim.claimed) {
    pluginCtx?.activity.audit('fire_suppressed', 'system', {
      jobId,
      runId,
      existingTaskId: claim.existing?.taskId ?? null,
      existingDisposition: claim.existing?.disposition ?? null,
    })
    return { status: 200, body: { ok: true, skipped: 'already-processed' } }
  }
  return runClaimedFire(meta, jobId, runId)
}

/** Drive a fire from a {jobId, runId?, timestamp?} payload — manual triggers
 *  and test harnesses. Mints a unique manual runId when none is given. */
async function fireScheduledRunFromPayload(payload: { jobId: string; runId?: string; timestamp?: string }): Promise<ProcessRunResult> {
  const meta = getJob(payload.jobId)
  if (!meta?.isBakinJob) return { status: 200, body: { ok: true, skipped: 'not-bakin' } }
  const runId = payload.runId || `manual-${randomUUID()}`
  const parsed = payload.timestamp ? Date.parse(payload.timestamp) : NaN
  const firedAt = Number.isFinite(parsed) ? parsed : Date.now()
  return fireScheduledRun(meta, payload.jobId, runId, firedAt)
}

async function runClaimedFire(meta: BakinJobMeta, jobId: string, runId: string): Promise<ProcessRunResult> {
  const defaults = withDefaults(meta, await getScheduleDefaultOwner())

  // Check pause state
  const pauseState = isPaused(meta)
  if (pauseState.paused) {
    markCronFireSkipped(jobId, runId) // consumed — never healed into a task
    upsertJob(meta) // persist any auto-resume changes
    return { status: 200, body: { ok: true, skipped: 'paused' } }
  }

  // Check skip-next-N
  if (shouldSkip(meta)) {
    markCronFireSkipped(jobId, runId)
    upsertJob(meta)
    return { status: 200, body: { ok: true, skipped: 'skip-count' } }
  }

  // Check failure auto-pause
  if ((defaults.consecutiveFailures ?? 0) >= (defaults.maxFailures ?? 3)) {
    meta.paused = true
    meta.pauseReason = 'auto-failures'
    markCronFireSkipped(jobId, runId)
    upsertJob(meta)
    return { status: 200, body: { ok: true, skipped: 'auto-paused' } }
  }

  // Check overlap
  if (!defaults.allowOverlap && meta.lastTaskId) {
    try {
      const board = readTaskboard() as unknown as { columns: Record<string, Array<{ id: string }>> }
      const activeColumns = ['todo', 'inProgress', 'review', 'blocked'] as const
      for (const col of activeColumns) {
        const tasks = board.columns[col] ?? []
        if (tasks.some(t => t.id === meta.lastTaskId)) {
          markCronFireSkipped(jobId, runId)
          return { status: 200, body: { ok: true, skipped: 'overlap' } }
        }
      }
    } catch {
      // If we can't check, proceed anyway
      log.debug('Could not check overlap for task', { taskId: meta.lastTaskId })
    }
  }

  // Check last task outcome for failure tracking
  if (meta.lastTaskId) {
    try {
      const board2 = readTaskboard() as unknown as { columns: Record<string, Array<{ id: string }>> }
      const doneOrArchived = [...(board2.columns.done ?? []), ...(board2.columns.archived ?? [])]
      if (doneOrArchived.some(t => t.id === meta.lastTaskId)) {
        recordSuccess(meta)
      } else {
        const blocked = board2.columns.blocked ?? []
        if (blocked.some(t => t.id === meta.lastTaskId)) {
          const autoPaused = recordFailure(meta)
          if (autoPaused) {
            markCronFireSkipped(jobId, runId)
            upsertJob(meta)
            return { status: 200, body: { ok: true, skipped: 'auto-paused' } }
          }
        }
      }
    } catch {
      log.debug('Could not check last task outcome')
    }
  }

  // Create the task
  const now = new Date()
  const templateVars = {
    date: now.toISOString().slice(0, 10),
    agent: meta.agentId ?? 'unassigned',
    jobName: meta.displayName ?? jobId,
  }

  const title = meta.taskTitle
    ? expandTemplate(meta.taskTitle, templateVars)
    : `${meta.displayName ?? jobId} — ${now.toLocaleDateString()}`

  const description = meta.taskPrompt
    ? expandTemplate(meta.taskPrompt, templateVars)
    : undefined

  try {
    const result = await createTaskWithEffects({
      title,
      description,
      column: 'todo',
      assignee: defaults.requireTriage ? undefined : meta.agentId,
      workflowId: meta.workflowId,
      createdBy: 'schedule',
      scheduleJobId: jobId,
      source: {
        pluginId: 'schedule',
        entityType: 'job',
        entityId: jobId,
        purpose: 'scheduled-run',
      },
    })
    const taskId = result.id

    meta.lastTaskId = taskId
    attachCronTask(jobId, runId, taskId)
    upsertJob(meta)

    // Audit + activity feed
    if (pluginCtx) {
      pluginCtx.activity.audit('task_created', 'system', { jobId, runId, taskId, agent: meta.agentId, owner: defaults.owner })
      pluginCtx.activity.log('system', `Schedule "${meta.displayName ?? jobId}" created task ${taskId}${meta.agentId ? ` for ${meta.agentId}` : ''}`, { taskId })
    }

    return { status: 200, body: { ok: true, taskId } }
  } catch (err) {
    log.error('Bridge failed to create task', err)
    recordFailure(meta)
    upsertJob(meta)
    return { status: 500, body: { ok: false, error: (err as Error).message } }
  }
}

const HEAL_AFTER_MS = 5 * 60_000

/**
 * Re-drive cron-fire claims stuck in 'pending'. The claim row is the lock,
 * so healing creates AT MOST one task per run — and re-evaluates pause/skip
 * state at heal time so a paused job's stranded claim is consumed, not
 * resurrected into a task.
 *
 * The scan→heal pass is not itself transactional; it's safe because the
 * server singleton lock guarantees one process and the scheduler's in-flight
 * guard serializes ticks within it. If either assumption ever changes, the
 * heal needs a claim-the-heal CAS (e.g. pending → healing disposition).
 */
async function healPendingCronClaims(): Promise<void> {
  let stale: ReturnType<typeof findHealableCronClaims>
  try {
    stale = findHealableCronClaims(HEAL_AFTER_MS)
  } catch (err) {
    log.warn('Cron-claim heal scan failed', err)
    return
  }
  for (const claim of stale) {
    const meta = getJob(claim.jobId)
    if (!meta?.isBakinJob) {
      // Job deleted/unmanaged since the claim — consume it.
      markCronFireSkipped(claim.jobId, claim.runId)
      continue
    }
    const result = await runClaimedFire(meta, claim.jobId, claim.runId)
    pluginCtx?.activity.audit('fire_healed', 'system', {
      jobId: claim.jobId,
      runId: claim.runId,
      taskId: (result.body as { taskId?: string }).taskId ?? null,
      skipped: (result.body as { skipped?: string }).skipped ?? null,
    })
  }
}

// ─── Bakin-owned scheduler ───────────────────────────────────────────────
// Bakin fires its own schedules directly from the store; each tick computes
// due occurrences, claims each in the ledger, and runs the shared post-claim
// fire path. healPendingCronClaims() then recovers any claim stranded by a
// crash between claim and task creation.

let schedulerTimer: ReturnType<typeof setInterval> | null = null
let schedulerRunning = false

function schedulerDeps(): SchedulerDeps {
  return {
    now: () => Date.now(),
    // Window must exceed the tick interval so no occurrence slips between ticks.
    tickWindowMs: Math.max(DEFAULT_TICK_WINDOW_MS, tickIntervalMs() * 2),
    listJobs: () => Object.values(readSidecar().jobs).filter(job => job.isBakinJob),
    getCronFire: (jobId, runId) => getCronFire(jobId, runId),
    claimCronFire: (jobId, runId, firedAt) => claimCronFire(jobId, runId, firedAt),
    fire: async (meta, jobId, runId) => { await runClaimedFire(meta, jobId, runId) },
    log,
  }
}

function startScheduler(): void {
  if (schedulerTimer) clearInterval(schedulerTimer)
  schedulerTimer = setInterval(() => {
    if (schedulerRunning) return
    schedulerRunning = true
    runSchedulerTick(schedulerDeps())
      .then(() => healPendingCronClaims())
      .catch(err => log.warn('Scheduler tick failed', err))
      .finally(() => { schedulerRunning = false })
  }, tickIntervalMs())
  schedulerTimer.unref?.()
}

function stopScheduler(): void {
  if (!schedulerTimer) return
  clearInterval(schedulerTimer)
  schedulerTimer = null
}

/** Fire a single occurrence on demand (run-now / manual trigger). Claims a
 *  unique manual run so it is never blocked by occurrence dedup. */
async function fireManualRun(meta: BakinJobMeta, jobId: string): Promise<void> {
  await fireScheduledRun(meta, jobId, `manual-${randomUUID()}`, Date.now())
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

// ─── Routes (declarative) ────────────────────────────────────────────────

const routes = [
  defineRoute({
    path: '/',
    method: 'GET',
    summary: 'List all scheduled jobs',
    description: 'Returns the merged runtime cron + Bakin sidecar view of all jobs.',
    responses: { 200: passthrough, 500: errorResponse },
    handler: async () => {
      const jobs = (await readMergedRuntimeJobs()).map(j => ({
        ...j,
        cron: j.schedule.type === 'cron' ? j.schedule.value : undefined,
      }))
      return json({ jobs })
    },
  }),

  defineRoute({
    path: '/',
    method: 'POST',
    summary: 'Create a scheduled job',
    body: createJobBody,
    responses: { 200: passthrough, 400: errorResponse, 500: errorResponse },
    handler: async (_req, ctx, { body }) => {
      const parsed = parseSchedule(body.schedule)
      if (!parsed) {
        return json({ error: 'Could not parse schedule expression' }, 400)
      }
      const tz = body.tz || getSystemTimezone()
      const jobId = newScheduleId()
      const owner = body.owner ?? await getRuntimeMainAgentId(ctx.runtime)
      const meta: BakinJobMeta = {
        jobId,
        isBakinJob: true,
        source: 'bakin',
        schedule: { kind: 'cron', expr: parsed.cron },
        enabled: true,
        displayName: body.name,
        agentId: body.agentId,
        owner,
        requireTriage: body.requireTriage ?? false,
        workflowId: body.workflowId,
        taskPrompt: body.taskPrompt,
        taskTitle: body.taskTitle,
        allowOverlap: body.allowOverlap ?? false,
        maxFailures: body.maxFailures ?? 3,
        consecutiveFailures: 0,
        tz,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      upsertJob(meta)
      indexJob(jobId)
      ctx.activity.audit('job.created', body.owner ?? 'system', { jobId, name: body.name })
      ctx.activity.log(body.owner ?? 'system', `Created schedule "${body.name}"`)
      return json({ ok: true, jobId, cron: parsed.cron, human: parsed.human, tz })
    },
  }),

  defineRoute({
    path: '/:jobId',
    method: 'PUT',
    summary: 'Update a scheduled job',
    params: jobIdParams,
    body: updateJobBody,
    responses: { 200: okResponse, 400: errorResponse, 404: errorResponse, 500: errorResponse },
    handler: async (_req, ctx, { params, body }) => {
      const jobId = params.jobId || (body as { jobId?: string }).jobId
      if (!jobId) return json({ error: 'jobId required' }, 400)
      const meta = getJob(jobId)
      if (!meta) return json({ error: 'Job not found in sidecar' }, 404)
      const b = body as Record<string, unknown>
      if (b.schedule && typeof b.schedule === 'string') {
        const parsed = parseSchedule(b.schedule)
        if (!parsed) return json({ error: 'Could not parse schedule' }, 400)
        meta.schedule = { kind: 'cron', expr: parsed.cron }
      }
      if (b.name && typeof b.name === 'string') {
        meta.displayName = b.name
      }
      const sidecarFields = [
        'displayName', 'description', 'agentId', 'owner', 'requireTriage',
        'workflowId', 'taskPrompt', 'taskTitle', 'allowOverlap', 'maxFailures',
      ]
      for (const field of sidecarFields) {
        if (b[field] !== undefined) {
          ;(meta as unknown as Record<string, unknown>)[field] = b[field]
        }
      }
      upsertJob(meta)
      indexJob(jobId)
      ctx.activity.audit('job.updated', 'system', { jobId })
      ctx.activity.log('system', `Updated schedule "${meta.displayName || jobId}"`)
      return json({ ok: true })
    },
  }),

  defineRoute({
    path: '/:jobId',
    method: 'GET',
    summary: 'Get scheduled job details',
    params: jobIdParams,
    responses: { 200: passthrough, 404: errorResponse },
    handler: async (_req, ctx, { params }) => {
      const meta = getJob(params.jobId)
      if (!meta) return json({ error: 'Job not found' }, 404)
      const defaults = withDefaults(meta, await getRuntimeMainAgentId(ctx.runtime))
      const lastRun = await getLastRun(ctx.runtime.cron, params.jobId)
      return json({
        job: {
          id: meta.jobId,
          name: meta.displayName,
          agent: meta.agentId,
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
        },
      })
    },
  }),

  defineRoute({
    path: '/:jobId',
    method: 'DELETE',
    summary: 'Delete a scheduled job',
    params: jobIdParams,
    body: deleteJobBody,
    responses: { 200: okResponse, 400: errorResponse },
    handler: async (_req, ctx, { params }) => {
      const jobId = params.jobId
      const result = await deleteScheduleJob(ctx, jobId)
      ctx.activity.audit('job.deleted', 'system', { jobId })
      ctx.activity.log('system', `Deleted schedule "${jobId}"`)
      return json({ ok: true, ...result })
    },
  }),

  defineRoute({
    path: '/:jobId/adopt',
    method: 'POST',
    summary: 'Adopt a runtime cron job into Bakin task scheduling',
    params: jobIdParams,
    body: adoptJobBody,
    responses: { 200: passthrough, 400: errorResponse, 404: errorResponse, 409: errorResponse, 500: errorResponse },
    handler: async (_req, ctx, { params, body }) => {
      const jobId = params.jobId || body.jobId
      if (!jobId) return json({ error: 'jobId required' }, 400)

      const runtimeJob = await ctx.runtime.cron.get(jobId)
      if (!runtimeJob) return json({ error: 'Runtime cron job not found' }, 404)

      const existing = getJob(jobId)
      if (existing?.isBakinJob) return json({ error: 'Job is already managed by Bakin' }, 409)

      const raw = await ctx.runtime.cron.getRaw(jobId, 'schedule adopt: preserve native cron before Bakin takes ownership')
      if (!raw) return json({ error: 'Runtime cron snapshot not found' }, 404)

      const parsed = body.schedule ? parseSchedule(body.schedule) : { cron: runtimeJob.schedule }
      if (!parsed) return json({ error: 'Could not parse schedule' }, 400)

      const now = new Date().toISOString()
      const tz = body.tz || existing?.tz || getSystemTimezone()
      const displayName = body.name || existing?.displayName || runtimeJob.name
      const owner = (body.owner ?? undefined) || existing?.owner || await getRuntimeMainAgentId(ctx.runtime)
      const taskPrompt = (body.taskPrompt ?? undefined) || existing?.taskPrompt || runtimeJob.command

      const meta: BakinJobMeta = {
        ...(existing ?? {}),
        jobId,
        isBakinJob: true,
        source: 'adopted',
        schedule: { kind: 'cron', expr: parsed.cron },
        enabled: runtimeJob.enabled ?? true,
        displayName,
        agentId: body.agentId === null ? undefined : body.agentId ?? existing?.agentId,
        owner,
        requireTriage: body.requireTriage ?? existing?.requireTriage ?? false,
        workflowId: body.workflowId === null ? undefined : body.workflowId ?? existing?.workflowId,
        taskPrompt,
        taskTitle: body.taskTitle === null ? undefined : body.taskTitle ?? existing?.taskTitle,
        allowOverlap: body.allowOverlap ?? existing?.allowOverlap ?? false,
        maxFailures: body.maxFailures ?? existing?.maxFailures ?? 3,
        consecutiveFailures: existing?.consecutiveFailures ?? 0,
        tz,
        originalRuntimeCron: {
          provider: ctx.runtime.name,
          capturedAt: now,
          snapshot: raw,
        },
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }
      upsertJob(meta)
      // Bakin owns the schedule now — remove the native cron so it stops firing.
      await ctx.runtime.cron.remove(jobId)
      indexJob(jobId)

      ctx.activity.audit('job.adopted', 'system', { jobId })
      ctx.activity.log('system', `Adopted runtime cron "${displayName}" into Bakin`)
      return json({ ok: true, jobId })
    },
  }),

  defineRoute({
    path: '/:jobId/restore-native',
    method: 'POST',
    summary: 'Restore an adopted Bakin schedule back to its native runtime cron behavior',
    params: jobIdParams,
    body: restoreNativeBody,
    responses: { 200: passthrough, 400: errorResponse, 404: errorResponse, 500: errorResponse },
    handler: async (_req, ctx, { params }) => {
      const jobId = params.jobId
      if (!jobId) return json({ error: 'jobId required' }, 400)

      const meta = getJob(jobId)
      if (!meta?.originalRuntimeCron) return json({ error: 'No native cron snapshot available' }, 404)

      const restored = await ctx.runtime.cron.restoreRaw(
        jobId,
        meta.originalRuntimeCron.snapshot,
        'schedule restore: return adopted cron to native runtime behavior',
      )
      const now = new Date().toISOString()
      const runtimeMeta: BakinJobMeta = {
        jobId,
        isBakinJob: false,
        source: 'runtime',
        displayName: restored.name,
        owner: meta.owner ?? await getRuntimeMainAgentId(ctx.runtime),
        requireTriage: true,
        createdAt: meta.createdAt ?? now,
        updatedAt: now,
      }
      upsertJob(runtimeMeta)
      indexJob(jobId)

      ctx.activity.audit('job.restored_native', 'system', { jobId })
      ctx.activity.log('system', `Restored schedule "${restored.name}" to native runtime cron behavior`)
      return json({ ok: true, jobId })
    },
  }),

  defineRoute({
    path: '/:jobId/pause',
    method: 'POST',
    summary: 'Pause/resume/skip a scheduled job',
    params: jobIdParams,
    body: pauseJobBody,
    responses: { 200: okResponse, 400: errorResponse, 404: errorResponse },
    handler: async (_req, ctx, { params, body }) => {
      const jobId = params.jobId || body.jobId
      if (!jobId) return json({ error: 'jobId required' }, 400)
      const meta = getJob(jobId)
      if (!meta) {
        if (body.action === 'skip') return json({ error: 'Skip is only available for Bakin schedules' }, 400)
        const runtimeJob = await ctx.runtime.cron.get(jobId)
        if (!runtimeJob) return json({ error: 'Job not found' }, 404)
        await ctx.runtime.cron.update(jobId, { enabled: body.action === 'resume' })
        indexJob(jobId)
        ctx.activity.audit(`job.${body.action === 'pause' ? 'disabled' : 'enabled'}`, 'system', { jobId })
        ctx.activity.log('system', `Runtime cron "${jobId}" ${body.action === 'pause' ? 'disabled' : 'enabled'}`)
        return json({ ok: true })
      }
      switch (body.action) {
        case 'pause':
          meta.paused = true
          meta.pauseReason = 'manual'
          meta.pauseUntil = body.pauseUntil
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
          if (!meta.isBakinJob) return json({ error: 'Skip is only available for Bakin schedules' }, 400)
          meta.skipNextN = body.skipN ?? 1
          meta.skippedCount = 0
          break
      }
      upsertJob(meta)
      indexJob(jobId)
      ctx.activity.audit(`job.${body.action}`, 'system', { jobId })
      ctx.activity.log('system', `Schedule "${meta.displayName || jobId}" ${body.action}d`)
      return json({ ok: true })
    },
  }),

  defineRoute({
    path: '/:jobId/run',
    method: 'POST',
    summary: 'Trigger immediate run',
    params: jobIdParams,
    body: runNowBody,
    responses: { 200: okResponse, 400: errorResponse, 404: errorResponse },
    handler: async (_req, ctx, { params }) => {
      const jobId = params.jobId
      const meta = getJob(jobId)
      if (!meta?.isBakinJob) return json({ error: 'Job not found' }, 404)
      await fireManualRun(meta, jobId)
      ctx.activity.audit('job.run_now', 'system', { jobId })
      ctx.activity.log('system', `Triggered immediate run for "${jobId}"`)
      return json({ ok: true })
    },
  }),

  defineRoute({
    path: '/:jobId/runs',
    method: 'GET',
    summary: 'Get run history for a job',
    params: jobIdParams,
    query: runsHistoryQuery,
    responses: { 200: passthrough },
    handler: async (_req, ctx, { params, query }) => {
      const limit = query.limit ?? 50
      const runs = await readRuns(ctx.runtime.cron, params.jobId, limit)
      return json({ runs })
    },
  }),

  defineRoute({
    path: '/parse',
    method: 'POST',
    summary: 'Parse a schedule expression',
    description: 'Converts a natural-language or cron expression into structured schedule output.',
    body: parseBody,
    responses: { 200: passthrough, 400: errorResponse },
    handler: async (_req, _ctx, { body }) => {
      const result = parseSchedule(body.input)
      if (!result) {
        return json({ error: 'Could not parse schedule. Try a simpler expression or raw cron.' }, 400)
      }
      return json(result)
    },
  }),


  searchRoute({ table: 'schedule' }),
]

const schedulePlugin: BakinPlugin = definePlugin({
  id: 'schedule',
  name: 'Schedule',
  version: '2.0.0',
  routes,

  settingsSchema: {
    fields: [
      { key: 'maxConcurrentJobs', type: 'number', label: 'Max concurrent jobs', description: 'Maximum jobs that can run at the same time', default: 3 },
      { key: 'failureCooldownMs', type: 'number', label: 'Failure cooldown (ms)', description: 'Wait time after failure before retrying', default: 300000 },
      { key: 'maxFailures', type: 'number', label: 'Max consecutive failures', description: 'Pause job after this many consecutive failures', default: 3 },
      { key: 'tickIntervalSeconds', type: 'number', label: 'Scheduler tick interval (seconds)', description: 'How often the scheduler checks for due schedules. Floor-clamped to 5s.', default: 30 },
      { key: 'catchUpWindowMinutes', type: 'number', label: 'Missed-fire safety window (minutes)', description: 'After downtime, a missed run fires normally if within this window; older runs land in Blocked for you to triage. Larger = more tolerant.', default: 60 },
    ],
  },

  navItems: [],
  contentFiles: [],

  async activate(ctx: PluginContext) {
    pluginCtx = ctx

    ctx.hooks.register('schedule.ensureBakinJob', (data: Record<string, unknown>) => ensureBakinJob(ctx, data), {
      hookKind: 'rpc',
      label: 'Ensure Bakin schedule',
      summary: 'Create or update a Bakin-managed runtime cron job and return the provider job id.',
    })

    // ─── Search Content Type Registration ─────────────────────────────

    ctx.search.registerContentType({
      table: 'schedule',
      schema: {
        name: { type: 'text' },
        schedule: { type: 'keyword' },
        command: { type: 'text' },
        agent: { type: 'keyword' },
        enabled: { type: 'keyword' },
        updated_at: { type: 'datetime' },
      },
      searchableFields: ['name', 'command'],
      rerankField: 'command',
      embeddingTemplate: '{{name}} {{command}}',
      facets: ['agent', 'enabled'],
      reindex: async function* () {
        for (const job of await readMergedRuntimeJobs()) {
          yield { key: job.id, doc: jobToSearchDoc(job) }
        }
      },
      verifyExists: async () => true, // Jobs are ephemeral, managed by the runtime adapter.
    })

    /** Runtime jobs live in the cron adapter + sidecar, so sync them into search on plugin activation. */
    async function syncRuntimeJobsToSearch(): Promise<void> {
      const jobs = await readMergedRuntimeJobs()
      for (const job of jobs) {
        ctx.search.index(job.id, jobToSearchDoc(job)).catch((err) => {
          log.warn('Failed to index runtime job', { jobId: job.id, error: err instanceof Error ? err.message : String(err) })
        })
      }
    }

    await syncRuntimeJobsToSearch()

    // ── API Routes are declarative on plugin.routes (see module scope). ──

    // ── Exec Tools (agent-facing) ──────────────────────────────────────

    ctx.registerExecTool({
      name: 'bakin_exec_schedule_list',
      label: 'Listed scheduled jobs',
      description: 'List all scheduled jobs (merged runtime cron + Bakin view)',
      parameters: {
        filter: z.enum(['bakin', 'all']).optional().describe('Filter by job type'),
        agentId: z.string().optional().describe('Filter by assigned agent'),
      },
      handler: async (params: Record<string, unknown>) => {
        let jobs = await readMergedRuntimeJobs()
        if (params.filter === 'bakin') jobs = jobs.filter(j => j.isBakinJob)
        if (params.agentId) jobs = jobs.filter(j => j.agentId === params.agentId)
        return {
          ok: true,
          jobs: jobs.map(j => ({
            id: j.id,
            name: j.displayName,
            agent: j.agentId,
            schedule: j.humanSchedule,
            paused: j.paused,
            isBakinJob: j.isBakinJob,
            lastTaskId: j.lastTaskId,
            ...(j.toolsAllow?.length ? { toolsAllow: j.toolsAllow } : {}),
            ...(j.toolsAllowMissing ? { toolsAllowMissing: true } : {}),
          })),
        }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_schedule_create',
      label: 'Created a scheduled job',
      description: 'Create a new scheduled job that creates tasks on the board',
      parameters: {
        name: z.string().describe('Job name (required)'),
        schedule: z.string().describe('Schedule expression: NL ("every day at 9am") or raw cron ("0 9 * * *") (required)'),
        agentId: z.string().optional().describe('Agent to assign tasks to'),
        workflowId: z.string().optional().describe('Workflow to attach to tasks'),
        taskPrompt: z.string().optional().describe('Task description template'),
        taskTitle: z.string().optional().describe('Task title template (supports {date}, {agent})'),
      },
      handler: async (params: Record<string, unknown>) => {
        if (!params.name || !params.schedule) {
          return { ok: false, error: 'name and schedule are required' }
        }

        const parsed = parseSchedule(params.schedule as string)
        if (!parsed) return { ok: false, error: 'Could not parse schedule expression' }

        const tz = getSystemTimezone()
        const jobId = newScheduleId()

        const meta: BakinJobMeta = {
          jobId,
          isBakinJob: true,
          source: 'bakin',
          schedule: { kind: 'cron', expr: parsed.cron },
          enabled: true,
          displayName: params.name as string,
          agentId: params.agentId as string | undefined,
          owner: await getRuntimeMainAgentId(ctx.runtime),
          workflowId: params.workflowId as string | undefined,
          taskPrompt: params.taskPrompt as string | undefined,
          taskTitle: params.taskTitle as string | undefined,
          allowOverlap: false,
          maxFailures: 3,
          consecutiveFailures: 0,
          tz,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
        upsertJob(meta)
        indexJob(jobId)

        return { ok: true, jobId, cron: parsed.cron, human: parsed.human, tz }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_schedule_update',
      label: 'Updated a scheduled job',
      description: 'Update an existing scheduled job',
      parameters: {
        jobId: z.string().describe('Job ID (required)'),
        name: z.string().optional().describe('New job name'),
        schedule: z.string().optional().describe('New schedule expression'),
        agentId: z.string().optional().describe('New agent assignment'),
        workflowId: z.string().optional().describe('New workflow binding'),
        taskPrompt: z.string().optional().describe('New task prompt template'),
        taskTitle: z.string().optional().describe('New task title template'),
      },
      handler: async (params: Record<string, unknown>) => {
        if (!params.jobId) return { ok: false, error: 'jobId required' }

        const meta = getJob(params.jobId as string)
        if (!meta) return { ok: false, error: 'Job not found' }

        if (params.schedule) {
          const parsed = parseSchedule(params.schedule as string)
          if (!parsed) return { ok: false, error: 'Could not parse schedule' }
          meta.schedule = { kind: 'cron', expr: parsed.cron }
        }

        const fields = ['displayName', 'agentId', 'workflowId', 'taskPrompt', 'taskTitle']
        for (const f of fields) {
          if (params[f] !== undefined) (meta as unknown as Record<string, unknown>)[f === 'name' ? 'displayName' : f] = params[f]
        }
        if (params.name) meta.displayName = params.name as string
        upsertJob(meta)
        indexJob(params.jobId as string)

        return { ok: true }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_schedule_pause',
      label: 'Paused a scheduled job',
      description: 'Pause, resume, or skip runs for a scheduled job',
      parameters: {
        jobId: z.string().describe('Job ID (required)'),
        action: z.enum(['pause', 'resume', 'skip']).describe('Action to take (required)'),
        pauseUntil: z.string().optional().describe('ISO date to auto-resume (for pause action)'),
        skipN: z.number().optional().describe('Number of runs to skip (for skip action)'),
      },
      handler: async (params: Record<string, unknown>) => {
        if (!params.jobId || !params.action) return { ok: false, error: 'jobId and action required' }

        const meta = getJob(params.jobId as string)
        if (!meta) {
          if (params.action === 'skip') return { ok: false, error: 'Skip is only available for Bakin schedules' }
          const runtimeJob = await ctx.runtime.cron.get(params.jobId as string)
          if (!runtimeJob) return { ok: false, error: 'Job not found' }
          await ctx.runtime.cron.update(params.jobId as string, { enabled: params.action === 'resume' })
          return { ok: true }
        }

        switch (params.action) {
          case 'pause':
            meta.paused = true
            meta.pauseReason = 'manual'
            if (params.pauseUntil) meta.pauseUntil = params.pauseUntil as string
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
            meta.skipNextN = (params.skipN as number) ?? 1
            meta.skippedCount = 0
            break
        }
        upsertJob(meta)

        return { ok: true }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_schedule_delete',
      label: 'Deleted a scheduled job',
      description: 'Delete a scheduled job',
      parameters: {
        jobId: z.string().describe('Job ID (required)'),
      },
      handler: async (params: Record<string, unknown>) => {
        if (!params.jobId) return { ok: false, error: 'jobId required' }
        const result = await deleteScheduleJob(ctx, params.jobId as string)
        return { ok: true, ...result }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_schedule_get',
      label: 'Read schedule details',
      description: 'Get details for a single scheduled job',
      parameters: {
        jobId: z.string().describe('Job ID (required)'),
      },
      handler: async (params: Record<string, unknown>) => {
        if (!params.jobId) return { ok: false, error: 'jobId required' }
        const meta = getJob(params.jobId as string)
        if (!meta) return { ok: false, error: 'Job not found' }
        const defaults = withDefaults(meta, await getRuntimeMainAgentId(ctx.runtime))
        const lastRun = await getLastRun(ctx.runtime.cron, params.jobId as string)
        return {
          ok: true,
          job: {
            id: meta.jobId,
            name: meta.displayName,
            agent: meta.agentId,
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
          },
        }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_schedule_run_now',
      label: 'Triggered scheduled job',
      activityDuplicate: true,
      description: 'Trigger an immediate run of a scheduled job',
      parameters: {
        jobId: z.string().describe('Job ID (required)'),
      },
      handler: async (params: Record<string, unknown>) => {
        const jobId = params.jobId as string | undefined
        if (!jobId) return { ok: false, error: 'jobId required' }
        const meta = getJob(jobId)
        if (!meta?.isBakinJob) return { ok: false, error: 'Job not found' }
        await fireManualRun(meta, jobId)
        ctx.activity.audit('job.run_now', 'system', { jobId })
        return { ok: true, jobId }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_schedule_runs',
      label: 'Listed schedule runs',
      description: 'Get run history for a scheduled job',
      parameters: {
        jobId: z.string().describe('Job ID (required)'),
        limit: z.number().optional().describe('Max runs to return (default 50)'),
      },
      handler: async (params: Record<string, unknown>) => {
        if (!params.jobId) return { ok: false, error: 'jobId required' }
        const limit = typeof params.limit === 'number' ? params.limit : 50
        const runs = await readRuns(ctx.runtime.cron, params.jobId as string, limit)
        return { ok: true, runs }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_schedule_parse',
      label: 'Parsed cron expression',
      description: 'Parse a natural language or raw cron schedule expression',
      parameters: {
        input: z.string().describe('Schedule expression to parse (required)'),
      },
      handler: async (params: Record<string, unknown>) => {
        if (!params.input) return { ok: false, error: 'input required' }
        const result = parseSchedule(params.input as string)
        if (!result) return { ok: false, error: 'Could not parse schedule. Try a simpler expression or raw cron.' }
        return { ok: true, cron: result.cron, human: result.human, nextRuns: result.nextRuns }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_schedule_briefing',
      label: 'Generated schedule briefing',
      description: "Today's schedule summary — which jobs fire, assigned agents, alerts. Designed for orchestrator daily briefing.",
      parameters: {
        date: z.string().optional().describe('ISO date to check (defaults to today)'),
      },
      handler: async (params: Record<string, unknown>) => {
        const jobs = await readMergedRuntimeJobs()
        const bakinJobs = jobs.filter(j => j.isBakinJob)

        const alerts = bakinJobs.filter(j =>
          j.paused || j.consecutiveFailures > 0
        )

        return {
          ok: true,
          date: (params.date as string) ?? new Date().toISOString().slice(0, 10),
          totalJobs: jobs.length,
          bakinJobs: bakinJobs.length,
          active: bakinJobs.filter(j => !j.paused).length,
          paused: bakinJobs.filter(j => j.paused).length,
          jobs: bakinJobs.map(j => ({
            id: j.id,
            name: j.displayName,
            agent: j.agentId,
            schedule: j.humanSchedule,
            paused: j.paused,
            pauseReason: j.pauseReason,
            failures: j.consecutiveFailures,
            lastTaskId: j.lastTaskId,
          })),
          alerts: alerts.map(j => ({
            id: j.id,
            name: j.displayName,
            issue: j.paused
              ? `Paused (${j.pauseReason ?? 'manual'})`
              : `${j.consecutiveFailures} consecutive failures`,
          })),
        }
      },
    })

    // ─── Health check (migrated out of core/doctor.ts per #139 C4) ──────
    // Cut any Bakin schedules off OpenClaw cron (import expr → store, remove the
    // runtime cron) so the scheduler is the sole fire path. Idempotent; runs
    // every activate to close the upgrade gap and recover from a prior partial.
    try {
      await migrateBakinSchedulesOffOpenClawCron({
        cronGet: async (jobId) => {
          const job = await ctx.runtime.cron.get(jobId)
          return job ? { schedule: job.schedule, enabled: job.enabled, metadata: job.metadata } : null
        },
        cronRemove: (jobId) => ctx.runtime.cron.remove(jobId),
        systemTz: getSystemTimezone,
      })
    } catch (err) {
      log.error('Schedule cutover failed', err)
    }

    startScheduler()
    log.info('Schedule plugin activated')
  },

  async onReady() {
    const runtime = pluginCtx?.runtime
    if (!runtime) return
    const jobs = await readMergedJobs(runtime.cron, await getRuntimeMainAgentId(runtime))
    const bakin = jobs.filter(j => j.isBakinJob)
    const paused = bakin.filter(j => j.paused)
    log.info(`Ready — ${bakin.length} bakin jobs (${paused.length} paused), ${jobs.length} total`)
  },

  onShutdown() {
    stopScheduler()
    log.info('Schedule plugin shutting down')
  },
}) as unknown as BakinPlugin

export default schedulePlugin

/**
 * Test-only internals. The plugin loader reads only the default export; these
 * let exactly-once / heal tests drive the claim→fire path directly without a
 * full scheduler tick.
 */
export const __scheduleTestInternals = {
  fireScheduledRunFromPayload,
  healPendingCronClaims,
  setPluginCtxForTests: (ctx: unknown) => {
    pluginCtx = ctx as PluginContext | null
  },
}
