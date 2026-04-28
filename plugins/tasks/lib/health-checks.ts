/**
 * Tasks-plugin-owned doctor checks.
 *
 * Migrated out of src/core/doctor.ts (#139 C2) — these three checks
 * operate on Bakin-owned task JSON files, so they belong with the plugin that
 * owns that data model.
 *
 * Registered in plugins/tasks/index.ts activate() via
 * ctx.registerHealthCheck. runDiagnostics() picks them up through the
 * plugin-check loop in src/core/doctor.ts's runPluginHealthChecks().
 */
import { existsSync } from 'fs'
import { join } from 'path'
import { selectRuntimeMainAgent, type AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'

import { getSettings } from '../../../src/core/settings'
import type { HealthCheckResult } from '../../../packages/core/src/plugin-types'
import { maybeGetAppServices } from '../../../src/core/app-services'
import { clearDependency, readTaskboard, reorderTasks } from './flow-store'
import type { ColumnId, Task } from '../types'

// ─── Result constructors (inlined; matches workflows precedent) ─────────────

function ok(check: string, message: string): HealthCheckResult {
  return { check, status: 'ok', message, autoFixable: false }
}
function warn(check: string, message: string, autoFixable = false): HealthCheckResult {
  return { check, status: 'warn', message, autoFixable }
}
function error(check: string, message: string): HealthCheckResult {
  return { check, status: 'error', message, autoFixable: false }
}
function fixed(check: string, message: string): HealthCheckResult {
  return { check, status: 'fixed', message, autoFixable: true }
}

type RuntimeAgentReader = Pick<AgentRuntimeAdapter['agents'], 'list'>

async function resolveKnownAgentIds(agentReader?: RuntimeAgentReader): Promise<Set<string>> {
  const knownAgents = new Set<string>()
  try {
    const agents = await (agentReader ?? maybeGetAppServices()?.runtime.agents)?.list()
    for (const agent of agents ?? []) knownAgents.add(agent.id)
    const mainAgent = selectRuntimeMainAgent(agents ?? [])
    if (mainAgent) knownAgents.add(mainAgent.id)
  } catch {
    // Adapter health is reported separately; keep this check focused on tasks.
  }
  return knownAgents
}

// ─── Taskboard: Bakin JSON store reachability ──────────────────────────────

/**
 * Verify the Bakin task JSON store is accessible and count Bakin-owned tasks.
 * Read-only — never writes.
 */
export function checkTaskboard(): HealthCheckResult[] {
  try {
    const board = readTaskboard()
    const count = Object.values(board.columns).reduce((sum, tasks) => sum + tasks.length, 0)
    return [ok('taskboard', `${count} tasks in Bakin task JSON store`)]
  } catch (err) {
    return [error('taskboard', `Failed to query Bakin task store: ${err}`)]
  }
}

// ─── Task consistency: orphaned, overloaded, or stale in-progress tasks ───

/**
 * Detect orphaned, overloaded, or stale in-progress tasks. Auto-fixes
 * orphaned dependsOn refs on done tasks when settings.doctor.autoFixSkill is
 * true.
 */
export async function checkTaskConsistency(
  contentDir: string,
  agentReader?: RuntimeAgentReader,
): Promise<HealthCheckResult[]> {
  const results: HealthCheckResult[] = []
  const autoFix = getSettings().doctor.autoFixSkill

  try {
    interface TaskEntry { id: string; title: string; agent?: string; dependsOn?: string; log?: unknown[] }
    const board = readTaskboard() as unknown as { columns: { inProgress: TaskEntry[]; done: TaskEntry[]; todo: TaskEntry[]; blocked: TaskEntry[] } }
    const { columns } = board

    const knownAgents = await resolveKnownAgentIds(agentReader)

    // Count tasks per agent
    const agentTaskCount: Record<string, number> = {}

    for (const task of columns.inProgress) {
      // Track agent load
      if (task.agent) {
        agentTaskCount[task.agent] = (agentTaskCount[task.agent] || 0) + 1
      }

      // In-progress task assigned to unknown agent
      if (task.agent && !knownAgents.has(task.agent)) {
        results.push(warn('task-consistency', `In-progress task "${task.title}" assigned to unknown agent "${task.agent}"`))
      }

      // In-progress task with no heartbeat file
      const heartbeatPath = join(contentDir, 'heartbeats', `${task.agent || 'unknown'}.json`)
      if (!existsSync(heartbeatPath)) {
        results.push(warn('task-consistency', `In-progress task "${task.title}" — no heartbeat file for agent "${task.agent || 'unassigned'}"`))
      }

      // In-progress task with zero log entries
      if (!task.log || task.log.length === 0) {
        results.push(warn('task-consistency', `In-progress task "${task.title}" has zero log entries`))
      }
    }

    // Agent with > 3 concurrent in-progress tasks
    for (const [agent, count] of Object.entries(agentTaskCount)) {
      if (count > 3) {
        results.push(warn('task-consistency', `Agent "${agent}" has ${count} concurrent in-progress tasks — may be overloaded`))
      }
    }

    // Done tasks with orphaned dependsOn
    for (const task of columns.done) {
      if (task.dependsOn) {
        if (autoFix) {
          try {
            await clearDependency(task.id)
            results.push(fixed('task-consistency', `Cleared orphaned dependsOn on done task "${task.title}"`))
          } catch {
            results.push(warn('task-consistency', `Done task "${task.title}" has orphaned dependsOn="${task.dependsOn}" — failed to clear`))
          }
        } else {
          results.push(warn('task-consistency', `Done task "${task.title}" has orphaned dependsOn="${task.dependsOn}"`, true))
        }
      }
    }

    if (results.length === 0) {
      results.push(ok('task-consistency', `${columns.inProgress.length} in-progress, ${columns.done.length} done — all consistent`))
    }
  } catch (err) {
    results.push(error('task-consistency', `Failed to check task consistency: ${err}`))
  }

  return results
}

// ─── Task position integrity: unique order values per column ───────────────

/**
 * Verify every Bakin task has a unique numeric order value within its
 * column. Auto-fixes by reassigning order zero-indexed by updated_at
 * desc when settings.doctor.autoFixSkill is true.
 *
 * Migration note (#139 C2): emitted check id renamed from
 * `tasks.order_integrity` to `order-integrity`. With plugin-namespacing
 * the dotted form becomes `tasks.order-integrity` (underscore→hyphen).
 */
export async function checkTaskPositionIntegrity(): Promise<HealthCheckResult[]> {
  const CHECK = 'order-integrity'
  const autoFix = getSettings().doctor.autoFixSkill
  try {
    const board = readTaskboard()
    const entries = Object.entries(board.columns) as Array<[ColumnId, Task[]]>
    const total = entries.reduce((sum, [, tasks]) => sum + tasks.length, 0)
    if (total === 0) return [ok(CHECK, 'No tasks to check')]

    let missingCount = 0
    let duplicateCount = 0
    for (const [, tasks] of entries) {
      const orders = tasks.map((task) => task.order).filter((order): order is number => typeof order === 'number')
      missingCount += tasks.length - orders.length
      const unique = new Set(orders)
      if (unique.size < orders.length) duplicateCount += orders.length - unique.size
    }

    if (missingCount === 0 && duplicateCount === 0) {
      return [ok(CHECK, `All ${total} tasks have valid unique order values`)]
    }

    const issues = []
    if (missingCount > 0) issues.push(`${missingCount} missing`)
    if (duplicateCount > 0) issues.push(`${duplicateCount} duplicates`)

    if (!autoFix) {
      return [warn(CHECK, `Order issues: ${issues.join(', ')} across ${total} tasks`, true)]
    }

    for (const [column, tasks] of entries) {
      const ordered = [...tasks]
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
        .map((task) => task.id)
      await reorderTasks(column, ordered)
    }

    return [fixed(CHECK, `Fixed order issues (${issues.join(', ')}) across ${total} tasks`)]
  } catch (err) {
    return [error(CHECK, `Order check failed: ${(err as Error).message}`)]
  }
}
