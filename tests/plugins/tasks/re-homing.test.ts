/**
 * Re-homing table rows 117–126 (self-healing 1.7): every tasks-owned
 * incident family is declared as the table says, and each row's emitted
 * shape matches — a repair with its effects/mode, the human's decision on
 * the assignee field, or a plain observation with no card.
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-tasks-rehoming-${Date.now()}-${randomUUID()}`)
const mockPaths = { home: testDir, tasks: pathJoin(testDir, 'tasks'), db: pathJoin(testDir, 'bakin.db') }
process.env.BAKIN_HOME = testDir

import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { rmSync } from 'fs'

const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => mockPaths, isUsingBakinHome: () => true })
mock.module('@/core/content-dir', contentDirMock)
mock.module('@bakin/core/content-dir', contentDirMock)
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => pathJoin(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => pathJoin(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('@bakin/core/main-agent', () => ({ getMainAgentId: () => 'main', tryGetMainAgentId: () => 'main', getMainAgentName: () => 'Main' }))
mock.module('../../../src/core/logger', () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) }))

type StoreTask = { id: string; title: string; agent?: string; dependsOn?: string; log?: unknown[]; order?: number }
type StoreBoard = { columns: Record<'backlog' | 'todo' | 'inProgress' | 'review' | 'done' | 'blocked' | 'archived', StoreTask[]> }
const emptyBoard = (): StoreBoard => ({ columns: { backlog: [], todo: [], inProgress: [], review: [], done: [], blocked: [], archived: [] } })
let board: StoreBoard = emptyBoard()
let storeBroken = false
mock.module('@/core/task-store', () => ({
  readTaskboard: () => { if (storeBroken) throw new Error('EACCES tasks.json'); return board },
  clearDependency: () => true,
  renumberColumn: async () => {},
}))
const agents = { list: async () => [{ id: 'main', name: 'Main' }, { id: 'patch', name: 'Patch' }] }
mock.module('../../../src/core/app-services', () => ({ maybeGetAppServices: () => ({ runtime: { agents } }) }))
mock.module('../../../src/core/app-services-store', () => ({ maybeGetAppServices: () => ({ runtime: { agents } }) }))

import { repairMode } from '@bakin/core/health/repair-mode'
import {
  ORDER_INTEGRITY_INCIDENTS,
  SESSION_DEATH_INCIDENTS,
  TASK_CONSISTENCY_INCIDENTS,
  TASKBOARD_INCIDENTS,
  checkSessionDeathIncidents,
  checkTaskboard,
  checkTaskConsistency,
  checkTaskPositionIntegrity,
  taskConsistencyRepair,
  taskOrderRepair,
} from '../../../plugins/tasks/lib/health-checks'

type Row = { key: string; status: string; incident?: Record<string, unknown> & { resolution: Record<string, unknown> } }
function rows(result: { outcome: string }): Row[] {
  if (result.outcome !== 'observed') throw new Error(`expected observed, got ${result.outcome}`)
  return (result as unknown as { observations: Row[] }).observations
}

beforeEach(() => { board = emptyBoard(); storeBroken = false })
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('tasks re-homing catalogs (rows 117–126)', () => {
  it('declares exactly the families the table names; observation rows have none', () => {
    expect(TASKBOARD_INCIDENTS).toEqual([
      { id: 'store-unreadable', subjectKind: 'record', resolution: { type: 'repair', actionId: 'core.diagnose' }, required: 'always' }, // 117
    ])
    expect(TASK_CONSISTENCY_INCIDENTS).toEqual([
      { id: 'unknown-agent', subjectKind: 'task', resolution: { type: 'human', needs: 'decision' }, required: 'owner-decides' }, // 118
      { id: 'orphaned-dependency', subjectKind: 'task', resolution: { type: 'repair', actionId: 'clear-done-depends-on' }, required: 'always' }, // 121
    ])
    expect(ORDER_INTEGRITY_INCIDENTS).toEqual([
      { id: 'order-invalid', subjectKind: 'system', resolution: { type: 'repair', actionId: 'reorder-columns' }, required: 'always' }, // 123
    ])
    expect(SESSION_DEATH_INCIDENTS).toEqual([]) // 125, 126 are observations
    // 119, 120, 122, 124 are observations: no family declares them.
    const declared = new Set([...TASK_CONSISTENCY_INCIDENTS, ...ORDER_INTEGRITY_INCIDENTS].map((d) => d.id))
    for (const id of ['progress-missing', 'overloaded', 'verification-failed']) expect(declared.has(id)).toBe(false)
  })

  it('repair actions carry the table effects: both self-heal, no installation mutation', () => {
    for (const action of [taskConsistencyRepair(), taskOrderRepair()]) {
      expect(action.effects).toEqual({ deletesUserContent: false, spendsMoney: false, widensAuthorization: false })
      expect(repairMode(action.effects)).toBe('self-heal')
      expect(action.mutation).toBeUndefined()
    }
  })
})

describe('tasks re-homing emissions', () => {
  it('117 store-unreadable → core.diagnose on the task store record', () => {
    storeBroken = true
    const [row] = rows(checkTaskboard())
    expect(row).toMatchObject({ key: 'store', status: 'error' })
    expect(row!.incident).toMatchObject({ key: 'store-unreadable', declarationId: 'store-unreadable', disposition: 'action_required', subject: { kind: 'record', id: 'tasks-store' }, resolution: { type: 'repair', actionId: 'core.diagnose' } })
  })

  it('118 unknown-agent → human decision on the assignee field, required while the task is open', async () => {
    board.columns.inProgress.push({ id: 't1', title: 'Ship it', agent: 'ghost', log: [{}] })
    const row = rows(await checkTaskConsistency()).find((r) => r.key === 'unknown-agent:t1')
    expect(row?.incident).toMatchObject({ declarationId: 'unknown-agent', required: true, subject: { kind: 'task', id: 't1' }, resolution: { type: 'human', needs: 'decision', href: '/tasks?taskId=t1&field=assignee', field: 'task-assignee' } })
  })

  it('119/120 progress-missing and overloaded are observations — no incident, no card', async () => {
    board.columns.inProgress.push({ id: 'a', title: 'A', agent: 'patch', log: [] })
    board.columns.inProgress.push(...Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, title: `P${i}`, agent: 'patch', log: [{}] })))
    const all = rows(await checkTaskConsistency())
    const progress = all.find((r) => r.key === 'progress-missing:a')
    const overloaded = all.find((r) => r.key === 'overloaded:patch')
    expect(progress).toMatchObject({ status: 'warning' })
    expect(progress?.incident).toBeUndefined()
    expect(overloaded).toMatchObject({ status: 'warning' })
    expect(overloaded?.incident).toBeUndefined()
  })

  it('121 orphaned-dependency → self-heal repair on the task', async () => {
    board.columns.done.push({ id: 'd1', title: 'Done', dependsOn: 'gone' })
    const row = rows(await checkTaskConsistency()).find((r) => r.key === 'orphaned-dependency:d1')
    expect(row?.incident).toMatchObject({ declarationId: 'orphaned-dependency', disposition: 'action_required', subject: { kind: 'task', id: 'd1' }, resolution: { type: 'repair', actionId: 'clear-done-depends-on' } })
  })

  it('122/124 verification-failed are plain unknown observations', async () => {
    storeBroken = true
    const [consistency] = rows(await checkTaskConsistency())
    const [order] = rows(await checkTaskPositionIntegrity())
    for (const row of [consistency, order]) {
      expect(row).toMatchObject({ key: 'verification', status: 'unknown' })
      expect(row!.incident).toBeUndefined()
    }
  })

  it('123 order-invalid → self-heal repair on the task board', async () => {
    board.columns.todo.push({ id: 'a', title: 'A' }, { id: 'b', title: 'B' })
    const [row] = rows(await checkTaskPositionIntegrity())
    expect(row!.incident).toMatchObject({ declarationId: 'order-invalid', subject: { kind: 'system', id: 'task-board' }, resolution: { type: 'repair', actionId: 'reorder-columns' } })
  })

  it('125/126 session-death rows are observations', () => {
    const [unavailable] = rows(checkSessionDeathIncidents(testDir, () => { throw new Error('audit gone') }))
    expect(unavailable).toMatchObject({ key: 'verification', status: 'unknown' })
    expect(unavailable!.incident).toBeUndefined()
    const [recent] = rows(checkSessionDeathIncidents(testDir, () => [{ ts: 'x', agent: 'main', data: { id: 't9' } }]))
    expect(recent).toMatchObject({ key: 'recent', status: 'warning' })
    expect(recent!.incident).toBeUndefined()
  })
})
