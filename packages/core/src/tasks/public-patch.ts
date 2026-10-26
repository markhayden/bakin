/**
 * The ONE translation from the public `ctx.tasks.update` patch to a store
 * patch — `checked` is a column move, nullable fields clear. Shared by the
 * host's plugin task service and the SDK testing harness so a plugin's
 * update behaves (and fires `tasks.statusChanged`) identically in both.
 */
import type { PluginTaskUpdateInput } from '../plugin-types'
import type { BakinTaskPatch } from './store'

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
