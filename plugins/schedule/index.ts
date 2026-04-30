/**
 * Schedule plugin — server entry point.
 * Registers API routes, exec tools, and the cron→task bridge.
 */
import { randomBytes, timingSafeEqual } from 'crypto'
import { z } from 'zod'
import type { BakinPlugin, PluginContext } from '@bakin/core/plugin-types'
import type { CronRun } from '@bakin/core/adapters/runtime'
import { readMergedJobs } from './lib/jobs-reader'
import { getLastRun, readRuns } from './lib/runs-reader'
import { upsertJob, removeJob, getJob, isPaused, shouldSkip, recordFailure, recordSuccess, withDefaults, hasProcessedRun, recordProcessedRun } from './lib/sidecar'
import { parseSchedule } from './lib/cron-parser'
import { createTaskWithEffects } from '../../src/core/task-service'
import { getContentDir } from '../../src/core/content-dir'
import { createLogger } from '../../src/core/logger'
import { readTaskboard } from '../../src/core/task-store'
import { checkScheduleSync } from './lib/health-checks'
import { getRuntimeMainAgentId } from '@bakin/core/adapters/runtime'
import type { BakinJobMeta, BridgePayload, BridgeResult, MergedJob } from './types'

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

async function readBody<T>(req: Request): Promise<T> {
  return req.json() as Promise<T>
}

function expandTemplate(template: string, vars: Record<string, string>): string {
  let result = template
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value)
  }
  return result
}

/** Settings shape used by handleBridge + webhook URL construction. */
interface ScheduleSettings {
  bridgeEnabled?: boolean
  bridgeSecret?: string
  reconcileLookbackHours?: number
}

/** Constant-time string comparison. Returns false for any length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf-8')
  const bBuf = Buffer.from(b, 'utf-8')
  if (aBuf.length !== bBuf.length) return false
  return timingSafeEqual(aBuf, bBuf)
}

/**
 * Resolve the bridge secret, generating and persisting one on first use.
 * Returns null if pluginCtx isn't set yet (shouldn't happen after activate()).
 */
function getOrCreateBridgeSecret(): string | null {
  if (!pluginCtx) return null
  const settings = pluginCtx.getSettings<ScheduleSettings>()
  if (settings.bridgeSecret && settings.bridgeSecret.length >= 32) {
    return settings.bridgeSecret
  }
  const fresh = randomBytes(32).toString('hex')
  pluginCtx.updateSettings({ bridgeSecret: fresh })
  return fresh
}

async function getScheduleDefaultOwner(): Promise<string> {
  return pluginCtx?.runtime ? getRuntimeMainAgentId(pluginCtx.runtime) : 'main'
}

// ---------------------------------------------------------------------------
// Bridge logic (cron → task)
// ---------------------------------------------------------------------------

/** Module-level ctx set during activate(), used by handleBridge */
let pluginCtx: PluginContext | null = null
let reconcileTimer: ReturnType<typeof setInterval> | null = null
let reconcileRunning = false

const RECONCILE_INTERVAL_MS = 60_000

async function handleBridge(req: Request): Promise<Response> {
  // Gate 1: feature flag. The bridge setting defaults to enabled, but admins
  // can disable it to stop ALL cron-driven task creation without tearing down
  // the underlying runtime cron jobs.
  const settings = pluginCtx?.getSettings<ScheduleSettings>() ?? {}
  if (settings.bridgeEnabled === false) {
    log.warn('Bridge call rejected — bridgeEnabled setting is false')
    return json({ ok: false, error: 'bridge disabled' }, 503)
  }

  // Gate 2: shared-secret auth. Runtime cron calls the webhook with ?secret=<hex>
  // from the URL used by future direct webhook callers. We require a match so a stale cron from a
  // previous install — or any unauthorized caller — cannot create tasks.
  const expected = getOrCreateBridgeSecret()
  if (!expected) {
    log.error('Bridge call rejected — plugin context not initialized')
    return json({ ok: false, error: 'bridge not ready' }, 503)
  }
  const url = new URL(req.url)
  const provided = url.searchParams.get('secret') || ''
  if (!safeEqual(provided, expected)) {
    log.warn('Bridge call rejected — invalid or missing secret')
    return json({ ok: false, error: 'unauthorized' }, 401)
  }

  const payload = await readBody<BridgePayload>(req)
  const result = await processScheduledRun(payload)
  return json(result.body, result.status)
}

interface ProcessRunResult {
  status: number
  body: BridgeResult
}

async function processScheduledRun(payload: BridgePayload): Promise<ProcessRunResult> {
  const { jobId, runId } = payload
  const meta = getJob(jobId)
  if (!meta || !meta.isBakinJob) {
    return { status: 200, body: { ok: true, skipped: 'not-bakin' } }
  }

  if (runId && hasProcessedRun(meta, runId)) {
    return { status: 200, body: { ok: true, skipped: 'already-processed' } }
  }

  const defaults = withDefaults(meta, await getScheduleDefaultOwner())

  // Check pause state
  const pauseState = isPaused(meta)
  if (pauseState.paused) {
    if (runId) recordProcessedRun(meta, runId, payload.timestamp)
    upsertJob(meta) // persist any auto-resume changes
    return { status: 200, body: { ok: true, skipped: 'paused' } }
  }

  // Check skip-next-N
  if (shouldSkip(meta)) {
    if (runId) recordProcessedRun(meta, runId, payload.timestamp)
    upsertJob(meta)
    return { status: 200, body: { ok: true, skipped: 'skip-count' } }
  }

  // Check failure auto-pause
  if ((defaults.consecutiveFailures ?? 0) >= (defaults.maxFailures ?? 3)) {
    meta.paused = true
    meta.pauseReason = 'auto-failures'
    if (runId) recordProcessedRun(meta, runId, payload.timestamp)
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
          if (runId) {
            recordProcessedRun(meta, runId, payload.timestamp)
            upsertJob(meta)
          }
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
            if (runId) recordProcessedRun(meta, runId, payload.timestamp)
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
    })
    const taskId = result.id

    meta.lastTaskId = taskId
    if (runId) recordProcessedRun(meta, runId, payload.timestamp)
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

function runTimestamp(run: CronRun): string {
  return run.startedAt ?? run.endedAt ?? new Date().toISOString()
}

function runTimeMs(run: CronRun): number {
  const parsed = Date.parse(runTimestamp(run))
  return Number.isFinite(parsed) ? parsed : Date.now()
}

function reconcileLookbackMs(startup: boolean): number {
  if (!startup) return 0
  const settings = pluginCtx?.getSettings<ScheduleSettings>() ?? {}
  const rawHours = typeof settings.reconcileLookbackHours === 'number' ? settings.reconcileLookbackHours : 24
  const hours = Math.max(0, Math.min(rawHours, 168))
  return hours * 60 * 60 * 1000
}

async function reconcileScheduleRuns(startup = false): Promise<void> {
  if (!pluginCtx || reconcileRunning) return
  reconcileRunning = true
  try {
    const cutoffMs = reconcileLookbackMs(startup)
    const cutoff = startup
      ? cutoffMs > 0 ? Date.now() - cutoffMs : Number.POSITIVE_INFINITY
      : 0
    const jobs = await readMergedJobs(pluginCtx.runtime.cron, await getScheduleDefaultOwner())
    for (const job of jobs) {
      if (!job.isBakinJob) continue
      const meta = getJob(job.id)
      if (!meta?.isBakinJob) continue
      const runs = await pluginCtx.runtime.cron.listRuns(job.id).catch((err) => {
        log.warn('Failed to read schedule run history', { jobId: job.id, error: err instanceof Error ? err.message : String(err) })
        return [] as CronRun[]
      })
      const jobCreatedAtMs = Number.isFinite(Date.parse(meta.createdAt)) ? Date.parse(meta.createdAt) : 0
      const candidates = runs
        .filter(run => run.status === 'succeeded')
        .filter(run => runTimeMs(run) >= jobCreatedAtMs)
        .filter(run => startup ? runTimeMs(run) >= cutoff : true)
        .sort((a, b) => runTimeMs(a) - runTimeMs(b))
      for (const run of candidates) {
        const latest = getJob(job.id)
        if (!latest?.isBakinJob || hasProcessedRun(latest, run.id)) continue
        await processScheduledRun({
          jobId: job.id,
          runId: run.id,
          timestamp: runTimestamp(run),
        })
      }
    }
  } finally {
    reconcileRunning = false
  }
}

function startReconciler(): void {
  if (reconcileTimer) clearInterval(reconcileTimer)
  reconcileScheduleRuns(true).catch(err => log.warn('Startup schedule reconcile failed', err))
  reconcileTimer = setInterval(() => {
    reconcileScheduleRuns(false).catch(err => log.warn('Schedule reconcile failed', err))
  }, RECONCILE_INTERVAL_MS)
  reconcileTimer.unref?.()
}

function stopReconciler(): void {
  if (!reconcileTimer) return
  clearInterval(reconcileTimer)
  reconcileTimer = null
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const schedulePlugin: BakinPlugin = {
  id: 'schedule',
  name: 'Schedule',
  version: '2.0.0',

  settingsSchema: {
    fields: [
      { key: 'maxConcurrentJobs', type: 'number', label: 'Max concurrent jobs', description: 'Maximum jobs that can run at the same time', default: 3 },
      { key: 'failureCooldownMs', type: 'number', label: 'Failure cooldown (ms)', description: 'Wait time after failure before retrying', default: 300000 },
      { key: 'maxFailures', type: 'number', label: 'Max consecutive failures', description: 'Pause job after this many consecutive failures', default: 3 },
      { key: 'bridgeEnabled', type: 'boolean', label: 'Bridge enabled', description: 'Allow cron jobs to create tasks via the bridge', default: true },
      { key: 'reconcileLookbackHours', type: 'number', label: 'Startup reconciliation window', description: 'Create missed scheduled tasks only for successful runtime cron runs newer than this many hours. Set to 0 to disable startup backfill.', default: 24 },
    ],
  },
  // bridgeSecret is stored alongside settings but not exposed in the UI —
  // it's auto-generated on first use (see getOrCreateBridgeSecret).

  navItems: [],
  contentFiles: [],

  async activate(ctx: PluginContext) {
    pluginCtx = ctx

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

    async function readMergedRuntimeJobs(): Promise<MergedJob[]> {
      return readMergedJobs(ctx.runtime.cron, await getRuntimeMainAgentId(ctx.runtime))
    }

    /** Convert a merged job to a search document */
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

    /** Index a job in the search index using the merged runtime view */
    function indexJob(jobId: string): void {
      readMergedRuntimeJobs().then((jobs) => {
        const job = jobs.find(j => j.id === jobId)
        if (!job) return
        return ctx.search.index(jobId, jobToSearchDoc(job))
      }).catch((err) => {
        log.warn('Failed to index job', { jobId, error: err instanceof Error ? err.message : String(err) })
      })
    }

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

    // ── API Routes ─────────────────────────────────────────────────────

    // GET / — list all jobs (merged)
    const listJobsHandler = async () => {
      const jobs = (await readMergedRuntimeJobs()).map(j => ({
        ...j,
        cron: j.schedule.type === 'cron' ? j.schedule.value : undefined,
      }))
      return json({ jobs })
    }
    ctx.registerRoute({ path: '/', method: 'GET', description: 'List all scheduled jobs', handler: listJobsHandler })

    // POST / — create a job
    const createJobHandler = async (req: Request): Promise<Response> => {
      const body = await readBody<{
        name: string
        schedule: string
        agentId?: string
        workflowId?: string
        taskPrompt?: string
        taskTitle?: string
        owner?: string
        requireTriage?: boolean
        allowOverlap?: boolean
        maxFailures?: number
        tz?: string
      }>(req)

      if (!body.name || !body.schedule) {
        return json({ error: 'name and schedule are required' }, 400)
      }

      const parsed = parseSchedule(body.schedule)
      if (!parsed) {
        return json({ error: 'Could not parse schedule expression' }, 400)
      }

      const tz = body.tz || getSystemTimezone()
      const created = await ctx.runtime.cron.create({
        name: body.name,
        schedule: parsed.cron,
        command: `bakin:schedule:${body.name}`,
        metadata: { tz, bakinSchedule: true, scheduleType: 'cron' },
      })
      const jobId = created.id

      const owner = body.owner ?? await getRuntimeMainAgentId(ctx.runtime)
      const meta: BakinJobMeta = {
        jobId,
        isBakinJob: true,
        source: 'bakin',
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
    }
    ctx.registerRoute({ path: '/', method: 'POST', description: 'Create a scheduled job', handler: createJobHandler })

    // PUT /:jobId — update a job
    ctx.registerRoute({
      path: '/:jobId',
      method: 'PUT',
      handler: async (req: Request) => {
        const url = new URL(req.url)
        const body = await readBody<{ jobId?: string; [key: string]: unknown }>(req)
        const jobId = url.searchParams.get('jobId') || body.jobId
        if (!jobId) return json({ error: 'jobId required' }, 400)

        const meta = getJob(jobId)
        if (!meta) return json({ error: 'Job not found in sidecar' }, 404)

        const runtimePatch: { name?: string; schedule?: string } = {}
        if (body.schedule && typeof body.schedule === 'string') {
          const parsed = parseSchedule(body.schedule)
          if (!parsed) return json({ error: 'Could not parse schedule' }, 400)
          runtimePatch.schedule = parsed.cron
        }
        if (body.name && typeof body.name === 'string') {
          runtimePatch.name = body.name
          meta.displayName = body.name
        }
        if (Object.keys(runtimePatch).length > 0) await ctx.runtime.cron.update(jobId, runtimePatch)

        // Update sidecar fields
        const sidecarFields = [
          'displayName', 'description', 'agentId', 'owner', 'requireTriage',
          'workflowId', 'taskPrompt', 'taskTitle', 'allowOverlap', 'maxFailures',
        ]
        for (const field of sidecarFields) {
          if (body[field] !== undefined) {
            ;(meta as unknown as Record<string, unknown>)[field] = body[field]
          }
        }
        upsertJob(meta)
        indexJob(jobId)

        ctx.activity.audit('job.updated', 'system', { jobId })
        ctx.activity.log('system', `Updated schedule "${meta.displayName || jobId}"`)
        return json({ ok: true })
      },
    })
    // GET /:jobId — get single job details

    // POST /:jobId/adopt — convert a native runtime cron into a Bakin schedule
    ctx.registerRoute({
      path: '/:jobId/adopt',
      method: 'POST',
      description: 'Adopt a runtime cron job into Bakin task scheduling',
      handler: async (req: Request) => {
        const url = new URL(req.url)
        const body = await readBody<{
          jobId?: string
          name?: string
          schedule?: string
          agentId?: string | null
          workflowId?: string | null
          taskPrompt?: string | null
          taskTitle?: string | null
          owner?: string | null
          requireTriage?: boolean
          allowOverlap?: boolean
          maxFailures?: number
          tz?: string
        }>(req).catch(() => ({} as {
          jobId?: string
          name?: string
          schedule?: string
          agentId?: string | null
          workflowId?: string | null
          taskPrompt?: string | null
          taskTitle?: string | null
          owner?: string | null
          requireTriage?: boolean
          allowOverlap?: boolean
          maxFailures?: number
          tz?: string
        }))
        const jobId = url.searchParams.get('jobId') || body.jobId
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
        const owner = body.owner || existing?.owner || await getRuntimeMainAgentId(ctx.runtime)
        const taskPrompt = body.taskPrompt || existing?.taskPrompt || runtimeJob.command

        await ctx.runtime.cron.update(jobId, {
          name: displayName,
          schedule: parsed.cron,
          command: `bakin:schedule:${jobId}`,
          metadata: {
            ...(runtimeJob.metadata ?? {}),
            tz,
            scheduleType: 'cron',
            bakinSchedule: true,
            adoptedByBakin: true,
          },
        })

        const meta: BakinJobMeta = {
          ...(existing ?? {}),
          jobId,
          isBakinJob: true,
          source: 'adopted',
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
        indexJob(jobId)

        ctx.activity.audit('job.adopted', 'system', { jobId })
        ctx.activity.log('system', `Adopted runtime cron "${displayName}" into Bakin`)
        return json({ ok: true, jobId })
      },
    })

    // POST /:jobId/restore-native — restore the native runtime cron captured during adoption
    ctx.registerRoute({
      path: '/:jobId/restore-native',
      method: 'POST',
      description: 'Restore an adopted Bakin schedule back to its native runtime cron behavior',
      handler: async (req: Request) => {
        const url = new URL(req.url)
        const body = await readBody<{ jobId?: string }>(req).catch(() => ({} as { jobId?: string }))
        const jobId = url.searchParams.get('jobId') || body.jobId
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
    })

    ctx.registerRoute({
      path: '/:jobId',
      method: 'GET',
      description: 'Get details for a single scheduled job',
      handler: async (req: Request) => {
        const url = new URL(req.url)
        const jobId = url.searchParams.get('jobId')
        if (!jobId) return json({ error: 'jobId required' }, 400)

        const meta = getJob(jobId)
        if (!meta) return json({ error: 'Job not found' }, 404)

        const defaults = withDefaults(meta, await getRuntimeMainAgentId(ctx.runtime))
        const lastRun = await getLastRun(ctx.runtime.cron, jobId)
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
    })

    // DELETE /:jobId — delete a job
    const deleteJobHandler = async (req: Request) => {
      const url = new URL(req.url)
      const body = await readBody<{ jobId?: string }>(req).catch(() => ({}))
      const jobId = url.searchParams.get('jobId') || (body as Record<string, unknown>).jobId as string | undefined
      if (!jobId) return json({ error: 'jobId required' }, 400)

      await ctx.runtime.cron.remove(jobId)
      removeJob(jobId)
      ctx.search.remove(jobId).catch(() => {})

      ctx.activity.audit('job.deleted', 'system', { jobId })
      ctx.activity.log('system', `Deleted schedule "${jobId}"`)
      return json({ ok: true })
    }
    ctx.registerRoute({ path: '/:jobId', method: 'DELETE', description: 'Delete a scheduled job', handler: deleteJobHandler })

    // POST /:jobId/pause — pause/resume/skip
    const pauseHandler = async (req: Request) => {
      const url = new URL(req.url)
      const body = await readBody<{
        jobId?: string
        action: 'pause' | 'resume' | 'skip'
        pauseUntil?: string
        skipN?: number
      }>(req)

      const jobId = url.searchParams.get('jobId') || body.jobId
      if (!jobId || !body.action) return json({ error: 'jobId and action required' }, 400)

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
          await ctx.runtime.cron.update(jobId, { enabled: false })
          break
        case 'resume':
          meta.paused = false
          meta.pauseReason = undefined
          meta.pauseUntil = undefined
          meta.skipNextN = undefined
          meta.skippedCount = undefined
          meta.consecutiveFailures = 0
          await ctx.runtime.cron.update(jobId, { enabled: true })
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
    }
    ctx.registerRoute({ path: '/:jobId/pause', method: 'POST', description: 'Pause/resume/skip a job', handler: pauseHandler })

    // POST /:jobId/run — trigger immediate run
    const runNowHandler = async (req: Request) => {
      const url = new URL(req.url)
      const body = await readBody<{ jobId?: string }>(req).catch(() => ({}))
      const jobId = url.searchParams.get('jobId') || (body as Record<string, unknown>).jobId as string | undefined
      if (!jobId) return json({ error: 'jobId required' }, 400)
      const runtimeJob = await ctx.runtime.cron.get(jobId)
      if (!runtimeJob) return json({ error: 'Job not found' }, 404)
      const run = await ctx.runtime.cron.runNow(jobId)
      if (run.status === 'succeeded') {
        await processScheduledRun({ jobId, runId: run.id, timestamp: runTimestamp(run) })
      }
      ctx.activity.audit('job.run_now', 'system', { jobId })
      ctx.activity.log('system', `Triggered immediate run for "${jobId}"`)
      return json({ ok: true })
    }
    ctx.registerRoute({ path: '/:jobId/run', method: 'POST', description: 'Trigger immediate run', handler: runNowHandler })

    // GET /:jobId/runs — run history
    const runsHandler = async (req: Request) => {
      const url = new URL(req.url)
      const jobId = url.searchParams.get('jobId')
      if (!jobId) return json({ error: 'jobId query param required' }, 400)
      const limit = parseInt(url.searchParams.get('limit') ?? '50', 10)
      const runs = await readRuns(ctx.runtime.cron, jobId, limit)
      return json({ runs })
    }
    ctx.registerRoute({ path: '/:jobId/runs', method: 'GET', description: 'Get run history for a job', handler: runsHandler })

    // POST /parse — parse schedule expression (NL → cron)
    const parseHandler = async (req: Request) => {
      const { input } = await readBody<{ input: string }>(req)
      if (!input) return json({ error: 'input required' }, 400)
      const result = parseSchedule(input)
      if (!result) {
        return json({ error: 'Could not parse schedule. Try a simpler expression or raw cron.' }, 400)
      }
      return json(result)
    }
    ctx.registerRoute({ path: '/parse', method: 'POST', description: 'Parse schedule expression', handler: parseHandler })

    // POST /bridge - runtime cron webhook -> task creation
    ctx.registerRoute({ path: '/bridge', method: 'POST', description: 'Cron bridge webhook', handler: handleBridge })

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
        const created = await ctx.runtime.cron.create({
          name: params.name as string,
          schedule: parsed.cron,
          command: `bakin:schedule:${params.name as string}`,
          metadata: { tz, bakinSchedule: true, scheduleType: 'cron' },
        })
        const jobId = created.id

        const meta: BakinJobMeta = {
          jobId,
          isBakinJob: true,
          source: 'bakin',
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
          await ctx.runtime.cron.update(params.jobId as string, { schedule: parsed.cron })
        }
        if (params.name) await ctx.runtime.cron.update(params.jobId as string, { name: params.name as string })

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
            await ctx.runtime.cron.update(params.jobId as string, { enabled: false })
            break
          case 'resume':
            meta.paused = false
            meta.pauseReason = undefined
            meta.pauseUntil = undefined
            meta.skipNextN = undefined
            meta.skippedCount = undefined
            meta.consecutiveFailures = 0
            await ctx.runtime.cron.update(params.jobId as string, { enabled: true })
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
        await ctx.runtime.cron.remove(params.jobId as string)
        removeJob(params.jobId as string)
        ctx.search.remove(params.jobId as string).catch(() => {})
        return { ok: true }
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
        if (!params.jobId) return { ok: false, error: 'jobId required' }
        const runtimeJob = await ctx.runtime.cron.get(params.jobId as string)
        if (!runtimeJob) return { ok: false, error: 'Job not found' }
        const run = await ctx.runtime.cron.runNow(params.jobId as string)
        if (run.status === 'succeeded') {
          await processScheduledRun({ jobId: params.jobId as string, runId: run.id, timestamp: runTimestamp(run) })
        }
        ctx.activity.audit('job.run_now', 'system', { jobId: params.jobId })
        return { ok: true, jobId: params.jobId }
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
    ctx.registerHealthCheck({
      id: 'schedule-sync',
      name: 'Runtime cron jobs and Bakin sidecar sync',
      autoFix: true,
      run: async () => checkScheduleSync(getContentDir(), ctx.runtime.cron, await getRuntimeMainAgentId(ctx.runtime)),
    })

    log.info('Schedule plugin activated')
    startReconciler()
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
    stopReconciler()
    log.info('Schedule plugin shutting down')
  },
}

export default schedulePlugin
