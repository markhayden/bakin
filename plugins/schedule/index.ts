/**
 * Schedule plugin — server entry point.
 * Registers API routes, exec tools, and the cron→task bridge.
 */
import { z } from 'zod'
import type { BakinPlugin, PluginContext } from '../../src/lib/plugin-types'
import { readMergedJobs } from './lib/jobs-reader'
import { readSidecar, writeSidecar, upsertJob, removeJob, getJob, isPaused, shouldSkip, recordFailure, recordSuccess, withDefaults } from './lib/sidecar'
import { readRuns, getLastRun } from './lib/runs-reader'
import { parseSchedule, cronToHuman } from './lib/cron-parser'
import { cronAdd, cronEdit, cronRemove, cronRun } from './lib/openclaw-cron'
import { createTaskWithEffects } from '../../src/core/task-service'
import { appendAudit } from '../../src/core/audit'
import { getContentDir } from '../../src/core/content-dir'
import { createLogger } from '../../src/core/logger'
import type { BakinJobMeta, BridgePayload, BridgeResult } from './types'

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

// ---------------------------------------------------------------------------
// Bridge logic (cron → task)
// ---------------------------------------------------------------------------

async function handleBridge(req: Request): Promise<Response> {
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
      const { readTaskboard } = await import('../../plugins/tasks/taskboard')
      const board = readTaskboard()
      const activeColumns = ['todo', 'inProgress', 'review', 'blocked'] as const
      for (const col of activeColumns) {
        const tasks = board.columns[col as keyof typeof board.columns] ?? []
        if (tasks.some(t => t.id === meta.lastTaskId)) {
          return json({ ok: true, skipped: 'overlap' } satisfies BridgeResult)
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
      const { readTaskboard } = await import('../../plugins/tasks/taskboard')
      const board = readTaskboard()
      const doneOrConfirmed = [...(board.columns.done ?? []), ...(board.columns.confirmed ?? [])]
      if (doneOrConfirmed.some(t => t.id === meta.lastTaskId)) {
        recordSuccess(meta)
      } else {
        const blocked = board.columns.blocked ?? []
        if (blocked.some(t => t.id === meta.lastTaskId)) {
          const autoPaused = recordFailure(meta)
          if (autoPaused) {
            upsertJob(meta)
            return json({ ok: true, skipped: 'auto-paused' } satisfies BridgeResult)
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

    // Audit
    appendAudit(getContentDir(), 'schedule.task_created', 'system', {
      jobId,
      runId,
      taskId,
      agent: meta.agentId,
      owner: defaults.owner,
    })

    // Broadcast for Roscoe / owner visibility
    const broadcast = (globalThis as Record<string, unknown>).__bakinBroadcast as
      | ((data: Record<string, unknown>) => void)
      | undefined
    if (broadcast) {
      broadcast({
        type: 'activity',
        agent: 'system',
        message: `Schedule "${meta.displayName ?? jobId}" created task ${taskId}${meta.agentId ? ` for ${meta.agentId}` : ''}`,
        taskId,
        ts: now.toISOString(),
        channel: 'system',
      })
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
  version: '1.0.0',
  navItems: [],
  contentFiles: [],

  activate(ctx: PluginContext) {
    // ── API Routes ─────────────────────────────────────────────────────

    // List all jobs (merged)
    ctx.registerRoute({
      path: '/jobs',
      method: 'GET',
      handler: () => {
        const jobs = readMergedJobs().map(j => ({
          ...j,
          // Flatten cron expression for client consumption
          cron: j.schedule.type === 'cron' ? j.schedule.value : undefined,
        }))
        return json({ jobs })
      },
    })

    // Create a job
    ctx.registerRoute({
      path: '/jobs',
      method: 'POST',
      handler: async (req) => {
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

        // Parse schedule (NL or raw cron)
        const parsed = parseSchedule(body.schedule)
        if (!parsed) {
          return json({ error: 'Could not parse schedule expression' }, 400)
        }

        // Resolve timezone — explicit, or system default
        const tz = body.tz || getSystemTimezone()

        // Create in OpenClaw
        const port = process.env.PORT || '3737'
        const jobId = await cronAdd({
          name: body.name,
          cron: parsed.cron,
          session: 'isolated',
          webhookUrl: `http://localhost:${port}/api/plugins/schedule/bridge`,
          tz,
        })

        // Write sidecar
        const meta: BakinJobMeta = {
          jobId,
          isBakinJob: true,
          displayName: body.name,
          agentId: body.agentId,
          owner: body.owner ?? 'roscoe',
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

        return json({ ok: true, jobId, cron: parsed.cron, human: parsed.human, tz })
      },
    })

    // Update a job
    ctx.registerRoute({
      path: '/jobs/update',
      method: 'PUT',
      handler: async (req) => {
        const body = await readBody<{ jobId: string; [key: string]: unknown }>(req)
        if (!body.jobId) return json({ error: 'jobId required' }, 400)

        const meta = getJob(body.jobId)
        if (!meta) return json({ error: 'Job not found in sidecar' }, 404)

        // Update OpenClaw fields if schedule changed
        if (body.schedule && typeof body.schedule === 'string') {
          const parsed = parseSchedule(body.schedule)
          if (!parsed) return json({ error: 'Could not parse schedule' }, 400)
          await cronEdit(body.jobId, { cron: parsed.cron })
        }
        if (body.name && typeof body.name === 'string') {
          await cronEdit(body.jobId, { name: body.name })
        }

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

        return json({ ok: true })
      },
    })

    // Delete a job
    ctx.registerRoute({
      path: '/jobs/delete',
      method: 'POST',
      handler: async (req) => {
        const { jobId } = await readBody<{ jobId: string }>(req)
        if (!jobId) return json({ error: 'jobId required' }, 400)

        await cronRemove(jobId)
        removeJob(jobId)

        return json({ ok: true })
      },
    })

    // Pause/resume/skip
    ctx.registerRoute({
      path: '/jobs/pause',
      method: 'POST',
      handler: async (req) => {
        const body = await readBody<{
          jobId: string
          action: 'pause' | 'resume' | 'skip'
          pauseUntil?: string
          skipN?: number
        }>(req)

        if (!body.jobId || !body.action) return json({ error: 'jobId and action required' }, 400)

        const meta = getJob(body.jobId)
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

        return json({ ok: true })
      },
    })

    // Run now
    ctx.registerRoute({
      path: '/jobs/run-now',
      method: 'POST',
      handler: async (req) => {
        const { jobId } = await readBody<{ jobId: string }>(req)
        if (!jobId) return json({ error: 'jobId required' }, 400)
        await cronRun(jobId, true)
        return json({ ok: true })
      },
    })

    // Run history
    ctx.registerRoute({
      path: '/runs',
      method: 'GET',
      handler: (req) => {
        const url = new URL(req.url)
        const jobId = url.searchParams.get('jobId')
        if (!jobId) return json({ error: 'jobId query param required' }, 400)
        const limit = parseInt(url.searchParams.get('limit') ?? '50', 10)
        const runs = readRuns(jobId, limit)
        return json({ runs })
      },
    })

    // Parse schedule (NL → cron)
    ctx.registerRoute({
      path: '/parse-schedule',
      method: 'POST',
      handler: async (req) => {
        const { input } = await readBody<{ input: string }>(req)
        if (!input) return json({ error: 'input required' }, 400)

        const result = parseSchedule(input)
        if (!result) {
          return json({ error: 'Could not parse schedule. Try a simpler expression or raw cron.' }, 400)
        }
        return json(result)
      },
    })

    // Bridge (OpenClaw webhook → task creation)
    ctx.registerRoute({
      path: '/bridge',
      method: 'POST',
      handler: handleBridge,
    })

    // ── Exec Tools (agent-facing) ──────────────────────────────────────

    ctx.registerExecTool({
      name: 'bakin_exec_schedule_list',
      description: 'List all scheduled jobs (merged OpenClaw + Bakin view)',
      parameters: {
        filter: z.enum(['bakin', 'all']).optional().describe('Filter by job type'),
        agentId: z.string().optional().describe('Filter by assigned agent'),
      },
      handler: async (params) => {
        let jobs = readMergedJobs()
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
      description: 'Create a new scheduled job that creates tasks on the board',
      parameters: {
        name: z.string().describe('Job name (required)'),
        schedule: z.string().describe('Schedule expression: NL ("every day at 9am") or raw cron ("0 9 * * *") (required)'),
        agentId: z.string().optional().describe('Agent to assign tasks to'),
        workflowId: z.string().optional().describe('Workflow to attach to tasks'),
        taskPrompt: z.string().optional().describe('Task description template'),
        taskTitle: z.string().optional().describe('Task title template (supports {date}, {agent})'),
      },
      handler: async (params) => {
        if (!params.name || !params.schedule) {
          return { ok: false, error: 'name and schedule are required' }
        }

        const parsed = parseSchedule(params.schedule as string)
        if (!parsed) return { ok: false, error: 'Could not parse schedule expression' }

        const tz = getSystemTimezone()
        const port = process.env.PORT || '3737'
        const jobId = await cronAdd({
          name: params.name as string,
          cron: parsed.cron,
          session: 'isolated',
          webhookUrl: `http://localhost:${port}/api/plugins/schedule/bridge`,
          tz,
        })

        const meta: BakinJobMeta = {
          jobId,
          isBakinJob: true,
          displayName: params.name as string,
          agentId: params.agentId as string | undefined,
          owner: 'roscoe',
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

        return { ok: true, jobId, cron: parsed.cron, human: parsed.human, tz }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_schedule_update',
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
      handler: async (params) => {
        if (!params.jobId) return { ok: false, error: 'jobId required' }

        const meta = getJob(params.jobId as string)
        if (!meta) return { ok: false, error: 'Job not found' }

        if (params.schedule) {
          const parsed = parseSchedule(params.schedule as string)
          if (!parsed) return { ok: false, error: 'Could not parse schedule' }
          await cronEdit(params.jobId as string, { cron: parsed.cron })
        }
        if (params.name) await cronEdit(params.jobId as string, { name: params.name as string })

        const fields = ['displayName', 'agentId', 'workflowId', 'taskPrompt', 'taskTitle']
        for (const f of fields) {
          if (params[f] !== undefined) (meta as unknown as Record<string, unknown>)[f === 'name' ? 'displayName' : f] = params[f]
        }
        if (params.name) meta.displayName = params.name as string
        upsertJob(meta)

        return { ok: true }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_schedule_pause',
      description: 'Pause, resume, or skip runs for a scheduled job',
      parameters: {
        jobId: z.string().describe('Job ID (required)'),
        action: z.enum(['pause', 'resume', 'skip']).describe('Action to take (required)'),
        pauseUntil: z.string().optional().describe('ISO date to auto-resume (for pause action)'),
        skipN: z.number().optional().describe('Number of runs to skip (for skip action)'),
      },
      handler: async (params) => {
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
      description: 'Delete a scheduled job',
      parameters: {
        jobId: z.string().describe('Job ID (required)'),
      },
      handler: async (params) => {
        if (!params.jobId) return { ok: false, error: 'jobId required' }
        await cronRemove(params.jobId as string)
        removeJob(params.jobId as string)
        return { ok: true }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_schedule_briefing',
      description: "Today's schedule summary — which jobs fire, assigned agents, alerts. Designed for orchestrator daily briefing.",
      parameters: {
        date: z.string().optional().describe('ISO date to check (defaults to today)'),
      },
      handler: async (params) => {
        const jobs = readMergedJobs()
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

    log.info('Schedule plugin activated')
  },
}

export default schedulePlugin
