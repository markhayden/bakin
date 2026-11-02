/**
 * The ONE store-event → `tasks.statusChanged` mapping (spec D21), shared by
 * the host's shared task store and the SDK testing harness so plugin authors'
 * tests see exactly the events production fires: one per real column change,
 * none for writes that keep the column.
 */
import type { BakinTask, BakinTaskStoreEvent } from './store'

export interface TaskStatusChangedPayload {
  [key: string]: unknown
  taskId: string
  title: string
  from: string
  to: string
  task: BakinTask
}

export function taskStatusChangedPayload(event: BakinTaskStoreEvent): TaskStatusChangedPayload | null {
  if (event.type !== 'updated' || event.previousColumn === undefined || !event.task) return null
  const { task } = event
  return { taskId: task.id, title: task.title, from: event.previousColumn, to: task.column, task }
}
