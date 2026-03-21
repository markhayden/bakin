/**
 * Task dependency continuation — re-dispatches dependent tasks when dependencies complete.
 */
import { createLogger } from './logger'
import { appendAudit } from './audit'
import * as openclaw from './openclaw-client'

const log = createLogger('continuation')

const AGENT_ID_MAP: Record<string, string> = { roscoe: 'main' }

export async function checkAndContinueDependents(
  completedTaskId: string,
  completedTitle: string,
  contentDir: string,
  port: number
): Promise<void> {
  const { readAllColumns, clearDependency } = await import('../lib/taskboard')
  const columns = readAllColumns()

  const columnsToScan = [columns.inProgress, columns.todo, columns.blocked]
  for (const col of columnsToScan) {
    for (const task of col) {
      if (task.dependsOn === completedTaskId) {
        await clearDependency(task.id)

        const agentId = task.agent ? (AGENT_ID_MAP[task.agent] || task.agent) : 'main'
        const resumeMsg = `Your dependency task "${completedTitle}" is now Done. Resume your task: "${task.title}". Continue from where you left off. Log: POST http://localhost:${port}/api/tasks/log. When done, move to done and report to roscoe.`

        try {
          await openclaw.sendMessage(agentId, resumeMsg)
          log.info('Continuation dispatched', { id: task.id, title: task.title, completedDep: completedTaskId })
        } catch (err) {
          log.error(`Failed to re-dispatch continuation for "${task.title}"`, err)
        }

        appendAudit(contentDir, 'task.continuation', agentId, {
          id: task.id,
          title: task.title,
          completedDep: completedTaskId,
        })
      }
    }
  }
}
