/**
 * Schedule plugin — server entry point.
 * Registers API routes, exec tools, and the cron→task bridge.
 */
import { randomBytes, timingSafeEqual } from 'crypto'
import { z } from 'zod'
import type { BakinPlugin, PluginContext } from '../../src/lib/plugin-types'
import { readMergedJobs } from './lib/jobs-reader'
import { getLastRun, readRuns } from './lib/runs-reader'
import { upsertJob, removeJob, getJob, isPaused, shouldSkip, recordFailure, recordSuccess, withDefaults } from './lib/sidecar'
import { parseSchedule } from './lib/cron-parser'
import { createTaskWithEffects } from '../../src/core/task-service'
import { getContentDir } from '../../src/core/content-dir'
import { createLogger } from '../../src/core/logger'
import { getMainAgentId } from '../../src/core/main-agent'
import { getHookRegistry } from '../../src/lib/plugin-registry'
import { checkScheduleSync } from './lib/health-checks'
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

/** Build the webhook URL the runtime cron will POST to, with secret attached. */
function buildBridgeWebhookUrl(): string {
  const port = process.env.PORT || '3737'
  const base = `${process.env.BAKIN_URL || `http://localhost:${port}`}/api/plugins/schedule/bridge`
  const secret = getOrCreateBridgeSecret()
  return secret ? `${base}?secret=${secret}` : base
}

// ---------------------------------------------------------------------------
// Bridge logic (cron → task)
// ---------------------------------------------------------------------------

/** Module-level ctx set during activate(), used by handleBridge */
let pluginCtx: PluginContext | null = null

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
  // from the URL we registered when the cron was created (see
  // buildBridgeWebhookUrl). We require a match so a stale cron from a
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
  const { jobId, runId } = payload

  const meta = getJob(jobId)
  if (!meta || !meta.isBakinJob) {
    return json({ ok: true, skipped: 'not-bakin' } satisfies BridgeResult)
  }

  const defaults = withDefaults(meta)

  // Check pause state
  const pauseState = isPaused(meta)
  if (pauseState.paused) {
    upsertJob(meta) // persist any auto-resume changes
    return json({ ok: true, skipped: 'paused' } satisfies BridgeResult)
  }

  // Check skip-next-N
  if (shouldSkip(meta)) {
    upsertJob(meta)
    return json({ ok: true, skipped: 'skip-count' } satisfies BridgeResult)
  }

  // Check failure auto-pause
  if ((defaults.consecutiveFailures ?? 0) >= (defaults.maxFailures ?? 3)) {
    meta.paused = true
    meta.pauseReason = 'auto-failures'
    upsertJob(meta)
    return json({ ok: true, skipped: 'auto-paused' } satisfies BridgeResult)
  }

  // Check overlap
  if (!defaults.allowOverlap && meta.lastTaskId) {
    try {
      const board = await getHookRegistry().invoke<{ columns: Record<string, Array<{ id: string }>> }>('tasks.readTaskboard', {})
      if (board) {
        const activeColumns = ['todo', 'inProgress', 'review', 'blocked'] as const
        for (const col of activeColumns) {
          const tasks = board.columns[col] ?? []
          if (tasks.some(t => t.id === meta.lastTaskId)) {
            return json({ ok: true, skipped: 'overlap' } satisfies BridgeResult)
          }
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
      const board2 = await getHookRegistry().invoke<{ columns: Record<string, Array<{ id: string }>> }>('tasks.readTaskboard', {})
      if (board2) {
        const doneOrArchived = [...(board2.columns.done ?? []), ...(board2.columns.archived ?? [])]
        if (doneOrArchived.some(t => t.id === meta.lastTaskId)) {
          recordSuccess(meta)
        } else {
          const blocked = board2.columns.blocked ?? []
          if (blocked.some(t => t.id === meta.lastTaskId)) {
            const autoPaused = recordFailure(meta)
            if (autoPaused) {
              upsertJob(meta)
              return json({ ok: true, skipped: 'auto-paused' } satisfies BridgeResult)
            }
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
    upsertJob(meta)

    // Audit + activity feed
    if (pluginCtx) {
      pluginCtx.activity.audit('task_created', 'system', { jobId, runId, taskId, agent: meta.agentId, owner: defaults.owner })
      pluginCtx.activity.log('system', `Schedule "${meta.displayName ?? jobId}" created task ${taskId}${meta.agentId ? ` for ${meta.agentId}` : ''}`, { taskId })
    }

    return json({ ok: true, taskId } satisfies BridgeResult)
  } catch (err) {
    log.error('Bridge failed to create task', err)
    recordFailure(meta)
    upsertJob(meta)
    return json({ ok: false, error: (err as Error).message }, 500)
  }
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
      return readMergedJobs(ctx.runtime.cron)
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
        metadata: { tz, webhookUrl: buildBridgeWebhookUrl() },
      })
      const jobId = created.id

      const meta: BakinJobMeta = {
        jobId,
        isBakinJob: true,
        displayName: body.name,
        agentId: body.agentId,
        owner: body.owner ?? getMainAgentId(),
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

        const defaults = withDefaults(meta)
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
        if (!meta) return json({ error: 'Job not found' }, 404)

        switch (body.action) {
          case 'pause':
            meta.paused = true
            meta.pauseReason = 'manual'
            meta.pauseUntil = body.pauseUntil
            break
          case 'resume':
            meta.paused = false
            meta.pauseReason = undefined
            meta.pauseUntil = undefined
            meta.skipNextN = undefined
            meta.skippedCount = undefined
            meta.consecutiveFailures = 0
            break
          case 'skip':
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
      await ctx.runtime.cron.runNow(jobId)
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
          metadata: { tz, webhookUrl: buildBridgeWebhookUrl() },
        })
        const jobId = created.id

        const meta: BakinJobMeta = {
          jobId,
          isBakinJob: true,
          displayName: params.name as string,
          agentId: params.agentId as string | undefined,
          owner: getMainAgentId(),
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
        if (!meta) return { ok: false, error: 'Job not found' }

        switch (params.action) {
          case 'pause':
            meta.paused = true
            meta.pauseReason = 'manual'
            if (params.pauseUntil) meta.pauseUntil = params.pauseUntil as string
            break
          case 'resume':
            meta.paused = false
            meta.pauseReason = undefined
            meta.pauseUntil = undefined
            meta.skipNextN = undefined
            meta.skippedCount = undefined
            meta.consecutiveFailures = 0
            break
          case 'skip':
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
        const defaults = withDefaults(meta)
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
        const meta = getJob(params.jobId as string)
        if (!meta) return { ok: false, error: 'Job not found' }
        await ctx.runtime.cron.runNow(params.jobId as string)
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
      run: () => checkScheduleSync(getContentDir(), ctx.runtime.cron),
    })

    log.info('Schedule plugin activated')
  },

  async onReady() {
    const runtime = pluginCtx?.runtime
    if (!runtime) return
    const jobs = await readMergedJobs(runtime.cron)
    const bakin = jobs.filter(j => j.isBakinJob)
    const paused = bakin.filter(j => j.paused)
    log.info(`Ready — ${bakin.length} bakin jobs (${paused.length} paused), ${jobs.length} total`)
  },

  onShutdown() {
    log.info('Schedule plugin shutting down')
  },
}

export default schedulePlugin
