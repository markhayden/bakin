/**
 * Tasks plugin REST routes (declarative).
 *
 * Extracted from index.ts. The read routes (board list, summary, details, run
 * history) and the mutation routes (create/update/delete/move/assign/log/block/
 * dependency/reorder/complete) plus the declarative search route, assembled into
 * one array the plugin shell registers via `routes: tasksRoutes`.
 *
 * Mutations share one shape: resolve identifier → taskEditGuard → service call →
 * audit/activity → indexTask. Handlers receive their PluginContextLite per
 * request; `indexTask`/`taskEditGuard` take ctx as a parameter, so this module
 * needs no plugin-scope wiring.
 */
import { z } from 'zod'
import { defineRoute, searchRoute } from '@bakin/core/routing'

import {
  readTaskboard,
  deleteTask,
  assignTask,
  updateTask,
  reorderTasks,
} from '../../../src/core/task-store'
import {
  moveTaskWithEffects,
  blockTaskWithEffects,
  createTaskWithEffects,
  validateTeamAssignment,
  TaskValidationError,
  reportComplete,
  setDependencyWithEffects,
  getTaskDetails,
  logProgress,
  WorkflowTaskMoveError,
} from '../../../src/core/task-service'
import { readTaskOutcome, readTaskRuns } from './runs-reader'
import type { ColumnId } from '../types'
import { taskEditGuard, guardResponse, resolveTaskIdentifier } from './edit-guard'
import { indexTask } from './search-doc'
import {
  taskIdParams,
  runsHistoryQuery,
  okResponse,
  errorResponse,
  taskBoardResponse,
  taskSummaryResponse,
  createTaskBody,
  createTaskResponse,
  updateTaskBody,
  deleteTaskBody,
  moveTaskBody,
  assignTaskBody,
  logEntryBody,
  blockTaskBody,
  dependencyBody,
  reorderBody,
  completeTaskBody,
} from './task-schemas'

export const tasksRoutes = [
  defineRoute({
    path: '/',
    method: 'GET',
    summary: 'List all tasks',
    description: 'Returns the full kanban board state, grouped by column.',
    responses: { 200: taskBoardResponse, 500: errorResponse },
    handler: async () => {
      try {
        const board = await readTaskboard()
        return Response.json(board)
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    },
  }),

  defineRoute({
    path: '/summary',
    method: 'GET',
    activityClass: 'routine',
    summary: 'Counts of tasks needing attention (nav-badge source)',
    description: 'Returns blocked/review counts only — cheap source for the Tasks nav badge.',
    responses: { 200: taskSummaryResponse, 500: errorResponse },
    handler: async () => {
      try {
        const board = await readTaskboard()
        return Response.json({
          blocked: board.columns.blocked.length,
          review: board.columns.review.length,
        })
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    },
  }),

  defineRoute({
    path: '/:taskId',
    method: 'GET',
    summary: 'Get a task by ID',
    params: taskIdParams,
    responses: { 200: z.object({}).passthrough(), 404: errorResponse, 500: errorResponse },
    handler: async (_req, _ctx, { params }) => {
      const result = await getTaskDetails(params.taskId)
      if (!result) {
        return Response.json({ error: 'Task not found' }, { status: 404 })
      }
      return Response.json(result)
    },
  }),

  defineRoute({
    path: '/:taskId/runs',
    method: 'GET',
    summary: 'Get dispatch run history for a task',
    params: taskIdParams,
    query: runsHistoryQuery,
    responses: { 200: z.object({}).passthrough() },
    handler: async (_req, _ctx, { params, query }) => {
      // Unknown task → empty list, never an error (a not-yet-dispatched task has no runs).
      // Column fallback is gated on dispatch history so unknown ids can't trigger
      // the task store's full shard walk on every request.
      const runs = readTaskRuns(params.taskId, query.limit ?? 50)
      return Response.json({ runs, outcome: readTaskOutcome(params.taskId, runs.length > 0) })
    },
  }),

  defineRoute({
    path: '/',
    method: 'POST',
    summary: 'Create a task',
    description: 'Creates a task on the kanban board. Auto-matches a workflow by title when workflowId is omitted.',
    body: createTaskBody,
    responses: { 200: createTaskResponse, 400: errorResponse, 500: errorResponse },
    handler: async (_req, ctx, { body }) => {
      // Assignment validation happens ONCE inside createTaskWithEffects
      // (review R10) — the typed TaskValidationError maps to 400 below.
      try {
        const result = await createTaskWithEffects({
          id: body.id,
          title: body.title,
          column: body.column as ColumnId | undefined,
          assignee: body.assignee,
          team: body.team,
          description: body.description,
          workflowId: body.workflowId,
          skipWorkflowReason: body.skipWorkflowReason,
          createdBy: body.createdBy || 'system',
          parentId: body.parentId,
          projectId: body.projectId,
          brandId: body.brandId,
          availableAt: body.availableAt,
          dueAt: body.dueAt,
          source: body.source,
          channel: 'rest',
        })
        ctx.activity.log(body.createdBy || 'system', `Created task "${body.title}"`, { taskId: result.id })
        indexTask(ctx, result.id).catch(() => {})
        return Response.json({ ok: true as const, id: result.id, workflowId: result.workflowId, suggestedWorkflow: result.suggestedWorkflow })
      } catch (err) {
        const status = err instanceof TaskValidationError ? 400 : 500
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status })
      }
    },
  }),

  defineRoute({
    path: '/:taskId',
    method: 'PUT',
    summary: 'Update a task',
    params: taskIdParams,
    body: updateTaskBody,
    responses: { 200: okResponse, 400: errorResponse, 409: errorResponse, 500: errorResponse },
    handler: async (_req, ctx, { params, body }) => {
      const identifier = resolveTaskIdentifier(params.taskId, body, { bodyTitleIsPayload: true })
      if (!identifier) {
        return Response.json({ error: 'taskId required' }, { status: 400 })
      }
      const guard = taskEditGuard(ctx, identifier, { agent: body.agent, expectedVersion: body.expectedVersion })
      if (guard) return guardResponse(guard)
      try {
        await validateTeamAssignment({ assignee: body.agent, team: body.team })
      } catch (err) {
        if (err instanceof TaskValidationError) {
          return Response.json({ error: err.message }, { status: 400 })
        }
        throw err
      }
      try {
        // Partial-update semantics (review R1): only forward keys the client
        // actually sent. updateTask clears fields on KEY PRESENCE
        // ('team' in updates), so passing `team: undefined` for an omitted
        // field would silently wipe stored team/agent on unrelated edits.
        await updateTask(identifier, {
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.agent !== undefined ? { agent: body.agent } : {}),
          ...(body.team !== undefined ? { team: body.team } : {}),
          ...(body.column !== undefined ? { column: body.column as ColumnId } : {}),
          ...(body.workflowId !== undefined ? { workflowId: body.workflowId } : {}),
          ...(body.brandId !== undefined ? { brandId: body.brandId ?? '' } : {}),
          ...(body.availableAt !== undefined ? { availableAt: body.availableAt } : {}),
          ...(body.dueAt !== undefined ? { dueAt: body.dueAt } : {}),
          ...(body.source !== undefined ? { source: body.source } : {}),
        })
        const agent = body.agent || 'system'
        ctx.activity.audit('updated', agent, { taskId: identifier })
        ctx.activity.log(agent, `Updated task "${identifier}"`, { taskId: identifier })
        indexTask(ctx, identifier).catch(() => {})
        return Response.json({ ok: true as const })
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    },
  }),

  defineRoute({
    path: '/:taskId',
    method: 'DELETE',
    summary: 'Delete a task',
    params: taskIdParams,
    body: { contentType: '*/*', schema: deleteTaskBody },  // optional body fallback (id/title)
    responses: { 200: okResponse, 400: errorResponse, 500: errorResponse },
    handler: async (req, ctx, { params }) => {
      let body: any = {}
      try { body = await req.clone().json() } catch { /* no body is fine */ }
      const identifier = resolveTaskIdentifier(params.taskId, body)
      if (!identifier) {
        return Response.json({ error: 'taskId required' }, { status: 400 })
      }
      try {
        // deleteTask owns the full cascade (abort in-flight turns, cancel +
        // delete the workflow instance, purge ledger rows) — #604 T5. It
        // returns the RESOLVED id: `identifier` may be a title (body
        // fallback), and search docs/audit are keyed by id (review F4).
        const deletedId = await deleteTask(identifier as string)
        ctx.activity.audit('deleted', 'system', { taskId: deletedId })
        ctx.activity.log('system', `Deleted task "${deletedId}"`, { taskId: deletedId })
        ctx.search.remove(deletedId).catch(() => {})
        return Response.json({ ok: true as const })
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    },
  }),

  defineRoute({
    path: '/:taskId/move',
    method: 'POST',
    summary: 'Move a task to a different column',
    params: taskIdParams,
    body: moveTaskBody,
    responses: { 200: okResponse, 400: errorResponse, 403: errorResponse, 409: errorResponse, 500: errorResponse },
    handler: async (_req, ctx, { params, body }) => {
      const identifier = resolveTaskIdentifier(params.taskId, body)
      if (!identifier) {
        return Response.json({ error: 'taskId and to required' }, { status: 400 })
      }
      const { from, to, agent, reason } = body
      if (to === 'blocked') {
        if (!reason) {
          return Response.json({ error: 'reason required when moving to blocked' }, { status: 400 })
        }
        try {
          const { alreadyComplete } = await blockTaskWithEffects(identifier, reason, agent, (body.channel === 'human' && agent === 'human') ? 'human' : 'rest')
          if (alreadyComplete) {
            return Response.json({ error: `Task ${identifier} is completed — reopen it (move it out of Done) before blocking.` }, { status: 409 })
          }
          ctx.activity.log(agent, `Blocked task: ${reason}`, { taskId: identifier })
          indexTask(ctx, identifier).catch(() => {})
          return Response.json({ ok: true as const })
        } catch (err) {
          return Response.json({ error: (err as Error).message }, { status: 500 })
        }
      }
      try {
        const effectiveChannel = (body.channel === 'human' && agent === 'human') ? 'human' as const : 'rest' as const
        const { alreadyComplete } = await moveTaskWithEffects(identifier, to, agent, { from, channel: effectiveChannel })
        if (!alreadyComplete) {
          ctx.activity.log(agent, `Moved task to "${to}"`, { taskId: identifier })
          indexTask(ctx, identifier).catch(() => {})
        }
        return Response.json({ ok: true as const, ...(alreadyComplete ? { alreadyComplete: true as const } : {}) })
      } catch (err) {
        const msg = (err as Error).message
        if (err instanceof WorkflowTaskMoveError) {
          return Response.json({ error: msg }, { status: 403 })
        }
        return Response.json({ error: msg }, { status: 500 })
      }
    },
  }),

  defineRoute({
    path: '/:taskId/assign',
    method: 'POST',
    summary: 'Assign a task to an agent',
    params: taskIdParams,
    body: assignTaskBody,
    responses: { 200: okResponse, 400: errorResponse, 409: errorResponse, 500: errorResponse },
    handler: async (_req, ctx, { params, body }) => {
      const identifier = resolveTaskIdentifier(params.taskId, body)
      if (!identifier) {
        return Response.json({ error: 'taskId required' }, { status: 400 })
      }
      const guard = taskEditGuard(ctx, identifier, { agent: body.agent })
      if (guard) return guardResponse(guard)
      try {
        await assignTask(identifier, body.agent || '')
        ctx.activity.audit('assigned', 'system', { taskId: identifier, agent: body.agent || '' })
        ctx.activity.log('system', `Assigned task to "${body.agent || 'unassigned'}"`, { taskId: identifier })
        ctx.search.transform(identifier, [{ op: '$set', field: 'agent', value: body.agent || '' }]).catch(() => {})
        return Response.json({ ok: true as const })
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    },
  }),

  defineRoute({
    path: '/:taskId/log',
    method: 'POST',
    summary: 'Add a log entry to a task',
    params: taskIdParams,
    body: logEntryBody,
    responses: { 200: okResponse, 400: errorResponse, 500: errorResponse },
    handler: async (_req, ctx, { params, body }) => {
      const identifier = resolveTaskIdentifier(params.taskId, body)
      if (!identifier) {
        return Response.json({ error: 'taskId required' }, { status: 400 })
      }
      try {
        await logProgress(identifier, body.author || 'system', body.message, 'rest')
        ctx.activity.log(body.agent || body.author || 'system', `Logged progress on task ${identifier}`, { taskId: identifier })
        return Response.json({ ok: true as const })
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    },
  }),

  defineRoute({
    path: '/:taskId/block',
    method: 'POST',
    summary: 'Mark a task as blocked',
    params: taskIdParams,
    body: blockTaskBody,
    responses: { 200: okResponse, 400: errorResponse, 409: errorResponse, 500: errorResponse },
    handler: async (_req, ctx, { params, body }) => {
      const identifier = resolveTaskIdentifier(params.taskId, body)
      if (!identifier) {
        return Response.json({ error: 'taskId required' }, { status: 400 })
      }
      const guard = taskEditGuard(ctx, identifier, { agent: body.agent })
      if (guard) return guardResponse(guard)
      try {
        await blockTaskWithEffects(identifier, body.reason, body.agent || 'system', 'rest')
        ctx.activity.log(body.agent || 'system', `Blocked task: ${body.reason}`, { taskId: identifier })
        indexTask(ctx, identifier).catch(() => {})
        return Response.json({ ok: true as const })
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    },
  }),

  defineRoute({
    path: '/:taskId/dependency',
    method: 'POST',
    summary: 'Set a dependency between tasks',
    params: taskIdParams,
    body: dependencyBody,
    responses: { 200: okResponse, 400: errorResponse, 409: errorResponse, 500: errorResponse },
    handler: async (_req, ctx, { params, body }) => {
      const taskId = params.taskId || body.id
      if (!taskId) {
        return Response.json({ error: 'taskId required' }, { status: 400 })
      }
      const guard = taskEditGuard(ctx, taskId)
      if (guard) return guardResponse(guard)
      try {
        await setDependencyWithEffects(taskId, body.dependsOn, 'rest')
        ctx.activity.log('system', `Set dependency on ${body.dependsOn}`, { taskId })
        return Response.json({ ok: true as const })
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    },
  }),

  defineRoute({
    path: '/reorder',
    method: 'POST',
    summary: 'Reorder tasks within a column',
    body: reorderBody,
    responses: { 200: okResponse, 400: errorResponse, 500: errorResponse },
    handler: async (_req, ctx, { body }) => {
      try {
        await reorderTasks(body.columnId as ColumnId, body.orderedIds)
        ctx.activity.audit('reordered', 'system', { columnId: body.columnId, orderedIds: body.orderedIds })
        ctx.activity.log('system', `Reordered tasks in ${body.columnId}`)
        return Response.json({ ok: true as const })
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    },
  }),

  defineRoute({
    path: '/:taskId/complete',
    method: 'POST',
    summary: 'Mark a task as complete',
    params: taskIdParams,
    body: completeTaskBody,
    responses: { 200: okResponse, 400: errorResponse, 500: errorResponse },
    handler: async (_req, ctx, { params, body }) => {
      const taskId = params.taskId || body.id
      if (!taskId) {
        return Response.json({ error: 'taskId required' }, { status: 400 })
      }
      const agent = body.agent || 'system'
      const summary = body.summary || ''
      try {
        const { alreadyComplete } = await reportComplete(taskId, agent, summary, 'rest')
        if (!alreadyComplete) {
          ctx.activity.log(agent, `Completed task: ${summary}`, { taskId })
          indexTask(ctx, taskId).catch(() => {})
        }
        return Response.json({ ok: true as const, ...(alreadyComplete ? { alreadyComplete: true as const } : {}) })
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    },
  }),

  // Declarative search route — replaces the auto-wired `/search` that
  // `ctx.search.registerContentType` historically created as a side
  // effect during activate(). Schemas live in @bakin/core/routing;
  // handler uses ctx.search at request time.
  searchRoute({ table: 'tasks', description: 'Full-text search across tasks (title, description, log entries, blocked reasons).' }),
]
