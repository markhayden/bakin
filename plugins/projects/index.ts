/**
 * Projects plugin — server entry point.
 * Registers API routes, exec tools, and the task-link index.
 */
import { z } from 'zod'
import type { BakinPlugin, PluginContext, RuntimeAgent } from '@bakin/sdk/types'
import { createProjectRepository, projectToSummary } from './lib/parser'
import { createProjectService } from './lib/project-service'
import type { Project, ProjectStatus } from './types'

const log = {
  info: (...args: unknown[]) => console.info('[projects]', ...args),
  warn: (...args: unknown[]) => console.warn('[projects]', ...args),
  error: (...args: unknown[]) => console.error('[projects]', ...args),
}

let activeProjectRepository: ReturnType<typeof createProjectRepository> | null = null

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

async function getRuntimeMainAgentId(ctx: PluginContext): Promise<string> {
  const agents = await ctx.runtime.agents.list()
  const main = agents.find((agent: RuntimeAgent) => agent.metadata?.main === true)
    ?? agents.find((agent: RuntimeAgent) => agent.id === 'main')
    ?? agents[0]
  return main?.id ?? 'main'
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const projectsPlugin: BakinPlugin = {
  id: 'projects',
  name: 'Projects',
  version: '2.0.0',

  settingsSchema: {
    fields: [
      { key: 'defaultStatus', type: 'select', label: 'Default project status', description: 'Status assigned to new projects', options: [{ value: 'active', label: 'Active' }, { value: 'planning', label: 'Planning' }, { value: 'paused', label: 'Paused' }], default: 'active' },
      { key: 'autoPromoteThreshold', type: 'number', label: 'Auto-promote threshold', description: 'Auto-promote checklist items to tasks when project has more than N unchecked items (0 = disabled)', default: 0 },
    ],
  },

  navItems: [
    { id: 'projects', label: 'Projects', icon: 'FolderKanban', href: '/projects', order: 30 },
  ],

  async activate(ctx: PluginContext) {
    const repo = createProjectRepository(ctx.storage)
    activeProjectRepository = repo
    const projectService = createProjectService(ctx, repo)
    const {
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
      autoCheckLinkedItem,
    } = projectService
    const readProject = repo.readProject
    const readAllProjects = repo.readAllProjects

    // ─── Search Content Type Registration ─────────────────────────────

    /** Convert a project to a search document */
    function projectToSearchDoc(project: Project): Record<string, unknown> {
      return {
        title: project.title,
        body: project.body,
        status: project.status,
        progress: project.progress,
        updated_at: project.updated || new Date().toISOString(),
      }
    }

    ctx.search.registerFileBackedContentType({
      table: 'projects',
      schema: {
        title: { type: 'text' },
        body: { type: 'text' },
        status: { type: 'keyword' },
        progress: { type: 'number' },
        updated_at: { type: 'datetime' },
      },
      searchableFields: ['title', 'body'],
      rerankField: 'body',
      embeddingTemplate: '{{title}} {{body}}',
      facets: ['status'],
      chunker: { enabled: true, targetTokens: 200, overlapTokens: 25 },
      filePatterns: [
        {
          pattern: repo.projectsGlob(),
          fileToId: (rel) => rel.replace(/^projects\//, '').replace(/\.md$/, ''),
          fileToDoc: async (rel) => {
            const id = rel.split('/').pop()?.replace(/\.md$/, '') ?? ''
            const project = readProject(id)
            return project ? projectToSearchDoc(project) : null
          },
        },
      ],
      reindex: async function* () {
        const projects = readAllProjects()
        for (const project of projects) {
          yield { key: project.id, doc: projectToSearchDoc(project) }
        }
      },
      verifyExists: async (key: string) => {
        return ctx.storage.exists(repo.projectStoragePath(key))
      },
    })

    /** Index a project by looking it up and indexing its current state */
    async function indexProject(projectId: string): Promise<void> {
      try {
        const project = readProject(projectId)
        if (project) {
          await ctx.search.index(projectId, projectToSearchDoc(project))
        }
      } catch (err) {
        log.warn('Failed to index project', { projectId, error: err instanceof Error ? err.message : String(err) })
      }
    }

    // Register cross-plugin hooks
    ctx.hooks.register('projects.readProject', (d: unknown) => readProject((d as Record<string, unknown>).id as string))
    ctx.hooks.register('projects.autoCheckLinkedItem', (d: unknown) => autoCheckLinkedItem((d as Record<string, unknown>).boardTaskId as string))

    // Build in-memory index on startup
    try {
      rebuildIndex()
    } catch (err) {
      log.error('Failed to build project index', err)
    }

    // Watch project files for index rebuilds
    ctx.watchFiles([repo.projectsGlob()])
    ctx.events.on('file.changed', (_event: string, data: Record<string, unknown>) => {
      const path = data.path as string | undefined
      if (path && path.includes('projects/') && path.endsWith('.md')) {
        rebuildIndex()
      }
    })

    // -----------------------------------------------------------------
    // API Routes (RESTful + aliases for old paths)
    // -----------------------------------------------------------------

    // GET / — list projects
    const listHandler = async (req: Request) => {
      const url = new URL(req.url, 'http://localhost')
      const statusFilter = url.searchParams.get('status') as ProjectStatus | null
      let projects = readAllProjects()
      if (statusFilter) projects = projects.filter(p => p.status === statusFilter)
      return json({ projects: projects.map(projectToSummary) })
    }
    ctx.registerRoute({ path: '/', method: 'GET', description: 'List projects', handler: listHandler })

    // GET /:projectId — get single project
    const getHandler = async (req: Request) => {
      const url = new URL(req.url, 'http://localhost')
      const id = url.searchParams.get('projectId') || url.searchParams.get('id')
      if (!id) return json({ error: 'Missing id parameter' }, 400)
      const project = readProject(id)
      if (!project) return json({ error: 'Project not found' }, 404)
      return json({ project: await resolveLinkedTaskStatuses(project) })
    }
    ctx.registerRoute({ path: '/:projectId', method: 'GET', description: 'Get project by ID', handler: getHandler })

    // POST / — create project
    const createHandler = async (req: Request) => {
      const body = await readBody<{ title: string; body?: string; owner?: string; tasks?: string[] }>(req)
      if (!body.title) return json({ error: 'Missing title' }, 400)
      const owner = body.owner ?? await getRuntimeMainAgentId(ctx)
      const result = await createProject({ ...body, owner })
      ctx.activity.audit('created', owner, { projectId: result.id, title: body.title })
      ctx.activity.log(owner, `Created project "${body.title}"`)
      indexProject(result.id).catch(() => {})
      return json({ ok: true, ...result })
    }
    ctx.registerRoute({ path: '/', method: 'POST', description: 'Create project', handler: createHandler })

    // PUT /:projectId — update project
    const updateHandler = async (req: Request) => {
      const url = new URL(req.url, 'http://localhost')
      const body = await readBody<{ id?: string; title?: string; status?: ProjectStatus; body?: string; owner?: string }>(req)
      const id = url.searchParams.get('projectId') || body.id
      if (!id) return json({ error: 'Missing id' }, 400)
      try {
        await updateProject(id, body)
        ctx.activity.audit('updated', 'system', { projectId: id })
        ctx.activity.log('system', `Updated project ${id}`)
        indexProject(id).catch(() => {})
        return json({ ok: true })
      } catch (err: unknown) {
        return json({ error: (err as Error).message }, 400)
      }
    }
    ctx.registerRoute({ path: '/:projectId', method: 'PUT', description: 'Update project', handler: updateHandler })

    // DELETE /:projectId — delete project
    const deleteHandler = async (req: Request) => {
      const url = new URL(req.url, 'http://localhost')
      const body = await readBody<{ id?: string; deleteLinkedTasks?: boolean }>(req).catch(() => ({} as { id?: string; deleteLinkedTasks?: boolean }))
      const id = url.searchParams.get('projectId') || body.id
      if (!id) return json({ error: 'Missing id' }, 400)
      try {
        if (body.deleteLinkedTasks) {
          const project = readProject(id)
          if (project) {
            for (const item of project.tasks) {
              if (item.taskId) {
                try { await ctx.tasks.remove(item.taskId) } catch { /* task may already be gone */ }
              }
            }
          }
        }
        await deleteProject(id)
        ctx.activity.audit('deleted', 'system', { projectId: id })
        ctx.activity.log('system', `Deleted project ${id}`)
        ctx.search.remove(id).catch(() => {})
        return json({ ok: true })
      } catch (err: unknown) {
        return json({ error: (err as Error).message }, 400)
      }
    }
    ctx.registerRoute({ path: '/:projectId', method: 'DELETE', description: 'Delete project', handler: deleteHandler })

    // POST /:projectId/checklist — add checklist item
    const addItemHandler = async (req: Request) => {
      const url = new URL(req.url, 'http://localhost')
      const body = await readBody<{ projectId?: string; title: string }>(req)
      const projectId = url.searchParams.get('projectId') || body.projectId
      if (!projectId || !body.title) return json({ error: 'Missing projectId or title' }, 400)
      const result = await addChecklistItem(projectId, body.title)
      ctx.activity.audit('checklist.added', 'system', { projectId })
      ctx.activity.log('system', `Added checklist item to project ${projectId}`)
      indexProject(projectId).catch(() => {})
      return json({ ok: true, ...result })
    }
    ctx.registerRoute({ path: '/:projectId/checklist', method: 'POST', description: 'Add checklist item', handler: addItemHandler })

    // PUT /:projectId/checklist/:itemId/toggle — toggle checklist item
    const toggleHandler = async (req: Request) => {
      const url = new URL(req.url, 'http://localhost')
      const body = await readBody<{ projectId?: string; taskItemId?: string; checked: boolean }>(req)
      const projectId = url.searchParams.get('projectId') || body.projectId
      const taskItemId = url.searchParams.get('itemId') || body.taskItemId
      if (!projectId || !taskItemId) return json({ error: 'Missing projectId or taskItemId' }, 400)
      const result = await markChecklistItem(projectId, taskItemId, body.checked)
      ctx.activity.audit('checklist.toggled', 'system', { projectId, checked: body.checked })
      ctx.activity.log('system', 'Toggled checklist item in project', { taskId: projectId })
      indexProject(projectId).catch(() => {})
      return json({ ok: true, ...result })
    }
    ctx.registerRoute({ path: '/:projectId/checklist/:itemId/toggle', method: 'PUT', description: 'Toggle checklist item', handler: toggleHandler })

    // PUT /:projectId/checklist/:itemId — update checklist item
    const updateItemHandler = async (req: Request) => {
      const url = new URL(req.url, 'http://localhost')
      const body = await readBody<{ projectId?: string; taskItemId?: string; title?: string; description?: string }>(req)
      const projectId = url.searchParams.get('projectId') || body.projectId
      const taskItemId = url.searchParams.get('itemId') || body.taskItemId
      if (!projectId || !taskItemId) return json({ error: 'Missing projectId or taskItemId' }, 400)
      await updateChecklistItem(projectId, taskItemId, { title: body.title, description: body.description })
      ctx.activity.audit('checklist.updated', 'system', { projectId })
      ctx.activity.log('system', 'Updated checklist item in project', { taskId: projectId })
      indexProject(projectId).catch(() => {})
      return json({ ok: true })
    }
    ctx.registerRoute({ path: '/:projectId/checklist/:itemId', method: 'PUT', description: 'Update checklist item', handler: updateItemHandler })

    // DELETE /:projectId/checklist/:itemId — remove checklist item
    const removeItemHandler = async (req: Request) => {
      const url = new URL(req.url, 'http://localhost')
      const body = await readBody<{ projectId?: string; taskItemId?: string }>(req).catch(() => ({} as { projectId?: string; taskItemId?: string }))
      const projectId = url.searchParams.get('projectId') || body.projectId
      const taskItemId = url.searchParams.get('itemId') || body.taskItemId
      if (!projectId || !taskItemId) return json({ error: 'Missing projectId or taskItemId' }, 400)
      await removeChecklistItem(projectId, taskItemId)
      ctx.activity.audit('checklist.removed', 'system', { projectId })
      ctx.activity.log('system', 'Removed checklist item from project', { taskId: projectId })
      indexProject(projectId).catch(() => {})
      return json({ ok: true })
    }
    ctx.registerRoute({ path: '/:projectId/checklist/:itemId', method: 'DELETE', description: 'Remove checklist item', handler: removeItemHandler })

    // POST /:projectId/checklist/:itemId/link — link to board task
    const linkHandler = async (req: Request) => {
      const url = new URL(req.url, 'http://localhost')
      const body = await readBody<{ projectId?: string; taskItemId?: string; taskId: string }>(req)
      const projectId = url.searchParams.get('projectId') || body.projectId
      const taskItemId = url.searchParams.get('itemId') || body.taskItemId
      if (!projectId || !taskItemId || !body.taskId) return json({ error: 'Missing required fields' }, 400)
      await linkChecklistItem(projectId, taskItemId, body.taskId)
      ctx.activity.audit('checklist.linked', 'system', { projectId, taskId: body.taskId })
      ctx.activity.log('system', 'Linked checklist item to task', { taskId: projectId })
      indexProject(projectId).catch(() => {})
      return json({ ok: true })
    }
    ctx.registerRoute({ path: '/:projectId/checklist/:itemId/link', method: 'POST', description: 'Link checklist item to task', handler: linkHandler })

    // POST /:projectId/checklist/:itemId/promote — promote to board task
    const promoteHandler = async (req: Request) => {
      const url = new URL(req.url, 'http://localhost')
      const body = await readBody<{ projectId?: string; taskItemId?: string; assignee?: string }>(req)
      const projectId = url.searchParams.get('projectId') || body.projectId
      const taskItemId = url.searchParams.get('itemId') || body.taskItemId
      if (!projectId || !taskItemId) return json({ error: 'Missing projectId or taskItemId' }, 400)
      const result = await promoteItemToTask(projectId, taskItemId, { assignee: body.assignee })
      ctx.activity.audit('checklist.promoted', 'system', { projectId })
      ctx.activity.log('system', `Promoted checklist item to task in project ${projectId}`)
      indexProject(projectId).catch(() => {})
      return json({ ok: true, ...result })
    }
    ctx.registerRoute({ path: '/:projectId/checklist/:itemId/promote', method: 'POST', description: 'Promote item to task', handler: promoteHandler })

    // POST /:projectId/assets — attach asset
    const attachHandler = async (req: Request) => {
      const url = new URL(req.url, 'http://localhost')
      const body = await readBody<{ projectId?: string; filename?: string; label?: string }>(req)
      const projectId = url.searchParams.get('projectId') || body.projectId
      if (!projectId || !body.filename) return json({ error: 'Missing projectId or filename' }, 400)
      await attachAsset(projectId, body.filename, body.label)
      ctx.activity.audit('asset.attached', 'system', { projectId, filename: body.filename })
      ctx.activity.log('system', 'Attached asset to project', { taskId: projectId })
      indexProject(projectId).catch(() => {})
      return json({ ok: true })
    }
    ctx.registerRoute({ path: '/:projectId/assets', method: 'POST', description: 'Attach asset', handler: attachHandler })

    // DELETE /:projectId/assets/:filename — detach asset
    const detachHandler = async (req: Request) => {
      const url = new URL(req.url, 'http://localhost')
      const body = await readBody<{ projectId?: string; filename?: string }>(req).catch(() => ({} as { projectId?: string; filename?: string }))
      const projectId = url.searchParams.get('projectId') || body.projectId
      const filename = url.searchParams.get('filename') || body.filename
      if (!projectId || !filename) return json({ error: 'Missing projectId or filename' }, 400)
      await detachAsset(projectId, filename)
      ctx.activity.audit('asset.detached', 'system', { projectId, filename })
      ctx.activity.log('system', 'Detached asset from project', { taskId: projectId })
      indexProject(projectId).catch(() => {})
      return json({ ok: true })
    }
    ctx.registerRoute({ path: '/:projectId/assets/:filename', method: 'DELETE', description: 'Detach asset', handler: detachHandler })

    // POST /:projectId/ask — agent brainstorm (SSE stream)
    ctx.registerRoute({ path: '/:projectId/ask', method: 'POST', description: 'Ask agent about project (streams tokens via SSE)', handler: async (req: Request) => {
        const body = await readBody<{
          projectId: string
          prompt: string
          agent?: string
          history?: Array<{ role: 'user' | 'agent' | 'assistant'; content: string }>
        }>(req)
        if (!body.projectId || !body.prompt) return json({ error: 'Missing projectId or prompt' }, 400)
        const project = readProject(body.projectId)
        if (!project) return json({ error: 'Project not found' }, 404)

        const assetLines = project.assets.length > 0
          ? ['', 'Attached assets (summaries — use asset tools to read full content if needed):', ...project.assets.map(a => `- ${a.filename}${a.label ? ` — ${a.label}` : ''}`)]
          : []

        const historyLines: string[] = []
        if (body.history && body.history.length > 0) {
          historyLines.push('', 'Previous conversation in this brainstorm session:')
          for (const msg of body.history) {
            const speaker = msg.role === 'user' ? 'User' : 'Assistant'
            historyLines.push(`${speaker}: ${msg.content}`)
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

        const agentId = body.agent || await getRuntimeMainAgentId(ctx)
        const sessionKey = `projects-${body.projectId}-${Date.now()}`

        const stream = new ReadableStream({
          async start(controller) {
            const encoder = new TextEncoder()
            function send(event: string, data: unknown): void {
              controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
            }

            let fullContent = ''
            let useStreaming = true
            let chunks: AsyncIterable<{ type: string; content?: string }> | undefined

            try {
              chunks = ctx.runtime.messaging.stream({
                agentId,
                content: context,
                threadId: sessionKey,
              })
            } catch (err) {
              // Fall back to one-shot runtime messaging below. Log at warn level
              // so a real runtime transport outage is still debuggable.
              log.warn('runtime stream failed, falling back to runtime send', {
                error: err instanceof Error ? err.message : String(err),
                agentId,
              })
              useStreaming = false
            }

            try {
              if (useStreaming && chunks) {
                for await (const chunk of chunks) {
                  if (chunk.type === 'text' && chunk.content) {
                    fullContent += chunk.content
                    send('token', { text: chunk.content })
                  } else if (chunk.type === 'error') {
                    throw new Error(chunk.content ?? 'Runtime stream error')
                  }
                }
              } else {
                const result = await ctx.runtime.messaging.send({
                  agentId,
                  content: context,
                  threadId: sessionKey,
                })
                fullContent = result.content ?? ''
                if (fullContent) send('token', { text: fullContent })
              }
              send('done', { content: fullContent })
            } catch (err: unknown) {
              log.error('Agent ask failed', err)
              send('error', { message: err instanceof Error ? err.message : String(err) })
            } finally {
              controller.close()
            }
          },
        })

        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          },
        })
      },
    })

    // -----------------------------------------------------------------
    // MCP Exec Tools
    // -----------------------------------------------------------------

    ctx.registerExecTool({
      name: 'bakin_exec_project_list',
      label: 'Listed projects',
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
      label: 'Read project details',
      description: 'Get a project by ID including full spec, checklist, progress, and linked board task statuses.',
      parameters: {
        projectId: z.string().describe('Project ID'),
      },
      handler: async (params: Record<string, unknown>) => {
        const project = readProject(params.projectId as string)
        if (!project) return { ok: false, error: `Project not found: ${params.projectId}` }
        return { ok: true, project: await resolveLinkedTaskStatuses(project) }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_project_create',
      label: 'Created a project',
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
        indexProject(result.id).catch(() => {})
        return { ok: true, ...result }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_project_update',
      label: 'Updated a project',
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
          indexProject(params.projectId as string).catch(() => {})
          return { ok: true }
        } catch (err: unknown) {
          return { ok: false, error: (err as Error).message }
        }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_project_delete',
      label: 'Deleted a project',
      description: 'Delete a project by ID.',
      parameters: {
        projectId: z.string().describe('Project ID'),
      },
      handler: async (params: Record<string, unknown>, agent: string) => {
        try {
          await deleteProject(params.projectId as string, agent)
          ctx.search.remove(params.projectId as string).catch(() => {})
          return { ok: true }
        } catch (err: unknown) {
          return { ok: false, error: (err as Error).message }
        }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_project_add_item',
      label: 'Added project item',
      description: 'Add a new checklist item to a project.',
      parameters: {
        projectId: z.string().describe('Project ID'),
        title: z.string().describe('Checklist item title'),
      },
      handler: async (params: Record<string, unknown>) => {
        const result = await addChecklistItem(params.projectId as string, params.title as string)
        indexProject(params.projectId as string).catch(() => {})
        return { ok: true, ...result }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_project_mark_item',
      label: 'Marked project item',
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
        indexProject(params.projectId as string).catch(() => {})
        return { ok: true, ...result }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_project_remove_item',
      label: 'Removed project item',
      description: 'Remove a checklist item from a project.',
      parameters: {
        projectId: z.string().describe('Project ID'),
        taskItemId: z.string().describe('Checklist item ID to remove'),
      },
      handler: async (params: Record<string, unknown>) => {
        try {
          await removeChecklistItem(params.projectId as string, params.taskItemId as string)
          indexProject(params.projectId as string).catch(() => {})
          return { ok: true }
        } catch (err: unknown) {
          return { ok: false, error: (err as Error).message }
        }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_project_link_item',
      label: 'Linked project item',
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
          indexProject(params.projectId as string).catch(() => {})
          return { ok: true }
        } catch (err: unknown) {
          return { ok: false, error: (err as Error).message }
        }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_project_promote_item',
      label: 'Promoted project item',
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
          indexProject(params.projectId as string).catch(() => {})
          return { ok: true, ...result }
        } catch (err: unknown) {
          return { ok: false, error: (err as Error).message }
        }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_project_attach_asset',
      label: 'Attached asset to project',
      description: 'Attach an existing asset to a project by filename. Assets provide additional context (specs, designs, docs) that agents can reference. Only summaries are included in project_get — use asset tools to read full content when needed.',
      parameters: {
        projectId: z.string().describe('Project ID'),
        filename: z.string().describe('Asset filename (e.g., "20260327-hero-a1b2c3d4.png") — globally unique, stable across retype/relink'),
        label: z.string().optional().describe('Human-readable label or summary of what this asset contains'),
      },
      handler: async (params: Record<string, unknown>) => {
        try {
          await attachAsset(params.projectId as string, params.filename as string, params.label as string | undefined)
          indexProject(params.projectId as string).catch(() => {})
          return { ok: true }
        } catch (err: unknown) {
          return { ok: false, error: (err as Error).message }
        }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_project_detach_asset',
      label: 'Detached asset from project',
      description: 'Remove an asset reference from a project by filename. Does not delete the asset itself.',
      parameters: {
        projectId: z.string().describe('Project ID'),
        filename: z.string().describe('Asset filename to detach'),
      },
      handler: async (params: Record<string, unknown>) => {
        try {
          await detachAsset(params.projectId as string, params.filename as string)
          indexProject(params.projectId as string).catch(() => {})
          return { ok: true }
        } catch (err: unknown) {
          return { ok: false, error: (err as Error).message }
        }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_project_toggle_item',
      label: 'Toggled project item',
      activityDuplicate: true,
      description: 'Toggle a checklist item checked/unchecked by item ID. Returns updated progress percentage.',
      parameters: {
        projectId: z.string().describe('Project ID'),
        itemId: z.string().describe('Checklist item ID (e.g., t001)'),
        checked: z.boolean().describe('true to mark as done, false to uncheck'),
      },
      handler: async (params: Record<string, unknown>) => {
        const projectId = params.projectId as string
        const itemId = params.itemId as string
        const checked = params.checked as boolean
        const result = await markChecklistItem(projectId, itemId, checked)
        ctx.activity.audit('checklist.toggled', 'system', { projectId, checked })
        indexProject(projectId).catch(() => {})
        return { ok: true, ...result }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_project_update_item',
      label: 'Updated project item',
      activityDuplicate: true,
      description: 'Update a checklist item\'s title and/or description.',
      parameters: {
        projectId: z.string().describe('Project ID'),
        itemId: z.string().describe('Checklist item ID (e.g., t001)'),
        title: z.string().optional().describe('New title for the checklist item'),
        description: z.string().optional().describe('New description for the checklist item'),
      },
      handler: async (params: Record<string, unknown>) => {
        const projectId = params.projectId as string
        const itemId = params.itemId as string
        try {
          await updateChecklistItem(projectId, itemId, {
            title: params.title as string | undefined,
            description: params.description as string | undefined,
          })
          ctx.activity.audit('checklist.updated', 'system', { projectId })
          indexProject(projectId).catch(() => {})
          return { ok: true }
        } catch (err: unknown) {
          return { ok: false, error: (err as Error).message }
        }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_project_ask',
      label: 'Asked project question',
      activityDuplicate: true,
      description: 'Ask an agent a question about a project. Sends the project context (spec, checklist, assets) along with the message to the agent for brainstorming.',
      parameters: {
        projectId: z.string().describe('Project ID'),
        message: z.string().describe('Question or prompt for the agent'),
        agent: z.string().optional().describe('Agent ID to ask (defaults to main)'),
      },
      handler: async (params: Record<string, unknown>) => {
        const projectId = params.projectId as string
        const message = params.message as string
        const project = readProject(projectId)
        if (!project) return { ok: false, error: `Project not found: ${projectId}` }

        const assetLines = project.assets.length > 0
          ? ['', 'Attached assets (summaries — use asset tools to read full content if needed):', ...project.assets.map(a => `- ${a.filename}${a.label ? ` — ${a.label}` : ''}`)]
          : []

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
          '',
          'User request:',
          message,
          '',
          'Respond concisely. If suggesting tasks, format them as a numbered list.',
        ].join('\n')

        try {
          const agentId = (params.agent as string) || await getRuntimeMainAgentId(ctx)
          const result = await ctx.runtime.messaging.send({ agentId, content: context })
          const reply = result.content ?? ''
          ctx.activity.audit('project.asked', 'system', { projectId, agent: agentId })
          return { ok: true, reply }
        } catch (err: unknown) {
          log.error('Agent ask failed', err)
          return { ok: false, error: (err as Error).message || 'Failed to reach agent' }
        }
      },
    })

    log.info('Projects plugin activated')
  },

  onReady() {
    const projects = activeProjectRepository?.readAllProjects() ?? []
    const byStatus: Record<string, number> = {}
    for (const p of projects) {
      byStatus[p.status] = (byStatus[p.status] || 0) + 1
    }
    log.info(`Ready — ${projects.length} projects`, byStatus)
  },

  onShutdown() {
    activeProjectRepository = null
    log.info('Projects plugin shutting down')
  },
}

export default projectsPlugin
