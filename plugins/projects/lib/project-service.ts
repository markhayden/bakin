/**
 * Projects plugin — service layer.
 * Wraps parser operations with side effects: audit, SSE broadcast,
 * in-memory index, auto-check on task completion.
 */
import { generateTaskId } from '@bakin/core/ids'
import { readProject, readAllProjects, writeProject, deleteProjectFile, computeProgress, nextTaskItemId } from './parser'
import { createTaskWithEffects } from '../../../src/core/task-service'
import { appendAudit } from '../../../src/core/audit'
import { getContentDir } from '../../../src/core/content-dir'
import { createLogger } from '../../../src/core/logger'
import { getMainAgentId } from '../../../src/core/main-agent'
import { getHookRegistry } from '../../../src/lib/plugin-registry'
import type { Project, ProjectTask, ProjectStatus } from '../types'

const log = createLogger('projects')

// ---------------------------------------------------------------------------
// Async mutex — serializes all read-modify-write cycles on project files
// Stored on globalThis to ensure single instance across dynamic imports
// ---------------------------------------------------------------------------

function getProjectLock(): { queue: Promise<void> } {
  const g = globalThis as Record<string, unknown>
  if (!g.__bakinProjectLock) {
    g.__bakinProjectLock = { queue: Promise.resolve() }
  }
  return g.__bakinProjectLock as { queue: Promise<void> }
}

function withProjectLock<T>(fn: () => T | Promise<T>): Promise<T> {
  const lock = getProjectLock()
  const next = lock.queue.then(fn, fn) as Promise<T>
  lock.queue = next.then(() => {}, () => {})
  return next
}

// ---------------------------------------------------------------------------
// SSE broadcast helper
// ---------------------------------------------------------------------------

function broadcast(data: Record<string, unknown>): void {
  const fn = (globalThis as any).__bakinBroadcast
  if (fn) fn(data)
}

// ---------------------------------------------------------------------------
// In-memory task-link index: boardTaskId → { projectId, taskItemId }
// ---------------------------------------------------------------------------

export interface TaskLinkEntry {
  projectId: string
  taskItemId: string
}

function getIndex(): Map<string, TaskLinkEntry> {
  const g = globalThis as Record<string, unknown>
  if (!g.__bakinProjectIndex) {
    g.__bakinProjectIndex = new Map<string, TaskLinkEntry>()
  }
  return g.__bakinProjectIndex as Map<string, TaskLinkEntry>
}

export function rebuildIndex(): void {
  const index = getIndex()
  index.clear()
  for (const project of readAllProjects()) {
    for (const item of project.tasks) {
      if (item.taskId) {
        index.set(item.taskId, { projectId: project.id, taskItemId: item.id })
      }
    }
  }
  log.info('Project index rebuilt', { entries: index.size })
}

export function getProjectForTask(boardTaskId: string): TaskLinkEntry | undefined {
  return getIndex().get(boardTaskId)
}

export function getProjectTitleForTask(boardTaskId: string): string | null {
  const entry = getIndex().get(boardTaskId)
  if (!entry) return null
  const project = readProject(entry.projectId)
  return project?.title ?? null
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

export interface CreateProjectOpts {
  title: string
  body?: string
  owner?: string
  tasks?: string[] // initial checklist item titles
}

export async function createProject(opts: CreateProjectOpts): Promise<{ id: string; taskItems: { id: string; title: string }[] }> {
  return withProjectLock(() => {
    const id = generateTaskId()
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
      owner: opts.owner || getMainAgentId(),
      tasks: taskItems,
      assets: [],
      body: opts.body || (opts.title ? `# ${opts.title}\n` : ''),
      progress: 0,
    }

    writeProject(project)
    appendAudit(getContentDir(), 'project.created', project.owner, { id, title: project.title })
    broadcast({ type: 'project.created', id, title: project.title })

    return { id, taskItems: taskItems.map(t => ({ id: t.id, title: t.title })) }
  })
}

export interface UpdateProjectOpts {
  title?: string
  status?: ProjectStatus
  body?: string
  owner?: string
}

export async function updateProject(id: string, updates: UpdateProjectOpts, agent?: string): Promise<void> {
  return withProjectLock(() => {
    const project = readProject(id)
    if (!project) throw new Error(`Project not found: ${id}`)

    // Validate status transition: cannot complete with unchecked items
    if (updates.status === 'completed') {
      const unchecked = project.tasks.filter(t => !t.checked)
      if (unchecked.length > 0) {
        throw new Error(`Cannot complete project: ${unchecked.length} unchecked items remain`)
      }
    }

    if (updates.title !== undefined) project.title = updates.title
    if (updates.status !== undefined) project.status = updates.status
    if (updates.body !== undefined) project.body = updates.body
    if (updates.owner !== undefined) project.owner = updates.owner
    project.updated = new Date().toISOString()
    project.progress = computeProgress(project.tasks)

    writeProject(project)
    appendAudit(getContentDir(), 'project.updated', agent || project.owner, { id, ...updates })
    broadcast({ type: 'project.updated', id, title: project.title })
  })
}

export async function deleteProject(id: string, agent?: string): Promise<void> {
  return withProjectLock(() => {
    const project = readProject(id)
    if (!project) throw new Error(`Project not found: ${id}`)
    deleteProjectFile(id)

    // Remove index entries for this project
    const index = getIndex()
    for (const [taskId, entry] of index) {
      if (entry.projectId === id) index.delete(taskId)
    }

    appendAudit(getContentDir(), 'project.deleted', agent || 'system', { id, title: project.title })
    broadcast({ type: 'project.deleted', id })
  })
}

// ---------------------------------------------------------------------------
// Checklist operations
// ---------------------------------------------------------------------------

export async function addChecklistItem(projectId: string, title: string): Promise<{ taskItemId: string }> {
  return withProjectLock(() => {
    const project = readProject(projectId)
    if (!project) throw new Error(`Project not found: ${projectId}`)

    const itemId = nextTaskItemId(project.tasks)
    project.tasks.push({ id: itemId, title, checked: false })
    project.updated = new Date().toISOString()
    project.progress = computeProgress(project.tasks)
    writeProject(project)

    broadcast({ type: 'project.checklist_changed', projectId, action: 'add', taskItemId: itemId })
    return { taskItemId: itemId }
  })
}

export async function markChecklistItem(projectId: string, taskItemId: string, checked: boolean): Promise<{ progress: number }> {
  return withProjectLock(() => {
    const project = readProject(projectId)
    if (!project) throw new Error(`Project not found: ${projectId}`)

    const item = project.tasks.find(t => t.id === taskItemId)
    if (!item) throw new Error(`Checklist item not found: ${taskItemId}`)

    item.checked = checked
    project.updated = new Date().toISOString()
    project.progress = computeProgress(project.tasks)

    // Auto-complete project if all items checked and status is active
    if (project.progress === 100 && project.status === 'active') {
      project.status = 'completed'
      broadcast({ type: 'project.auto_completed', projectId })
    }

    writeProject(project)
    broadcast({ type: 'project.checklist_changed', projectId, action: 'mark', taskItemId, checked })
    return { progress: project.progress }
  })
}

export async function updateChecklistItem(projectId: string, taskItemId: string, updates: { title?: string; description?: string }): Promise<void> {
  return withProjectLock(() => {
    const project = readProject(projectId)
    if (!project) throw new Error(`Project not found: ${projectId}`)

    const item = project.tasks.find(t => t.id === taskItemId)
    if (!item) throw new Error(`Checklist item not found: ${taskItemId}`)

    if (updates.title !== undefined) item.title = updates.title
    if (updates.description !== undefined) item.description = updates.description || undefined
    project.updated = new Date().toISOString()
    writeProject(project)

    broadcast({ type: 'project.checklist_changed', projectId, action: 'update', taskItemId })
  })
}

export async function removeChecklistItem(projectId: string, taskItemId: string): Promise<void> {
  return withProjectLock(() => {
    const project = readProject(projectId)
    if (!project) throw new Error(`Project not found: ${projectId}`)

    const idx = project.tasks.findIndex(t => t.id === taskItemId)
    if (idx === -1) throw new Error(`Checklist item not found: ${taskItemId}`)

    // Remove index entry if linked
    const removed = project.tasks[idx]
    if (removed.taskId) {
      getIndex().delete(removed.taskId)
    }

    project.tasks.splice(idx, 1)
    project.updated = new Date().toISOString()
    project.progress = computeProgress(project.tasks)
    writeProject(project)

    broadcast({ type: 'project.checklist_changed', projectId, action: 'remove', taskItemId })
  })
}

export async function linkChecklistItem(projectId: string, taskItemId: string, boardTaskId: string): Promise<void> {
  return withProjectLock(() => {
    const project = readProject(projectId)
    if (!project) throw new Error(`Project not found: ${projectId}`)

    const item = project.tasks.find(t => t.id === taskItemId)
    if (!item) throw new Error(`Checklist item not found: ${taskItemId}`)

    // Remove old index entry if re-linking
    if (item.taskId) {
      getIndex().delete(item.taskId)
    }

    item.taskId = boardTaskId
    project.updated = new Date().toISOString()
    writeProject(project)

    // Update index
    getIndex().set(boardTaskId, { projectId, taskItemId })

    broadcast({ type: 'project.checklist_changed', projectId, action: 'link', taskItemId, boardTaskId })
  })
}

// ---------------------------------------------------------------------------
// Asset operations
// ---------------------------------------------------------------------------

export async function attachAsset(projectId: string, filename: string, label?: string): Promise<void> {
  return withProjectLock(() => {
    const project = readProject(projectId)
    if (!project) throw new Error(`Project not found: ${projectId}`)

    // Prevent duplicates
    if (project.assets.some(a => a.filename === filename)) return

    project.assets.push({ filename, label })
    project.updated = new Date().toISOString()
    writeProject(project)

    broadcast({ type: 'project.asset_changed', projectId, action: 'attach', filename })
  })
}

export async function detachAsset(projectId: string, filename: string): Promise<void> {
  return withProjectLock(() => {
    const project = readProject(projectId)
    if (!project) throw new Error(`Project not found: ${projectId}`)

    const idx = project.assets.findIndex(a => a.filename === filename)
    if (idx === -1) return

    project.assets.splice(idx, 1)
    project.updated = new Date().toISOString()
    writeProject(project)

    broadcast({ type: 'project.asset_changed', projectId, action: 'detach', filename })
  })
}

export async function updateAssetLabel(projectId: string, filename: string, label: string): Promise<void> {
  return withProjectLock(() => {
    const project = readProject(projectId)
    if (!project) throw new Error(`Project not found: ${projectId}`)

    const asset = project.assets.find(a => a.filename === filename)
    if (!asset) throw new Error(`Asset not attached: ${filename}`)

    asset.label = label || undefined
    project.updated = new Date().toISOString()
    writeProject(project)
  })
}

export interface PromoteItemOpts {
  assignee?: string
  workflowId?: string
  skipWorkflowReason?: string
}

export async function promoteItemToTask(projectId: string, taskItemId: string, opts?: PromoteItemOpts): Promise<{ taskId: string }> {
  // Read project inside lock, create task outside lock (createTaskWithEffects has its own lock)
  const { title, projectIdVal } = await withProjectLock(() => {
    const project = readProject(projectId)
    if (!project) throw new Error(`Project not found: ${projectId}`)

    const item = project.tasks.find(t => t.id === taskItemId)
    if (!item) throw new Error(`Checklist item not found: ${taskItemId}`)
    if (item.taskId) throw new Error(`Item already linked to board task: ${item.taskId}`)

    return { title: item.title, projectIdVal: project.id }
  })

  // Create the board task with projectId
  const task = await createTaskWithEffects({
    title,
    assignee: opts?.assignee,
    projectId: projectIdVal,
    description: `Project task`,
    channel: 'rest',
  })

  // Link back to checklist item
  await linkChecklistItem(projectId, taskItemId, task.id)

  return { taskId: task.id }
}

// ---------------------------------------------------------------------------
// Auto-check: called when a board task reaches done/archived
// ---------------------------------------------------------------------------

export async function autoCheckLinkedItem(boardTaskId: string): Promise<void> {
  const entry = getIndex().get(boardTaskId)
  if (!entry) return // Not linked to any project

  log.info('Auto-checking project item', { boardTaskId, ...entry })
  await markChecklistItem(entry.projectId, entry.taskItemId, true)
  broadcast({ type: 'project.checklist_auto_checked', ...entry, boardTaskId })
}

// ---------------------------------------------------------------------------
// Auto-unlink: called when a board task is deleted
// ---------------------------------------------------------------------------

export async function autoUnlinkTask(boardTaskId: string): Promise<void> {
  const entry = getIndex().get(boardTaskId)
  if (!entry) return

  log.info('Auto-unlinking deleted task', { boardTaskId, ...entry })
  await withProjectLock(() => {
    const project = readProject(entry.projectId)
    if (!project) return

    const item = project.tasks.find(t => t.id === entry.taskItemId)
    if (!item || item.taskId !== boardTaskId) return

    item.taskId = undefined
    item.checked = false
    project.updated = new Date().toISOString()
    project.progress = computeProgress(project.tasks)
    writeProject(project)

    getIndex().delete(boardTaskId)
    broadcast({ type: 'project.checklist_changed', projectId: entry.projectId, action: 'unlink', taskItemId: entry.taskItemId })
  })
}

// ---------------------------------------------------------------------------
// Resolve linked task statuses from the board
// ---------------------------------------------------------------------------

export interface ResolvedAsset {
  filename: string
  label?: string
  type: string
  description?: string
  tags?: string[]
  missing?: boolean
}

export async function resolveLinkedTaskStatuses(project: Project): Promise<Project & { resolvedTasks: Record<string, { column: string; title: string } | null>; resolvedAssets: ResolvedAsset[] }> {
  const board = await getHookRegistry().invoke<{ columns: Record<string, Array<{ id: string; title: string }>> }>('tasks.readTaskboard', {})
  const columns = board?.columns ?? {}
  const resolved: Record<string, { column: string; title: string } | null> = {}

  for (const item of project.tasks) {
    if (!item.taskId) continue
    let found = false
    for (const [colId, tasks] of Object.entries(columns)) {
      const task = (tasks as Array<{ id: string; title: string }>).find(t => t.id === item.taskId)
      if (task) {
        resolved[item.taskId] = { column: colId, title: task.title }
        found = true
        break
      }
    }
    if (!found) resolved[item.taskId] = null
  }

  // Resolve asset summaries (lightweight — no full content).
  // Stored: just the filename. At render time: derive the path from the
  // filename (pure function) and read indexed metadata.
  let resolvedAssets: ResolvedAsset[] = []
  try {
    const { getAsset } = require('../../assets/lib/asset-index')
    const { pathForFilename } = require('../../assets/lib/path-for-filename')
    resolvedAssets = project.assets.map(a => {
      const resolvedPath = pathForFilename(a.filename)
      const indexed = resolvedPath ? getAsset(resolvedPath) : null
      if (!indexed) return { filename: a.filename, label: a.label, type: 'unknown', missing: true }
      return {
        filename: a.filename,
        label: a.label,
        type: indexed.type,
        description: indexed.metadata?.description,
        tags: indexed.metadata?.tags,
      }
    })
  } catch {
    // Assets plugin may not be loaded
    resolvedAssets = project.assets.map(a => ({
      filename: a.filename,
      label: a.label,
      type: 'unknown',
    }))
  }

  return { ...project, resolvedTasks: resolved, resolvedAssets }
}
