/**
 * Taskboard reads + dispatch-eligibility policy + the thin task-store wrappers
 * the dispatch fire-path uses. Pure reads/policy — no dispatch state, no mutex,
 * no fire-path. Extracted from dispatch.ts.
 */
import { createLogger } from './logger'
import {
  addTaskLog as appendTaskLog,
  readTaskboard,
  updateTask as updateStoredTask,
} from './task-store'
import type {
  DispatchColumns,
  DispatchEligibility,
  DispatchEligibilityContext,
  DispatchTask,
  DispatchTaskSnapshot,
} from './dispatch-types'

const log = createLogger('dispatch')

export function emptyDispatchColumns(): DispatchColumns {
  return {
    backlog: [],
    todo: [],
    inProgress: [],
    review: [],
    done: [],
    blocked: [],
    archived: [],
  }
}

export async function readDispatchColumns(): Promise<DispatchColumns> {
  const board = readTaskboard() as unknown as { columns: Partial<DispatchColumns> }
  return { ...emptyDispatchColumns(), ...(board?.columns ?? {}) }
}

export function isTaskDispatchEligible(
  task: DispatchTask,
  context: DispatchEligibilityContext,
): DispatchEligibility {
  if (task.availableAt) {
    const availableMs = Date.parse(task.availableAt)
    if (!Number.isNaN(availableMs) && availableMs > context.nowMs) {
      return { eligible: false, reason: 'scheduled' }
    }
  }

  let danglingDependency: string | undefined
  if (task.dependsOn && !context.completedTaskIds.has(task.dependsOn)) {
    const targetExists = context.knownTaskIds ? context.knownTaskIds.has(task.dependsOn) : true
    if (targetExists) {
      return { eligible: false, reason: 'dependency' }
    }
    danglingDependency = task.dependsOn
  }

  if (task.agent && !context.runtimeAgentIds.has(task.agent)) {
    return { eligible: false, reason: 'agent' }
  }

  return { eligible: true, ...(danglingDependency ? { danglingDependency } : {}) }
}

export async function addTaskLog(taskId: string, author: string, message: string, data?: Record<string, unknown>): Promise<void> {
  if (data) await appendTaskLog(taskId, author, message, data)
  else await appendTaskLog(taskId, author, message)
}

export async function moveTaskToInProgress(taskId: string, agent: string): Promise<void> {
  await updateStoredTask(taskId, { column: 'inProgress', agent })
}

export function findDispatchTaskSnapshot(taskId: string): DispatchTaskSnapshot | null {
  const { columns } = readTaskboard() as unknown as { columns: DispatchColumns }
  for (const column of Object.keys(emptyDispatchColumns()) as Array<keyof DispatchColumns>) {
    const task = columns[column]?.find(t => t.id === taskId)
    if (task) return { column, task }
  }
  return null
}

export function taskAlreadyLeftActiveWork(column: keyof DispatchColumns): boolean {
  return column === 'done' || column === 'blocked' || column === 'review' || column === 'archived'
}

export async function tryAddTaskLog(taskId: string, author: string, message: string, data?: Record<string, unknown>): Promise<void> {
  try {
    if (data) await addTaskLog(taskId, author, message, data)
    else await addTaskLog(taskId, author, message)
  } catch (err) {
    log.warn('Failed to append dispatch reconciliation task log', err, { id: taskId })
  }
}

export function shouldBlockAfterDispatchFailure(
  snapshot: DispatchTaskSnapshot,
  initialLogCount: number,
): boolean {
  return (snapshot.task.log?.length ?? 0) > initialLogCount
}
