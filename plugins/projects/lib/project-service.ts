/**
 * Projects plugin service layer.
 *
 * All host-owned capabilities are injected through PluginContext so this file
 * can run as an extracted official plugin without Bakin core imports.
 */
import type { PluginContext } from '@bakin/sdk/types'
import {
  type ProjectRepository,
  computeProgress,
  nextTaskItemId,
} from './parser'
import type { Project, ProjectTask, ProjectStatus } from '../types'

const log = {
  info: (...args: unknown[]) => console.info('[projects]', ...args),
  warn: (...args: unknown[]) => console.warn('[projects]', ...args),
  error: (...args: unknown[]) => console.error('[projects]', ...args),
}

function generateProjectId(): string {
  return Math.random().toString(36).slice(2, 10)
}

function getProjectLock(): { queue: Promise<void> } {
  const g = globalThis as Record<string, unknown>
  if (!g.__bakinProjectLock) g.__bakinProjectLock = { queue: Promise.resolve() }
  return g.__bakinProjectLock as { queue: Promise<void> }
}

function withProjectLock<T>(fn: () => T | Promise<T>): Promise<T> {
  const lock = getProjectLock()
  const next = lock.queue.then(fn, fn) as Promise<T>
  lock.queue = next.then(() => {}, () => {})
  return next
}

function broadcast(data: Record<string, unknown>): void {
  const fn = (globalThis as { __bakinBroadcast?: (data: Record<string, unknown>) => void }).__bakinBroadcast
  if (fn) fn(data)
}

export interface TaskLinkEntry {
  projectId: string
  taskItemId: string
}

function getIndex(): Map<string, TaskLinkEntry> {
  const g = globalThis as Record<string, unknown>
  if (!g.__bakinProjectIndex) g.__bakinProjectIndex = new Map<string, TaskLinkEntry>()
  return g.__bakinProjectIndex as Map<string, TaskLinkEntry>
}

export interface CreateProjectOpts {
  title: string
  body?: string
  owner?: string
  tasks?: string[]
}

export interface UpdateProjectOpts {
  title?: string
  status?: ProjectStatus
  body?: string
  owner?: string
}

export interface PromoteItemOpts {
  assignee?: string
  workflowId?: string
  skipWorkflowReason?: string
}

export interface ResolvedAsset {
  filename: string
  label?: string
  type: string
  description?: string
  tags?: string[]
  missing?: boolean
}

export interface ProjectService {
  rebuildIndex(): void
  getProjectForTask(boardTaskId: string): TaskLinkEntry | undefined
  getProjectTitleForTask(boardTaskId: string): string | null
  createProject(opts: CreateProjectOpts): Promise<{ id: string; taskItems: { id: string; title: string }[] }>
  updateProject(id: string, updates: UpdateProjectOpts, agent?: string): Promise<void>
  deleteProject(id: string, agent?: string): Promise<void>
  addChecklistItem(projectId: string, title: string): Promise<{ taskItemId: string }>
  markChecklistItem(projectId: string, taskItemId: string, checked: boolean): Promise<{ progress: number }>
  updateChecklistItem(projectId: string, taskItemId: string, updates: { title?: string; description?: string }): Promise<void>
  removeChecklistItem(projectId: string, taskItemId: string): Promise<void>
  linkChecklistItem(projectId: string, taskItemId: string, boardTaskId: string): Promise<void>
  attachAsset(projectId: string, filename: string, label?: string): Promise<void>
  detachAsset(projectId: string, filename: string): Promise<void>
  updateAssetLabel(projectId: string, filename: string, label: string): Promise<void>
  promoteItemToTask(projectId: string, taskItemId: string, opts?: PromoteItemOpts): Promise<{ taskId: string }>
  autoCheckLinkedItem(boardTaskId: string): Promise<void>
  autoUnlinkTask(boardTaskId: string): Promise<void>
  resolveLinkedTaskStatuses(project: Project): Promise<Project & {
    resolvedTasks: Record<string, { column: string; title: string } | null>
    resolvedAssets: ResolvedAsset[]
  }>
}

export function createProjectService(ctx: PluginContext, repo: ProjectRepository): ProjectService {
  function rebuildIndex(): void {
    const index = getIndex()
    index.clear()
    for (const project of repo.readAllProjects()) {
      for (const item of project.tasks) {
        if (item.taskId) index.set(item.taskId, { projectId: project.id, taskItemId: item.id })
      }
    }
    log.info('Project index rebuilt', { entries: index.size })
  }

  function getProjectForTask(boardTaskId: string): TaskLinkEntry | undefined {
    return getIndex().get(boardTaskId)
  }

  function getProjectTitleForTask(boardTaskId: string): string | null {
    const entry = getIndex().get(boardTaskId)
    if (!entry) return null
    return repo.readProject(entry.projectId)?.title ?? null
  }

  async function createProject(opts: CreateProjectOpts): Promise<{ id: string; taskItems: { id: string; title: string }[] }> {
    return withProjectLock(() => {
      const id = generateProjectId()
      const now = new Date().toISOString()
      const taskItems: ProjectTask[] = (opts.tasks || []).map((title, i) => ({
        id: `t${String(i + 1).padStart(3, '0')}`,
        title,
        checked: false,
      }))

      const project: Project = {
        id,
        title: opts.title,
        status: 'draft',
        created: now,
        updated: now,
        owner: opts.owner || 'main',
        tasks: taskItems,
        assets: [],
        body: opts.body || (opts.title ? `# ${opts.title}\n` : ''),
        progress: 0,
      }

      repo.writeProject(project)
      ctx.activity.audit('created', project.owner, { id, title: project.title })
      broadcast({ type: 'project.created', id, title: project.title })
      return { id, taskItems: taskItems.map(t => ({ id: t.id, title: t.title })) }
    })
  }

  async function updateProject(id: string, updates: UpdateProjectOpts, agent?: string): Promise<void> {
    return withProjectLock(() => {
      const project = repo.readProject(id)
      if (!project) throw new Error(`Project not found: ${id}`)
      if (updates.status === 'completed') {
        const unchecked = project.tasks.filter(t => !t.checked)
        if (unchecked.length > 0) throw new Error(`Cannot complete project: ${unchecked.length} unchecked items remain`)
      }
      if (updates.title !== undefined) project.title = updates.title
      if (updates.status !== undefined) project.status = updates.status
      if (updates.body !== undefined) project.body = updates.body
      if (updates.owner !== undefined) project.owner = updates.owner
      project.updated = new Date().toISOString()
      project.progress = computeProgress(project.tasks)
      repo.writeProject(project)
      ctx.activity.audit('updated', agent || project.owner, { id, ...updates })
      broadcast({ type: 'project.updated', id, title: project.title })
    })
  }

  async function deleteProject(id: string, agent?: string): Promise<void> {
    return withProjectLock(() => {
      const project = repo.readProject(id)
      if (!project) throw new Error(`Project not found: ${id}`)
      repo.deleteProjectFile(id)
      const index = getIndex()
      for (const [taskId, entry] of index) {
        if (entry.projectId === id) index.delete(taskId)
      }
      ctx.activity.audit('deleted', agent || 'system', { id, title: project.title })
      broadcast({ type: 'project.deleted', id })
    })
  }

  async function addChecklistItem(projectId: string, title: string): Promise<{ taskItemId: string }> {
    return withProjectLock(() => {
      const project = repo.readProject(projectId)
      if (!project) throw new Error(`Project not found: ${projectId}`)
      const itemId = nextTaskItemId(project.tasks)
      project.tasks.push({ id: itemId, title, checked: false })
      project.updated = new Date().toISOString()
      project.progress = computeProgress(project.tasks)
      repo.writeProject(project)
      broadcast({ type: 'project.checklist_changed', projectId, action: 'add', taskItemId: itemId })
      return { taskItemId: itemId }
    })
  }

  async function markChecklistItem(projectId: string, taskItemId: string, checked: boolean): Promise<{ progress: number }> {
    return withProjectLock(() => {
      const project = repo.readProject(projectId)
      if (!project) throw new Error(`Project not found: ${projectId}`)
      const item = project.tasks.find(t => t.id === taskItemId)
      if (!item) throw new Error(`Checklist item not found: ${taskItemId}`)
      item.checked = checked
      project.updated = new Date().toISOString()
      project.progress = computeProgress(project.tasks)
      if (project.progress === 100 && project.status === 'active') {
        project.status = 'completed'
        broadcast({ type: 'project.auto_completed', projectId })
      }
      repo.writeProject(project)
      broadcast({ type: 'project.checklist_changed', projectId, action: 'mark', taskItemId, checked })
      return { progress: project.progress }
    })
  }

  async function updateChecklistItem(projectId: string, taskItemId: string, updates: { title?: string; description?: string }): Promise<void> {
    return withProjectLock(() => {
      const project = repo.readProject(projectId)
      if (!project) throw new Error(`Project not found: ${projectId}`)
      const item = project.tasks.find(t => t.id === taskItemId)
      if (!item) throw new Error(`Checklist item not found: ${taskItemId}`)
      if (updates.title !== undefined) item.title = updates.title
      if (updates.description !== undefined) item.description = updates.description || undefined
      project.updated = new Date().toISOString()
      repo.writeProject(project)
      broadcast({ type: 'project.checklist_changed', projectId, action: 'update', taskItemId })
    })
  }

  async function removeChecklistItem(projectId: string, taskItemId: string): Promise<void> {
    return withProjectLock(() => {
      const project = repo.readProject(projectId)
      if (!project) throw new Error(`Project not found: ${projectId}`)
      const idx = project.tasks.findIndex(t => t.id === taskItemId)
      if (idx === -1) throw new Error(`Checklist item not found: ${taskItemId}`)
      const removed = project.tasks[idx]
      if (removed.taskId) getIndex().delete(removed.taskId)
      project.tasks.splice(idx, 1)
      project.updated = new Date().toISOString()
      project.progress = computeProgress(project.tasks)
      repo.writeProject(project)
      broadcast({ type: 'project.checklist_changed', projectId, action: 'remove', taskItemId })
    })
  }

  async function linkChecklistItem(projectId: string, taskItemId: string, boardTaskId: string): Promise<void> {
    return withProjectLock(() => {
      const project = repo.readProject(projectId)
      if (!project) throw new Error(`Project not found: ${projectId}`)
      const item = project.tasks.find(t => t.id === taskItemId)
      if (!item) throw new Error(`Checklist item not found: ${taskItemId}`)
      if (item.taskId) getIndex().delete(item.taskId)
      item.taskId = boardTaskId
      project.updated = new Date().toISOString()
      repo.writeProject(project)
      getIndex().set(boardTaskId, { projectId, taskItemId })
      broadcast({ type: 'project.checklist_changed', projectId, action: 'link', taskItemId, boardTaskId })
    })
  }

  async function attachAsset(projectId: string, filename: string, label?: string): Promise<void> {
    return withProjectLock(() => {
      const project = repo.readProject(projectId)
      if (!project) throw new Error(`Project not found: ${projectId}`)
      if (project.assets.some(a => a.filename === filename)) return
      project.assets.push({ filename, label })
      project.updated = new Date().toISOString()
      repo.writeProject(project)
      broadcast({ type: 'project.asset_changed', projectId, action: 'attach', filename })
    })
  }

  async function detachAsset(projectId: string, filename: string): Promise<void> {
    return withProjectLock(() => {
      const project = repo.readProject(projectId)
      if (!project) throw new Error(`Project not found: ${projectId}`)
      const idx = project.assets.findIndex(a => a.filename === filename)
      if (idx === -1) return
      project.assets.splice(idx, 1)
      project.updated = new Date().toISOString()
      repo.writeProject(project)
      broadcast({ type: 'project.asset_changed', projectId, action: 'detach', filename })
    })
  }

  async function updateAssetLabel(projectId: string, filename: string, label: string): Promise<void> {
    return withProjectLock(() => {
      const project = repo.readProject(projectId)
      if (!project) throw new Error(`Project not found: ${projectId}`)
      const asset = project.assets.find(a => a.filename === filename)
      if (!asset) throw new Error(`Asset not attached: ${filename}`)
      asset.label = label || undefined
      project.updated = new Date().toISOString()
      repo.writeProject(project)
    })
  }

  async function promoteItemToTask(projectId: string, taskItemId: string, opts?: PromoteItemOpts): Promise<{ taskId: string }> {
    const { title, projectIdVal } = await withProjectLock(() => {
      const project = repo.readProject(projectId)
      if (!project) throw new Error(`Project not found: ${projectId}`)
      const item = project.tasks.find(t => t.id === taskItemId)
      if (!item) throw new Error(`Checklist item not found: ${taskItemId}`)
      if (item.taskId) throw new Error(`Item already linked to board task: ${item.taskId}`)
      return { title: item.title, projectIdVal: project.id }
    })

    const task = await ctx.tasks.create({
      title,
      agent: opts?.assignee,
      projectId: projectIdVal,
      description: 'Project task',
      workflowId: opts?.workflowId,
      skipWorkflowReason: opts?.skipWorkflowReason,
    })
    await linkChecklistItem(projectId, taskItemId, task.id)
    return { taskId: task.id }
  }

  async function autoCheckLinkedItem(boardTaskId: string): Promise<void> {
    const entry = getIndex().get(boardTaskId)
    if (!entry) return
    log.info('Auto-checking project item', { boardTaskId, ...entry })
    await markChecklistItem(entry.projectId, entry.taskItemId, true)
    broadcast({ type: 'project.checklist_auto_checked', ...entry, boardTaskId })
  }

  async function autoUnlinkTask(boardTaskId: string): Promise<void> {
    const entry = getIndex().get(boardTaskId)
    if (!entry) return
    log.info('Auto-unlinking deleted task', { boardTaskId, ...entry })
    await withProjectLock(() => {
      const project = repo.readProject(entry.projectId)
      if (!project) return
      const item = project.tasks.find(t => t.id === entry.taskItemId)
      if (!item || item.taskId !== boardTaskId) return
      item.taskId = undefined
      item.checked = false
      project.updated = new Date().toISOString()
      project.progress = computeProgress(project.tasks)
      repo.writeProject(project)
      getIndex().delete(boardTaskId)
      broadcast({ type: 'project.checklist_changed', projectId: entry.projectId, action: 'unlink', taskItemId: entry.taskItemId })
    })
  }

  async function resolveLinkedTaskStatuses(project: Project): Promise<Project & {
    resolvedTasks: Record<string, { column: string; title: string } | null>
    resolvedAssets: ResolvedAsset[]
  }> {
    const linkedIds = project.tasks.map(item => item.taskId).filter((id): id is string => Boolean(id))
    const resolved: Record<string, { column: string; title: string } | null> = {}
    const boardTasks = await ctx.tasks.list()

    for (const taskId of linkedIds) {
      const task = boardTasks.find(t => t.id === taskId)
      resolved[taskId] = task ? { column: task.column, title: task.title } : null
    }

    const resolvedAssets = await Promise.all(project.assets.map(async (asset) => {
      const indexed = await ctx.assets.getByFilename(asset.filename)
      if (!indexed) return { filename: asset.filename, label: asset.label, type: 'unknown', missing: true }
      return {
        filename: asset.filename,
        label: asset.label,
        type: indexed.type,
        description: indexed.metadata?.description,
        tags: indexed.metadata?.tags,
      }
    }))

    return { ...project, resolvedTasks: resolved, resolvedAssets }
  }

  return {
    rebuildIndex,
    getProjectForTask,
    getProjectTitleForTask,
    createProject,
    updateProject,
    deleteProject,
    addChecklistItem,
    markChecklistItem,
    updateChecklistItem,
    removeChecklistItem,
    linkChecklistItem,
    attachAsset,
    detachAsset,
    updateAssetLabel,
    promoteItemToTask,
    autoCheckLinkedItem,
    autoUnlinkTask,
    resolveLinkedTaskStatuses,
  }
}
