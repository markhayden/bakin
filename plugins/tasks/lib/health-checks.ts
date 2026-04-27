/**
 * Tasks-plugin-owned doctor checks.
 *
 * Migrated out of src/core/doctor.ts (#139 C2) — these three checks
 * operate on tasks-plugin data (the OpenClaw flow_runs SQLite table
 * Bakin reads via owner_key='bakin:task:%'), so they belong with the
 * plugin that owns that data model.
 *
 * Registered in plugins/tasks/index.ts activate() via
 * ctx.registerHealthCheck. runDiagnostics() picks them up through the
 * plugin-check loop in src/core/doctor.ts's runPluginHealthChecks().
 */
import { existsSync } from 'fs'
import { join } from 'path'

import { getSettings } from '../../../src/core/settings'
import { getMainAgentId } from '../../../src/core/main-agent'
import { getHookRegistry } from '../../../src/lib/plugin-registry'
import { getAgentIds } from '../../../packages/core/src/openclaw-config'
import { getOpenClawPath } from '../../../packages/core/src/openclaw-home'
import type { HealthCheckResult } from '../../../packages/core/src/plugin-types'

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

// ─── SQLite helper (shared by taskboard + position-integrity checks) ───────

function openDoctorDb(dbPath: string) {
  const { Database } = require('bun:sqlite') as typeof import('bun:sqlite')
  const db = new Database(dbPath)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA busy_timeout = 5000')
  return db
}

// ─── Taskboard: flow_runs SQLite reachability ──────────────────────────────

/**
 * Verify the OpenClaw flow_runs SQLite table is accessible and count
 * Bakin-owned task rows. Read-only — never writes.
 */
export function checkTaskboard(): HealthCheckResult[] {
  try {
    const dbPath = getOpenClawPath('flows', 'registry.sqlite')
    if (!existsSync(dbPath)) {
      return [warn('taskboard', 'OpenClaw flow_runs database not found at ' + dbPath)]
    }
    const db = openDoctorDb(dbPath)
    const count = db.prepare(`SELECT count(*) as n FROM flow_runs WHERE owner_key LIKE 'bakin:task:%'`).get() as { n: number }
    db.close()
    return [ok('taskboard', `${count.n} tasks in flow_runs (SQLite)`)]
  } catch (err) {
    return [error('taskboard', `Failed to query flow_runs: ${err}`)]
  }
}

// ─── Task consistency: orphaned, overloaded, or stale in-progress tasks ───

/**
 * Detect orphaned, overloaded, or stale in-progress tasks. Auto-fixes
 * orphaned dependsOn refs on done tasks (clears them via the
 * tasks.clearDependency hook) when settings.doctor.autoFixSkill is true.
 */
export async function checkTaskConsistency(contentDir: string): Promise<HealthCheckResult[]> {
  const results: HealthCheckResult[] = []
  const autoFix = getSettings().doctor.autoFixSkill
  const hooks = getHookRegistry()

  try {
    interface TaskEntry { id: string; title: string; agent?: string; dependsOn?: string; log?: unknown[] }
    const board = await hooks.invoke<{ columns: { inProgress: TaskEntry[]; done: TaskEntry[]; todo: TaskEntry[]; blocked: TaskEntry[] } }>('tasks.readTaskboard', {})
    if (!board) { return [warn('task-consistency', 'Taskboard not available (tasks plugin not loaded)')] }
    const { columns } = board

    // Known agents from openclaw.json
    const knownAgents = new Set(getAgentIds())

    // Count tasks per agent
    const agentTaskCount: Record<string, number> = {}

    for (const task of columns.inProgress) {
      // Track agent load
      if (task.agent) {
        agentTaskCount[task.agent] = (agentTaskCount[task.agent] || 0) + 1
      }

      // In-progress task assigned to unknown agent
      if (task.agent && !knownAgents.has(task.agent) && task.agent !== getMainAgentId()) {
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
            await hooks.invoke<void>('tasks.clearDependency', { taskId: task.id })
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
export function checkTaskPositionIntegrity(): HealthCheckResult[] {
  const CHECK = 'order-integrity'
  const autoFix = getSettings().doctor.autoFixSkill
  try {
    const dbPath = getOpenClawPath('flows', 'registry.sqlite')
    if (!existsSync(dbPath)) return [ok(CHECK, 'No task database found (OK for fresh install)')]

    const db = openDoctorDb(dbPath)

    try {
      const rows = db.prepare(
        `SELECT flow_id, status, state_json, blocked_task_id, updated_at FROM flow_runs WHERE owner_key LIKE 'bakin:task:%'`
      ).all() as Array<{ flow_id: string; status: string; state_json: string | null; blocked_task_id: string | null; updated_at: number }>

      if (rows.length === 0) return [ok(CHECK, 'No tasks to check')]

      // Check for missing or invalid order values
      let missingCount = 0
      const byColumn = new Map<string, Array<{ flowId: string; order: number | null; updatedAt: number }>>()

      for (const row of rows) {
        const state = row.state_json ? JSON.parse(row.state_json) : {}
        const ord = typeof state.order === 'number' ? state.order : null

        // Derive column (inlined from flow-store.ts)
        let col: string
        switch (row.status) {
          case 'queued': col = state.column === 'backlog' ? 'backlog' : 'todo'; break
          case 'running': col = 'inProgress'; break
          case 'waiting': col = row.blocked_task_id ? 'blocked' : 'review'; break
          case 'succeeded': col = state.archived ? 'archived' : 'done'; break
          default: col = 'backlog'
        }

        if (ord === null) missingCount++
        if (!byColumn.has(col)) byColumn.set(col, [])
        byColumn.get(col)!.push({ flowId: row.flow_id, order: ord, updatedAt: row.updated_at })
      }

      // Check for duplicates within columns
      let duplicateCount = 0
      for (const [, colTasks] of byColumn) {
        const orders = colTasks.filter(t => t.order !== null).map(t => t.order!)
        const unique = new Set(orders)
        if (unique.size < orders.length) duplicateCount += orders.length - unique.size
      }

      if (missingCount === 0 && duplicateCount === 0) {
        return [ok(CHECK, `All ${rows.length} tasks have valid unique order values`)]
      }

      const issues = []
      if (missingCount > 0) issues.push(`${missingCount} missing`)
      if (duplicateCount > 0) issues.push(`${duplicateCount} duplicates`)

      if (!autoFix) {
        return [warn(CHECK, `Order issues: ${issues.join(', ')} across ${rows.length} tasks`, true)]
      }

      // Auto-fix: reassign order per column (zero-indexed) based on updated_at desc
      const stmt = db.prepare(`UPDATE flow_runs SET state_json = json_set(state_json, '$.order', ?) WHERE flow_id = ?`)
      const tx = db.transaction(() => {
        for (const [, colTasks] of byColumn) {
          colTasks.sort((a, b) => b.updatedAt - a.updatedAt)
          for (let i = 0; i < colTasks.length; i++) {
            stmt.run(i, colTasks[i].flowId)
          }
        }
      })
      tx()

      return [fixed(CHECK, `Fixed order issues (${issues.join(', ')}) across ${rows.length} tasks`)]
    } finally {
      db.close()
    }
  } catch (err) {
    return [error(CHECK, `Order check failed: ${(err as Error).message}`)]
  }
}
