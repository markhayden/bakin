import type { Unsubscribe } from '../adapters/shared'
import type { TaskExecutionStatus } from '../adapters/runtime'

export interface BakinTask {
  id: string
  title: string
  description?: string
  agent?: string
  column: string
  order: number
  tags: string[]
  workflowId?: string
  projectId?: string
  parentId?: string | null
  blockedBy: string[]
  blocking: string[]
  comments: TaskComment[]
  pendingDelete: boolean
  execution: {
    flowId: string | null
    state?: TaskExecutionStatus['state'] | 'execution-orphaned' | 'not-dispatched'
    currentStep?: string | null
    blockingReason?: string | null
    retryCount?: number
    startedAt?: string | null
    endedAt?: string | null
    lastSyncedAt?: string | null
  }
  log: TaskLogEntry[]
  createdAt: string
  updatedAt: string
}

export interface CreateBakinTaskInput {
  id?: string
  title: string
  description?: string
  agent?: string
  column?: string
  order?: number
  tags?: string[]
  workflowId?: string
  projectId?: string
  parentId?: string | null
}

export type BakinTaskPatch = Partial<Pick<
  BakinTask,
  | 'title'
  | 'description'
  | 'agent'
  | 'column'
  | 'order'
  | 'tags'
  | 'workflowId'
  | 'projectId'
  | 'parentId'
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
  at: string
  actor: string
  event: string
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
  linkExecution(id: string, flowId: string): Promise<BakinTask>
  updateExecutionCache(id: string, status: TaskExecutionStatus): Promise<BakinTask>

  subscribe(handler: (event: BakinTaskStoreEvent) => void): Unsubscribe
}

export function createEmptyBakinTask(input: CreateBakinTaskInput, now = new Date().toISOString()): BakinTask {
  return {
    id: input.id ?? `task-${crypto.randomUUID()}`,
    title: input.title,
    description: input.description,
    agent: input.agent,
    column: input.column ?? 'todo',
    order: input.order ?? 0,
    tags: input.tags ?? [],
    workflowId: input.workflowId,
    projectId: input.projectId,
    parentId: input.parentId ?? null,
    blockedBy: [],
    blocking: [],
    comments: [],
    pendingDelete: false,
    execution: {
      flowId: null,
      state: 'not-dispatched',
      lastSyncedAt: null,
    },
    log: [],
    createdAt: now,
    updatedAt: now,
  }
}
