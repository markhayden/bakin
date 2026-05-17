/**
 * Schedule plugin — server entry point.
 * Registers API routes, exec tools, and the cron→task bridge.
 */
import { randomBytes, timingSafeEqual } from 'crypto'
import { z } from 'zod'
import type { BakinPlugin, PluginContext } from '@bakin/core/plugin-types'
import { definePlugin, defineRoute, searchRoute } from '@bakin/core/routing'
import type { CronRun } from '@bakin/core/adapters/runtime'
import { readMergedJobs } from './lib/jobs-reader'
import { getLastRun, readRuns } from './lib/runs-reader'
import { upsertJob, removeJob, getJob, isPaused, shouldSkip, recordFailure, recordSuccess, withDefaults, hasProcessedRun, recordProcessedRun } from './lib/sidecar'
import { parseSchedule } from './lib/cron-parser'
import { createTaskWithEffects } from '../../src/core/task-service'
import { getContentDir } from '../../src/core/content-dir'
import { createLogger } from '../../src/core/logger'
import { readTaskboard } from '../../src/core/task-store'
import { checkScheduleSync, scheduleSyncRepair } from './lib/health-checks'
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

interface EnsureBakinJobResult {
  ok: boolean
  jobId?: string
  cron?: string
  human?: string
  error?: string
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

async function ensureBakinJob(ctx: PluginContext, input: Record<string, unknown>): Promise<EnsureBakinJobResult> {
  const jobId = typeof input.jobId === 'string' && input.jobId.trim() ? input.jobId.trim() : undefined
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const schedule = typeof input.schedule === 'string' ? input.schedule.trim() : ''
  const command = typeof input.command === 'string' ? input.command.trim() : ''
  if (!jobId || !name || !schedule || !command) {
    return { ok: false, error: 'jobId, name, schedule, and command are required' }
  }

  const parsed = parseSchedule(schedule)
  if (!parsed) return { ok: false, error: 'Could not parse schedule expression' }

  const metadata = input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
    ? input.metadata as Record<string, unknown>
    : {}
  const tz = typeof input.tz === 'string' && input.tz.trim() ? input.tz.trim() : getSystemTimezone()
  const enabled = typeof input.enabled === 'boolean' ? input.enabled : true
  const now = new Date().toISOString()
  const runtimePatch = {
    name,
    schedule: parsed.cron,
    command,
    enabled,
    metadata: {
      ...metadata,
      tz,
      source: metadata.source ?? 'bakin',
      scheduleType: 'cron',
      bakinSchedule: true,
    },
  }

  const existingRuntime = await ctx.runtime.cron.get(jobId)
  if (existingRuntime) {
    await ctx.runtime.cron.update(jobId, runtimePatch)
  } else {
    await ctx.runtime.cron.create({ id: jobId, ...runtimePatch })
  }

  const existing = getJob(jobId)
  const owner = typeof input.owner === 'string' && input.owner.trim()
    ? input.owner.trim()
    : existing?.owner ?? await getRuntimeMainAgentId(ctx.runtime)
  const description = typeof input.description === 'string' ? input.description : existing?.description
  const meta: BakinJobMeta = {
    ...(existing ?? {}),
    jobId,
    isBakinJob: true,
    source: 'bakin',
    displayName: name,
    description,
    owner,
    requireTriage: typeof input.requireTriage === 'boolean' ? input.requireTriage : existing?.requireTriage ?? false,
    agentId: typeof input.agentId === 'string' ? input.agentId : existing?.agentId,
    workflowId: typeof input.workflowId === 'string' ? input.workflowId : existing?.workflowId,
    taskPrompt: typeof input.taskPrompt === 'string' ? input.taskPrompt : existing?.taskPrompt,
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

// ---------------------------------------------------------------------------
// Bridge logic (cron → task)
// ---------------------------------------------------------------------------

/** Module-level ctx set during activate(), used by handleBridge + routes */
let pluginCtx: PluginContext | null = null
let reconcileTimer: ReturnType<typeof setInterval> | null = null
let reconcileRunning = false

const RECONCILE_INTERVAL_MS = 60_000

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

const bridgeBody = z.object({
  jobId: z.string(),
  runId: z.string().optional(),
}).passthrough()

const bridgeQuery = z.object({
  secret: z.string().optional(),
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

interface BakinCommand {
  pluginId: string
  action: string
}

interface PluginRunHookResult {
  ok?: boolean
  error?: string
  taskId?: string
}

const BAKIN_COMMAND_RE = /^bakin:([^:]+):([^:]+)$/

function parseBakinCommand(command: string | undefined): BakinCommand | null {
  if (!command) return null
  const match = command.match(BAKIN_COMMAND_RE)
  if (!match) return null
  return { pluginId: match[1], action: match[2] }
}

async function getRuntimeJobCommand(jobId: string): Promise<string | undefined> {
  if (!pluginCtx) return undefined
  try {
    return (await pluginCtx.runtime.cron.get(jobId))?.command
  } catch (err) {
    log.warn('Failed to inspect runtime cron command', { jobId, error: err instanceof Error ? err.message : String(err) })
    return undefined
  }
}

async function processPluginScheduledRun(
  payload: BridgePayload,
  command: string,
  parsed: BakinCommand,
): Promise<ProcessRunResult> {
  if (!pluginCtx) {
    return { status: 503, body: { ok: false, error: 'bridge not ready' } }
  }

  const hookName = `${parsed.pluginId}.${parsed.action}.run`
  if (!pluginCtx.hooks.has(hookName)) {
    return { status: 500, body: { ok: false, error: `hook ${hookName} not registered` } }
  }

  try {
    const result = await pluginCtx.hooks.invoke<PluginRunHookResult | undefined>(hookName, {
      ...payload,
      command,
      pluginId: parsed.pluginId,
      action: parsed.action,
    })
    if (result?.ok === false) {
      return { status: 500, body: { ok: false, error: result.error ?? `hook ${hookName} failed` } }
    }
    return { status: 200, body: { ok: true, ...(result?.taskId ? { taskId: result.taskId } : {}) } }
  } catch (err) {
    return { status: 500, body: { ok: false, error: err instanceof Error ? err.message : String(err) } }
  }
}

async function processScheduledRun(payload: BridgePayload): Promise<ProcessRunResult> {
  const { jobId, runId } = payload
  const command = await getRuntimeJobCommand(jobId)
  const parsedCommand = parseBakinCommand(command)
  if (parsedCommand && parsedCommand.pluginId !== 'schedule') {
    return processPluginScheduledRun(payload, command!, parsedCommand)
  }

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
      const runtimePatch: { name?: string; schedule?: string } = {}
      const b = body as Record<string, unknown>
      if (b.schedule && typeof b.schedule === 'string') {
        const parsed = parseSchedule(b.schedule)
        if (!parsed) return json({ error: 'Could not parse schedule' }, 400)
        runtimePatch.schedule = parsed.cron
      }
      if (b.name && typeof b.name === 'string') {
        runtimePatch.name = b.name
        meta.displayName = b.name
      }
      if (Object.keys(runtimePatch).length > 0) await ctx.runtime.cron.update(jobId, runtimePatch)
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
      await ctx.runtime.cron.remove(jobId)
      removeJob(jobId)
      ctx.search.remove(jobId).catch(() => {})
      ctx.activity.audit('job.deleted', 'system', { jobId })
      ctx.activity.log('system', `Deleted schedule "${jobId}"`)
      return json({ ok: true })
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
      const runtimeJob = await ctx.runtime.cron.get(jobId)
      if (!runtimeJob) return json({ error: 'Job not found' }, 404)
      const run = await ctx.runtime.cron.runNow(jobId)
      if (run.status === 'succeeded') {
        await processScheduledRun({ jobId, runId: run.id, timestamp: runTimestamp(run) })
      }
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

  defineRoute({
    path: '/bridge',
    method: 'POST',
    summary: 'Cron bridge webhook',
    description: 'Internal webhook the runtime cron POSTs to when a job fires. Auth via shared secret.',
    visibility: 'internal',
    body: bridgeBody,
    query: bridgeQuery,
    responses: { 200: passthrough, 401: errorResponse, 503: errorResponse, 500: errorResponse },
    handler: async (req) => handleBridge(req),
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

    ctx.hooks.register('schedule.ensureBakinJob', (data: Record<string, unknown>) => ensureBakinJob(ctx, data), {
      hookKind: 'rpc',
      label: 'Ensure Bakin schedule',
      summary: 'Create or update a deterministic Bakin-managed runtime cron job.',
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
      run: async () => checkScheduleSync(getContentDir(), ctx.runtime.cron, await getRuntimeMainAgentId(ctx.runtime)),
      repair: scheduleSyncRepair(getContentDir(), ctx.runtime.cron, () => getRuntimeMainAgentId(ctx.runtime)),
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
}) as unknown as BakinPlugin

export default schedulePlugin
