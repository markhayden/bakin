// TaskLogEntry is single-homed in the SDK (published TaskService contract).
import type { TaskLogEntry } from '@makinbakin/sdk/types'
export type { TaskLogEntry }

export interface TaskSource {
  pluginId?: string
  entityType?: string
  entityId?: string
  purpose?: string
}

export interface Task {
  id: string
  title: string
  agent?: string
  createdBy?: string
  checked: boolean
  date?: string
  blockedReason?: string
  description?: string
  log?: TaskLogEntry[]
  dependsOn?: string
  parentId?: string
  workflowId?: string
  scheduleJobId?: string
  projectId?: string
  availableAt?: string
  dueAt?: string
  source?: TaskSource
  order?: number
  /** Wall-clock ms of the last DB row update — used by the watchdog as a fallback "last activity" when a task has no log entries yet. */
  updatedAt?: number
}

export interface TaskColumns {
  backlog: Task[]
  inProgress: Task[]
  todo: Task[]
  review: Task[]
  done: Task[]
  archived: Task[]
  blocked: Task[]
}

export interface TaskBoard {
  columns: TaskColumns
  timestamp?: string
}

export type ColumnId = keyof TaskColumns

/** Task-level terminal outcome, derived from the completion ledger + task column.
 *  Mirrored client-side in src/hooks/use-task-run-history.ts — keep in sync. */
export interface TaskOutcome {
  state: 'done' | 'blocked' | 'archived' | 'in_progress'
  /** Set when state === 'done' and a completion row exists. */
  completedAt?: string // ISO
  /** Agent that recorded the completion, when known. */
  agent?: string
}

/** One dispatch attempt for a task, from the execution ledger's `runs` table.
 *  Mirrored client-side in src/hooks/use-task-run-history.ts — keep in sync. */
export interface TaskRunEntry {
  runId: string
  taskId: string
  seq: number
  agent: string
  status: 'running' | 'settled' | 'superseded' | 'lost'
  startedAt: string // ISO
  settledAt?: string // ISO
  settleReason?: string
  durationMs?: number
}
