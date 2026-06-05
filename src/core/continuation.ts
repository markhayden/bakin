/**
 * Task dependency continuation — re-dispatches dependent tasks when their
 * dependency completes.
 *
 * This is a FULL re-dispatch through the normal dispatch path (fresh
 * per-attempt session, complete self-contained prompt with a Completed
 * Dependency block, lessons, assets, cooldown/failure machinery). The old
 * implementation sent a bare "resume your task" nudge that only worked
 * because it happened to land in the shared session that still held the
 * original context — a silent dependence on unbounded session history that
 * per-dispatch sessions make explicit.
 */
import { createLogger } from './logger'
import { appendAudit } from './audit'
import { clearDispatchMarker, dispatchSingleTask } from './dispatch'
import { addTaskLog, clearDependency, moveTask, readTaskboard } from './task-store'

const log = createLogger('continuation')

type DependentTask = { id: string; title: string; agent?: string; dependsOn?: string }

export async function checkAndContinueDependents(
  completedTaskId: string,
  completedTitle: string,
  contentDir: string,
  opts: { port?: number } = {},
): Promise<void> {
  const board = readTaskboard() as unknown as {
    columns: {
      inProgress: DependentTask[]
      todo: DependentTask[]
      blocked: DependentTask[]
    }
  }
  const columns = {
    inProgress: board?.columns.inProgress ?? [],
    todo: board?.columns.todo ?? [],
    blocked: board?.columns.blocked ?? [],
  }
  const port = opts.port ?? Number(process.env.PORT || 3737)

  const dependents: Array<{ task: DependentTask; column: 'inProgress' | 'todo' | 'blocked' }> = [
    ...columns.inProgress.map((task) => ({ task, column: 'inProgress' as const })),
    ...columns.todo.map((task) => ({ task, column: 'todo' as const })),
    ...columns.blocked.map((task) => ({ task, column: 'blocked' as const })),
  ].filter(({ task }) => task.dependsOn === completedTaskId)

  for (const { task, column } of dependents) {
    await clearDependency(task.id)

    // Active work in flight — the agent will see the completion through its
    // own task context; re-dispatching would double-run the task.
    if (column === 'inProgress') {
      log.info('Skipping continuation — task already in progress', { id: task.id, title: task.title })
      continue
    }

    if (column === 'blocked') {
      try {
        await moveTask(task.id, 'todo', 'blocked')
        await addTaskLog(task.id, 'system', `Dependency "${completedTitle}" completed — unblocked for re-dispatch.`)
      } catch (err) {
        log.error('Continuation failed to unblock dependent task', err, { id: task.id })
        continue
      }
    }

    let dispatched = false
    try {
      // The task's previous dispatch marker may still linger until the next
      // cycle reconciles — clear it so the immediate re-dispatch isn't
      // skipped as "already dispatched".
      await clearDispatchMarker(contentDir, task.id)
      await dispatchSingleTask(task.id, contentDir, port, 'continuation', {
        completedDependency: { id: completedTaskId, title: completedTitle },
      })
      dispatched = true
      log.info('Continuation re-dispatched', { id: task.id, title: task.title, completedDep: completedTaskId })
    } catch (err) {
      log.error(`Continuation re-dispatch failed for "${task.title}"`, err)
      try {
        await addTaskLog(task.id, 'system', `Continuation re-dispatch failed: ${err instanceof Error ? err.message : String(err)}`)
      } catch { /* best effort */ }
    }

    appendAudit(contentDir, 'task.continuation', task.agent ?? 'system', {
      id: task.id,
      title: task.title,
      completedDep: completedTaskId,
      dispatched,
    })
  }
}
