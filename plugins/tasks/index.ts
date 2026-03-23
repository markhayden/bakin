/**
 * Tasks plugin — server entry point.
 * Registers API routes for task operations.
 */
import type { MCPlugin, PluginContext } from '../../src/lib/plugin-types'
import {
  createTask,
  moveTask,
  readTaskboard,
  deleteTask,
  assignTask,
  addTaskLog,
  blockTask,
  updateTask,
} from './taskboard'
import { loadInstance } from '../workflows/runtime'
import { indexCompletedTask } from '../../src/core/antfly'
import { appendAudit } from '../../src/lib/audit'

const tasksPlugin: MCPlugin = {
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
    // Register task API routes
    ctx.registerRoute({
      path: '/create',
      method: 'POST',
      handler: async (req) => {
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
      handler: async (req) => {
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
          // Workflow done-guard: workflow tasks can only reach Done via the workflow engine
          if (to.toLowerCase() === 'done') {
            const { columns } = readTaskboard()
            for (const col of Object.values(columns)) {
              const task = (col as Array<{ id: string; title: string; workflowId?: string }>).find(
                t => t.id === identifier || t.title === identifier
              )
              if (task?.workflowId) {
                const instance = loadInstance(task.id)
                if (instance && instance.status !== 'complete') {
                  return Response.json({
                    error: 'Workflow tasks cannot be moved to Done directly. Submit step output via POST /api/plugins/workflows/step/complete — the workflow engine manages task completion.',
                  }, { status: 403 })
                }
                break
              }
            }
          }

          await moveTask(identifier, to, from)
          // Resolve title for audit/indexing (agents often only send id)
          let resolvedTitle = title
          if (!resolvedTitle && id) {
            try {
              const { columns } = readTaskboard()
              for (const col of Object.values(columns)) {
                const found = (col as Array<{ id: string; title: string }>).find(t => t.id === id)
                if (found) { resolvedTitle = found.title; break }
              }
            } catch { /* best effort */ }
          }
          appendAudit('task.moved', agent, { id, title: resolvedTitle || id, from, to })
          // When moved to done: index and trigger dependency continuation
          if (to.toLowerCase() === 'done') {
            indexCompletedTask({ id: identifier, title: resolvedTitle || identifier }).catch(() => {})
            if (id) {
              const PORT = process.env.PORT || '3737'
              fetch(`http://localhost:${PORT}/api/internal/continuation`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ completedTaskId: id, completedTitle: resolvedTitle || id }),
              }).catch((err) => {
                console.error('Continuation trigger failed from plugin move', err)
              })
            }
          }
          return Response.json({ ok: true })
        } catch (err) {
          return Response.json({ error: String(err) }, { status: 500 })
        }
      },
    })

    ctx.registerRoute({
      path: '/delete',
      method: 'POST',
      handler: async (req) => {
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
      handler: async (req) => {
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
      handler: async (req) => {
        const body = await req.json()
        const { title, id, author, message } = body
        const identifier = id || title
        if (!identifier || !message) {
          return Response.json({ error: 'title/id and message required' }, { status: 400 })
        }
        try {
          await addTaskLog(identifier, author || 'system', message)
          return Response.json({ ok: true })
        } catch (err) {
          return Response.json({ error: String(err) }, { status: 500 })
        }
      },
    })

    ctx.registerRoute({
      path: '/block',
      method: 'POST',
      handler: async (req) => {
        const body = await req.json()
        const { title, id, reason, agent } = body
        const identifier = id || title
        if (!identifier || !reason) {
          return Response.json({ error: 'title/id and reason required' }, { status: 400 })
        }
        try {
          await blockTask(identifier, reason, agent)
          return Response.json({ ok: true })
        } catch (err) {
          return Response.json({ error: String(err) }, { status: 500 })
        }
      },
    })

    ctx.registerRoute({
      path: '/update',
      method: 'POST',
      handler: async (req) => {
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
