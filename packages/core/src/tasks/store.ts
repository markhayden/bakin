import type { TaskLogEntry } from '@makinbakin/sdk/types'
import type { Unsubscribe } from '../adapters/shared'
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { atomicWriteJson } from '../storage/atomic-write'

// TaskLogEntry is single-homed in the SDK (published TaskService contract);
// re-exported here so the in-repo store stays the internal import source.
export type { TaskLogEntry } from '@makinbakin/sdk/types'

export interface BakinTask {
  id: string
  title: string
  description?: string
  agent?: string
  /**
   * Requested team assignment (#189). `team` alone = unresolved team task
   * (the dispatch resolver picks a member); `team` + `agent` = resolved —
   * team is retained so the record explains requested vs resolved.
   * Exclusion semantics live in the app facade (src/core/task-store.ts).
   */
  team?: string
  createdBy?: string
  column: string
  order: number
  tags: string[]
  workflowId?: string
  scheduleJobId?: string
  projectId?: string
  /** Brand link (#419) — resolved lazily at dispatch, mirrors projectId. */
  brandId?: string
  /** Repo binding override (same-agent-concurrency D6): dispatch worktree target; project binding via projects.getRepo otherwise. */
  repoPath?: string
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
  /**
   * Optimistic concurrency counter — bumped on every write. Absent on
   * pre-upgrade tasks (treated as 0; lazy-stamped on the next write).
   * API mutations may send expectedVersion and get a 409 when stale.
   */
  version?: number
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
  team?: string
  createdBy?: string
  column?: string
  order?: number
  tags?: string[]
  workflowId?: string
  scheduleJobId?: string
  projectId?: string
  brandId?: string
  /** Repo binding override (same-agent-concurrency D6): dispatch worktree target; project binding via projects.getRepo otherwise. */
  repoPath?: string
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
  | 'team'
  | 'createdBy'
  | 'column'
  | 'order'
  | 'tags'
  | 'workflowId'
  | 'scheduleJobId'
  | 'projectId'
  | 'brandId'
  | 'repoPath'
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
  brandId?: string
  /** Repo binding override (same-agent-concurrency D6): dispatch worktree target; project binding via projects.getRepo otherwise. */
  repoPath?: string
  includePendingDelete?: boolean
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
  /** Index-backed column count (excludes pendingDelete, matching listSync). Zero file reads. */
  countByColumnSync(column: string): number
}

export function createEmptyBakinTask(input: CreateBakinTaskInput, now = new Date().toISOString()): BakinTask {
  return {
    id: input.id ?? `task-${crypto.randomUUID()}`,
    title: input.title,
    description: input.description,
    agent: input.agent,
    team: input.team,
    createdBy: input.createdBy,
    column: input.column ?? 'todo',
    order: input.order ?? 0,
    tags: input.tags ?? [],
    workflowId: input.workflowId,
    scheduleJobId: input.scheduleJobId,
    projectId: input.projectId,
    brandId: input.brandId,
    repoPath: input.repoPath,
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

interface TaskIndexEntry {
  path: string
  column: string
  pendingDelete: boolean
}

export function createFileBakinTaskStore(root: string): SyncBakinTaskStore {
  const listeners = new Set<(event: BakinTaskStoreEvent) => void>()

  // In-memory index: id → {path, column, pendingDelete} plus column → id buckets.
  // Holds NO task content — content reads always hit disk, so external content
  // edits are picked up on read. Self-heals on miss (targeted rescan + repair)
  // and on externally-deleted files (existence validated before trusting).
  const idToEntry = new Map<string, TaskIndexEntry>()
  const columnBuckets = new Map<string, Set<string>>()
  let indexBuilt = false

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

  function indexUpsert(task: BakinTask, path: string): void {
    const prev = idToEntry.get(task.id)
    if (prev && prev.column !== task.column) {
      columnBuckets.get(prev.column)?.delete(task.id)
    }
    idToEntry.set(task.id, { path, column: task.column, pendingDelete: task.pendingDelete === true })
    let bucket = columnBuckets.get(task.column)
    if (!bucket) {
      bucket = new Set()
      columnBuckets.set(task.column, bucket)
    }
    bucket.add(task.id)
  }

  function indexRemove(id: string): void {
    const entry = idToEntry.get(id)
    if (entry) columnBuckets.get(entry.column)?.delete(id)
    idToEntry.delete(id)
  }

  function buildIndex(): void {
    idToEntry.clear()
    columnBuckets.clear()
    ensureRoot()
    for (const shard of readdirSync(root, { withFileTypes: true })) {
      if (!shard.isDirectory()) continue
      const dir = join(root, shard.name)
      for (const file of readdirSync(dir, { withFileTypes: true })) {
        if (!file.isFile() || !file.name.endsWith('.json')) continue
        const path = join(dir, file.name)
        const task = readFile(path)
        if (task?.id) indexUpsert(task, path)
      }
    }
    indexBuilt = true
  }

  function ensureIndex(): void {
    if (!indexBuilt) buildIndex()
  }

  /** Full shard walk — retained as the index self-heal fallback only. */
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
    // trailingNewline: false — the store has always written bare JSON.
    atomicWriteJson(path, task, { trailingNewline: false })
    indexUpsert(task, path)
  }

  function requireTask(id: string): BakinTask {
    const task = store.getSync(id)
    if (!task) throw new Error(`Task not found: ${id}`)
    return task
  }

  function writeUpdated(task: BakinTask, eventType: BakinTaskStoreEvent['type'] = 'updated'): BakinTask {
    // Single write chokepoint — every mutation bumps the optimistic
    // concurrency counter alongside updatedAt.
    const next = { ...task, updatedAt: new Date().toISOString(), version: (task.version ?? 0) + 1 }
    writeTask(next)
    emit({ type: eventType, taskId: next.id, task: next })
    return next
  }

  function sortTasks(tasks: BakinTask[]): BakinTask[] {
    return tasks.sort((a, b) => (
      a.column.localeCompare(b.column)
      || a.order - b.order
      || b.updatedAt.localeCompare(a.updatedAt)
      || a.id.localeCompare(b.id)
    ))
  }

  const store: SyncBakinTaskStore = {
    createSync(input) {
      ensureIndex()
      const task = createEmptyBakinTask(input)
      // Index check plus a targeted stat of the path this create would write —
      // no shard walk. An externally hand-placed file for the same id in a
      // DIFFERENT month shard is not detected (store is the single writer).
      if (idToEntry.has(task.id) || existsSync(taskPath(task))) {
        throw new Error(`Task already exists: ${task.id}`)
      }
      writeTask(task)
      emit({ type: 'created', taskId: task.id, task })
      return task
    },

    getSync(id) {
      ensureIndex()
      const entry = idToEntry.get(id)
      if (entry) {
        const task = readFile(entry.path)
        if (task) {
          // Refresh column/pendingDelete picked up from external content edits.
          if (task.column !== entry.column || (task.pendingDelete === true) !== entry.pendingDelete) {
            indexUpsert(task, entry.path)
          }
          return task
        }
        indexRemove(id) // file vanished or unreadable — heal and fall through
      }
      // Self-heal: targeted full walk for externally-created files.
      const path = findTaskPath(id)
      if (!path) return null
      const task = readFile(path)
      if (task) indexUpsert(task, path)
      return task
    },

    findSync(identifier) {
      return store.getSync(identifier)
        ?? store.listSync({ includePendingDelete: true }).find((task) => task.title === identifier)
        ?? null
    },

    listSync(opts = {}) {
      // Column-filtered listing reads only that column's bucket (dispatch hot
      // path). The unfiltered walk remains the discovery path for externally
      // created files and opportunistically repairs the index.
      if (opts.column) {
        ensureIndex()
        const tasks: BakinTask[] = []
        for (const id of columnBuckets.get(opts.column) ?? []) {
          const entry = idToEntry.get(id)
          if (!entry) continue
          const task = readFile(entry.path)
          if (!task) {
            indexRemove(id)
            continue
          }
          if (task.column !== opts.column) {
            indexUpsert(task, entry.path) // external column edit — heal, no longer matches
            continue
          }
          if (!opts.includePendingDelete && task.pendingDelete) continue
          if (opts.agent && task.agent !== opts.agent) continue
          if (opts.projectId && task.projectId !== opts.projectId) continue
          if (opts.brandId && task.brandId !== opts.brandId) continue
          tasks.push(task)
        }
        return sortTasks(tasks)
      }

      ensureRoot()
      const tasks: BakinTask[] = []
      for (const shard of readdirSync(root, { withFileTypes: true })) {
        if (!shard.isDirectory()) continue
        const dir = join(root, shard.name)
        for (const file of readdirSync(dir, { withFileTypes: true })) {
          if (!file.isFile() || !file.name.endsWith('.json')) continue
          const path = join(dir, file.name)
          const task = readFile(path)
          if (!task) continue
          if (indexBuilt) indexUpsert(task, path)
          if (!opts.includePendingDelete && task.pendingDelete) continue
          if (opts.agent && task.agent !== opts.agent) continue
          if (opts.projectId && task.projectId !== opts.projectId) continue
          if (opts.brandId && task.brandId !== opts.brandId) continue
          tasks.push(task)
        }
      }
      return sortTasks(tasks)
    },

    countByColumnSync(column) {
      ensureIndex()
      let count = 0
      const ghosts: string[] = []
      for (const id of columnBuckets.get(column) ?? []) {
        const entry = idToEntry.get(id)
        if (!entry || entry.pendingDelete) continue
        // Cheap stat (no read/parse) — tolerates externally deleted files.
        // Intentional divergence from listSync({column}): an external hand-
        // edit that re-columns a task is only noticed by reads that parse
        // content (getSync/listSync heal it); a count never re-reads files.
        // Acceptable: the store is the single writer (spec decision, #434).
        if (!existsSync(entry.path)) {
          ghosts.push(id)
          continue
        }
        count++
      }
      for (const id of ghosts) indexRemove(id)
      return count
    },

    updateSync(id, patch) {
      const current = requireTask(id)
      return writeUpdated({ ...current, ...patch })
    },

    removeSync(id) {
      ensureIndex()
      const entry = idToEntry.get(id)
      const path = entry && existsSync(entry.path) ? entry.path : findTaskPath(id)
      if (!path) {
        indexRemove(id)
        throw new Error(`Task not found: ${id}`)
      }
      unlinkSync(path)
      indexRemove(id)
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
