/**
 * Restart recovery — one-shot boot repair for orphaned in-progress tasks.
 *
 * The runtime adapter owns live execution. Bakin owns task state. On server
 * restart, any task still marked inProgress but whose active agent heartbeat is
 * missing/stale can be returned to todo so normal dispatch can pick it up.
 */
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { createLogger } from './logger'
import { getSettings } from './settings'
import { appendAudit } from './audit'
import { isStale } from '../lib/format'
import { getHookRegistry } from '../lib/plugin-registry'
import {
  addTaskLog,
  blockTask,
  moveTask,
  readTaskboard,
} from './task-store'

const log = createLogger('restart-recovery')
const hooks = () => getHookRegistry()

const HEARTBEAT_STALE_MS = 15 * 60 * 1000
const RESTART_RECOVERY_PREFIX = 'Restart recovery:'
const WATCHDOG_RECOVERY_PREFIX = 'Auto-recovered:'

type RecoveryAction = 'recover' | 'block' | 'manual'

type RecoveryReason =
  | 'plain-agent-stale'
  | 'workflow-agent-stale'
  | 'workflow-instance-missing'
  | 'workflow-no-active-agents'
  | 'workflow-partial-agent-stale'
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

type WorkflowAgent = {
  agent: string
  stepId?: string
  effectiveTaskId?: string
}

export interface RestartRecoveryCandidate {
  id: string
  title: string
  agent?: string
  workflowId?: string
  effectiveAgents: string[]
  staleAgents: string[]
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

function isAgentHeartbeatStale(contentDir: string, agent: string | undefined): boolean {
  if (!agent) return true

  const heartbeatPath = join(contentDir, 'heartbeats', `${agent}.json`)
  try {
    if (!existsSync(heartbeatPath)) return true
    const data = JSON.parse(readFileSync(heartbeatPath, 'utf-8'))
    const ts = data.timestamp || data.ts
    if (!ts) return true
    return isStale(ts, HEARTBEAT_STALE_MS)
  } catch {
    return true
  }
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
      staleAgents: uniq([task.agent]),
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
      staleAgents: [],
      recoveryCount,
      reason: 'workflow-not-running',
      action: 'manual',
    }
  }

  const activeAgents = await hooks().invoke<WorkflowAgent[]>('workflows.getActiveAgents', {
    taskId: task.id,
    contentDir,
  }) ?? []
  const effectiveAgents = uniq(activeAgents.map((entry) => entry.agent))

  if (effectiveAgents.length === 0) {
    return {
      id: task.id,
      title: task.title,
      agent: task.agent,
      workflowId: task.workflowId,
      effectiveAgents: [],
      staleAgents: [],
      recoveryCount,
      reason: 'workflow-no-active-agents',
      action: 'manual',
    }
  }

  const staleAgents = effectiveAgents.filter((agent) => isAgentHeartbeatStale(contentDir, agent))
  if (staleAgents.length === 0) return null

  if (staleAgents.length !== effectiveAgents.length) {
    return {
      id: task.id,
      title: task.title,
      agent: task.agent,
      workflowId: task.workflowId,
      effectiveAgents,
      staleAgents,
      recoveryCount,
      reason: 'workflow-partial-agent-stale',
      action: 'manual',
    }
  }

  return withActionForRecoveryLimit(task, {
    effectiveAgents,
    staleAgents,
    reason: 'workflow-agent-stale',
  })
}

async function assessTask(task: RecoveryTask, contentDir: string): Promise<RestartRecoveryCandidate | null> {
  if (task.workflowId) {
    return assessWorkflowTask(task, contentDir)
  }

  if (!isAgentHeartbeatStale(contentDir, task.agent)) return null

  return withActionForRecoveryLimit(task, {
    effectiveAgents: uniq([task.agent]),
    staleAgents: uniq([task.agent]),
    reason: 'plain-agent-stale',
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
      result.skipped++
      continue
    }

    try {
      if (candidate.action === 'block') {
        await blockTask(
          candidate.id,
          `Restart recovery limit reached (${candidate.recoveryCount} attempts). Active agent heartbeat is missing or stale.`,
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
        `${RESTART_RECOVERY_PREFIX} inactive agent heartbeat after server restart; returned to Todo for re-dispatch.`,
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
