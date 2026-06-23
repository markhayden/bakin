/**
 * Schedule plugin — server entry point.
 * Registers API routes, exec tools, and the cron→task bridge.
 */
import { z } from 'zod'
import type { BakinPlugin, PluginContext } from '@bakin/core/plugin-types'
import { definePlugin, defineRoute, searchRoute } from '@bakin/core/routing'
import { readMergedJobs } from './lib/jobs-reader'
import { getLastRun, readRuns } from './lib/runs-reader'
import { upsertJob, getJob, readSidecar, withDefaults, newScheduleId, resumeDuePauses } from './lib/sidecar'
import { parseSchedule } from './lib/cron-parser'
import { runStartupCatchUp } from './lib/scheduler'
import { checkScheduleCutover, scheduleCutoverRepair } from './lib/health-checks'
import { checkSchedulePrompt } from './lib/prompt-guard'
import { getSystemTimezone, json } from './lib/schedule-util'
import { setPluginCtx, getPluginCtx } from './lib/plugin-context'
import {
  MISSED_WINDOW_REASON,
  healPendingCronClaims,
  fireManualRun,
  fireScheduledRunFromPayload,
} from './lib/fire-engine'

// Re-exported so the `@bakin/schedule/index` test surface stays stable
// (cron-dedup.test.ts / blocked-fire-routing.test.ts import it from here).
export { MISSED_WINDOW_REASON }
import {
  schedulerDeps,
  runScheduleCutover,
  startScheduler,
  stopScheduler,
  catchUpWindowMs,
} from './lib/scheduler-loop'
import {
  guardBakinMutation,
  ensureBakinJob,
  deleteScheduleJob,
  readMergedRuntimeJobs,
  jobToSearchDoc,
  indexJob,
} from './lib/job-service'
import { registerScheduleExecTools } from './lib/exec-tools'
import { createLogger } from '../../src/core/logger'
import { getRuntimeMainAgentId } from '@bakin/core/adapters/runtime'
import type { BakinJobMeta } from './types'

const log = createLogger('schedule')

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
      const warnings = checkSchedulePrompt(body.taskPrompt)
      return json({ ok: true, jobId, cron: parsed.cron, human: parsed.human, tz, ...(warnings.length ? { warnings } : {}) })
    },
  }),

  defineRoute({
    path: '/:jobId',
    method: 'PUT',
    summary: 'Update a scheduled job',
    params: jobIdParams,
    body: updateJobBody,
    responses: { 200: okResponse, 400: errorResponse, 403: errorResponse, 404: errorResponse, 500: errorResponse },
    handler: async (_req, ctx, { params, body }) => {
      const jobId = params.jobId || (body as { jobId?: string }).jobId
      if (!jobId) return json({ error: 'jobId required' }, 400)
      const guard = await guardBakinMutation(jobId)
      if (!guard.ok) return json({ error: guard.error }, guard.status)
      const meta = guard.meta
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
      const warnings = checkSchedulePrompt(meta.taskPrompt)
      return json({ ok: true, ...(warnings.length ? { warnings } : {}) })
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
    responses: { 200: okResponse, 400: errorResponse, 403: errorResponse },
    handler: async (_req, ctx, { params }) => {
      const jobId = params.jobId
      const guard = await guardBakinMutation(jobId)
      if (!guard.ok) return json({ error: guard.error }, guard.status)
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
    responses: { 200: okResponse, 400: errorResponse, 403: errorResponse, 404: errorResponse },
    handler: async (_req, ctx, { params, body }) => {
      const jobId = params.jobId || body.jobId
      if (!jobId) return json({ error: 'jobId required' }, 400)
      const guard = await guardBakinMutation(jobId)
      if (!guard.ok) return json({ error: guard.error }, guard.status)
      const meta = guard.meta
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
    setPluginCtx(ctx)

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

    registerScheduleExecTools(ctx)

    // ─── Health check (migrated out of core/doctor.ts per #139 C4) ──────
    // Cut any Bakin schedules off OpenClaw cron (import expr → store, remove the
    // runtime cron) so the scheduler is the sole fire path. Idempotent; runs
    // every activate to close the upgrade gap and recover from a prior partial.
    try {
      await runScheduleCutover()
    } catch (err) {
      log.error('Schedule cutover failed', err)
    }

    // Doctor check + repair surfacing any schedule whose cutover didn't complete
    // (e.g. OpenClaw unreachable at boot) — the end-user migration command.
    ctx.registerHealthCheck({
      id: 'schedule-cutover',
      name: 'Bakin schedules cut over from OpenClaw cron',
      run: async () => checkScheduleCutover(
        ctx.runtime.cron,
        () => Object.values(readSidecar().jobs).filter(j => j.isBakinJob).map(j => j.jobId),
      ),
      repair: scheduleCutoverRepair(runScheduleCutover),
    })

    // Fire (or block) anything missed while the server was down, then start the
    // steady tick. Catch-up first so a just-missed occurrence isn't double-handled.
    // Re-enable any timed pause that lapsed during downtime so its missed run is
    // caught up rather than left dormant by the enabled-gate.
    try {
      resumeDuePauses()
      await runStartupCatchUp(schedulerDeps(), catchUpWindowMs())
    } catch (err) {
      log.error('Schedule startup catch-up failed', err)
    }

    startScheduler()
    log.info('Schedule plugin activated')
  },

  async onReady() {
    const runtime = getPluginCtx()?.runtime
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
    setPluginCtx(ctx as PluginContext | null)
  },
}
