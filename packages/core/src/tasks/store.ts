import type { Unsubscribe } from '../adapters/shared'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

export interface BakinTask {
  id: string
  title: string
  description?: string
  agent?: string
  createdBy?: string
  column: string
  order: number
  tags: string[]
  workflowId?: string
  scheduleJobId?: string
  projectId?: string
  parentId?: string | null
  dependsOn?: string
  availableAt?: string
  dueAt?: string
  source?: TaskSource
  date?: string
  blockedReason?: string
  blockedBy: string[]
  blocking: string[]
  comments: TaskComment[]
  pendingDelete: boolean
  log: TaskLogEntry[]
  createdAt: string
  updatedAt: string
}

export interface TaskSource {
  pluginId?: string
  entityType?: string
  entityId?: string
  purpose?: string
}

export interface CreateBakinTaskInput {
  id?: string
  title: string
  description?: string
  agent?: string
  createdBy?: string
  column?: string
  order?: number
  tags?: string[]
  workflowId?: string
  scheduleJobId?: string
  projectId?: string
  parentId?: string | null
  dependsOn?: string
  availableAt?: string
  dueAt?: string
  source?: TaskSource
}

export type BakinTaskPatch = Partial<Pick<
  BakinTask,
  | 'title'
  | 'description'
  | 'agent'
  | 'createdBy'
  | 'column'
  | 'order'
  | 'tags'
  | 'workflowId'
  | 'scheduleJobId'
  | 'projectId'
  | 'parentId'
  | 'dependsOn'
  | 'availableAt'
  | 'dueAt'
  | 'source'
  | 'date'
  | 'blockedReason'
  | 'blockedBy'
  | 'blocking'
  | 'pendingDelete'
>>

export interface TaskListOpts {
  column?: string
  agent?: string
  projectId?: string
  includePendingDelete?: boolean
}

export interface TaskLogEntry {
  timestamp: string
  author: string
  message: string
  data?: Record<string, unknown>
}

export interface TaskComment {
  id: string
  author: string
  body: string
  createdAt: string
}

export interface TaskDependencyPatch {
  blockedBy?: string[]
  blocking?: string[]
}

export interface BakinTaskStoreEvent {
  type: 'created' | 'updated' | 'deleted'
  taskId: string
  task?: BakinTask
}

export interface BakinTaskStore {
  create(input: CreateBakinTaskInput): Promise<BakinTask>
  get(id: string): Promise<BakinTask | null>
  list(opts?: TaskListOpts): Promise<BakinTask[]>
  update(id: string, patch: BakinTaskPatch): Promise<BakinTask>
  move(id: string, column: string, order?: number): Promise<BakinTask>
  remove(id: string): Promise<void>

  appendLog(id: string, entry: TaskLogEntry): Promise<void>
  addComment(id: string, comment: TaskComment): Promise<void>
  setDependencies(id: string, deps: TaskDependencyPatch): Promise<BakinTask>
  markPendingDelete(id: string, pending: boolean): Promise<BakinTask>

  subscribe(handler: (event: BakinTaskStoreEvent) => void): Unsubscribe
}

export interface SyncBakinTaskStore extends BakinTaskStore {
  createSync(input: CreateBakinTaskInput): BakinTask
  getSync(id: string): BakinTask | null
  findSync(identifier: string): BakinTask | null
  listSync(opts?: TaskListOpts): BakinTask[]
  updateSync(id: string, patch: BakinTaskPatch): BakinTask
  removeSync(id: string): void
  appendLogSync(id: string, entry: TaskLogEntry): void
  addCommentSync(id: string, comment: TaskComment): void
  setDependenciesSync(id: string, deps: TaskDependencyPatch): BakinTask
  markPendingDeleteSync(id: string, pending: boolean): BakinTask
}

export function createEmptyBakinTask(input: CreateBakinTaskInput, now = new Date().toISOString()): BakinTask {
  return {
    id: input.id ?? `task-${crypto.randomUUID()}`,
    title: input.title,
    description: input.description,
    agent: input.agent,
    createdBy: input.createdBy,
    column: input.column ?? 'todo',
    order: input.order ?? 0,
    tags: input.tags ?? [],
    workflowId: input.workflowId,
    scheduleJobId: input.scheduleJobId,
    projectId: input.projectId,
    parentId: input.parentId ?? null,
    dependsOn: input.dependsOn,
    availableAt: input.availableAt,
    dueAt: input.dueAt,
    source: input.source,
    blockedBy: [],
    blocking: [],
    comments: [],
    pendingDelete: false,
    log: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function createFileBakinTaskStore(root: string): SyncBakinTaskStore {
  const listeners = new Set<(event: BakinTaskStoreEvent) => void>()

  function emit(event: BakinTaskStoreEvent): void {
    for (const listener of listeners) listener(event)
  }

  function ensureRoot(): void {
    if (!existsSync(root)) mkdirSync(root, { recursive: true })
  }

  function taskPath(task: BakinTask): string {
    const shard = (task.createdAt || new Date().toISOString()).slice(0, 7)
    return join(root, shard, `task-${task.id}.json`)
  }

  function findTaskPath(id: string): string | null {
    ensureRoot()
    for (const shard of readdirSync(root, { withFileTypes: true })) {
      if (!shard.isDirectory()) continue
      const dir = join(root, shard.name)
      for (const file of readdirSync(dir, { withFileTypes: true })) {
        if (!file.isFile()) continue
        if (file.name === `task-${id}.json`) return join(dir, file.name)
      }
    }
    return null
  }

  function readFile(path: string): BakinTask | null {
    try {
      return JSON.parse(readFileSync(path, 'utf-8')) as BakinTask
    } catch {
      return null
    }
  }

  function writeTask(task: BakinTask): void {
    const path = taskPath(task)
    const dir = dirname(path)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
    writeFileSync(tmp, JSON.stringify(task, null, 2), 'utf-8')
    renameSync(tmp, path)
  }

  function requireTask(id: string): BakinTask {
    const task = store.getSync(id)
    if (!task) throw new Error(`Task not found: ${id}`)
    return task
  }

  function writeUpdated(task: BakinTask, eventType: BakinTaskStoreEvent['type'] = 'updated'): BakinTask {
    const next = { ...task, updatedAt: new Date().toISOString() }
    writeTask(next)
    emit({ type: eventType, taskId: next.id, task: next })
    return next
  }

  const store: SyncBakinTaskStore = {
    createSync(input) {
      const task = createEmptyBakinTask(input)
      if (findTaskPath(task.id)) throw new Error(`Task already exists: ${task.id}`)
      writeTask(task)
      emit({ type: 'created', taskId: task.id, task })
      return task
    },

    getSync(id) {
      const path = findTaskPath(id)
      return path ? readFile(path) : null
    },

    findSync(identifier) {
      return store.getSync(identifier)
        ?? store.listSync({ includePendingDelete: true }).find((task) => task.title === identifier)
        ?? null
    },

    listSync(opts = {}) {
      ensureRoot()
      const tasks: BakinTask[] = []
      for (const shard of readdirSync(root, { withFileTypes: true })) {
        if (!shard.isDirectory()) continue
        const dir = join(root, shard.name)
        for (const file of readdirSync(dir, { withFileTypes: true })) {
          if (!file.isFile() || !file.name.endsWith('.json')) continue
          const task = readFile(join(dir, file.name))
          if (!task) continue
          if (!opts.includePendingDelete && task.pendingDelete) continue
          if (opts.column && task.column !== opts.column) continue
          if (opts.agent && task.agent !== opts.agent) continue
          if (opts.projectId && task.projectId !== opts.projectId) continue
          tasks.push(task)
        }
      }
      return tasks.sort((a, b) => (
        a.column.localeCompare(b.column)
        || a.order - b.order
        || b.updatedAt.localeCompare(a.updatedAt)
        || a.id.localeCompare(b.id)
      ))
    },

    updateSync(id, patch) {
      const current = requireTask(id)
      return writeUpdated({ ...current, ...patch })
    },

    removeSync(id) {
      const path = findTaskPath(id)
      if (!path) throw new Error(`Task not found: ${id}`)
      unlinkSync(path)
      emit({ type: 'deleted', taskId: id })
    },

    appendLogSync(id, entry) {
      const current = requireTask(id)
      writeUpdated({ ...current, log: [...current.log, entry] })
    },

    addCommentSync(id, comment) {
      const current = requireTask(id)
      writeUpdated({ ...current, comments: [...current.comments, comment] })
    },

    setDependenciesSync(id, deps) {
      const current = requireTask(id)
      return writeUpdated({
        ...current,
        blockedBy: deps.blockedBy ?? current.blockedBy,
        blocking: deps.blocking ?? current.blocking,
      })
    },

    markPendingDeleteSync(id, pending) {
      return store.updateSync(id, { pendingDelete: pending })
    },

    create: async (input) => store.createSync(input),
    get: async (id) => store.getSync(id),
    list: async (opts) => store.listSync(opts),
    update: async (id, patch) => store.updateSync(id, patch),
    move: async (id, column, order) => store.updateSync(id, {
      column,
      ...(order === undefined ? {} : { order }),
    }),
    remove: async (id) => store.removeSync(id),
    appendLog: async (id, entry) => store.appendLogSync(id, entry),
    addComment: async (id, comment) => store.addCommentSync(id, comment),
    setDependencies: async (id, deps) => store.setDependenciesSync(id, deps),
    markPendingDelete: async (id, pending) => store.markPendingDeleteSync(id, pending),
    subscribe(handler) {
      listeners.add(handler)
      return () => {
        listeners.delete(handler)
      }
    },
  }

  return store
}
