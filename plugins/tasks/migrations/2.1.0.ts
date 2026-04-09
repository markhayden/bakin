/**
 * Migration: Backfill position values in task state_json for weight-based ordering.
 *
 * Before this migration, task ordering relied on updated_at DESC which was fragile
 * (any mutation could scramble order). This adds an explicit position field to each
 * task's state_json, preserving the existing visual order based on updated_at.
 */
import Database from 'better-sqlite3'
import { getOpenClawPath } from '@bakin/core/openclaw-home'
import { createLogger } from '../../../src/core/logger'

const log = createLogger('tasks:migration:2.1.0')

const POSITION_GAP = 1_000_000

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
export const description = 'Backfill position values in task state_json for weight-based ordering'

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

    // Sort each column by updated_at DESC (preserves current visual order)
    // Then assign positions: index 0 (most recent) gets lowest position
    const stmt = db.prepare(
      `UPDATE flow_runs SET state_json = json_set(state_json, '$.position', ?) WHERE flow_id = ?`
    )

    let totalUpdated = 0
    const tx = db.transaction(() => {
      for (const [col, colRows] of byColumn) {
        colRows.sort((a, b) => b.updated_at - a.updated_at)
        for (let i = 0; i < colRows.length; i++) {
          stmt.run((i + 1) * POSITION_GAP, colRows[i].flow_id)
          totalUpdated++
        }
      }
    })
    tx()

    log.info(`Backfilled positions for ${totalUpdated} tasks across ${byColumn.size} columns`)
  } finally {
    db.close()
  }
}
