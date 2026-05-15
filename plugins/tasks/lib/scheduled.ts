import type { Task, TaskColumns } from '../types'

export function getTaskAvailableAtMs(task: Task): number | null {
  if (!task.availableAt) return null
  const timestamp = Date.parse(task.availableAt)
  return Number.isNaN(timestamp) ? null : timestamp
}

export function isFutureScheduledTask(task: Task, nowMs = Date.now()): boolean {
  const availableAtMs = getTaskAvailableAtMs(task)
  return availableAtMs !== null && availableAtMs > nowMs
}

export function splitScheduledTasks(tasks: Task[], nowMs = Date.now()): { ready: Task[]; scheduled: Task[] } {
  const ready: Task[] = []
  const scheduled: Task[] = []
  for (const task of tasks) {
    if (isFutureScheduledTask(task, nowMs)) scheduled.push(task)
    else ready.push(task)
  }
  return { ready, scheduled }
}

export function countVisibleTasks(columns: TaskColumns, showScheduled: boolean, nowMs = Date.now()): number {
  return Object.values(columns).reduce((count, tasks) => (
    count + (showScheduled ? tasks.length : splitScheduledTasks(tasks, nowMs).ready.length)
  ), 0)
}
