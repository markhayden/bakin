/**
 * Tasks plugin — server entry point.
 * Registers API routes (declarative) and MCP exec tools for task operations.
 */
import { z } from 'zod'
import type { BakinPlugin, PluginContext } from '@bakin/core/plugin-types'
import { definePlugin, defineRoute, searchRoute, type PluginContextLite } from '@bakin/core/routing'
import {
  readTaskboard,
  deleteTask,
  assignTask,
  updateTask,
  reorderTasks,
  archiveOldTasks,
  autoArchiveDoneTasks,
  getTask,
} from '../../src/core/task-store'
import {
  moveTaskWithEffects,
  blockTaskWithEffects,
  createTaskWithEffects,
  reportComplete,
  setDependencyWithEffects,
  getTaskDetails,
  logProgress,
  triggerDispatch,
} from '../../src/core/task-service'
import { createLogger } from '../../src/core/logger'
import { getLiveRun, hasCompletion } from '../../src/core/execution-ledger'
import { readTaskOutcome, readTaskRuns } from './lib/runs-reader'
import { getContentDir } from '../../packages/core/src/content-dir'
import {
  checkSessionDeathIncidents,
  checkTaskboard,
  checkTaskConsistency,
  checkTaskPositionIntegrity,
  taskConsistencyRepair,
  taskOrderRepair,
} from './lib/health-checks'
import { queryAuditEvents } from '../../src/core/audit'
import type { Task, ColumnId } from './types'

const log = createLogger('tasks')

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

const COLUMNS = ['backlog', 'todo', 'inProgress', 'review', 'done', 'blocked', 'archived'] as const
let maintenanceTimers: Array<ReturnType<typeof setInterval>> = []

function clearMaintenanceTimers(): void {
  for (const timer of maintenanceTimers) {
    clearInterval(timer)
  }
  maintenanceTimers = []
}

// ─── Search-document helpers (module scope) ──────────────────────────────

function taskToSearchDoc(task: Task, column: ColumnId): Record<string, unknown> {
  const logText = task.log?.map(l => `[${l.timestamp} ${l.author}] ${l.message}`).join('\n') || ''
  return {
    title: task.title,
    description: task.description || '',
    agent: task.agent || '',
    created_by: task.createdBy || '',
    status: column,
    project_id: task.projectId || '',
    workflow_id: task.workflowId || '',
    source_plugin_id: task.source?.pluginId || '',
    source_entity_type: task.source?.entityType || '',
    source_entity_id: task.source?.entityId || '',
    source_purpose: task.source?.purpose || '',
    available_at: task.availableAt || '',
    due_at: task.dueAt || '',
    log_text: logText,
    blocked_reason: task.blockedReason || '',
    updated_at: new Date().toISOString(),
  }
}

async function indexTask(ctx: PluginContextLite, taskId: string): Promise<void> {
  try {
    const board = readTaskboard()
    const columns = board.columns as unknown as Record<string, Task[]>
    for (const [colName, tasks] of Object.entries(columns)) {
      const task = tasks.find(t => t.id === taskId)
      if (task) {
        await ctx.search.index(taskId, taskToSearchDoc(task, colName as ColumnId))
        return
      }
    }
  } catch (err) {
    log.warn('Failed to index task', { taskId, error: err instanceof Error ? err.message : String(err) })
  }
}

// ─── Schemas (module scope) ──────────────────────────────────────────────

const taskIdParams = z.object({ taskId: z.string() })

const runsHistoryQuery = z.object({ limit: z.coerce.number().int().positive().optional() })

const okResponse = z.object({ ok: z.literal(true) })
const errorResponse = z.object({ error: z.string() })

const taskBoardResponse = z.object({}).passthrough()  // structural; defined elsewhere

const taskSummaryResponse = z.object({ blocked: z.number(), review: z.number() })

const taskSourceSchema = z.object({
  pluginId: z.string().optional(),
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  purpose: z.string().optional(),
})

const createTaskBody = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  column: z.enum(COLUMNS).optional(),
  assignee: z.string().optional(),
  workflowId: z.string().optional(),
  skipWorkflowReason: z.string().optional(),
  createdBy: z.string().optional(),
  parentId: z.string().optional(),
  projectId: z.string().optional(),
  availableAt: z.string().optional(),
  dueAt: z.string().optional(),
  source: taskSourceSchema.optional(),
})
const createTaskResponse = z.object({
  ok: z.literal(true),
  id: z.string(),
  workflowId: z.string().optional(),
  suggestedWorkflow: z.string().optional(),
})

const updateTaskBody = z.object({
  id: z.string().optional(),
  originalTitle: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  agent: z.string().optional(),
  column: z.string().optional(),
  workflowId: z.string().optional(),
  availableAt: z.string().nullable().optional(),
  dueAt: z.string().nullable().optional(),
  source: taskSourceSchema.nullable().optional(),
  /** Optimistic concurrency: refuse with 409 when stale. */
  expectedVersion: z.number().optional(),
})

const deleteTaskBody = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
}).optional()

const moveTaskBody = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
  from: z.string().optional(),
  to: z.string(),
  agent: z.string(),
  reason: z.string().optional(),
  channel: z.string().optional(),
})

const assignTaskBody = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
  agent: z.string().optional(),
})

const logEntryBody = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
  author: z.string().optional(),
  agent: z.string().optional(),
  message: z.string().min(1),
})

const blockTaskBody = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
  agent: z.string().optional(),
  reason: z.string().min(1),
})

const dependencyBody = z.object({
  id: z.string().optional(),
  dependsOn: z.string().min(1),
})

const reorderBody = z.object({
  columnId: z.string().min(1),
  orderedIds: z.array(z.string()),
})

const completeTaskBody = z.object({
  id: z.string().optional(),
  agent: z.string().optional(),
  summary: z.string().optional(),
})

// ─── Edit-safety guard (optimistic versioning + freeze-on-complete) ───────
//
// Content mutations (update/assign/dependency/block) pass through here.
// - A completed task (completions row in the execution ledger) refuses
//   mutation until explicitly reopened (moved out of Done). Move/complete
//   routes are exempt — they ARE the reopen/complete paths.
// - A stale expectedVersion gets a 409 + edit_conflict audit so contention
//   is measurable; omitting expectedVersion stays last-write-wins.
function taskEditGuard(
  ctx: { activity: { audit: (event: string, agent: string, data?: Record<string, unknown>) => void } },
  identifier: string,
  opts: { agent?: string; expectedVersion?: number } = {},
): { status: number; error: string; currentVersion?: number } | null {
  const task = getTask(identifier)
  if (!task) return null // unknown ids fall through to the handler's own error path
  if (hasCompletion(task.id)) {
    return { status: 409, error: `Task ${task.id} is completed — reopen it (move it out of Done) before editing.` }
  }
  const currentVersion = task.version ?? 0
  if (opts.expectedVersion !== undefined && currentVersion !== opts.expectedVersion) {
    ctx.activity.audit('edit_conflict', opts.agent ?? 'system', {
      taskId: task.id,
      expectedVersion: opts.expectedVersion,
      currentVersion,
    })
    return {
      status: 409,
      error: `Version conflict on ${task.id}: expected version ${opts.expectedVersion}, current is ${currentVersion}. Refetch and retry.`,
      currentVersion,
    }
  }
  return null
}

function guardResponse(guard: { status: number; error: string; currentVersion?: number }): Response {
  return Response.json(
    { error: guard.error, ...(guard.currentVersion !== undefined ? { currentVersion: guard.currentVersion } : {}) },
    { status: guard.status },
  )
}

// ─── Routes (declarative) ────────────────────────────────────────────────

const routes = [
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
    responses: { 200: createTaskResponse, 500: errorResponse },
    handler: async (_req, ctx, { body }) => {
      try {
        const result = await createTaskWithEffects({
          id: body.id,
          title: body.title,
          column: body.column as ColumnId | undefined,
          assignee: body.assignee,
          description: body.description,
          workflowId: body.workflowId,
          skipWorkflowReason: body.skipWorkflowReason,
          createdBy: body.createdBy || 'system',
          parentId: body.parentId,
          projectId: body.projectId,
          availableAt: body.availableAt,
          dueAt: body.dueAt,
          source: body.source,
          channel: 'rest',
        })
        ctx.activity.log(body.createdBy || 'system', `Created task "${body.title}"`, { taskId: result.id })
        indexTask(ctx, result.id).catch(() => {})
        return Response.json({ ok: true as const, id: result.id, workflowId: result.workflowId, suggestedWorkflow: result.suggestedWorkflow })
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
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
      const identifier = params.taskId || body.id || body.originalTitle
      if (!identifier) {
        return Response.json({ error: 'taskId required' }, { status: 400 })
      }
      const guard = taskEditGuard(ctx, identifier, { agent: body.agent, expectedVersion: body.expectedVersion })
      if (guard) return guardResponse(guard)
      try {
        await updateTask(identifier, {
          title: body.title,
          description: body.description,
          agent: body.agent,
          column: body.column as ColumnId | undefined,
          workflowId: body.workflowId,
          availableAt: body.availableAt,
          dueAt: body.dueAt,
          source: body.source,
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
      const identifier = params.taskId || body.id || body.title
      if (!identifier) {
        return Response.json({ error: 'taskId required' }, { status: 400 })
      }
      try {
        await deleteTask(identifier as string)
        ctx.activity.audit('deleted', 'system', { taskId: identifier })
        ctx.activity.log('system', `Deleted task "${identifier}"`, { taskId: identifier as string })
        ctx.search.remove(identifier as string).catch(() => {})
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
      const identifier = params.taskId || body.id || body.title
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
        if (msg.includes('Workflow tasks cannot be moved')) {
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
      const identifier = params.taskId || body.id || body.title
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
      const identifier = params.taskId || body.id || body.title
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
      const identifier = params.taskId || body.id || body.title
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

// ─── Plugin definition ───────────────────────────────────────────────────

const tasksPlugin: BakinPlugin = definePlugin({
  id: 'tasks',
  name: 'Tasks',
  version: '2.1.0',
  routes,

  settingsSchema: {
    fields: [
      { key: 'defaultColumn', type: 'select', label: 'Default column', description: 'Which column new tasks are created in', options: [{ value: 'backlog', label: 'Backlog' }, { value: 'todo', label: 'Todo' }], default: 'todo' },
      { key: 'showCompleted', type: 'boolean', label: 'Show completed tasks', description: 'Show tasks in the Done and Archived columns by default', default: true },
      { key: 'autoArchiveDays', type: 'number', label: 'Auto-archive after (days)', description: 'Move completed tasks to archive after this many days. 0 to disable.', default: 0 },
      { key: 'maxInProgress', type: 'number', label: 'Max in-progress tasks', description: 'Warn when more than this many tasks are in progress', default: 5 },
    ],
  },

  navItems: [
    { id: 'tasks', label: 'Tasks', icon: 'CheckSquare', href: '/tasks', order: 10 },
  ],

  activate(ctx: PluginContext) {
    clearMaintenanceTimers()

    // ─── Search Content Type Registration ─────────────────────────────

    ctx.search.registerContentType({
      table: 'tasks',
      schema: {
        title: { type: 'text' },
        description: { type: 'text' },
        agent: { type: 'keyword' },
        created_by: { type: 'keyword' },
        status: { type: 'keyword' },
        project_id: { type: 'keyword' },
        workflow_id: { type: 'keyword' },
        source_plugin_id: { type: 'keyword' },
        source_entity_type: { type: 'keyword' },
        source_entity_id: { type: 'keyword' },
        source_purpose: { type: 'keyword' },
        available_at: { type: 'datetime' },
        due_at: { type: 'datetime' },
        log_text: { type: 'text' },
        blocked_reason: { type: 'text' },
        updated_at: { type: 'datetime' },
      },
      searchableFields: ['title', 'description', 'log_text', 'blocked_reason'],
      rerankField: 'description',
      embeddingTemplate: '{{title}} {{description}} {{log_text}}',
      facets: ['status', 'agent', 'created_by', 'project_id', 'source_plugin_id', 'source_entity_type'],
      chunker: { enabled: true, targetTokens: 200, overlapTokens: 25 },
      reindex: async function* () {
        const board = readTaskboard()
        const columns = board.columns as unknown as Record<string, Task[]>
        for (const [colName, tasks] of Object.entries(columns)) {
          for (const task of tasks) {
            yield { key: task.id, doc: taskToSearchDoc(task, colName as ColumnId) }
          }
        }
      },
      verifyExists: async (key: string) => {
        return getTask(key) !== null
      },
    })

    // ─── MCP Exec Tools ────────────────────────────────────────────────

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
      handler: async (params: Record<string, unknown>) => {
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
      },
      handler: async (params: Record<string, unknown>, agent: string) => {
        const { taskId, title, description, agent: assignee, availableAt, dueAt } = params as {
          taskId: string
          title?: string
          description?: string
          agent?: string
          availableAt?: string | null
          dueAt?: string | null
        }
        const guard = taskEditGuard(ctx, taskId, { agent })
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
          await deleteTask(taskId)
          ctx.activity.audit('deleted', agent, { taskId })
          ctx.search.remove(taskId).catch(() => {})
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

    // Auto-archive: move done tasks to archived after 24 hours (runs hourly)
    const autoArchived = autoArchiveDoneTasks()
    if (autoArchived > 0) log.info(`Auto-archived ${autoArchived} done tasks (>24h)`)
    maintenanceTimers.push(setInterval(() => {
      const count = autoArchiveDoneTasks()
      if (count > 0) log.info(`Auto-archive: moved ${count} done tasks to archived`)
    }, 60 * 60 * 1000))

    // Hard-delete old completed tasks on startup + every 6 hours
    const taskSettings = ctx.getSettings<{ autoArchiveDays?: number }>()
    if (taskSettings?.autoArchiveDays && taskSettings.autoArchiveDays > 0) {
      const days = taskSettings.autoArchiveDays
      const deleted = archiveOldTasks(days)
      if (deleted > 0) log.info(`Deleted ${deleted} old tasks (>${days} days)`)
      maintenanceTimers.push(setInterval(() => {
        const count = archiveOldTasks(days)
        if (count > 0) log.info(`Periodic cleanup: deleted ${count} old tasks`)
      }, 6 * 60 * 60 * 1000))
    }

    // ─── Health checks (migrated out of core/doctor.ts per #139 C2) ─────
    ctx.registerHealthCheck({
      id: 'taskboard',
      name: 'Taskboard SQLite reachability',
      run: () => Promise.resolve(checkTaskboard()),
    })
    ctx.registerHealthCheck({
      id: 'task-consistency',
      name: 'Task consistency (orphans, overload, stale in-progress)',
      run: () => checkTaskConsistency(getContentDir(), ctx.runtime.agents),
      repair: taskConsistencyRepair(),
    })
    ctx.registerHealthCheck({
      id: 'order-integrity',
      name: 'Task position / order integrity',
      run: () => Promise.resolve(checkTaskPositionIntegrity()),
      repair: taskOrderRepair(),
    })
    ctx.registerHealthCheck({
      id: 'session-death-incidents',
      name: 'Runtime session deaths (last 24h)',
      run: () => Promise.resolve(checkSessionDeathIncidents(getContentDir(), queryAuditEvents)),
    })
  },

  async onReady() {
    try {
      const board = await readTaskboard()
      if (board) {
        const columns = board.columns as unknown as Record<string, unknown[]>
        const counts = Object.entries(columns).map(([col, tasks]) => `${col}: ${tasks.length}`).join(', ')
        log.info(`Ready — ${counts}`)
      }
    } catch (err) {
      log.error('Failed to read task board on ready', err)
    }
  },

  onShutdown() {
    clearMaintenanceTimers()
    log.info('Shutting down tasks plugin')
  },
}) as unknown as BakinPlugin

export default tasksPlugin
