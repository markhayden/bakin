/**
 * Task dependency continuation — re-dispatches dependent tasks when dependencies complete.
 * Includes retry logic and dedup to prevent double-dispatch.
 */
import { createLogger } from './logger'
import { appendAudit } from './audit'
import * as openclaw from './openclaw-client'
import { getMainAgentId } from '@bakin/core/main-agent'

const log = createLogger('continuation')

const MAX_RETRIES = 3
const RETRY_DELAY_MS = 5000

export async function checkAndContinueDependents(
  completedTaskId: string,
  completedTitle: string,
  contentDir: string,
  port: number
): Promise<void> {
  const { readAllColumns, clearDependency, addTaskLog } = await import('../lib/taskboard')
  const columns = readAllColumns()

  const columnsToScan = [columns.inProgress, columns.todo, columns.blocked]
  for (const col of columnsToScan) {
    for (const task of col) {
      if (task.dependsOn === completedTaskId) {
        // Dedup: skip if task is already in progress (another path may have re-dispatched it)
        const isAlreadyInProgress = columns.inProgress.some(t => t.id === task.id)
        if (isAlreadyInProgress) {
          log.info('Skipping continuation — task already in progress', { id: task.id, title: task.title })
          await clearDependency(task.id)
          continue
        }

        await clearDependency(task.id)

        const agentId = task.agent ?? getMainAgentId()
        const mcServer = `bakin-${agentId}`
        const resumeMsg = `Your dependency task "${completedTitle}" is now Done. Resume your task: "${task.title}". Continue from where you left off.

Your Bakin MCP server is \`${mcServer}\`. Use mcporter for all interactions:
\`\`\`bash
mcporter call ${mcServer}.bakin_exec_tasks_log_progress taskId=${task.id} message="<update>"
mcporter call ${mcServer}.bakin_exec_tasks_complete taskId=${task.id} summary="<what you did>"
mcporter call ${mcServer}.bakin_exec_tasks_block taskId=${task.id} reason="<why>"
mcporter call ${mcServer}.bakin_exec_tasks_get taskId=${task.id}
\`\`\``

        let sent = false
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          try {
            await openclaw.sendMessage(agentId, resumeMsg)
            log.info('Continuation dispatched', { id: task.id, title: task.title, completedDep: completedTaskId, attempt })
            sent = true
            break
          } catch (err) {
            if (attempt === MAX_RETRIES) {
              log.error(`Continuation failed after ${MAX_RETRIES} attempts for "${task.title}"`, err)
              try {
                await addTaskLog(task.id, 'system', `Continuation re-dispatch failed after ${MAX_RETRIES} attempts: agent "${agentId}" unreachable`)
              } catch { /* best effort */ }
            } else {
              log.warn(`Continuation attempt ${attempt} failed for "${task.title}", retrying in ${RETRY_DELAY_MS}ms`, err)
              await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
            }
          }
        }

        appendAudit(contentDir, 'task.continuation', agentId, {
          id: task.id,
          title: task.title,
          completedDep: completedTaskId,
          sent,
        })
      }
    }
  }
}
