// TaskLogEntry is single-homed in the SDK (published TaskService contract).
import type { TaskLogEntry } from '@makinbakin/sdk/types'
export type { TaskLogEntry }

// The board wire shapes are single-homed in the task store. Re-exported
// type-only, so client bundles never pull the server module (type-only
// re-exports are erased at build). A local copy here had already drifted
// (it was missing `version`) — pinned by tests/architecture/type-single-home.
export type { Task, TaskColumns, TaskBoard, ColumnId, TaskSource } from '../../src/core/task-store'

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
