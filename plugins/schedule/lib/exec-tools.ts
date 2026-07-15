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
import { getJob } from './sidecar'
import { parseSchedule } from './cron-parser'
import { readRuns } from './runs-reader'
import { fireManualRun } from './fire-engine'
import {
  applyPauseAction,
  createScheduleJob,
  deleteScheduleJob,
  guardBakinMutation,
  indexJob,
  projectJobDetail,
  readMergedRuntimeJobs,
  updateScheduleJob,
  type PauseAction,
} from './job-service'

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
      agentId: z.string().optional().describe('Agent to assign tasks to. Mutually exclusive with teamId.'),
      teamId: z.string().optional().describe('Team to assign — each occurrence is routed to the best-suited member at fire time (#189). Mutually exclusive with agentId.'),
      workflowId: z.string().optional().describe('Workflow to attach to tasks'),
      taskPrompt: z.string().optional().describe('Task description template'),
      taskTitle: z.string().optional().describe('Task title template (supports {date}, {agent})'),
    },
    handler: async (params: Record<string, unknown>) => {
      if (!params.name || !params.schedule) {
        return { ok: false, error: 'name and schedule are required' }
      }
      const result = await createScheduleJob(ctx, {
        name: params.name as string,
        schedule: params.schedule as string,
        agentId: params.agentId as string | undefined,
        teamId: params.teamId as string | undefined,
        workflowId: params.workflowId as string | undefined,
        taskPrompt: params.taskPrompt as string | undefined,
        taskTitle: params.taskTitle as string | undefined,
      })
      if (!result.ok) return result
      const { warnings, ...created } = result
      return { ...created, ...(warnings.length ? { warnings } : {}) }
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
      agentId: z.string().optional().describe('New agent assignment. Setting a non-empty agent clears any team; mutually exclusive with teamId.'),
      teamId: z.string().optional().describe('New team assignment (#189). Setting a non-empty team clears any agent; mutually exclusive with agentId.'),
      workflowId: z.string().optional().describe('New workflow binding'),
      taskPrompt: z.string().optional().describe('New task prompt template'),
      taskTitle: z.string().optional().describe('New task title template'),
    },
    handler: async (params: Record<string, unknown>) => {
      if (!params.jobId) return { ok: false, error: 'jobId required' }

      const guard = await guardBakinMutation(params.jobId as string)
      if (!guard.ok) return { ok: false, error: guard.error }

      const result = await updateScheduleJob(guard.meta, params, [
        'displayName', 'agentId', 'teamId', 'workflowId', 'taskPrompt', 'taskTitle',
      ])
      if (!result.ok) return result
      indexJob(params.jobId as string)
      return { ok: true, ...(result.warnings.length ? { warnings: result.warnings } : {}) }
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

      return applyPauseAction(guard.meta, params.action as PauseAction, {
        pauseUntil: params.pauseUntil as string | undefined,
        skipN: params.skipN as number | undefined,
      })
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
      return { ok: true, job: await projectJobDetail(ctx, params.jobId as string, meta) }
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
      return { ok: true, kind: result.kind, expr: result.expr, human: result.human, nextRuns: result.nextRuns }
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
