/**
 * The ONE public task shape for plugins, both directions: `toPluginTask`
 * projects a stored task (derived `checked`, public fields only) and
 * `taskPatchFromPublic` translates a `ctx.tasks.update` patch (`checked` is a
 * column move, nullable fields clear). Shared by the host's plugin task
 * service and the SDK testing harness so plugins behave — and fire
 * `tasks.statusChanged` — identically in both.
 */
import type { PluginTask, PluginTaskColumn, PluginTaskUpdateInput } from '../plugin-types'
import type { BakinTask, BakinTaskPatch } from './store'

function isDoneColumn(column: string): boolean {
  return column === 'done' || column === 'archived'
}

export function toPluginTask(task: BakinTask): PluginTask {
  return {
    id: task.id,
    title: task.title,
    agent: task.agent,
    createdBy: task.createdBy,
    checked: isDoneColumn(task.column),
    column: task.column as PluginTaskColumn,
    date: task.date,
    blockedReason: task.blockedReason,
    description: task.description,
    log: task.log.map(({ timestamp, author, message, data }) => ({ timestamp, author, message, data })),
    dependsOn: task.dependsOn,
    parentId: task.parentId,
    workflowId: task.workflowId,
    scheduleJobId: task.scheduleJobId,
    projectId: task.projectId,
    brandId: task.brandId,
    tags: task.tags,
    availableAt: task.availableAt,
    dueAt: task.dueAt,
    source: task.source,
    order: task.order,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  }
}


export function taskPatchFromPublic(patch: PluginTaskUpdateInput): BakinTaskPatch {
  const next: BakinTaskPatch = {}
  if ('title' in patch) next.title = patch.title
  if ('description' in patch) next.description = patch.description
  if ('agent' in patch) next.agent = patch.agent
  if ('createdBy' in patch) next.createdBy = patch.createdBy
  if ('column' in patch && patch.column) next.column = patch.column
  if ('checked' in patch && patch.checked !== undefined) next.column = patch.checked ? 'done' : 'todo'
  if ('date' in patch) next.date = patch.date
  if ('blockedReason' in patch) next.blockedReason = patch.blockedReason
  if ('workflowId' in patch) next.workflowId = patch.workflowId
  if ('scheduleJobId' in patch) next.scheduleJobId = patch.scheduleJobId
  if ('projectId' in patch) next.projectId = patch.projectId
  if ('brandId' in patch) next.brandId = patch.brandId
  if ('tags' in patch) next.tags = patch.tags ?? []
  if ('parentId' in patch) next.parentId = patch.parentId
  if ('availableAt' in patch) next.availableAt = patch.availableAt || undefined
  if ('dueAt' in patch) next.dueAt = patch.dueAt || undefined
  if ('source' in patch) next.source = patch.source || undefined
  return next
}
