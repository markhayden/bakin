/**
 * Tasks plugin — server entry point.
 * Registers API routes, MCP exec tools, and cross-plugin hooks for task operations.
 */
import { z } from 'zod'
import type { BakinPlugin, PluginContext } from '../../src/lib/plugin-types'
import {
  readTaskboard,
  createTask,
  deleteTask,
  assignTask,
  addTaskLog,
  blockTask,
  updateTask,
  moveTask,
  setDependency,
  clearDependency,
  reorderTasks,
  archiveOldTasks,
  autoArchiveDoneTasks,
} from './lib/flow-store'
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
import type { Task, TaskBoard, ColumnId } from './types'

const log = createLogger('tasks')

const COLUMNS = ['backlog', 'todo', 'inProgress', 'review', 'done', 'blocked', 'archived'] as const

const tasksPlugin: BakinPlugin = {
  id: 'tasks',
  name: 'Tasks',
  version: '2.1.0',

  settingsSchema: {
    fields: [
      { key: 'defaultColumn', type: 'select', label: 'Default column', description: 'Which column new tasks are created in', options: [{ value: 'backlog', label: 'Backlog' }, { value: 'todo', label: 'Todo' }], default: 'todo' },
      { key: 'showCompleted', type: 'boolean', label: 'Show completed tasks', description: 'Show tasks in the Done and Confirmed columns by default', default: true },
      { key: 'autoArchiveDays', type: 'number', label: 'Auto-archive after (days)', description: 'Move completed tasks to archive after this many days. 0 to disable.', default: 0 },
      { key: 'maxInProgress', type: 'number', label: 'Max in-progress tasks', description: 'Warn when more than this many tasks are in progress', default: 5 },
    ],
  },

  navItems: [
    { id: 'tasks', label: 'Tasks', icon: 'CheckSquare', href: '/tasks', order: 10 },
  ],

  activate(ctx: PluginContext) {
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
        log_text: { type: 'text' },
        blocked_reason: { type: 'text' },
        updated_at: { type: 'datetime' },
      },
      searchableFields: ['title', 'description', 'log_text', 'blocked_reason'],
      rerankField: 'description',
      embeddingTemplate: '{{title}} {{description}} {{log_text}}',
      facets: ['status', 'agent', 'created_by', 'project_id'],
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
        const { getTask } = await import('./lib/flow-store')
        return getTask(key) !== null
      },
    })

    /** Convert a task to a search document */
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
        log_text: logText,
        blocked_reason: task.blockedReason || '',
        updated_at: new Date().toISOString(),
      }
    }

    /** Index a task by looking it up and indexing its current state */
    async function indexTask(taskId: string): Promise<void> {
      try {
        const { getTask } = await import('./lib/flow-store')
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

    // ─── Cross-Plugin Hooks ────────────────────────────────────────────

    ctx.hooks.register('tasks.readTaskboard', () => readTaskboard())
    ctx.hooks.register('tasks.createTask', (d: Record<string, unknown>) => createTask(d.title as string, d.column as string | undefined, d.assignee as string | undefined, d.description as string | undefined, d.workflowId as string | undefined, d.createdBy as string | undefined, d.id as string | undefined, d.parentId as string | undefined, d.projectId as string | undefined))
    ctx.hooks.register('tasks.moveTask', (d: Record<string, unknown>) => moveTask(d.identifier as string, d.to as string, d.from as string | undefined, d.channel as string | undefined))
    ctx.hooks.register('tasks.blockTask', (d: Record<string, unknown>) => blockTask(d.identifier as string, d.reason as string, d.agent as string | undefined))
    ctx.hooks.register('tasks.addTaskLog', (d: Record<string, unknown>) => addTaskLog(d.identifier as string, d.author as string, d.message as string))
    ctx.hooks.register('tasks.updateTask', (d: Record<string, unknown>) => {
      const updates = { ...(d.updates as Record<string, unknown>) }
      delete updates.channel // Never trust channel from hook callers — only the REST route controls this
      return updateTask(d.identifier as string, updates)
    })
    ctx.hooks.register('tasks.deleteTask', (d: Record<string, unknown>) => deleteTask(d.identifier as string))
    ctx.hooks.register('tasks.setDependency', (d: Record<string, unknown>) => setDependency(d.taskId as string, d.dependsOnId as string))
    ctx.hooks.register('tasks.clearDependency', (d: Record<string, unknown>) => clearDependency(d.taskId as string))

    // ─── REST API Routes ───────────────────────────────────────────────

    // GET /search — search tasks via Antfly
    ctx.registerRoute({
      path: '/search',
      method: 'GET',
      description: 'Search tasks',
      handler: async (req: Request) => {
        const url = new URL(req.url, 'http://localhost')
        const q = url.searchParams.get('q')
        if (!q) return Response.json({ error: 'Missing ?q= parameter' }, { status: 400 })
        const result = await ctx.search.query({
          q,
          limit: Number(url.searchParams.get('limit')) || undefined,
          offset: Number(url.searchParams.get('offset')) || undefined,
          facets: url.searchParams.get('facets')?.split(',').filter(Boolean),
        })
        return Response.json(result)
      },
    })

    // GET / — list all tasks
    ctx.registerRoute({
      path: '/',
      method: 'GET',
      description: 'List all tasks',
      handler: async () => {
        try {
          const board = await readTaskboard()
          return Response.json(board)
        } catch (err) {
          return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
        }
      },
    })

    // GET /:taskId — get single task details
    ctx.registerRoute({
      path: '/:taskId',
      method: 'GET',
      description: 'Get a single task by ID',
      handler: async (req: Request) => {
        const url = new URL(req.url)
        const taskId = url.searchParams.get('taskId')
        if (!taskId) {
          return Response.json({ error: 'taskId required' }, { status: 400 })
        }
        const result = await getTaskDetails(taskId)
        if (!result) {
          return Response.json({ error: 'Task not found' }, { status: 404 })
        }
        return Response.json(result)
      },
    })

    // POST / — create task
    ctx.registerRoute({
      path: '/',
      method: 'POST',
      description: 'Create a new task',
      handler: async (req: Request) => {
        const body = await req.json()
        const { id, title, description, column, assignee, workflowId, skipWorkflowReason, createdBy, parentId, projectId } = body
        if (!title) {
          return Response.json({ error: 'title required' }, { status: 400 })
        }
        try {
          const result = await createTaskWithEffects({
            id, title, column, assignee, description, workflowId, skipWorkflowReason,
            createdBy: createdBy || 'system', parentId, projectId, channel: 'rest',
          })
          ctx.activity.log(createdBy || 'system', `Created task "${title}"`, { taskId: result.id })
          indexTask(result.id).catch(() => {})
          return Response.json({ ok: true, id: result.id, workflowId: result.workflowId, suggestedWorkflow: result.suggestedWorkflow })
        } catch (err) {
          return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
        }
      },
    })

    // PUT /:taskId — update task
    ctx.registerRoute({
      path: '/:taskId',
      method: 'PUT',
      description: 'Update a task',
      handler: async (req: Request) => {
        const url = new URL(req.url)
        const taskId = url.searchParams.get('taskId')
        const body = await req.json()
        const identifier = taskId || body.id || body.originalTitle
        if (!identifier) {
          return Response.json({ error: 'taskId required' }, { status: 400 })
        }
        try {
          const { title, description, agent, column, workflowId } = body
          await updateTask(identifier, { title, description, agent, column, workflowId })
          ctx.activity.audit('updated', agent || 'system', { taskId: identifier })
          ctx.activity.log(agent || 'system', `Updated task "${identifier}"`, { taskId: identifier })
          indexTask(identifier).catch(() => {})
          return Response.json({ ok: true })
        } catch (err) {
          return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
        }
      },
    })

    // DELETE /:taskId — delete task
    ctx.registerRoute({
      path: '/:taskId',
      method: 'DELETE',
      description: 'Delete a task',
      handler: async (req: Request) => {
        const url = new URL(req.url)
        const taskId = url.searchParams.get('taskId')
        const body = await req.json().catch(() => ({}))
        const identifier = taskId || (body as Record<string, unknown>).id || (body as Record<string, unknown>).title
        if (!identifier) {
          return Response.json({ error: 'taskId required' }, { status: 400 })
        }
        try {
          await deleteTask(identifier as string)
          ctx.activity.audit('deleted', 'system', { taskId: identifier })
          ctx.activity.log('system', `Deleted task "${identifier}"`, { taskId: identifier as string })
          ctx.search.remove(identifier as string).catch(() => {})
          return Response.json({ ok: true })
        } catch (err) {
          return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
        }
      },
    })

    // POST /:taskId/move — move task to column
    ctx.registerRoute({
      path: '/:taskId/move',
      method: 'POST',
      description: 'Move a task to a different column',
      handler: async (req: Request) => {
        const url = new URL(req.url)
        const body = await req.json()
        const identifier = url.searchParams.get('taskId') || body.id || body.title
        const { from, to, agent, reason } = body
        if (!identifier || !to) {
          return Response.json({ error: 'taskId and to required' }, { status: 400 })
        }
        if (!agent) {
          return Response.json({ error: 'agent field required — who is moving this task?' }, { status: 400 })
        }
        // Blocked column requires a reason — use blockTaskWithEffects
        if (to === 'blocked') {
          if (!reason) {
            return Response.json({ error: 'reason required when moving to blocked' }, { status: 400 })
          }
          try {
            await blockTaskWithEffects(identifier, reason, agent, (body.channel === 'human' && agent === 'human') ? 'human' : 'rest')
            ctx.activity.log(agent, `Blocked task: ${reason}`, { taskId: identifier })
            indexTask(identifier).catch(() => {})
            return Response.json({ ok: true })
          } catch (err) {
            return Response.json({ error: (err as Error).message }, { status: 500 })
          }
        }
        try {
          // Channel determines guard bypass: 'human' skips transition/log guards.
          // Only accept 'human' from REST when the caller explicitly identifies as the
          // UI operator (agent === 'human'). MCP tools hardcode 'mcp' server-side.
          const effectiveChannel = (body.channel === 'human' && agent === 'human') ? 'human' as const : 'rest' as const
          await moveTaskWithEffects(identifier, to, agent, { from, channel: effectiveChannel })
          ctx.activity.log(agent, `Moved task to "${to}"`, { taskId: identifier })
          indexTask(identifier).catch(() => {})
          return Response.json({ ok: true })
        } catch (err) {
          const msg = (err as Error).message
          if (msg.includes('Workflow tasks cannot be moved')) {
            return Response.json({ error: msg }, { status: 403 })
          }
          return Response.json({ error: msg }, { status: 500 })
        }
      },
    })

    // POST /:taskId/assign — assign task to agent
    ctx.registerRoute({
      path: '/:taskId/assign',
      method: 'POST',
      description: 'Assign a task to an agent',
      handler: async (req: Request) => {
        const url = new URL(req.url)
        const body = await req.json()
        const identifier = url.searchParams.get('taskId') || body.id || body.title
        if (!identifier) {
          return Response.json({ error: 'taskId required' }, { status: 400 })
        }
        try {
          await assignTask(identifier, body.agent || '')
          ctx.activity.audit('assigned', 'system', { taskId: identifier, agent: body.agent || '' })
          ctx.activity.log('system', `Assigned task to "${body.agent || 'unassigned'}"`, { taskId: identifier })
          ctx.search.transform(identifier, [{ op: '$set', field: 'agent', value: body.agent || '' }]).catch(() => {})
          return Response.json({ ok: true })
        } catch (err) {
          return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
        }
      },
    })

    // POST /:taskId/log — add log entry
    ctx.registerRoute({
      path: '/:taskId/log',
      method: 'POST',
      description: 'Add a log entry to a task',
      handler: async (req: Request) => {
        const url = new URL(req.url)
        const body = await req.json()
        const identifier = url.searchParams.get('taskId') || body.id || body.title
        if (!identifier || !body.message) {
          return Response.json({ error: 'taskId and message required' }, { status: 400 })
        }
        try {
          await logProgress(identifier, body.author || 'system', body.message, 'rest')
          ctx.activity.log(body.agent || body.author || 'system', `Logged progress on task ${identifier}`, { taskId: identifier })
          return Response.json({ ok: true })
        } catch (err) {
          return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
        }
      },
    })

    // POST /:taskId/block — block task
    ctx.registerRoute({
      path: '/:taskId/block',
      method: 'POST',
      description: 'Mark a task as blocked',
      handler: async (req: Request) => {
        const url = new URL(req.url)
        const body = await req.json()
        const identifier = url.searchParams.get('taskId') || body.id || body.title
        if (!identifier || !body.reason) {
          return Response.json({ error: 'taskId and reason required' }, { status: 400 })
        }
        try {
          await blockTaskWithEffects(identifier, body.reason, body.agent || 'system', 'rest')
          ctx.activity.log(body.agent || 'system', `Blocked task: ${body.reason}`, { taskId: identifier })
          indexTask(identifier).catch(() => {})
          return Response.json({ ok: true })
        } catch (err) {
          return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
        }
      },
    })

    // POST /:taskId/dependency — set dependency
    ctx.registerRoute({
      path: '/:taskId/dependency',
      method: 'POST',
      description: 'Set a dependency between tasks',
      handler: async (req: Request) => {
        const url = new URL(req.url)
        const body = await req.json()
        const taskId = url.searchParams.get('taskId') || body.id
        if (!taskId || !body.dependsOn) {
          return Response.json({ error: 'taskId and dependsOn required' }, { status: 400 })
        }
        try {
          await setDependencyWithEffects(taskId, body.dependsOn, 'rest')
          ctx.activity.log('system', `Set dependency on ${body.dependsOn}`, { taskId })
          return Response.json({ ok: true })
        } catch (err) {
          return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
        }
      },
    })

    // POST /:taskId/reorder — reorder tasks in a column
    ctx.registerRoute({
      path: '/reorder',
      method: 'POST',
      description: 'Reorder tasks within a column',
      handler: async (req: Request) => {
        const body = await req.json()
        const { columnId, orderedIds } = body
        if (!columnId || !Array.isArray(orderedIds)) {
          return Response.json({ error: 'columnId and orderedIds[] required' }, { status: 400 })
        }
        try {
          await reorderTasks(columnId, orderedIds)
          ctx.activity.audit('reordered', 'system', { columnId, orderedIds })
          ctx.activity.log('system', `Reordered tasks in ${columnId}`)
          return Response.json({ ok: true })
        } catch (err) {
          return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
        }
      },
    })

    // POST /:taskId/complete — mark task as complete
    ctx.registerRoute({
      path: '/:taskId/complete',
      method: 'POST',
      description: 'Mark a task as complete',
      handler: async (req: Request) => {
        const url = new URL(req.url)
        const body = await req.json()
        const taskId = url.searchParams.get('taskId') || body.id
        if (!taskId) {
          return Response.json({ error: 'taskId required' }, { status: 400 })
        }
        const agent = body.agent || 'system'
        const summary = body.summary || ''
        try {
          await reportComplete(taskId, agent, summary, 'rest')
          ctx.activity.log(agent, `Completed task: ${summary}`, { taskId })
          indexTask(taskId).catch(() => {})
          return Response.json({ ok: true })
        } catch (err) {
          return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
        }
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

        // Enrich with project context if task has projectId
        const pId = (result.task as Record<string, unknown>).projectId as string | undefined
        if (pId) {
          try {
            const project = await ctx.hooks.invoke<{ title: string; status: string; progress: number; body: string }>('projects.readProject', { projectId: pId })
            if (project) {
              ;(result as Record<string, unknown>).projectTitle = project.title
              ;(result as Record<string, unknown>).projectStatus = project.status
              ;(result as Record<string, unknown>).projectProgress = project.progress
              ;(result as Record<string, unknown>).projectExcerpt = project.body.slice(0, 500)
            }
          } catch { /* project plugin may not be available */ }
        }

        return { ok: true, ...result }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_tasks_create',
      label: 'Created a task',
      activityDuplicate: true,
      description: 'Create a new task on the task board. Workflows are auto-matched by title when workflowId is not provided. Provide workflowId to force a specific workflow, or skipWorkflowReason to explicitly skip.',
      parameters: {
        title: z.string().describe('Task title'),
        assignee: z.string().optional().describe('Agent to assign (basil, pixel, rolo, patch, nemo, etc.)'),
        description: z.string().optional().describe('Task description and context'),
        parentId: z.string().optional().describe('Parent task ID if this is a subtask'),
        workflowId: z.string().optional().describe('Workflow to start (e.g. image-social-post, video-script). Use bakin_exec_workflows_list to see options.'),
        skipWorkflowReason: z.string().optional().describe('Reason no workflow applies (required if workflowId is not set and this is not a subtask)'),
        projectId: z.string().optional().describe('Project ID to link this task to'),
      },
      handler: async (params: Record<string, unknown>, agent: string) => {
        const { title, assignee, description, parentId, workflowId, skipWorkflowReason, projectId } = params as {
          title: string; assignee?: string; description?: string; parentId?: string
          workflowId?: string; skipWorkflowReason?: string; projectId?: string
        }

        try {
          const result = await createTaskWithEffects({
            title, assignee, description, workflowId, skipWorkflowReason,
            createdBy: agent, parentId, projectId, channel: 'mcp',
          })
          if (parentId || assignee) triggerDispatch()
          indexTask(result.id).catch(() => {})

          // Nudge: if no workflow was matched or provided, let the agent know
          const notice = (!parentId && !result.workflowId && !skipWorkflowReason)
            ? 'No workflow attached. Consider providing workflowId next time — use bakin_exec_workflows_list to see options.'
            : undefined

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
          await moveTaskWithEffects(taskId, to, agent, { channel: 'mcp' })
          indexTask(taskId).catch(() => {})
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
          await blockTaskWithEffects(params.taskId as string, params.reason as string, agent, 'mcp')
          indexTask(params.taskId as string).catch(() => {})
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
          await reportComplete(params.taskId as string, agent, params.summary as string, 'mcp')
          indexTask(params.taskId as string).catch(() => {})
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
      },
      handler: async (params: Record<string, unknown>, agent: string) => {
        const { taskId, title, description, agent: assignee } = params as {
          taskId: string; title?: string; description?: string; agent?: string
        }
        try {
          const updates: Record<string, unknown> = {}
          if (title !== undefined) updates.title = title
          if (description !== undefined) updates.description = description
          if (assignee !== undefined) updates.agent = assignee
          const result = await ctx.hooks.invoke('tasks.updateTask', { identifier: taskId, updates })
          ctx.activity.audit('updated', agent, { taskId })
          indexTask(taskId).catch(() => {})
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
          await ctx.hooks.invoke('tasks.deleteTask', { identifier: taskId })
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
    setInterval(() => {
      const count = autoArchiveDoneTasks()
      if (count > 0) log.info(`Auto-archive: moved ${count} done tasks to archived`)
    }, 60 * 60 * 1000)

    // Hard-delete old completed tasks on startup + every 6 hours
    const taskSettings = ctx.getSettings<{ autoArchiveDays?: number }>()
    if (taskSettings?.autoArchiveDays && taskSettings.autoArchiveDays > 0) {
      const days = taskSettings.autoArchiveDays
      const deleted = archiveOldTasks(days)
      if (deleted > 0) log.info(`Deleted ${deleted} old tasks (>${days} days)`)
      setInterval(() => {
        const count = archiveOldTasks(days)
        if (count > 0) log.info(`Periodic cleanup: deleted ${count} old tasks`)
      }, 6 * 60 * 60 * 1000)
    }
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
    log.info('Shutting down tasks plugin')
  },
}

export default tasksPlugin
