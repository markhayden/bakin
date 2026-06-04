import type {
  BakinTask,
  BakinTaskPatch,
  BakinTaskStore,
  BakinTaskStoreEvent,
  CreateBakinTaskInput,
  TaskDependencyPatch,
  TaskListOpts,
} from './store'
import { createEmptyBakinTask } from './store'

function cloneTask(task: BakinTask): BakinTask {
  return structuredClone(task)
}

function sortTasks(tasks: BakinTask[]): BakinTask[] {
  return [...tasks].sort((a, b) => (
    a.column.localeCompare(b.column)
    || a.order - b.order
    || a.updatedAt.localeCompare(b.updatedAt)
    || a.id.localeCompare(b.id)
  ))
}

export function createMockBakinTaskStore(seed: BakinTask[] = []): BakinTaskStore {
  const tasks = new Map(seed.map((task) => [task.id, cloneTask(task)]))
  const listeners = new Set<(event: BakinTaskStoreEvent) => void>()

  function emit(event: BakinTaskStoreEvent): void {
    for (const listener of listeners) listener(event)
  }

  function requireTask(id: string): BakinTask {
    const task = tasks.get(id)
    if (!task) throw new Error(`Task not found: ${id}`)
    return task
  }

  async function patchTask(id: string, patch: BakinTaskPatch): Promise<BakinTask> {
    const current = requireTask(id)
    const next: BakinTask = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    }
    tasks.set(id, next)
    emit({ type: 'updated', taskId: id, task: cloneTask(next) })
    return cloneTask(next)
  }

  return {
    create: async (input: CreateBakinTaskInput) => {
      const task = createEmptyBakinTask(input)
      tasks.set(task.id, task)
      emit({ type: 'created', taskId: task.id, task: cloneTask(task) })
      return cloneTask(task)
    },

    get: async (id) => {
      const task = tasks.get(id)
      return task ? cloneTask(task) : null
    },

    list: async (opts: TaskListOpts = {}) => sortTasks(
      Array.from(tasks.values()).filter((task) => {
        if (!opts.includePendingDelete && task.pendingDelete) return false
        if (opts.column && task.column !== opts.column) return false
        if (opts.agent && task.agent !== opts.agent) return false
        if (opts.projectId && task.projectId !== opts.projectId) return false
        return true
      }).map(cloneTask)
    ),

    update: patchTask,

    move: async (id, column, order) => patchTask(id, {
      column,
      ...(order === undefined ? {} : { order }),
    }),

    remove: async (id) => {
      tasks.delete(id)
      emit({ type: 'deleted', taskId: id })
    },

    appendLog: async (id, entry) => {
      const task = requireTask(id)
      const next = { ...task, log: [...task.log, entry], updatedAt: new Date().toISOString() }
      tasks.set(id, next)
      emit({ type: 'updated', taskId: id, task: cloneTask(next) })
    },

    addComment: async (id, comment) => {
      const task = requireTask(id)
      const next = { ...task, comments: [...task.comments, comment], updatedAt: new Date().toISOString() }
      tasks.set(id, next)
      emit({ type: 'updated', taskId: id, task: cloneTask(next) })
    },

    setDependencies: async (id, deps: TaskDependencyPatch) => patchTask(id, {
      ...(deps.blockedBy === undefined ? {} : { blockedBy: deps.blockedBy }),
      ...(deps.blocking === undefined ? {} : { blocking: deps.blocking }),
    }),

    markPendingDelete: async (id, pending) => patchTask(id, { pendingDelete: pending }),


    subscribe: (handler) => {
      listeners.add(handler)
      return () => listeners.delete(handler)
    },
  }
}
