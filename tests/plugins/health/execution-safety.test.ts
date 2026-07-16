/**
 * Execution-safety doctor check (SPEC §8 test #9 + user story 10):
 * green when nothing was suppressed in 24h, warns with counts when the
 * guards fired, errors when the ledger is unreachable (fail-closed state).
 */
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdirSync, rmSync, appendFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-exec-safety-check-${Date.now()}-${randomUUID()}`)
// Mutable so the fail-closed case can point the db at an unopenable path.
let dbPath = join(testDir, 'bakin.db')

const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    home: testDir,
    audit: join(testDir, 'audit.jsonl'),
    logs: join(testDir, 'logs'),
    db: dbPath,
  }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)

const loggerMock = () => ({
  createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }),
})
mock.module('../../../src/core/logger', loggerMock)
mock.module('../../../packages/core/src/logger', loggerMock)

import { checkExecutionSafety } from '@bakin/health/lib/system-checks/execution-safety'
import { closeDb } from '../../../packages/core/src/storage/db'
import type { HealthCheckRunInput } from '@makinbakin/sdk'
import { parseHealthCheckRunInput } from '../../../src/core/health-contract'

function appendAuditLine(event: string, agoMs = 60_000): void {
  const line = JSON.stringify({ ts: new Date(Date.now() - agoMs).toISOString(), event, agent: 'test', data: {} })
  appendFileSync(join(testDir, 'audit.jsonl'), line + '\n', 'utf-8')
}

function observed(run: HealthCheckRunInput) {
  const parsed = parseHealthCheckRunInput(run)
  expect(parsed.outcome).toBe('observed')
  if (parsed.outcome !== 'observed') throw new Error(parsed.reason)
  return parsed.observations
}

beforeEach(() => {
  mkdirSync(testDir, { recursive: true })
  dbPath = join(testDir, 'bakin.db')
})

afterEach(() => {
  closeDb()
  rmSync(testDir, { recursive: true, force: true })
})

describe('execution-safety health check', () => {
  it('is ok when no suppressions happened in the window', async () => {
    appendAuditLine('task.completed') // unrelated events don't count
    const [result] = observed(await checkExecutionSafety())
    expect(result.status).toBe('healthy')
  })

  it('warns with per-kind counts when the guards fired', async () => {
    appendAuditLine('schedule.fire_suppressed')
    appendAuditLine('schedule.fire_suppressed')
    appendAuditLine('task.completion_suppressed')
    appendAuditLine('task.run_superseded')

    const [result] = observed(await checkExecutionSafety())
    expect(result.status).toBe('warning')
    expect(result.summary).toContain('4 duplicate executions were suppressed')
    expect(result.evidence?.counts).toEqual({
      'schedule.fire_suppressed': 2,
      'task.completion_suppressed': 1,
      'task.run_superseded': 1,
    })
  })

  it('ignores suppressions older than 24h', async () => {
    appendAuditLine('task.dispatch_suppressed', 25 * 60 * 60 * 1000)
    const [result] = observed(await checkExecutionSafety())
    expect(result.status).toBe('healthy')
  })

  it('errors when the ledger is unreachable (guards are failing closed)', async () => {
    closeDb()
    mkdirSync(join(testDir, 'blocked', 'bakin.db'), { recursive: true }) // a directory at the db path
    dbPath = join(testDir, 'blocked', 'bakin.db')

    const [result] = observed(await checkExecutionSafety())
    expect(result.status).toBe('error')
    expect(result.incident?.impact).toContain('fail closed')
  })
})
