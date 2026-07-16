/**
 * Schedule REST routes — the declarative job CRUD/run/parse/search surface.
 *
 * The 12 defineRoute/searchRoute entries plus their zod schemas. Handlers stay
 * thin: validate → call a job-service verb / the fire engine / the cron parser
 * → log. Spread into definePlugin from index.ts.
 */
import { z } from 'zod'
import { defineRoute, searchRoute } from '@bakin/core/routing'
import type { BakinJobMeta } from '../../types'
import { getJob, upsertJob } from '../sidecar'
import { parseSchedule } from '../cron-parser'
import { getSystemTimezone, json, nativeCronTz } from '../schedule-util'
import { readRuns } from '../runs-reader'
import { computeOccurrences } from '../occurrences'
import { collectDomainEvents, RESCHEDULE_EVENT_SUFFIX } from '../domain-events'
import { getCronFire } from '../../../../src/core/execution-ledger'
import { getHookRegistry } from '@bakin/core/hooks/hook-registry-singleton'
import { getRuntimeMainAgentId } from '@bakin/core/adapters/runtime'
import { fireManualRun } from '../fire-engine'
import {
  applyPauseAction,
  createScheduleJob,
  deleteScheduleJob,
  guardBakinMutation,
  indexJob,
  projectJobDetail,
  readMergedRuntimeJobs,
  updateScheduleJob,
} from '../job-service'
import { validateTeamAssignment, TaskValidationError } from '../../../../src/core/task-service'

// ─── Schemas ─────────────────────────────────────────────────────────────

const jobIdParams = z.object({ jobId: z.string().min(1) })
/** Occurrence queries cap at ~2 months — the month view needs 6 weeks. */
const MAX_OCCURRENCE_RANGE_MS = 62 * 24 * 60 * 60 * 1000
const rescheduleEventBody = z.object({
  pluginId: z.string().min(1),
  eventId: z.string().min(1),
  to: z.string().min(1),
})
const okResponse = z.object({ ok: z.literal(true) }).passthrough()
const errorResponse = z.object({ error: z.string() }).passthrough()
const passthrough = z.object({}).passthrough()

const createJobBody = z.object({
  name: z.string().min(1),
  schedule: z.string().min(1),
  agentId: z.string().optional(),
  /** Team assignment (#189) — mutually exclusive with agentId (handler-enforced 400). */
  teamId: z.string().optional(),
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
  teamId: z.string().nullable().optional(),
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

export const scheduleRoutes = [
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
    path: '/occurrences',
    method: 'GET',
    summary: 'Job occurrences in a time range',
    description: 'Server-computed, timezone-correct occurrence instants for every evaluable job (cron + one-shot), past occurrences enriched with their ledger disposition. The single source the calendar views render from.',
    responses: { 200: passthrough, 400: errorResponse, 500: errorResponse },
    handler: async (req) => {
      const url = new URL(req.url)
      const fromMs = Date.parse(url.searchParams.get('from') ?? '')
      const toMs = Date.parse(url.searchParams.get('to') ?? '')
      if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
        return json({ error: 'from and to must be ISO-8601 instants' }, 400)
      }
      if (toMs <= fromMs) return json({ error: 'to must be after from' }, 400)
      if (toMs - fromMs > MAX_OCCURRENCE_RANGE_MS) {
        return json({ error: `range too large (max ${MAX_OCCURRENCE_RANGE_MS / 86_400_000} days)` }, 400)
      }
      const jobs = await readMergedRuntimeJobs()
      const { items, unevaluated } = computeOccurrences(jobs, fromMs, toMs, {
        nowMs: Date.now(),
        getFire: (jobId, runId) => getCronFire(jobId, runId),
      })
      // Plugin-contributed domain events ride the same feed (#191): fan-in
      // over `{pluginId}.scheduledEvents` hooks, per-provider fault-isolated.
      const { events, droppedProviders } = await collectDomainEvents(
        new Date(fromMs).toISOString(),
        new Date(toMs).toISOString(),
        { hooks: getHookRegistry() },
      )
      return json({ occurrences: items, events, unevaluated, droppedProviders })
    },
  }),

  defineRoute({
    path: '/events/reschedule',
    method: 'POST',
    summary: 'Reschedule a plugin-owned domain event',
    description: "Invokes the owning plugin's {pluginId}.rescheduleEvent hook — the contract's one sanctioned mutation. Schedule never writes plugin domain data itself.",
    body: rescheduleEventBody,
    responses: { 200: okResponse, 400: errorResponse, 404: errorResponse, 500: errorResponse },
    handler: async (_req, _ctx, { body }) => {
      if (!Number.isFinite(Date.parse(body.to))) {
        return json({ error: 'to must be an ISO-8601 instant' }, 400)
      }
      const hookName = `${body.pluginId}${RESCHEDULE_EVENT_SUFFIX}`
      const registry = getHookRegistry()
      if (!registry.has(hookName)) {
        return json({ error: `Plugin '${body.pluginId}' does not support rescheduling` }, 404)
      }
      const result = await registry.invoke<{ ok: boolean; error?: string }>(hookName, {
        eventId: body.eventId,
        to: body.to,
      })
      if (!result?.ok) return json({ error: result?.error ?? 'Owner rejected the reschedule' }, 400)
      return json({ ok: true })
    },
  }),

  defineRoute({
    path: '/',
    method: 'POST',
    summary: 'Create a scheduled job',
    body: createJobBody,
    responses: { 200: passthrough, 400: errorResponse, 500: errorResponse },
    handler: async (_req, ctx, { body }) => {
      const result = await createScheduleJob(ctx, body)
      if (!result.ok) return json({ error: result.error }, 400)
      ctx.activity.audit('job.created', body.owner ?? 'system', { jobId: result.jobId, name: body.name })
      ctx.activity.log(body.owner ?? 'system', `Created schedule "${body.name}"`)
      const { warnings, ...created } = result
      return json({ ...created, ...(warnings.length ? { warnings } : {}) })
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
      const updates = body as Record<string, unknown>
      const result = await updateScheduleJob(meta, updates, [
        'displayName', 'description', 'agentId', 'teamId', 'owner', 'requireTriage',
        'workflowId', 'taskPrompt', 'taskTitle', 'allowOverlap', 'maxFailures',
      ])
      if (!result.ok) return json({ error: result.error }, 400)
      indexJob(jobId)
      ctx.activity.audit('job.updated', 'system', { jobId })
      ctx.activity.log('system', `Updated schedule "${meta.displayName || jobId}"`)
      return json({ ok: true, ...(result.warnings.length ? { warnings: result.warnings } : {}) })
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
      return json({ job: await projectJobDetail(ctx, params.jobId, meta) })
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

      // cron is optional (P2.1): adoption only makes sense on a runtime that
      // HAS native crons to adopt from.
      const cron = ctx.runtime.cron
      if (!cron) return json({ error: 'The active runtime has no native cron surface — nothing to adopt' }, 404)

      const runtimeJob = await cron.get(jobId)
      if (!runtimeJob) return json({ error: 'Runtime cron job not found' }, 404)

      const existing = getJob(jobId)
      if (existing?.isBakinJob) return json({ error: 'Job is already managed by Bakin' }, 409)

      const raw = await cron.getRaw(jobId, 'schedule adopt: preserve native cron before Bakin takes ownership')
      if (!raw) return json({ error: 'Runtime cron snapshot not found' }, 404)

      const tz = body.tz || existing?.tz || nativeCronTz(runtimeJob) || getSystemTimezone()
      const parsed = body.schedule
        ? parseSchedule(body.schedule, { tz })
        : { kind: 'cron' as const, expr: runtimeJob.schedule }
      if (!parsed) return json({ error: 'Could not parse schedule' }, 400)

      const now = new Date().toISOString()
      const displayName = body.name || existing?.displayName || runtimeJob.name
      const owner = (body.owner ?? undefined) || existing?.owner || await getRuntimeMainAgentId(ctx.runtime)
      const taskPrompt = (body.taskPrompt ?? undefined) || existing?.taskPrompt || runtimeJob.command

      // Assignment merge + exclusion, mirroring ensureBakinJob (round-3):
      // a body-provided side wins and clears the other; validated before
      // any sidecar write.
      // null and '' are both explicit clears; only ABSENT falls back to the
      // existing value (round-4 review — '' must not silently preserve).
      let adoptAgentId = body.agentId === null || body.agentId === '' ? undefined : body.agentId ?? existing?.agentId
      let adoptTeamId = body.teamId === null || body.teamId === '' ? undefined : body.teamId ?? existing?.teamId
      if (typeof body.agentId === 'string' && body.agentId) adoptTeamId = typeof body.teamId === 'string' && body.teamId ? adoptTeamId : undefined
      if (typeof body.teamId === 'string' && body.teamId) adoptAgentId = typeof body.agentId === 'string' && body.agentId ? adoptAgentId : undefined
      try {
        await validateTeamAssignment({ assignee: adoptAgentId, team: typeof body.teamId === 'string' && body.teamId ? body.teamId : undefined })
      } catch (err) {
        if (err instanceof TaskValidationError) return json({ error: err.message }, 400)
        throw err
      }

      const meta: BakinJobMeta = {
        ...(existing ?? {}),
        jobId,
        isBakinJob: true,
        source: 'adopted',
        schedule: { kind: parsed.kind, expr: parsed.expr },
        enabled: runtimeJob.enabled ?? true,
        displayName,
        agentId: adoptAgentId,
        teamId: adoptTeamId,
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
      await cron.remove(jobId)
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

      // cron is optional (P2.1): restoring native behavior needs a runtime
      // with a native cron surface to restore INTO.
      const cron = ctx.runtime.cron
      if (!cron) return json({ error: 'The active runtime has no native cron surface — cannot restore native behavior' }, 400)

      const restored = await cron.restoreRaw(
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
      const result = applyPauseAction(meta, body.action, { pauseUntil: body.pauseUntil, skipN: body.skipN })
      if (!result.ok) return json({ error: result.error }, 400)
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
