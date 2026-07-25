/**
 * Workflow Task Bridge
 *
 * The single auditable crossing into the core task-store / task-service. Every
 * board-task side effect a workflow performs — moves, logs, completion, child
 * board tasks — lives here. CLAUDE.md flags this as the natural place to later
 * swap direct core imports for ctx.tasks / hook calls.
 */
import type { WorkflowInstance, WorkflowDefinition, AgentStep, NestedWorkflowStep, MapWorkflowStep } from '../types'
import { getContentDir } from './content-dir'
import { createLogger } from '@bakin/core/logger'
import {
  addTaskLog,
  createTask,
  getTask,
  getTaskWithColumn,
} from '../../../src/core/task-store'
import { syncLedgerForStoreMove } from '../../../src/core/task-service'
import { isTeamStepToken } from '@bakin/core/workflows/team-token'
import { listInstances } from './instance-store'
import { resolveAgent } from './step-context'

const log = createLogger('workflow-runtime')

type BoardTask = { id: string; title?: string; description?: string }

export async function findTaskFromStore(taskId: string): Promise<BoardTask | null> {
  return getTask(taskId)
}

export async function addTaskLogToStore(identifier: string, author: string, message: string): Promise<void> {
  await addTaskLog(identifier, author, message)
}

// Every workflow move goes through the ledger-sync helper: leaving done
// deletes the completion row (reopen), landing on done records one — the
// raw store move alone would strand/skip rows (#482 path 2).
export async function moveTaskInStore(identifier: string, to: string, from?: string): Promise<void> {
  await syncLedgerForStoreMove(identifier, to, 'workflow', { from })
}

interface WorkflowTaskReviewMoveResult {
  moved: boolean
  skipped: boolean
  reason?: string
}

async function moveWorkflowTaskToReview(identifier: string): Promise<WorkflowTaskReviewMoveResult> {
  const taskWithColumn = getTaskWithColumn(identifier)
  const currentColumn = taskWithColumn?.column

  if (currentColumn === 'review') return { moved: false, skipped: false }

  if (currentColumn === 'todo') {
    await moveTaskInStore(identifier, 'inProgress')
    await moveTaskInStore(identifier, 'review')
    return { moved: true, skipped: false }
  }

  if (currentColumn === 'inProgress') {
    await moveTaskInStore(identifier, 'review')
    return { moved: true, skipped: false }
  }

  if (!currentColumn) {
    await moveTaskInStore(identifier, 'review')
    return { moved: true, skipped: false }
  }

  log.warn('Workflow reached a review gate but task is in a non-reviewable column', {
    taskId: identifier,
    column: currentColumn,
  })
  return { moved: false, skipped: true, reason: `non-reviewable column: ${currentColumn}` }
}

export { moveWorkflowTaskToReview }

export interface PendingApprovalTaskColumnReconcileResult {
  checked: number
  moved: number
  skipped: number
  failed: Array<{ taskId: string; error: string }>
}

export async function reconcilePendingApprovalTaskColumns(contentDir?: string): Promise<PendingApprovalTaskColumnReconcileResult> {
  const dir = contentDir || getContentDir()
  const result: PendingApprovalTaskColumnReconcileResult = {
    checked: 0,
    moved: 0,
    skipped: 0,
    failed: [],
  }

  for (const instance of listInstances('pending_approval', dir)) {
    result.checked += 1
    try {
      const move = await moveWorkflowTaskToReview(instance.taskId)
      if (move.moved) result.moved += 1
      if (move.skipped) result.skipped += 1
    } catch (err) {
      result.failed.push({
        taskId: instance.taskId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return result
}

export async function completeTaskViaHooks(instance: WorkflowInstance, from: string): Promise<void> {
  const task = await findTaskFromStore(instance.taskId).catch(() => null)
  await addTaskLogToStore(instance.taskId, 'workflow', `Workflow "${instance.workflowId}" completed - all steps done.`)
  await moveTaskInStore(instance.taskId, 'done', from)
  const { appendAudit } = await import('../../../src/core/audit')
  await appendAudit(getContentDir(), 'task.moved', 'workflow', {
    id: instance.taskId,
    ...(task?.title ? { title: task.title } : {}),
    from,
    to: 'done',
  })
}

/**
 * Create a board task for a nested workflow so it's visible in the UI.
 * Fire-and-forget — the workflow instance is the source of truth;
 * the board task is just for visibility and gate approvals.
 *
 * Idempotent: skips the INSERT if a task with `childTaskId` already exists.
 * Without this guard, the watchdog's stale-task recovery (which moves a
 * parent workflow task back to todo and re-dispatches it) can re-run
 * advanceWorkflow() and create a duplicate "Run Child" row for the same
 * nested workflow step — one of the root causes of the mystery "child-wf"
 * tasks on the board.
 */
export function createBoardTaskForChild(
  childTaskId: string,
  parentTaskId: string,
  nestedStep: NestedWorkflowStep | MapWorkflowStep,
  childDef: WorkflowDefinition | null,
  childInstance: WorkflowInstance,
  /** Map fan-out children: fraction titles + board-task revive on id reuse. */
  mapMeta?: { index: number; total: number },
) {
  void (async () => {
    if (await findTaskFromStore(childTaskId)) {
      if (mapMeta) {
        // Reused map-child id (re-fan-out after a source rewind) — pull the
        // existing board task back into active work instead of duplicating.
        await moveTaskInStore(childTaskId, 'inProgress')
        return
      }
      log.debug(`Skipping duplicate child task for ${childTaskId} — already on board`)
      return
    }

    let title = `${nestedStep.label || nestedStep.workflow_id} (sub-workflow)`
    if (mapMeta) {
      const parentTask = await findTaskFromStore(parentTaskId)
      const fraction = `${nestedStep.label || nestedStep.workflow_id} ${mapMeta.index + 1}/${mapMeta.total}`
      title = parentTask?.title ? `${parentTask.title} — ${fraction}` : `${fraction} (sub-workflow)`
    }
    const description = nestedStep.description || childDef?.description || undefined
    // Seed the assignee from the child workflow's first agent step, resolved
    // through the same selector engine dispatch uses (resolveAgent handles
    // $assigned and $preferred(...) against the instance's agent snapshot).
    // Storing a raw selector string here left fan-out tasks with an
    // unrenderable "$preferred(pixel,$assigned)" agent on the board.
    const childAgent = childDef?.steps.find(s => s.type === 'agent')
    const agent = childAgent ? (childAgent as AgentStep).agent : childInstance.resolvedAgent
    const resolved = agent ? resolveAgent(agent, childInstance, childAgent?.id) : undefined
    // Selectors AND unresolved team tokens are unrenderable on the board —
    // fall back to the instance's snapshotted assignee.
    const resolvedAgent = resolved && !resolved.startsWith('$') && !isTeamStepToken(resolved) ? resolved : childInstance.resolvedAgent

    await createTask(
      title,
      'inProgress',
      resolvedAgent,
      description?.trim(),
      nestedStep.workflow_id,
      'workflow',
      childTaskId,
    )
    await addTaskLogToStore(childTaskId, 'workflow', `Sub-workflow of task ${parentTaskId}`)
  })().catch((err) => {
    log.error(`Failed to create board task for child ${childTaskId}`, err)
  })
}
