/**
 * Migration: Backfill order values in task state_json for array-index ordering.
 *
 * Converts from sparse position values (POSITION_GAP = 1M) to contiguous
 * zero-indexed order values per column. Also renames the field from
 * `position` to `order` in state_json.
 */
import Database from 'better-sqlite3'
import { getOpenClawPath } from '@bakin/core/openclaw-home'
import { createLogger } from '../../../src/core/logger'

const log = createLogger('tasks:migration:2.1.0')

interface FlowRunRow {
  flow_id: string
  status: string
  state_json: string | null
  blocked_task_id: string | null
  updated_at: number
}

/**
 * Derive column from flow_runs fields — inlined from flow-store.ts to avoid import cycles.
 */
function getColumn(flow: FlowRunRow): string {
  const state = flow.state_json ? JSON.parse(flow.state_json) : {}
  switch (flow.status) {
    case 'queued':
      return state.column === 'backlog' ? 'backlog' : 'todo'
    case 'running':
      return 'inProgress'
    case 'waiting':
      return flow.blocked_task_id ? 'blocked' : 'review'
    case 'succeeded':
      return (state.archived || state.confirmed) ? 'archived' : 'done'
    case 'failed':
    case 'cancelled':
      return 'done'
    default:
      return 'backlog'
  }
}

export const version = '2.1.0'
export const description = 'Migrate position to zero-indexed order values in task state_json'

export async function up(): Promise<void> {
  const dbPath = getOpenClawPath('flows', 'registry.sqlite')
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = 5000')

  try {
    const rows = db.prepare(
      `SELECT flow_id, status, state_json, blocked_task_id, updated_at FROM flow_runs WHERE owner_key LIKE 'bakin:task:%'`
    ).all() as FlowRunRow[]

    if (rows.length === 0) {
      log.info('No tasks to migrate')
      return
    }

    // Group by column
    const byColumn = new Map<string, FlowRunRow[]>()
    for (const row of rows) {
      const col = getColumn(row)
      if (!byColumn.has(col)) byColumn.set(col, [])
      byColumn.get(col)!.push(row)
    }

    // Sort each column by existing position (if present) or updated_at DESC,
    // then assign zero-indexed order and remove old position field.
    const stmt = db.prepare(
      `UPDATE flow_runs SET state_json = ? WHERE flow_id = ?`
    )

    let totalUpdated = 0
    const tx = db.transaction(() => {
      for (const [, colRows] of byColumn) {
        colRows.sort((a, b) => {
          const stateA = a.state_json ? JSON.parse(a.state_json) : {}
          const stateB = b.state_json ? JSON.parse(b.state_json) : {}
          // Sort by existing position if available, otherwise by updated_at DESC
          if (typeof stateA.position === 'number' && typeof stateB.position === 'number') {
            return stateA.position - stateB.position
          }
          return b.updated_at - a.updated_at
        })
        for (let i = 0; i < colRows.length; i++) {
          const state = colRows[i].state_json ? JSON.parse(colRows[i].state_json!) : {}
          delete state.position
          state.order = i
          stmt.run(JSON.stringify(state), colRows[i].flow_id)
          totalUpdated++
        }
      }
    })
    tx()

    log.info(`Migrated ${totalUpdated} tasks to zero-indexed order across ${byColumn.size} columns`)
  } finally {
    db.close()
  }
}
