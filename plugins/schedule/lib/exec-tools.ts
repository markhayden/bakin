/**
 * Schedule exec tools — the agent-facing MCP surface.
 *
 * registerScheduleExecTools(ctx) wraps the ten ctx.registerExecTool calls
 * (list / create / update / pause / delete / get / run_now / runs / parse /
 * briefing). Extracted verbatim from the activate() body; handlers delegate to
 * job-service verbs, the fire engine, and the cron parser.
 */
import { z } from 'zod'
import type { PluginContext } from '@bakin/core/plugin-types'
import type { BakinJobMeta } from '../types'
import { getJob, upsertJob, newScheduleId, withDefaults } from './sidecar'
import { parseSchedule } from './cron-parser'
import { getSystemTimezone } from './schedule-util'
import { checkSchedulePrompt } from './prompt-guard'
import { getLastRun, readRuns } from './runs-reader'
import { getRuntimeMainAgentId } from '@bakin/core/adapters/runtime'
import { fireManualRun } from './fire-engine'
import { guardBakinMutation, deleteScheduleJob, indexJob, readMergedRuntimeJobs } from './job-service'

export function registerScheduleExecTools(ctx: PluginContext): void {
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

      const warnings = checkSchedulePrompt(params.taskPrompt as string | undefined)
      return { ok: true, jobId, cron: parsed.cron, human: parsed.human, tz, ...(warnings.length ? { warnings } : {}) }
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

      const guard = await guardBakinMutation(params.jobId as string)
      if (!guard.ok) return { ok: false, error: guard.error }
      const meta = guard.meta

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

      const warnings = checkSchedulePrompt(meta.taskPrompt)
      return { ok: true, ...(warnings.length ? { warnings } : {}) }
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

      const guard = await guardBakinMutation(params.jobId as string)
      if (!guard.ok) return { ok: false, error: guard.error }
      const meta = guard.meta

      switch (params.action) {
        case 'pause':
          meta.paused = true
          meta.pauseReason = 'manual'
          // Unconditional, matching the REST pause route: a fresh pause without a
          // date clears any stale auto-resume from a prior pause (was a conditional
          // assignment here that left the old pauseUntil in place).
          meta.pauseUntil = params.pauseUntil as string | undefined
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
      const guard = await guardBakinMutation(params.jobId as string)
      if (!guard.ok) return { ok: false, error: guard.error }
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
}
