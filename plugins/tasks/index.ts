/**
 * Tasks plugin — server entry point.
 * Registers API routes for task operations.
 */
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
} from './taskboard'
import {
  moveTaskWithEffects,
  blockTaskWithEffects,
  logProgress,
} from '../../src/core/task-service'

const tasksPlugin: BakinPlugin = {
  id: 'tasks',
  name: 'Tasks',
  version: '1.0.0',

  navItems: [
    { id: 'tasks', label: 'Tasks', icon: 'CheckSquare', href: '/tasks', order: 10 },
  ],

  contentFiles: [
    { path: 'TASKBOARD.md' },
  ],

  activate(ctx: PluginContext) {
    // Register cross-plugin hooks
    ctx.hooks.register('tasks.readTaskboard', () => readTaskboard())
    ctx.hooks.register('tasks.createTask', (d: Record<string, unknown>) => createTask(d.title as string, d.column as string | undefined, d.assignee as string | undefined, d.description as string | undefined, d.workflowId as string | undefined, d.createdBy as string | undefined, d.id as string | undefined, d.parentId as string | undefined, d.projectId as string | undefined))
    ctx.hooks.register('tasks.moveTask', (d: Record<string, unknown>) => moveTask(d.identifier as string, d.to as string, d.from as string | undefined))
    ctx.hooks.register('tasks.blockTask', (d: Record<string, unknown>) => blockTask(d.identifier as string, d.reason as string, d.agent as string | undefined))
    ctx.hooks.register('tasks.addTaskLog', (d: Record<string, unknown>) => addTaskLog(d.identifier as string, d.author as string, d.message as string))
    ctx.hooks.register('tasks.updateTask', (d: Record<string, unknown>) => updateTask(d.identifier as string, d.updates as Record<string, unknown>))
    ctx.hooks.register('tasks.deleteTask', (d: Record<string, unknown>) => deleteTask(d.identifier as string))
    ctx.hooks.register('tasks.setDependency', (d: Record<string, unknown>) => setDependency(d.taskId as string, d.dependsOnId as string))
    ctx.hooks.register('tasks.clearDependency', (d: Record<string, unknown>) => clearDependency(d.taskId as string))

    // Register task API routes
    ctx.registerRoute({
      path: '/create',
      method: 'POST',
      handler: async (req: Request) => {
        const body = await req.json()
        const { title, description, column, assignee, workflowId, createdBy } = body
        if (!title) {
          return Response.json({ error: 'title required' }, { status: 400 })
        }
        try {
          const task = await createTask(title, column, assignee, description, workflowId, createdBy)
          return Response.json({ ok: true, id: task.id })
        } catch (err) {
          return Response.json({ error: String(err) }, { status: 500 })
        }
      },
    })

    ctx.registerRoute({
      path: '/move',
      method: 'POST',
      handler: async (req: Request) => {
        const body = await req.json()
        const { title, id, from, to, agent } = body
        const identifier = id || title
        if (!identifier || !to) {
          return Response.json({ error: 'title/id and to required' }, { status: 400 })
        }
        if (!agent) {
          return Response.json({ error: 'agent field required — who is moving this task?' }, { status: 400 })
        }
        try {
          await moveTaskWithEffects(identifier, to, agent, { from, channel: 'rest' })
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

    ctx.registerRoute({
      path: '/delete',
      method: 'POST',
      handler: async (req: Request) => {
        const body = await req.json()
        const { title, id } = body
        const identifier = id || title
        if (!identifier) {
          return Response.json({ error: 'title or id required' }, { status: 400 })
        }
        try {
          await deleteTask(identifier)
          return Response.json({ ok: true })
        } catch (err) {
          return Response.json({ error: String(err) }, { status: 500 })
        }
      },
    })

    ctx.registerRoute({
      path: '/assign',
      method: 'POST',
      handler: async (req: Request) => {
        const body = await req.json()
        const { title, id, agent } = body
        const identifier = id || title
        if (!identifier) {
          return Response.json({ error: 'title or id required' }, { status: 400 })
        }
        try {
          await assignTask(identifier, agent || '')
          return Response.json({ ok: true })
        } catch (err) {
          return Response.json({ error: String(err) }, { status: 500 })
        }
      },
    })

    ctx.registerRoute({
      path: '/log',
      method: 'POST',
      handler: async (req: Request) => {
        const body = await req.json()
        const { title, id, author, message } = body
        const identifier = id || title
        if (!identifier || !message) {
          return Response.json({ error: 'title/id and message required' }, { status: 400 })
        }
        try {
          await logProgress(identifier, author || 'system', message, 'rest')
          return Response.json({ ok: true })
        } catch (err) {
          return Response.json({ error: String(err) }, { status: 500 })
        }
      },
    })

    ctx.registerRoute({
      path: '/block',
      method: 'POST',
      handler: async (req: Request) => {
        const body = await req.json()
        const { title, id, reason, agent } = body
        const identifier = id || title
        if (!identifier || !reason) {
          return Response.json({ error: 'title/id and reason required' }, { status: 400 })
        }
        try {
          await blockTaskWithEffects(identifier, reason, agent || 'system', 'rest')
          return Response.json({ ok: true })
        } catch (err) {
          return Response.json({ error: String(err) }, { status: 500 })
        }
      },
    })

    ctx.registerRoute({
      path: '/update',
      method: 'POST',
      handler: async (req: Request) => {
        const body = await req.json()
        const { originalTitle, id, title, description, agent, column, workflowId } = body
        const identifier = id || originalTitle
        if (!identifier) {
          return Response.json({ error: 'originalTitle or id required' }, { status: 400 })
        }
        try {
          await updateTask(identifier, { title, description, agent, column, workflowId })
          return Response.json({ ok: true })
        } catch (err) {
          return Response.json({ error: String(err) }, { status: 500 })
        }
      },
    })

    ctx.watchFiles(['TASKBOARD.md'])
  },
}

export default tasksPlugin
