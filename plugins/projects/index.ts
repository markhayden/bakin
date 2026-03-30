/**
 * Projects plugin — server entry point.
 * Registers API routes, exec tools, and the task-link index.
 */
import { z } from 'zod'
import type { BakinPlugin, PluginContext } from '../../src/lib/plugin-types'
import { readProject, readAllProjects, projectToSummary } from './lib/parser'
import {
  createProject,
  updateProject,
  deleteProject,
  addChecklistItem,
  markChecklistItem,
  updateChecklistItem,
  removeChecklistItem,
  linkChecklistItem,
  promoteItemToTask,
  attachAsset,
  detachAsset,
  rebuildIndex,
  resolveLinkedTaskStatuses,
} from './lib/project-service'
import { createLogger } from '../../src/core/logger'
import type { ProjectStatus } from './types'

const log = createLogger('projects')

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

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const projectsPlugin: BakinPlugin = {
  id: 'projects',
  name: 'Projects',
  version: '1.0.0',

  navItems: [
    { id: 'projects', label: 'Projects', icon: 'FolderKanban', href: '/projects', order: 30 },
  ],

  async activate(ctx: PluginContext) {
    // Build in-memory index on startup
    try {
      rebuildIndex()
    } catch (err) {
      log.error('Failed to build project index', err)
    }

    // Watch project files for index rebuilds
    ctx.watchFiles(['projects/*.md'])
    ctx.events.on('file.changed', (_event: string, data: Record<string, unknown>) => {
      const path = data.path as string | undefined
      if (path && path.startsWith('projects/') && path.endsWith('.md')) {
        rebuildIndex()
      }
    })

    // -----------------------------------------------------------------
    // API Routes
    // -----------------------------------------------------------------

    ctx.registerRoute({
      path: '/list',
      method: 'GET',
      description: 'List projects with optional status filter',
      handler: async (req: Request) => {
        const url = new URL(req.url, 'http://localhost')
        const statusFilter = url.searchParams.get('status') as ProjectStatus | null
        let projects = readAllProjects()
        if (statusFilter) {
          projects = projects.filter(p => p.status === statusFilter)
        }
        return json({ projects: projects.map(projectToSummary) })
      },
    })

    ctx.registerRoute({
      path: '/get',
      method: 'GET',
      description: 'Get a project by ID with resolved task statuses',
      handler: async (req: Request) => {
        const url = new URL(req.url, 'http://localhost')
        const id = url.searchParams.get('id')
        if (!id) return json({ error: 'Missing id parameter' }, 400)
        const project = readProject(id)
        if (!project) return json({ error: 'Project not found' }, 404)
        return json({ project: resolveLinkedTaskStatuses(project) })
      },
    })

    ctx.registerRoute({
      path: '/create',
      method: 'POST',
      description: 'Create a new project',
      handler: async (req: Request) => {
        const body = await readBody<{ title: string; body?: string; owner?: string; tasks?: string[] }>(req)
        if (!body.title) return json({ error: 'Missing title' }, 400)
        const result = await createProject(body)
        return json({ ok: true, ...result })
      },
    })

    ctx.registerRoute({
      path: '/update',
      method: 'PUT',
      description: 'Update a project',
      handler: async (req: Request) => {
        const body = await readBody<{ id: string; title?: string; status?: ProjectStatus; body?: string; owner?: string }>(req)
        if (!body.id) return json({ error: 'Missing id' }, 400)
        try {
          await updateProject(body.id, body)
          return json({ ok: true })
        } catch (err: any) {
          return json({ error: err.message }, 400)
        }
      },
    })

    ctx.registerRoute({
      path: '/delete',
      method: 'POST',
      description: 'Delete a project',
      handler: async (req: Request) => {
        const body = await readBody<{ id: string; deleteLinkedTasks?: boolean }>(req)
        if (!body.id) return json({ error: 'Missing id' }, 400)
        try {
          // If requested, delete linked board tasks before deleting the project
          if (body.deleteLinkedTasks) {
            const project = readProject(body.id)
            if (project) {
              const { deleteTask } = await import('../../plugins/tasks/taskboard')
              for (const item of project.tasks) {
                if (item.taskId) {
                  try { await deleteTask(item.taskId) } catch { /* task may already be gone */ }
                }
              }
            }
          }
          await deleteProject(body.id)
          return json({ ok: true })
        } catch (err: any) {
          return json({ error: err.message }, 400)
        }
      },
    })

    ctx.registerRoute({
      path: '/checklist/add',
      method: 'POST',
      description: 'Add a checklist item to a project',
      handler: async (req: Request) => {
        const body = await readBody<{ projectId: string; title: string }>(req)
        if (!body.projectId || !body.title) return json({ error: 'Missing projectId or title' }, 400)
        const result = await addChecklistItem(body.projectId, body.title)
        return json({ ok: true, ...result })
      },
    })

    ctx.registerRoute({
      path: '/checklist/toggle',
      method: 'POST',
      description: 'Mark a checklist item as checked or unchecked',
      handler: async (req: Request) => {
        const body = await readBody<{ projectId: string; taskItemId: string; checked: boolean }>(req)
        if (!body.projectId || !body.taskItemId) return json({ error: 'Missing projectId or taskItemId' }, 400)
        const result = await markChecklistItem(body.projectId, body.taskItemId, body.checked)
        return json({ ok: true, ...result })
      },
    })

    ctx.registerRoute({
      path: '/checklist/update',
      method: 'POST',
      description: 'Update a checklist item title or description',
      handler: async (req: Request) => {
        const body = await readBody<{ projectId: string; taskItemId: string; title?: string; description?: string }>(req)
        if (!body.projectId || !body.taskItemId) return json({ error: 'Missing projectId or taskItemId' }, 400)
        await updateChecklistItem(body.projectId, body.taskItemId, { title: body.title, description: body.description })
        return json({ ok: true })
      },
    })

    ctx.registerRoute({
      path: '/checklist/remove',
      method: 'POST',
      description: 'Remove a checklist item',
      handler: async (req: Request) => {
        const body = await readBody<{ projectId: string; taskItemId: string }>(req)
        if (!body.projectId || !body.taskItemId) return json({ error: 'Missing projectId or taskItemId' }, 400)
        await removeChecklistItem(body.projectId, body.taskItemId)
        return json({ ok: true })
      },
    })

    ctx.registerRoute({
      path: '/checklist/link',
      method: 'POST',
      description: 'Link a checklist item to an existing board task',
      handler: async (req: Request) => {
        const body = await readBody<{ projectId: string; taskItemId: string; taskId: string }>(req)
        if (!body.projectId || !body.taskItemId || !body.taskId) return json({ error: 'Missing required fields' }, 400)
        await linkChecklistItem(body.projectId, body.taskItemId, body.taskId)
        return json({ ok: true })
      },
    })

    ctx.registerRoute({
      path: '/checklist/promote',
      method: 'POST',
      description: 'Create a board task from a checklist item and auto-link it',
      handler: async (req: Request) => {
        const body = await readBody<{ projectId: string; taskItemId: string; assignee?: string }>(req)
        if (!body.projectId || !body.taskItemId) return json({ error: 'Missing projectId or taskItemId' }, 400)
        const result = await promoteItemToTask(body.projectId, body.taskItemId, { assignee: body.assignee })
        return json({ ok: true, ...result })
      },
    })

    ctx.registerRoute({
      path: '/assets/attach',
      method: 'POST',
      description: 'Attach an asset to a project',
      handler: async (req: Request) => {
        const body = await readBody<{ projectId: string; assetPath: string; label?: string }>(req)
        if (!body.projectId || !body.assetPath) return json({ error: 'Missing projectId or assetPath' }, 400)
        await attachAsset(body.projectId, body.assetPath, body.label)
        return json({ ok: true })
      },
    })

    ctx.registerRoute({
      path: '/assets/detach',
      method: 'POST',
      description: 'Detach an asset from a project',
      handler: async (req: Request) => {
        const body = await readBody<{ projectId: string; assetPath: string }>(req)
        if (!body.projectId || !body.assetPath) return json({ error: 'Missing projectId or assetPath' }, 400)
        await detachAsset(body.projectId, body.assetPath)
        return json({ ok: true })
      },
    })

    ctx.registerRoute({
      path: '/ask',
      method: 'POST',
      description: 'Send a prompt to the main agent with project context',
      handler: async (req: Request) => {
        const body = await readBody<{
          projectId: string
          prompt: string
          agent?: string
          history?: Array<{ role: 'user' | 'agent'; content: string }>
        }>(req)
        if (!body.projectId || !body.prompt) return json({ error: 'Missing projectId or prompt' }, 400)
        const project = readProject(body.projectId)
        if (!project) return json({ error: 'Project not found' }, 404)

        const assetLines = project.assets.length > 0
          ? ['', 'Attached assets (summaries — use asset tools to read full content if needed):', ...project.assets.map(a => `- ${a.path}${a.label ? ` — ${a.label}` : ''}`)]
          : []

        // Build conversation history section
        const historyLines: string[] = []
        if (body.history && body.history.length > 0) {
          historyLines.push('', 'Previous conversation in this brainstorm session:')
          for (const msg of body.history) {
            historyLines.push(msg.role === 'user' ? `User: ${msg.content}` : `Assistant: ${msg.content}`)
          }
          historyLines.push('')
        }

        const context = [
          `You are being asked about project "${project.title}" (id: ${project.id}, status: ${project.status}).`,
          `Progress: ${project.progress}% (${project.tasks.filter(t => t.checked).length}/${project.tasks.length} items checked)`,
          '',
          'Project spec:',
          project.body.slice(0, 3000),
          '',
          'Checklist items:',
          ...project.tasks.map(t => `- [${t.checked ? 'x' : ' '}] ${t.title}${t.taskId ? ` (linked: ${t.taskId})` : ''}`),
          ...assetLines,
          ...historyLines,
          'User request:',
          body.prompt,
          '',
          'Respond concisely. If suggesting tasks, format them as a numbered list.',
        ].join('\n')

        try {
          const { sendMessage } = await import('../../src/core/openclaw-client')
          const agentId = body.agent || 'main'
          const reply = await sendMessage(agentId, context)
          return json({ ok: true, reply })
        } catch (err: any) {
          log.error('Agent ask failed', err)
          return json({ error: err.message || 'Failed to reach agent' }, 500)
        }
      },
    })

    // -----------------------------------------------------------------
    // MCP Exec Tools
    // -----------------------------------------------------------------

    ctx.registerExecTool({
      name: 'bakin_exec_project_list',
      description: 'List all projects with optional status filter. Returns summaries with id, title, status, progress, taskCount.',
      parameters: {
        status: z.enum(['draft', 'active', 'completed', 'archived']).optional().describe('Filter by status'),
      },
      handler: async (params: Record<string, unknown>) => {
        let projects = readAllProjects()
        if (params.status) {
          projects = projects.filter(p => p.status === params.status)
        }
        return { ok: true, projects: projects.map(projectToSummary) }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_project_get',
      description: 'Get a project by ID including full spec, checklist, progress, and linked board task statuses.',
      parameters: {
        projectId: z.string().describe('Project ID'),
      },
      handler: async (params: Record<string, unknown>) => {
        const project = readProject(params.projectId as string)
        if (!project) return { ok: false, error: `Project not found: ${params.projectId}` }
        return { ok: true, project: resolveLinkedTaskStatuses(project) }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_project_create',
      description: 'Create a new project with title, markdown body, and optional initial checklist items. Returns project ID and generated task item IDs.',
      parameters: {
        title: z.string().describe('Project title'),
        body: z.string().optional().describe('Markdown body (spec/plan)'),
        owner: z.string().optional().describe('Project owner'),
        tasks: z.array(z.string()).optional().describe('Initial checklist item titles'),
      },
      handler: async (params: Record<string, unknown>, agent: string) => {
        const result = await createProject({
          title: params.title as string,
          body: params.body as string | undefined,
          owner: (params.owner as string) || agent,
          tasks: params.tasks as string[] | undefined,
        })
        return { ok: true, ...result }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_project_update',
      description: 'Update a project\'s title, status, body, or owner. Cannot set status to "completed" if unchecked items remain.',
      parameters: {
        projectId: z.string().describe('Project ID'),
        title: z.string().optional().describe('New title'),
        status: z.enum(['draft', 'active', 'completed', 'archived']).optional().describe('New status'),
        body: z.string().optional().describe('New markdown body'),
        owner: z.string().optional().describe('New owner'),
      },
      handler: async (params: Record<string, unknown>, agent: string) => {
        try {
          await updateProject(params.projectId as string, {
            title: params.title as string | undefined,
            status: params.status as ProjectStatus | undefined,
            body: params.body as string | undefined,
            owner: params.owner as string | undefined,
          }, agent)
          return { ok: true }
        } catch (err: any) {
          return { ok: false, error: err.message }
        }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_project_delete',
      description: 'Delete a project by ID.',
      parameters: {
        projectId: z.string().describe('Project ID'),
      },
      handler: async (params: Record<string, unknown>, agent: string) => {
        try {
          await deleteProject(params.projectId as string, agent)
          return { ok: true }
        } catch (err: any) {
          return { ok: false, error: err.message }
        }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_project_add_item',
      description: 'Add a new checklist item to a project.',
      parameters: {
        projectId: z.string().describe('Project ID'),
        title: z.string().describe('Checklist item title'),
      },
      handler: async (params: Record<string, unknown>) => {
        const result = await addChecklistItem(params.projectId as string, params.title as string)
        return { ok: true, ...result }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_project_mark_item',
      description: 'Mark a checklist item as checked (done) or unchecked. Returns updated progress percentage.',
      parameters: {
        projectId: z.string().describe('Project ID'),
        taskItemId: z.string().describe('Checklist item ID (e.g., t001)'),
        checked: z.boolean().describe('true to mark as done, false to uncheck'),
      },
      handler: async (params: Record<string, unknown>) => {
        const result = await markChecklistItem(
          params.projectId as string,
          params.taskItemId as string,
          params.checked as boolean,
        )
        return { ok: true, ...result }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_project_remove_item',
      description: 'Remove a checklist item from a project.',
      parameters: {
        projectId: z.string().describe('Project ID'),
        taskItemId: z.string().describe('Checklist item ID to remove'),
      },
      handler: async (params: Record<string, unknown>) => {
        try {
          await removeChecklistItem(params.projectId as string, params.taskItemId as string)
          return { ok: true }
        } catch (err: any) {
          return { ok: false, error: err.message }
        }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_project_link_item',
      description: 'Link an existing board task to a project checklist item. Use this when a task was created separately and should be associated with a project.',
      parameters: {
        projectId: z.string().describe('Project ID'),
        taskItemId: z.string().describe('Checklist item ID'),
        taskId: z.string().describe('Board task ID to link'),
      },
      handler: async (params: Record<string, unknown>) => {
        try {
          await linkChecklistItem(
            params.projectId as string,
            params.taskItemId as string,
            params.taskId as string,
          )
          return { ok: true }
        } catch (err: any) {
          return { ok: false, error: err.message }
        }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_project_promote_item',
      description: 'Create a NEW board task from a project checklist item and automatically link it. The task appears on the task board with the item title and projectId set.',
      parameters: {
        projectId: z.string().describe('Project ID'),
        taskItemId: z.string().describe('Checklist item ID to promote to a board task'),
        assignee: z.string().optional().describe('Agent to assign the task to'),
      },
      handler: async (params: Record<string, unknown>) => {
        try {
          const result = await promoteItemToTask(
            params.projectId as string,
            params.taskItemId as string,
            { assignee: params.assignee as string | undefined },
          )
          return { ok: true, ...result }
        } catch (err: any) {
          return { ok: false, error: err.message }
        }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_project_attach_asset',
      description: 'Attach an existing asset to a project. Assets provide additional context (specs, designs, docs) that agents can reference. Only summaries are included in project_get — use asset tools to read full content when needed.',
      parameters: {
        projectId: z.string().describe('Project ID'),
        assetPath: z.string().describe('Relative asset path (e.g., "assets/text/task-abc/spec.md")'),
        label: z.string().optional().describe('Human-readable label or summary of what this asset contains'),
      },
      handler: async (params: Record<string, unknown>) => {
        try {
          await attachAsset(params.projectId as string, params.assetPath as string, params.label as string | undefined)
          return { ok: true }
        } catch (err: any) {
          return { ok: false, error: err.message }
        }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_project_detach_asset',
      description: 'Remove an asset reference from a project. Does not delete the asset itself.',
      parameters: {
        projectId: z.string().describe('Project ID'),
        assetPath: z.string().describe('Asset path to detach'),
      },
      handler: async (params: Record<string, unknown>) => {
        try {
          await detachAsset(params.projectId as string, params.assetPath as string)
          return { ok: true }
        } catch (err: any) {
          return { ok: false, error: err.message }
        }
      },
    })

    log.info('Projects plugin activated')
  },
}

export default projectsPlugin
