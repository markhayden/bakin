/**
 * Task search-document helpers.
 *
 * Extracted from index.ts. `taskToSearchDoc` shapes a task into the
 * `bakin_tasks` content-type document; `indexTask` finds a task on the board by
 * id and upserts it. Used by the REST routes, the exec tools, and the search
 * content-type reindex generator. Direct precedent: plugins/assets/lib/search-doc.ts.
 */
import type { PluginContextLite } from '@bakin/core/routing'

import { readTaskboard } from '../../../src/core/task-store'
import { createLogger } from '../../../src/core/logger'
import type { Task, ColumnId } from '../types'

const log = createLogger('tasks')

export function taskToSearchDoc(task: Task, column: ColumnId): Record<string, unknown> {
  const logText = task.log?.map(l => `[${l.timestamp} ${l.author}] ${l.message}`).join('\n') || ''
  return {
    title: task.title,
    description: task.description || '',
    agent: task.agent || '',
    created_by: task.createdBy || '',
    status: column,
    project_id: task.projectId || '',
    brand_id: task.brandId || '',
    workflow_id: task.workflowId || '',
    source_plugin_id: task.source?.pluginId || '',
    source_entity_type: task.source?.entityType || '',
    source_entity_id: task.source?.entityId || '',
    source_purpose: task.source?.purpose || '',
    available_at: task.availableAt || '',
    due_at: task.dueAt || '',
    log_text: logText,
    blocked_reason: task.blockedReason || '',
    updated_at: new Date().toISOString(),
  }
}

export async function indexTask(ctx: PluginContextLite, taskId: string): Promise<void> {
  try {
    const board = readTaskboard()
    const columns = board.columns as unknown as Record<string, Task[]>
    for (const [colName, tasks] of Object.entries(columns)) {
      const task = tasks.find(t => t.id === taskId)
      if (task) {
        await ctx.search.index(taskId, taskToSearchDoc(task, colName as ColumnId))
        return
      }
    }
  } catch (err) {
    log.warn('Failed to index task', { taskId, error: err instanceof Error ? err.message : String(err) })
  }
}
