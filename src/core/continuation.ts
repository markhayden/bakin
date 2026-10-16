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
import { withStateLock } from './dispatch-state'
import { addTaskLog, clearDependency, moveTask, readTaskboard } from './task-store'
import { isStrandedInProgress } from './task-liveness'

const log = createLogger('continuation')

type DependentTask = { id: string; title: string; agent?: string; workflowId?: string; dependsOn?: string }

/**
 * Read the board, decide per dependent, and apply the board mutations — all
 * under the dispatch state lock so a settling turn (which parks under the
 * same lock) and this reconciliation never interleave on one task. Returns
 * the dependents that now sit in todo and need a re-dispatch; the caller
 * dispatches AFTER the lock is released because dispatchSingleTask takes the
 * same non-reentrant lock.
 */
async function reconcileDependents(completedTaskId: string, completedTitle: string): Promise<DependentTask[]> {
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

  const dependents: Array<{ task: DependentTask; column: 'inProgress' | 'todo' | 'blocked' }> = [
    ...columns.inProgress.map((task) => ({ task, column: 'inProgress' as const })),
    ...columns.todo.map((task) => ({ task, column: 'todo' as const })),
    ...columns.blocked.map((task) => ({ task, column: 'blocked' as const })),
  ].filter(({ task }) => task.dependsOn === completedTaskId)

  const toDispatch: DependentTask[] = []
  for (const { task, column } of dependents) {
    if (column === 'inProgress') {
      // The workflow engine owns step flow for its own tasks; a gate-held
      // instance is legitimately idle without a run.
      if (task.workflowId) {
        await clearDependency(task.id, completedTaskId)
        log.info('Skipping continuation — workflow task is in progress', { id: task.id, title: task.title })
        continue
      }
      // Active work in flight — the agent sees the completion through its
      // own task context; re-dispatching would double-run the task. The
      // dependency STAYS recorded: that turn may have just registered it and
      // stopped, and the settle-time park reads dependsOn to know the task
      // is waiting (spec D2) — it clears the satisfied dependency itself.
      if (!isStrandedInProgress({ id: task.id, column: 'inProgress' })) {
        log.info('Skipping continuation — task holds a live run', { id: task.id, title: task.title })
        continue
      }
      // In progress with NO live run: the parent delegated and its turn
      // ended, so nobody is executing it (found live on margo — the Daily
      // Scramble parent idled until watchdog recovery). Re-queue it.
      try {
        // The snapshot is the board read above; every clear is conditional on
        // the task STILL waiting on this completion (the dependency route
        // takes no lock), so a replacement dependency is never erased and a
        // task that moved on is left alone (code review round 3).
        if (!(await clearDependency(task.id, completedTaskId))) {
          log.info('Skipping continuation — dependency replaced since the board read', { id: task.id, title: task.title })
          continue
        }
        await moveTask(task.id, 'todo', 'inProgress')
        await addTaskLog(task.id, 'system', `Dependency "${completedTitle}" completed — no live run, re-queued for dispatch.`)
      } catch (err) {
        log.error('Continuation failed to re-queue idle dependent task', err, { id: task.id })
        continue
      }
    } else if (column === 'blocked') {
      try {
        if (!(await clearDependency(task.id, completedTaskId))) {
          log.info('Skipping continuation — dependency replaced since the board read', { id: task.id, title: task.title })
          continue
        }
        await moveTask(task.id, 'todo', 'blocked')
        await addTaskLog(task.id, 'system', `Dependency "${completedTitle}" completed — unblocked for re-dispatch.`)
      } catch (err) {
        log.error('Continuation failed to unblock dependent task', err, { id: task.id })
        continue
      }
    } else if (!(await clearDependency(task.id, completedTaskId))) {
      log.info('Skipping continuation — dependency replaced since the board read', { id: task.id, title: task.title })
      continue
    }
    toDispatch.push(task)
  }
  return toDispatch
}

export async function checkAndContinueDependents(
  completedTaskId: string,
  completedTitle: string,
  contentDir: string,
  opts: { port?: number } = {},
): Promise<void> {
  const port = opts.port ?? Number(process.env.PORT || 3737)
  const toDispatch = await withStateLock(() => reconcileDependents(completedTaskId, completedTitle))

  for (const task of toDispatch) {
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
