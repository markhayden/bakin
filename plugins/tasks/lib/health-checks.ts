/** Canonical Health checks and repair actions owned by the Tasks plugin. */
import { existsSync } from 'fs'
import { join } from 'path'
import { selectRuntimeMainAgent, type AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import type {
  HealthCheckRunInput,
  HealthObservationInput,
  HealthRepairActionDefinition,
  HealthRepairChange,
  HealthRepairPlanItem,
  HealthRepairTarget,
} from '@makinbakin/sdk'
import {
  healthError,
  healthHealthy,
  healthObserved,
  healthUnknown,
  healthWarning,
} from '@makinbakin/sdk/utils'

import { maybeGetAppServices } from '../../../src/core/app-services'
import { clearDependency, readTaskboard, reorderTasks } from '../../../src/core/task-store'
import type { ColumnId, Task } from '../types'

type RuntimeAgentReader = Pick<AgentRuntimeAdapter['agents'], 'list'>

function repairTargetSelection(target: HealthRepairTarget): Pick<
  HealthRepairPlanItem,
  'incidentIds' | 'observationIds' | 'preconditions'
> {
  return {
    incidentIds: target.type === 'incidents' ? [...target.ids] : [],
    observationIds: target.type === 'observations' ? [...target.ids] : [],
    preconditions: [],
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function resolveKnownAgentIds(agentReader?: RuntimeAgentReader): Promise<Set<string>> {
  const knownAgents = new Set<string>()
  try {
    const agents = await (agentReader ?? maybeGetAppServices()?.runtime.agents)?.list()
    for (const agent of agents ?? []) knownAgents.add(agent.id)
    const mainAgent = selectRuntimeMainAgent(agents ?? [])
    if (mainAgent) knownAgents.add(mainAgent.id)
  } catch {
    // Runtime availability has its own check; task consistency remains useful.
  }
  return knownAgents
}

/** Verify that the Bakin task JSON store is readable. */
export function checkTaskboard(): HealthCheckRunInput {
  try {
    const board = readTaskboard()
    const taskCount = Object.values(board.columns).reduce((sum, tasks) => sum + tasks.length, 0)
    return healthObserved([healthHealthy({
      key: 'store',
      summary: `${taskCount} tasks in the Bakin task store.`,
      evidence: { taskCount },
    })])
  } catch (error) {
    return healthObserved([healthError({
      key: 'store',
      summary: 'The Bakin task store could not be read.',
      detail: errorMessage(error),
      incident: {
        key: 'store-unreadable',
        title: 'Task data is unavailable',
        impact: 'Task views, dispatch, and task-based automation may fail until the store is readable.',
        disposition: 'action_required',
        resources: [{ kind: 'system', id: 'task-store', label: 'Task store' }],
        resolution: { key: 'rerun', type: 'rerun', label: 'Retry the task-store check' },
      },
    })])
  }
}

/** Detect task assignments and state that need operator attention. */
export async function checkTaskConsistency(
  contentDir: string,
  agentReader?: RuntimeAgentReader,
): Promise<HealthCheckRunInput> {
  const observations: HealthObservationInput[] = []

  try {
    interface TaskEntry { id: string; title: string; agent?: string; dependsOn?: string; log?: unknown[] }
    const board = readTaskboard() as unknown as {
      columns: { inProgress: TaskEntry[]; done: TaskEntry[] }
    }
    const { columns } = board
    const knownAgents = await resolveKnownAgentIds(agentReader)
    const agentTaskCount: Record<string, number> = {}

    for (const task of columns.inProgress) {
      if (task.agent) agentTaskCount[task.agent] = (agentTaskCount[task.agent] ?? 0) + 1
      const taskResource = { kind: 'task' as const, id: task.id, label: task.title }

      if (task.agent && !knownAgents.has(task.agent)) {
        observations.push(healthWarning({
          key: `unknown-agent:${task.id}`,
          summary: `In-progress task “${task.title}” is assigned to unknown agent “${task.agent}”.`,
          evidence: { taskId: task.id, agentId: task.agent },
          incident: {
            key: `unknown-agent:${task.id}`,
            title: 'A running task is assigned to an unknown agent',
            impact: 'The task may not have a runtime that can continue its work.',
            disposition: 'action_required',
            resources: [taskResource, { kind: 'agent', id: task.agent, label: task.agent }],
            resolution: { key: 'review-task', type: 'navigate', label: 'Review task assignment', href: '/tasks' },
          },
        }))
      }

      const agentId = task.agent ?? 'unassigned'
      const heartbeatPath = join(contentDir, 'heartbeats', `${task.agent ?? 'unknown'}.json`)
      if (!existsSync(heartbeatPath)) {
        observations.push(healthWarning({
          key: `heartbeat-missing:${task.id}`,
          summary: `In-progress task “${task.title}” has no heartbeat for “${agentId}”.`,
          evidence: { taskId: task.id, agentId },
          incident: {
            key: `heartbeat-missing:${task.id}`,
            title: 'A running task has no agent heartbeat',
            impact: 'Work may be stalled even though the task is still marked in progress.',
            disposition: 'watch',
            resources: [taskResource, { kind: 'agent', id: agentId, label: agentId }],
            resolution: { key: 'review-task', type: 'navigate', label: 'Review running task', href: '/tasks' },
          },
        }))
      }

      if (!task.log || task.log.length === 0) {
        observations.push(healthWarning({
          key: `progress-missing:${task.id}`,
          summary: `In-progress task “${task.title}” has no progress entries.`,
          evidence: { taskId: task.id, progressEntries: 0 },
          incident: {
            key: `progress-missing:${task.id}`,
            title: 'A running task has no recorded progress',
            impact: 'Operators cannot tell whether the task is actively advancing.',
            disposition: 'advisory',
            resources: [taskResource],
            resolution: { key: 'review-task', type: 'navigate', label: 'Review task progress', href: '/tasks' },
          },
        }))
      }
    }

    for (const [agentId, count] of Object.entries(agentTaskCount)) {
      if (count <= 3) continue
      observations.push(healthWarning({
        key: `overloaded:${agentId}`,
        summary: `Agent “${agentId}” has ${count} concurrent in-progress tasks.`,
        evidence: { agentId, inProgressTasks: count },
        incident: {
          key: `overloaded:${agentId}`,
          title: 'An agent may be overloaded',
          impact: 'Too much concurrent work can slow progress and make failures harder to diagnose.',
          disposition: 'advisory',
          resources: [{ kind: 'agent', id: agentId, label: agentId }],
          resolution: { key: 'review-workload', type: 'navigate', label: 'Review agent workload', href: '/tasks' },
        },
      }))
    }

    for (const task of columns.done) {
      if (!task.dependsOn) continue
      observations.push(healthWarning({
        key: `orphaned-dependency:${task.id}`,
        summary: `Done task “${task.title}” still depends on “${task.dependsOn}”.`,
        evidence: { taskId: task.id, dependsOn: task.dependsOn },
        incident: {
          key: `orphaned-dependency:${task.id}`,
          title: 'A completed task retains a dependency',
          impact: 'The stale dependency can make unrelated task relationships misleading.',
          disposition: 'action_required',
          resources: [{ kind: 'task', id: task.id, label: task.title }],
          resolution: {
            key: 'clear-dependency',
            type: 'repair',
            label: 'Clear completed-task dependency',
            actionId: 'clear-done-depends-on',
          },
        },
      }))
    }

    if (observations.length === 0) {
      observations.push(healthHealthy({
        key: 'consistency',
        summary: `${columns.inProgress.length} in progress and ${columns.done.length} done; task state is consistent.`,
        evidence: { inProgress: columns.inProgress.length, done: columns.done.length },
      }))
    }
  } catch (error) {
    observations.push(healthUnknown({
      key: 'verification',
      summary: 'Task consistency could not be verified.',
      detail: errorMessage(error),
      incident: {
        key: 'verification-failed',
        title: 'Task consistency is unknown',
        impact: 'Health cannot confirm whether running and completed tasks are internally consistent.',
        disposition: 'watch',
        resources: [{ kind: 'system', id: 'task-store', label: 'Task store' }],
        resolution: { key: 'rerun', type: 'rerun', label: 'Rerun task consistency' },
      },
    }))
  }

  return healthObserved(observations as [HealthObservationInput, ...HealthObservationInput[]])
}

export function taskConsistencyRepair(): HealthRepairActionDefinition {
  return {
    id: 'clear-done-depends-on',
    name: 'Clear completed-task dependencies',
    async plan(target) {
      const board = readTaskboard() as unknown as {
        columns: { done: Array<{ id: string; dependsOn?: string }> }
      }
      const affected = board.columns.done.filter((task) => task.dependsOn)
      if (affected.length === 0) return []
      return [{
        id: 'clear-completed-task-dependencies',
        actionId: 'clear-done-depends-on',
        title: 'Clear dependencies from completed tasks',
        reason: `${affected.length} completed task${affected.length === 1 ? '' : 's'} still carry dependency links.`,
        safety: 'safe',
        ...repairTargetSelection(target),
        changes: affected.map((task) => ({
          kind: 'task' as const,
          target: task.id,
          action: 'update' as const,
          description: 'Remove dependsOn from this completed task.',
        })),
      }]
    },
    async apply(items) {
      if (items.length === 0) return []
      try {
        const board = readTaskboard() as unknown as {
          columns: { done: Array<{ id: string; title: string; dependsOn?: string }> }
        }
        const affected = board.columns.done.filter((task) => task.dependsOn)
        for (const task of affected) await clearDependency(task.id)
        return items.map((item) => ({
          itemId: item.id,
          actionId: item.actionId,
          status: affected.length > 0 ? 'applied' as const : 'skipped' as const,
          message: affected.length > 0
            ? `Cleared dependencies from ${affected.length} completed task${affected.length === 1 ? '' : 's'}.`
            : 'No completed-task dependencies remain.',
          affectedCheckIds: ['tasks.task-consistency'],
          changes: item.changes,
        }))
      } catch (error) {
        return items.map((item) => ({
          itemId: item.id,
          actionId: item.actionId,
          status: 'failed' as const,
          message: errorMessage(error),
          affectedCheckIds: ['tasks.task-consistency'],
          changes: item.changes,
        }))
      }
    },
  }
}

/** Verify every task has a unique numeric order within its column. */
export async function checkTaskPositionIntegrity(): Promise<HealthCheckRunInput> {
  try {
    const board = readTaskboard()
    const entries = Object.entries(board.columns) as Array<[ColumnId, Task[]]>
    const total = entries.reduce((sum, [, tasks]) => sum + tasks.length, 0)
    if (total === 0) {
      return healthObserved([healthHealthy({
        key: 'order',
        summary: 'No tasks need order validation.',
        evidence: { taskCount: 0 },
      })])
    }

    let missingCount = 0
    let duplicateCount = 0
    for (const [, tasks] of entries) {
      const orders = tasks.map((task) => task.order).filter((order): order is number => typeof order === 'number')
      missingCount += tasks.length - orders.length
      duplicateCount += orders.length - new Set(orders).size
    }

    if (missingCount === 0 && duplicateCount === 0) {
      return healthObserved([healthHealthy({
        key: 'order',
        summary: `All ${total} tasks have valid unique order values.`,
        evidence: { taskCount: total, missing: 0, duplicates: 0 },
      })])
    }

    const issueSummary = [
      missingCount > 0 ? `${missingCount} missing` : null,
      duplicateCount > 0 ? `${duplicateCount} duplicate${duplicateCount === 1 ? '' : 's'}` : null,
    ].filter(Boolean).join(', ')
    return healthObserved([healthWarning({
      key: 'order',
      summary: `Task order has ${issueSummary} across ${total} tasks.`,
      evidence: { taskCount: total, missing: missingCount, duplicates: duplicateCount },
      incident: {
        key: 'order-invalid',
        title: 'Task order values need rebuilding',
        impact: 'Tasks may render in an unstable or misleading order within their columns.',
        disposition: 'action_required',
        resources: [{ kind: 'system', id: 'taskboard-order', label: 'Taskboard order' }],
        resolution: {
          key: 'reorder-columns',
          type: 'repair',
          label: 'Rebuild task order',
          actionId: 'reorder-columns',
        },
      },
    })])
  } catch (error) {
    return healthObserved([healthUnknown({
      key: 'verification',
      summary: 'Task order could not be verified.',
      detail: errorMessage(error),
      incident: {
        key: 'verification-failed',
        title: 'Task order integrity is unknown',
        impact: 'Health cannot confirm that task columns have stable order values.',
        disposition: 'watch',
        resources: [{ kind: 'system', id: 'taskboard-order', label: 'Taskboard order' }],
        resolution: { key: 'rerun', type: 'rerun', label: 'Rerun task order validation' },
      },
    })])
  }
}

export function taskOrderRepair(): HealthRepairActionDefinition {
  return {
    id: 'reorder-columns',
    name: 'Rebuild task order values',
    async plan(target) {
      return [{
        id: 'rebuild-task-order',
        actionId: 'reorder-columns',
        title: 'Rebuild task order values',
        reason: 'One or more task columns contain missing or duplicate order values.',
        safety: 'safe',
        ...repairTargetSelection(target),
        changes: [{
          kind: 'task',
          target: 'task columns',
          action: 'update',
          description: 'Assign contiguous order values within each column using updatedAt descending.',
        }],
      }]
    },
    async apply(items) {
      if (items.length === 0) return []
      try {
        const board = readTaskboard()
        const entries = Object.entries(board.columns) as Array<[ColumnId, Task[]]>
        const changes: HealthRepairChange[] = []
        for (const [column, tasks] of entries) {
          const ordered = [...tasks]
            .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
            .map((task) => task.id)
          await reorderTasks(column, ordered)
          changes.push({
            kind: 'task' as const,
            target: column,
            action: 'update' as const,
            description: `Rebuilt order values for ${ordered.length} task${ordered.length === 1 ? '' : 's'}.`,
          })
        }
        return items.map((item) => ({
          itemId: item.id,
          actionId: item.actionId,
          status: 'applied' as const,
          message: 'Rebuilt task order values.',
          affectedCheckIds: ['tasks.order-integrity'],
          changes,
        }))
      } catch (error) {
        return items.map((item) => ({
          itemId: item.id,
          actionId: item.actionId,
          status: 'failed' as const,
          message: errorMessage(error),
          affectedCheckIds: ['tasks.order-integrity'],
          changes: item.changes,
        }))
      }
    },
  }
}

/** Surface runtime session deaths from the last 24 hours. */
export function checkSessionDeathIncidents(
  contentDir: string,
  queryAuditEvents: (
    contentDir: string,
    opts: { kinds?: string[]; sinceMs?: number },
  ) => Array<{ ts: string; agent: string; data: Record<string, unknown> }>,
): HealthCheckRunInput {
  const dayMs = 24 * 60 * 60 * 1000
  let incidents: Array<{ ts: string; agent: string; data: Record<string, unknown> }>
  try {
    incidents = queryAuditEvents(contentDir, {
      kinds: ['task.runtime_session_died'],
      sinceMs: dayMs,
    })
  } catch (error) {
    return healthObserved([healthUnknown({
      key: 'verification',
      summary: 'Recent runtime session deaths could not be read.',
      detail: errorMessage(error),
      incident: {
        key: 'audit-unavailable',
        title: 'Session-death history is unknown',
        impact: 'Health cannot confirm whether agent sessions have recently died during execution.',
        disposition: 'watch',
        resources: [{ kind: 'system', id: 'audit-trail', label: 'Audit trail' }],
        resolution: { key: 'rerun', type: 'rerun', label: 'Rerun session history' },
      },
    })])
  }

  if (incidents.length === 0) {
    return healthObserved([healthHealthy({
      key: 'recent',
      summary: 'No runtime session deaths in the last 24 hours.',
      evidence: { count: 0, windowHours: 24 },
    })])
  }

  const recent = incidents.slice(-5).map((incident) => ({
    taskId: typeof incident.data.id === 'string' ? incident.data.id : 'unknown-task',
    agentId: incident.agent,
    completionBytes: typeof incident.data.completionBytes === 'number' ? incident.data.completionBytes : null,
    oversizedOutput: incident.data.oversizedOutput === true,
  }))
  return healthObserved([healthWarning({
    key: 'recent',
    summary: `${incidents.length} runtime session death${incidents.length === 1 ? '' : 's'} occurred in the last 24 hours.`,
    detail: 'Review the affected work and salvaged assets; repeated deaths often indicate oversized agent output.',
    evidence: { count: incidents.length, windowHours: 24, recent },
    incident: {
      key: 'recent-session-deaths',
      title: 'Agent sessions have died recently',
      impact: 'Interrupted turns can delay tasks or leave partial work that needs operator review.',
      disposition: 'watch',
      resources: recent.flatMap((incident) => [
        { kind: 'session' as const, id: `${incident.agentId}:${incident.taskId}`, label: incident.taskId },
        { kind: 'agent' as const, id: incident.agentId, label: incident.agentId },
        { kind: 'task' as const, id: incident.taskId, label: incident.taskId },
      ]),
      resolution: { key: 'review-activity', type: 'navigate', label: 'Review agent activity', href: '/health?tab=activity' },
    },
  })])
}
