/**
 * Tasks plugin MCP exec tools.
 *
 * Extracted from index.ts. `registerTaskExecTools` registers all 11 task exec
 * tools (list/get/create/move/block/complete/log_progress/set_dependency/
 * update/delete/assign) against the plugin context. The tools share the same
 * helpers as the REST routes — the edit-safety guard, search indexing, and the
 * checklist-nudge advisory — so they're imported from the same lib modules.
 *
 * Guard coverage mirrors the REST routes exactly: update/assign/set_dependency
 * pass through `taskEditGuard` (freeze-on-complete + optimistic versioning).
 * move/complete are exempt (they ARE the reopen/complete paths), block's
 * completion freeze lives inside `blockTaskWithEffects` (agents retrying a
 * block on a meanwhile-completed task must see success), and delete is
 * unguarded on both channels (deleting a completed task is legitimate cleanup).
 */
import { z } from 'zod'

import type { PluginContext } from '@bakin/core/plugin-types'

import {
  readTaskboard,
  assignTask,
  updateTask,
  deleteTask,
} from '../../../src/core/task-store'
import {
  getTaskDetails,
  createTaskWithEffects,
  moveTaskWithEffects,
  blockTaskWithEffects,
  reportComplete,
  setDependencyWithEffects,
  logProgress,
  triggerDispatch,
} from '../../../src/core/task-service'
import { getLiveRun } from '../../../src/core/execution-ledger'
import { COLUMNS } from './task-schemas'
import { taskEditGuard } from './edit-guard'
import { indexTask } from './search-doc'

/**
 * Advisory nudge (never rejects): a description enumerating several
 * deliverables without checklist formatting is the shape that killed
 * task-56d382ae — the agent drafted everything in one mega-response and the
 * runtime session died. Checklist structure cues produce-save-log
 * one-at-a-time execution.
 */
function buildChecklistNudge(description: string | undefined): string | undefined {
  if (!description) return undefined
  if (description.includes('- [ ]')) return undefined // already a checklist
  const enumeratedLines = description
    .split('\n')
    .filter((line) => /^\s*(?:[-*•]|\d+[.)])\s+\S/.test(line))
  if (enumeratedLines.length < 3) return undefined
  return `This task enumerates ${enumeratedLines.length} items. Consider formatting deliverables as a markdown checklist ("- [ ] …") — agents then produce and save each one in succession (write file → assets_save → log) instead of drafting everything in one oversized response.`
}

export function registerTaskExecTools(ctx: PluginContext): void {
    ctx.registerExecTool({
      name: 'bakin_exec_tasks_list',
      label: 'Listed tasks',
      description: 'List all tasks on the board. Optionally filter by column or agent.',
      parameters: {
        column: z.enum(COLUMNS).optional().describe('Filter by column'),
        agent: z.string().optional().describe('Filter by assigned agent'),
      },
      handler: async (params: Record<string, unknown>) => {
        const board = await readTaskboard()
        if (!board) return { ok: false, error: 'Failed to read task board' }

        const column = params.column as string | undefined
        const agent = params.agent as string | undefined

        if (column || agent) {
          const filtered: Record<string, unknown[]> = {}
          const columns = board.columns as unknown as Record<string, Array<{ agent?: string }>>
          for (const [colName, tasks] of Object.entries(columns)) {
            if (column && colName !== column) continue
            const matches = agent ? tasks.filter(t => t.agent === agent) : tasks
            if (matches.length > 0) filtered[colName] = matches
          }
          return { ok: true, columns: filtered }
        }

        return { ok: true, ...board }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_tasks_get',
      label: 'Read task details',
      description: 'Get details about a task — title, description, current column, logs, dependencies, project context.',
      parameters: {
        taskId: z.string().describe('Task ID'),
      },
      handler: async (params: Record<string, unknown>) => {
        const result = await getTaskDetails(params.taskId as string)
        if (!result) return { ok: false, error: `Task ${params.taskId} not found` }

        let enriched = result as Record<string, unknown>
        try {
          enriched = await ctx.hooks.call<Record<string, unknown>>('tasks.enrichDetails', enriched)
        } catch {
          // Detail enrichment is optional plugin behavior; task reads should
          // still work if an installed plugin's extension is unavailable.
        }

        // Surface the in-flight run so a session that received the task
        // through a side channel can see another worker already owns it
        // (live-test incident: a duplicate worker had no way to know).
        // Deliberately NOT wrapped: a ledger failure must fail this read
        // rather than report liveRun:null — "nobody owns this" is exactly
        // the wrong answer to give a would-be duplicate worker.
        const live = getLiveRun(params.taskId as string)
        const liveRun = live
          ? { runId: live.runId, agent: live.agent, startedAt: new Date(live.startedAt).toISOString() }
          : null

        return { ok: true, ...enriched, liveRun }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_tasks_create',
      label: 'Created a task',
      activityDuplicate: true,
      description: 'Create a new task on the task board. Workflows are auto-matched by title when workflowId is not provided. Provide workflowId to force a specific workflow, or skipWorkflowReason to explicitly skip.',
      parameters: {
        title: z.string().describe('Task title'),
        assignee: z.string().optional().describe('Agent to assign (chef, pixel, rolo, patch, trainer, etc.)'),
        description: z.string().optional().describe('Task description and context'),
        parentId: z.string().optional().describe('Parent task ID if this is a subtask'),
        workflowId: z.string().optional().describe('Workflow to start (e.g. image-social-post, video-script). Use bakin_exec_workflows_list to see options.'),
        skipWorkflowReason: z.string().optional().describe('Reason no workflow applies (required if workflowId is not set and this is not a subtask)'),
        projectId: z.string().optional().describe('Project ID to link this task to'),
        availableAt: z.string().optional().describe('ISO timestamp before which dispatch should not pick up the task'),
        dueAt: z.string().optional().describe('ISO timestamp representing the task deadline or target delivery time'),
        sourcePluginId: z.string().optional().describe('Plugin that owns the source entity for this task'),
        sourceEntityType: z.string().optional().describe('Source entity type, such as plan or deliverable'),
        sourceEntityId: z.string().optional().describe('Source entity ID'),
        sourcePurpose: z.string().optional().describe('Source purpose, such as kickoff or publish'),
      },
      handler: async (params: Record<string, unknown>, agent: string) => {
        const {
          title, assignee, description, parentId, workflowId, skipWorkflowReason, projectId,
          availableAt, dueAt, sourcePluginId, sourceEntityType, sourceEntityId, sourcePurpose,
        } = params as {
          title: string; assignee?: string; description?: string; parentId?: string
          workflowId?: string; skipWorkflowReason?: string; projectId?: string
          availableAt?: string; dueAt?: string
          sourcePluginId?: string; sourceEntityType?: string; sourceEntityId?: string; sourcePurpose?: string
        }

        try {
          const result = await createTaskWithEffects({
            title, assignee, description, workflowId, skipWorkflowReason,
            createdBy: agent, parentId, projectId, availableAt, dueAt,
            source: sourcePluginId || sourceEntityType || sourceEntityId || sourcePurpose
              ? { pluginId: sourcePluginId, entityType: sourceEntityType, entityId: sourceEntityId, purpose: sourcePurpose }
              : undefined,
            channel: 'mcp',
          })
          if (parentId || assignee) triggerDispatch()
          indexTask(ctx, result.id).catch(() => {})

          const notices: string[] = []
          if (assignee) {
            // Creation IS the briefing: dispatch sends the assignee the full
            // task. A separate team message about it lands in their main
            // session and starts a duplicate worker (live-test incident).
            notices.push(`Task assigned — dispatch will notify ${assignee} with the full task; do NOT send them a separate message about it.`)
          }
          if (!parentId && !result.workflowId && !skipWorkflowReason) {
            notices.push('No workflow attached. Consider providing workflowId next time — use bakin_exec_workflows_list to see options.')
          }
          const checklistNudge = buildChecklistNudge(description)
          if (checklistNudge) notices.push(checklistNudge)
          const notice = notices.length > 0 ? notices.join(' ') : undefined

          return {
            ok: true as const,
            id: result.id,
            workflowId: result.workflowId,
            suggestedWorkflow: result.suggestedWorkflow,
            notice,
          }
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) }
        }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_tasks_move',
      label: 'Moved a task',
      activityDuplicate: true,
      description: 'Move a task to a different column on the task board.',
      parameters: {
        taskId: z.string().describe('Task ID'),
        to: z.enum(COLUMNS).describe('Target column'),
        reason: z.string().optional().describe('Required when moving to "blocked"'),
      },
      handler: async (params: Record<string, unknown>, agent: string) => {
        const { taskId, to, reason } = params as { taskId: string; to: string; reason?: string }
        if (to === 'blocked' && !reason) {
          return { ok: false, error: 'reason is required when moving to blocked' }
        }
        try {
          const { alreadyComplete } = await moveTaskWithEffects(taskId, to, agent, { channel: 'mcp' })
          if (alreadyComplete) {
            return { ok: true, alreadyComplete: true, note: 'Task was already completed — no duplicate side effects fired.' }
          }
          indexTask(ctx, taskId).catch(() => {})
          return { ok: true }
        } catch (err) {
          return { ok: false, error: (err as Error).message }
        }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_tasks_block',
      label: 'Blocked a task',
      activityDuplicate: true,
      description: 'Mark a task as blocked with a reason. Use when you cannot proceed.',
      parameters: {
        taskId: z.string().describe('Task ID'),
        reason: z.string().describe('Why the task is blocked'),
      },
      handler: async (params: Record<string, unknown>, agent: string) => {
        try {
          const { alreadyComplete } = await blockTaskWithEffects(params.taskId as string, params.reason as string, agent, 'mcp')
          if (alreadyComplete) {
            // An agent retrying a block on a task that completed meanwhile
            // must see success, not an error — same contract as complete.
            return { ok: true, alreadyComplete: true, note: 'Task is already completed — block ignored. Reopen it (move it out of Done) first if it truly needs blocking.' }
          }
          indexTask(ctx, params.taskId as string).catch(() => {})
          return { ok: true }
        } catch (err) {
          return { ok: false, error: (err as Error).message }
        }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_tasks_complete',
      label: 'Completed a task',
      activityDuplicate: true,
      description: 'Report that your task is complete. Moves the task to Done and notifies the orchestrator.',
      parameters: {
        taskId: z.string().describe('Task ID'),
        summary: z.string().describe('Summary of what you accomplished'),
      },
      handler: async (params: Record<string, unknown>, agent: string) => {
        try {
          const { alreadyComplete } = await reportComplete(params.taskId as string, agent, params.summary as string, 'mcp')
          if (alreadyComplete) {
            // An agent retrying a timed-out completion must see success, not
            // an error — the work happened exactly once.
            return { ok: true, alreadyComplete: true, note: 'Task was already completed — no duplicate side effects fired.' }
          }
          indexTask(ctx, params.taskId as string).catch(() => {})
          return { ok: true }
        } catch (err) {
          return { ok: false, error: (err as Error).message }
        }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_tasks_log_progress',
      label: 'Logged progress',
      activityDuplicate: true,
      description: 'Log a human-readable progress update to the live activity feed. Call this at every significant step.',
      parameters: {
        taskId: z.string().describe('Task ID (e.g. "fe84ac51")'),
        message: z.string().describe('Human-readable status update'),
      },
      handler: async (params: Record<string, unknown>, agent: string) => {
        try {
          await logProgress(params.taskId as string, agent, params.message as string, 'mcp')
          return { ok: true }
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) }
        }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_tasks_set_dependency',
      label: 'Set task dependency',
      activityDuplicate: true,
      description: 'Register a dependency between tasks. Your task will be auto-re-dispatched when the dependency completes. After registering, exit — do not wait.',
      parameters: {
        taskId: z.string().describe('Your task ID (the one that depends)'),
        dependsOn: z.string().describe('Task ID you depend on'),
      },
      handler: async (params: Record<string, unknown>, agent: string) => {
        const guard = taskEditGuard(ctx, params.taskId as string, { agent })
        if (guard) return { ok: false, error: guard.error }
        try {
          await setDependencyWithEffects(params.taskId as string, params.dependsOn as string, 'mcp')
          return { ok: true, message: `Dependency registered. You will be re-dispatched when ${params.dependsOn} completes. Stop now.` }
        } catch (err) {
          return { ok: false, error: (err as Error).message }
        }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_tasks_update',
      label: 'Updated a task',
      activityDuplicate: true,
      description: 'Update a task on the board — change title, description, or assigned agent.',
      parameters: {
        taskId: z.string().describe('Task ID'),
        title: z.string().optional().describe('New task title'),
        description: z.string().optional().describe('New task description'),
        agent: z.string().optional().describe('New assigned agent'),
        availableAt: z.string().nullable().optional().describe('ISO timestamp before which dispatch should not pick up the task'),
        dueAt: z.string().nullable().optional().describe('ISO timestamp representing the task deadline or target delivery time'),
        expectedVersion: z.number().optional().describe('Optimistic-concurrency check: fail if the task version has moved past this'),
      },
      handler: async (params: Record<string, unknown>, agent: string) => {
        const { taskId, title, description, agent: assignee, availableAt, dueAt, expectedVersion } = params as {
          taskId: string
          title?: string
          description?: string
          agent?: string
          availableAt?: string | null
          dueAt?: string | null
          expectedVersion?: number
        }
        const guard = taskEditGuard(ctx, taskId, { agent, expectedVersion })
        if (guard) return { ok: false, error: guard.error }
        try {
          const updates: Record<string, unknown> = {}
          if (title !== undefined) updates.title = title
          if (description !== undefined) updates.description = description
          if (assignee !== undefined) updates.agent = assignee
          if (availableAt !== undefined) updates.availableAt = availableAt
          if (dueAt !== undefined) updates.dueAt = dueAt
          const result = await updateTask(taskId, updates)
          ctx.activity.audit('updated', agent, { taskId })
          indexTask(ctx, taskId).catch(() => {})
          return { ok: true, result }
        } catch (err) {
          return { ok: false, error: (err as Error).message }
        }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_tasks_delete',
      label: 'Deleted a task',
      activityDuplicate: true,
      description: 'Delete a task from the board.',
      parameters: {
        taskId: z.string().describe('Task ID'),
      },
      handler: async (params: Record<string, unknown>, agent: string) => {
        const taskId = params.taskId as string
        try {
          // deleteTask resolves the identifier — audit/search key on the id.
          const deletedId = await deleteTask(taskId)
          ctx.activity.audit('deleted', agent, { taskId: deletedId })
          ctx.search.remove(deletedId).catch(() => {})
          return { ok: true }
        } catch (err) {
          return { ok: false, error: (err as Error).message }
        }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_tasks_assign',
      label: 'Assigned a task',
      activityDuplicate: true,
      description: 'Assign a task to an agent.',
      parameters: {
        taskId: z.string().describe('Task ID'),
        agent: z.string().describe('Agent to assign the task to'),
      },
      handler: async (params: Record<string, unknown>, callingAgent: string) => {
        const taskId = params.taskId as string
        const targetAgent = params.agent as string
        const guard = taskEditGuard(ctx, taskId, { agent: callingAgent })
        if (guard) return { ok: false, error: guard.error }
        try {
          await assignTask(taskId, targetAgent)
          ctx.activity.audit('assigned', callingAgent, { taskId, agent: targetAgent })
          ctx.search.transform(taskId, [{ op: '$set', field: 'agent', value: targetAgent }]).catch(() => {})
          return { ok: true }
        } catch (err) {
          return { ok: false, error: (err as Error).message }
        }
      },
    })
}
