/**
 * Restart recovery — one-shot boot repair for stranded in-progress tasks.
 *
 * The runtime adapter owns live execution. Bakin owns task state. The
 * execution ledger is the only liveness authority (spec D3): the boot sweep
 * marks every prior-boot run lost first, so any task still in progress with
 * no running row is stranded and can be returned to todo for re-dispatch.
 */
import { createLogger } from './logger'
import { getSettings } from './settings'
import { appendAudit } from './audit'
import { getHookRegistry } from '@bakin/core/hooks/hook-registry-singleton'
import { assessWorkflowRuns, isStrandedInProgress, type WorkflowActiveAgent } from './task-liveness'
import {
  addTaskLog,
  blockTask,
  moveTask,
  readTaskboard,
} from './task-store'

const log = createLogger('restart-recovery')
const hooks = () => getHookRegistry()

const RESTART_RECOVERY_PREFIX = 'Restart recovery:'
const WATCHDOG_RECOVERY_PREFIX = 'Auto-recovered:'

type RecoveryAction = 'recover' | 'block' | 'manual'

type RecoveryReason =
  | 'no-live-run'
  | 'workflow-no-live-run'
  | 'workflow-instance-missing'
  | 'workflow-no-active-agents'
  | 'workflow-partial-live-run'
  | 'workflow-not-running'

type RecoveryTask = {
  id: string
  title: string
  agent?: string
  workflowId?: string
  log?: Array<{ message?: string; timestamp?: string }>
}

type WorkflowInstanceLike = {
  status?: string
}

export interface RestartRecoveryCandidate {
  id: string
  title: string
  agent?: string
  workflowId?: string
  /** Agents the task (or its active workflow steps) is assigned to. */
  effectiveAgents: string[]
  /** Exec keys the ledger holds no running row for (`taskId` or `taskId:stepId`). */
  missingRuns: string[]
  recoveryCount: number
  reason: RecoveryReason
  action: RecoveryAction
}

export interface RestartRecoveryResult {
  recovered: number
  blocked: number
  skipped: number
  candidates: RestartRecoveryCandidate[]
}

function countRecoveries(task: RecoveryTask): number {
  return (task.log ?? []).filter((entry) => {
    const message = entry.message ?? ''
    return message.startsWith(RESTART_RECOVERY_PREFIX) || message.startsWith(WATCHDOG_RECOVERY_PREFIX)
  }).length
}

function uniq(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => !!value))]
}

function withActionForRecoveryLimit(
  task: RecoveryTask,
  candidate: Omit<RestartRecoveryCandidate, 'id' | 'title' | 'agent' | 'workflowId' | 'recoveryCount' | 'action'>,
): RestartRecoveryCandidate {
  const settings = getSettings()
  const recoveryCount = countRecoveries(task)
  return {
    id: task.id,
    title: task.title,
    agent: task.agent,
    workflowId: task.workflowId,
    recoveryCount,
    ...candidate,
    action: recoveryCount >= settings.watchdog.maxAutoRecoveries ? 'block' : 'recover',
  }
}

async function assessWorkflowTask(
  task: RecoveryTask,
  contentDir: string,
): Promise<RestartRecoveryCandidate | null> {
  const recoveryCount = countRecoveries(task)
  const instance = await hooks().invoke<WorkflowInstanceLike | null>('workflows.loadInstance', {
    taskId: task.id,
    contentDir,
  })

  if (!instance) {
    return withActionForRecoveryLimit(task, {
      effectiveAgents: uniq([task.agent]),
      missingRuns: [task.id],
      reason: 'workflow-instance-missing',
    })
  }

  if (instance.status === 'pending_approval' || instance.status === 'complete' || instance.status === 'cancelled') {
    return null
  }

  if (instance.status !== 'in_progress') {
    return {
      id: task.id,
      title: task.title,
      agent: task.agent,
      workflowId: task.workflowId,
      effectiveAgents: [],
      missingRuns: [],
      recoveryCount,
      reason: 'workflow-not-running',
      action: 'manual',
    }
  }

  const activeAgents = await hooks().invoke<WorkflowActiveAgent[]>('workflows.getActiveAgents', {
    taskId: task.id,
    contentDir,
  }) ?? []
  const effectiveAgents = uniq(activeAgents.map((entry) => entry.agent))

  if (activeAgents.length === 0) {
    return {
      id: task.id,
      title: task.title,
      agent: task.agent,
      workflowId: task.workflowId,
      effectiveAgents: [],
      missingRuns: [],
      recoveryCount,
      reason: 'workflow-no-active-agents',
      action: 'manual',
    }
  }

  // Steps claim runs keyed by their (possibly nested-child) task id + step id.
  // A still-running previous-step row (the engine advanced before that turn
  // settled) is execution too — never stranded, never manual (review P1).
  const runs = assessWorkflowRuns(task.id, activeAgents)
  if (runs.missing.length === 0 || (runs.live.length === 0 && runs.otherLive.length > 0)) return null

  if (runs.live.length > 0) {
    return {
      id: task.id,
      title: task.title,
      agent: task.agent,
      workflowId: task.workflowId,
      effectiveAgents,
      missingRuns: runs.missing,
      recoveryCount,
      reason: 'workflow-partial-live-run',
      action: 'manual',
    }
  }

  return withActionForRecoveryLimit(task, {
    effectiveAgents,
    missingRuns: runs.missing,
    reason: 'workflow-no-live-run',
  })
}

async function assessTask(task: RecoveryTask, contentDir: string): Promise<RestartRecoveryCandidate | null> {
  if (task.workflowId) {
    return assessWorkflowTask(task, contentDir)
  }

  if (!isStrandedInProgress({ id: task.id, column: 'inProgress' })) return null

  return withActionForRecoveryLimit(task, {
    effectiveAgents: uniq([task.agent]),
    missingRuns: [task.id],
    reason: 'no-live-run',
  })
}

export async function findRestartRecoveryCandidates(contentDir: string): Promise<RestartRecoveryCandidate[]> {
  const board = readTaskboard() as unknown as { columns?: { inProgress?: RecoveryTask[] } }
  const tasks = board.columns?.inProgress ?? []
  const candidates: RestartRecoveryCandidate[] = []

  for (const task of tasks) {
    try {
      const candidate = await assessTask(task, contentDir)
      if (candidate) candidates.push(candidate)
    } catch (err) {
      log.warn('Failed to assess restart recovery candidate', err, { id: task.id })
    }
  }

  return candidates
}

export async function runRestartRecovery(contentDir: string): Promise<RestartRecoveryResult> {
  const settings = getSettings()
  const candidates = await findRestartRecoveryCandidates(contentDir)
  const result: RestartRecoveryResult = {
    recovered: 0,
    blocked: 0,
    skipped: 0,
    candidates,
  }

  if (settings.restartRecovery?.enabled === false) {
    if (candidates.length > 0) {
      log.warn('Restart recovery disabled; leaving candidates untouched', { count: candidates.length })
    }
    result.skipped = candidates.length
    return result
  }

  for (const candidate of candidates) {
    if (candidate.action === 'manual') {
      // Durable + visible hold: the structured marker makes the watchdog
      // skip this task while it is the latest log entry (any newer activity
      // clears the hold naturally). Deliberately NOT prefixed with
      // RESTART_RECOVERY_PREFIX — countRecoveries() matches that prefix and
      // a manual hold must not count as a recovery attempt.
      try {
        await addTaskLog(
          candidate.id,
          'system',
          `Manual recovery hold: ${candidate.reason} (no live run: ${candidate.missingRuns.join(', ') || 'unknown'}). Left in progress for manual attention; the watchdog will not auto-recover while this is the latest log entry.`,
          { restartRecovery: 'manual' },
        )
      } catch (err) {
        log.warn('Failed to write manual recovery hold marker', err, { taskId: candidate.id })
      }
      result.skipped++
      continue
    }

    try {
      if (candidate.action === 'block') {
        await blockTask(
          candidate.id,
          `Restart recovery limit reached (${candidate.recoveryCount} attempts). No live run in the execution ledger.`,
        )
        await addTaskLog(
          candidate.id,
          'system',
          `${RESTART_RECOVERY_PREFIX} recovery limit reached after ${candidate.recoveryCount} attempts; task moved to blocked for manual review.`,
        )
        appendAudit(contentDir, 'task.restart_recovery_exhausted', 'system', {
          id: candidate.id,
          title: candidate.title,
          agent: candidate.agent,
          workflowId: candidate.workflowId,
          recoveryCount: candidate.recoveryCount,
          reason: candidate.reason,
        })
        result.blocked++
        log.warn('Restart recovery blocked exhausted task', {
          id: candidate.id,
          title: candidate.title,
          recoveryCount: candidate.recoveryCount,
        })
        continue
      }

      await addTaskLog(
        candidate.id,
        'system',
        `${RESTART_RECOVERY_PREFIX} no live run after server restart; returned to Todo for re-dispatch.`,
      )
      await moveTask(candidate.id, 'todo', 'inProgress')
      appendAudit(contentDir, 'task.restart_recovered', 'system', {
        id: candidate.id,
        title: candidate.title,
        agent: candidate.agent,
        workflowId: candidate.workflowId,
        effectiveAgents: candidate.effectiveAgents,
        reason: candidate.reason,
      })
      result.recovered++
      log.info('Restart recovery moved task to todo', {
        id: candidate.id,
        title: candidate.title,
        reason: candidate.reason,
      })
    } catch (err) {
      result.skipped++
      log.error('Restart recovery failed for task', err, { id: candidate.id })
    }
  }

  if (result.recovered > 0 || result.blocked > 0 || result.skipped > 0) {
    log.info('Restart recovery complete', {
      recovered: result.recovered,
      blocked: result.blocked,
      skipped: result.skipped,
    })
  }

  return result
}
