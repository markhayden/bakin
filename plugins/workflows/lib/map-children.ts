/**
 * Per-child recovery operations for map_workflow steps (#203).
 *
 * The unit of retry is the CHILD, never the parent: a live child reopens in
 * place (reopenFromStep); a terminally dead (cancelled/failed/missing) child
 * is re-created under the same childTaskId with its item context rebuilt from
 * the parent's source-step output — the single source of truth. The join in
 * propagateChildCompletion is untouched: these ops only change child state
 * and the parent's children[] bookkeeping, so a blocked join unblocks the
 * moment the retried child completes.
 */
import type { WorkflowInstance, MapWorkflowStep, MapChildEntry, InstanceStatus } from '../types'
import { loadDefinition, findStep } from './parser'
import { getContentDir } from './content-dir'
import { createLogger } from '@bakin/core/logger'
import { loadInstance, saveInstance } from './instance-store'
import { createInstance, cancelInstance, buildMapChildContext } from './engine'
import { reopenFromStep } from './gates'
import { createBoardTaskForChild, moveTaskInStore } from './task-bridge'

const log = createLogger('workflow-runtime')

export interface MapChildOpResult {
  success: boolean
  errors?: string[]
}

export interface MapChildInfo {
  index: number
  childTaskId: string
  /** The parent's join bookkeeping for this child. */
  entryStatus: MapChildEntry['status']
  /** The child instance's actual status — 'missing' when its file is gone. */
  liveStatus: InstanceStatus | 'missing'
  currentStepId?: string
  workflowId?: string
  output?: Record<string, unknown>
}

interface ResolvedMapChild {
  parent: WorkflowInstance
  mapStep: MapWorkflowStep
  entry: MapChildEntry
}

function resolveMapChild(
  parentTaskId: string,
  stepId: string,
  index: number,
  dir: string,
): ResolvedMapChild | { errors: string[] } {
  const parent = loadInstance(parentTaskId, dir)
  if (!parent) return { errors: ['Workflow instance not found'] }
  const def = loadDefinition(parent.workflowId, dir)
  if (!def) return { errors: ['Workflow definition not found'] }
  const step = findStep(def, stepId)
  if (!step || step.type !== 'map_workflow') {
    return { errors: [`Step "${stepId}" is not a map_workflow step`] }
  }
  const entry = parent.stepStates[stepId]?.children?.find((c) => c.index === index)
  if (!entry) return { errors: [`No map child at index ${index} for step "${stepId}"`] }
  return { parent, mapStep: step as MapWorkflowStep, entry }
}

/** Cancel one fan-out child: child instance cancelled, entry marked, board task retired. */
export function cancelMapChild(
  parentTaskId: string,
  stepId: string,
  index: number,
  contentDir?: string,
): MapChildOpResult {
  const dir = contentDir || getContentDir()
  const resolved = resolveMapChild(parentTaskId, stepId, index, dir)
  if ('errors' in resolved) return { success: false, errors: resolved.errors }
  const { parent, entry } = resolved
  if (entry.status === 'complete') {
    return { success: false, errors: ['Child already completed — nothing to cancel'] }
  }

  cancelInstance(entry.childTaskId, dir)
  entry.status = 'cancelled'
  parent.updatedAt = new Date().toISOString()
  saveInstance(parent, dir)
  moveTaskInStore(entry.childTaskId, 'done').catch((err) => {
    log.warn('Failed to retire cancelled map child task', err)
  })
  return { success: true }
}

/**
 * Retry one fan-out child. Live children reopen in place; terminally dead or
 * missing children are re-created under the same childTaskId. Either way the
 * parent entry returns to in_progress so the join waits for the fresh run.
 */
export function retryMapChild(
  parentTaskId: string,
  stepId: string,
  index: number,
  opts: { reason?: string; contentDir?: string } = {},
): MapChildOpResult {
  const dir = opts.contentDir || getContentDir()
  const resolved = resolveMapChild(parentTaskId, stepId, index, dir)
  if ('errors' in resolved) return { success: false, errors: resolved.errors }
  const { parent, mapStep, entry } = resolved
  if (entry.status === 'complete') {
    return { success: false, errors: ['Child already completed — nothing to retry'] }
  }
  if (parent.status === 'cancelled' || parent.status === 'complete') {
    return { success: false, errors: [`Parent workflow is ${parent.status} — children cannot be retried`] }
  }

  const reason = opts.reason || 'Map child retry requested'
  const child = loadInstance(entry.childTaskId, dir)
  if (child && (child.status === 'in_progress' || child.status === 'pending_approval')) {
    const reopened = reopenFromStep(entry.childTaskId, { reason, contentDir: dir })
    if (!reopened.success) return { success: false, errors: reopened.errors }
  } else {
    // Terminally dead (cancelled/failed) or missing — re-create with the item
    // context rebuilt from the parent's source-step output.
    const context = buildMapChildContext(parent, mapStep, index)
    if (!context) {
      return {
        success: false,
        errors: [`Source "${mapStep.source}" no longer resolves an item at index ${index} — re-run the source step instead`],
      }
    }
    const childInstance = createInstance(entry.childTaskId, mapStep.workflow_id, dir, parent.resolvedAgent, context, parent.availableAgents)
    childInstance.parentTaskId = parent.taskId
    childInstance.parentStepId = mapStep.id
    saveInstance(childInstance, dir)
    const total = parent.stepStates[stepId].children?.length ?? index + 1
    createBoardTaskForChild(entry.childTaskId, parent.taskId, mapStep, loadDefinition(mapStep.workflow_id, dir), parent.resolvedAgent, { index, total })
    // The re-created child can fail synchronously inside createInstance
    // (defensive first-step failures) — record an honest entry. The in-spawn
    // markMapChildFailed no-ops there because linkage is assigned after.
    if (childInstance.status === 'failed') {
      entry.status = 'failed'
      parent.updatedAt = new Date().toISOString()
      saveInstance(parent, dir)
      return { success: false, errors: ['Retried child failed during spawn — inspect the child task'] }
    }
  }

  entry.status = 'in_progress'
  delete entry.output
  parent.updatedAt = new Date().toISOString()
  saveInstance(parent, dir)
  return { success: true }
}

/**
 * List a map step's children with LIVE instance statuses. The cached entry
 * can lag reality (e.g. a child cancelled out-of-band still reads
 * in_progress in the parent) — UIs need the truth to offer retry/cancel.
 */
export function listMapChildren(
  parentTaskId: string,
  stepId: string,
  contentDir?: string,
): { success: true; children: MapChildInfo[] } | { success: false; errors: string[] } {
  const dir = contentDir || getContentDir()
  const parent = loadInstance(parentTaskId, dir)
  if (!parent) return { success: false, errors: ['Workflow instance not found'] }
  const entries = parent.stepStates[stepId]?.children
  if (!entries) return { success: false, errors: [`Step "${stepId}" has no map children`] }

  const children = entries.map((entry): MapChildInfo => {
    const child = loadInstance(entry.childTaskId, dir)
    return {
      index: entry.index,
      childTaskId: entry.childTaskId,
      entryStatus: entry.status,
      liveStatus: child?.status ?? 'missing',
      currentStepId: child?.currentStepId,
      workflowId: child?.workflowId,
      output: entry.output,
    }
  })
  return { success: true, children }
}
