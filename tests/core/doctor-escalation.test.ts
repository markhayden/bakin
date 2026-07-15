/**
 * Periodic-doctor escalation — cron errors become ONE deduplicated
 * delegated-repair task (or a notification), never a task per cycle.
 */
import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = mkdtempSync(join(tmpdir(), 'bakin-doctor-escalation-'))
process.env.BAKIN_HOME = testDir

const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
const loggerMock = () => ({
  createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }),
})
mock.module('../../src/core/logger', loggerMock)
mock.module('../../packages/core/src/logger', loggerMock)

// Mutable fixtures
let escalationMode: 'off' | 'notify' | 'task' = 'task'
let cooldownMs = 6 * 60 * 60 * 1000
let staleAfterMs = 12 * 60 * 60 * 1000
let repairRequests: Array<{
  id: string
  createdAt: string
  taskId?: string
  unresolved: Array<{ check: string; status: string; message: string }>
}> = []
let openTaskColumns: Record<string, string> = {}

mock.module('../../src/core/settings', () => ({
  getSettings: () => ({ doctor: { escalation: escalationMode, escalationCooldownMs: cooldownMs, escalationStaleAfterMs: staleAfterMs } }),
}))
mock.module('../../src/core/doctor-repair-store', () => ({
  listDoctorRepairRequests: () => repairRequests,
}))
mock.module('../../src/core/task-service', () => ({
  getTaskDetails: async (taskId: string) =>
    taskId in openTaskColumns ? { task: {}, column: openTaskColumns[taskId] } : null,
}))
const delegateDoctorRepair = mock(async (options: { rows?: unknown[] }) => ({
  status: 'sent',
  request: { id: 'repair-new', taskId: 'task-new' },
  unresolved: options.rows ?? [],
}))
mock.module('../../src/core/doctor-delegate', () => ({ delegateDoctorRepair }))
// notify mode sends through the runtime — spy at the messaging boundary
const messagingSend = mock(async () => ({ ok: true }))
const appServices = () => ({ runtime: { messaging: { send: messagingSend } } })
mock.module('../../src/core/app-services', () => ({ getAppServices: appServices, maybeGetAppServices: appServices }))
mock.module('../../src/core/agent-cost', () => ({ meterAgentTurn: async () => {} }))
mock.module('@bakin/core/adapters/runtime', () => ({ getRuntimeMainAgentId: async () => 'main' }))

import { clearNotifiedIssues, escalateCronErrors } from '../../src/core/doctor-escalation'
import type { HealthCheckResult } from '../../packages/core/src/plugin-types'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  escalationMode = 'task'
  cooldownMs = 6 * 60 * 60 * 1000
  staleAfterMs = 12 * 60 * 60 * 1000
  repairRequests = []
  openTaskColumns = {}
  delegateDoctorRepair.mockClear()
  messagingSend.mockClear()
  clearNotifiedIssues()
})

const errorRow = (check: string): HealthCheckResult => ({ check, status: 'error', message: `${check} broke`, autoFixable: true })
const okRow = (check: string): HealthCheckResult => ({ check, status: 'ok', message: 'fine', autoFixable: false })

describe('escalateCronErrors', () => {
  it('creates a delegated repair task for cron errors (safe-repairable ones included)', async () => {
    await escalateCronErrors([okRow('search'), errorRow('search-canary')], testDir, testDir)
    expect(delegateDoctorRepair).toHaveBeenCalledTimes(1)
    const args = delegateDoctorRepair.mock.calls[0][0] as { accepted: boolean; rows: HealthCheckResult[] }
    expect(args.accepted).toBe(true)
    expect(args.rows.map((r) => r.check)).toEqual(['search-canary'])
  })

  it('does nothing without errors, when off, or on a not-onboarded machine', async () => {
    await escalateCronErrors([okRow('search')], testDir, testDir)
    escalationMode = 'off'
    await escalateCronErrors([errorRow('search-canary')], testDir, testDir)
    escalationMode = 'task'
    await escalateCronErrors([errorRow('onboarded'), errorRow('search-canary')], testDir, testDir)
    expect(delegateDoctorRepair).not.toHaveBeenCalled()
  })

  it('skips while a FRESH open repair task already covers every current error check', async () => {
    repairRequests = [{
      id: 'repair-1',
      createdAt: new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString(), // cooldown past, not yet stale
      taskId: 'task-1',
      unresolved: [{ check: 'search-canary', status: 'error', message: 'dark' }],
    }]
    openTaskColumns = { 'task-1': 'doing' }
    await escalateCronErrors([errorRow('search-canary')], testDir, testDir)
    expect(delegateDoctorRepair).not.toHaveBeenCalled()
  })

  it('an ARCHIVED covering task is closed, not an open cover (the 2026-07-14 mute)', async () => {
    repairRequests = [{
      id: 'repair-1',
      createdAt: new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString(), // cooldown past, would suppress if open
      taskId: 'task-1',
      unresolved: [{ check: 'search-canary', status: 'error', message: 'dark' }],
    }]
    openTaskColumns = { 'task-1': 'archived' }
    await escalateCronErrors([errorRow('search-canary')], testDir, testDir)
    expect(delegateDoctorRepair).toHaveBeenCalledTimes(1)
  })

  it('re-escalates when the covering task is STALE — open past escalationStaleAfterMs with the error still burning', async () => {
    repairRequests = [{
      id: 'repair-1',
      createdAt: new Date(Date.now() - 34 * 60 * 60 * 1000).toISOString(), // the 2026-07-14 incident shape
      taskId: 'task-1',
      unresolved: [{ check: 'search-canary', status: 'error', message: 'dark' }],
    }]
    openTaskColumns = { 'task-1': 'doing' }
    await escalateCronErrors([errorRow('search-canary')], testDir, testDir)
    expect(delegateDoctorRepair).toHaveBeenCalledTimes(1)
  })

  it('a fresher covering request still suppresses even when an older stale one exists', async () => {
    repairRequests = [
      {
        id: 'repair-old',
        createdAt: new Date(Date.now() - 34 * 60 * 60 * 1000).toISOString(),
        taskId: 'task-old',
        unresolved: [{ check: 'search-canary', status: 'error', message: 'dark' }],
      },
      {
        id: 'repair-new',
        createdAt: new Date(Date.now() - 60_000).toISOString(), // the re-escalation from last cycle
        taskId: 'task-new',
        unresolved: [{ check: 'search-canary', status: 'error', message: 'dark' }],
      },
    ]
    openTaskColumns = { 'task-old': 'doing', 'task-new': 'todo' }
    await escalateCronErrors([errorRow('search-canary')], testDir, testDir)
    expect(delegateDoctorRepair).not.toHaveBeenCalled()
  })

  it('skips inside the cooldown window even when the previous task is done', async () => {
    repairRequests = [{
      id: 'repair-1',
      createdAt: new Date(Date.now() - 60_000).toISOString(),
      taskId: 'task-1',
      unresolved: [{ check: 'search-canary', status: 'error', message: 'dark' }],
    }]
    openTaskColumns = { 'task-1': 'done' }
    await escalateCronErrors([errorRow('search-canary')], testDir, testDir)
    expect(delegateDoctorRepair).not.toHaveBeenCalled()
  })

  it('re-escalates once the cooldown passed and the previous task is done', async () => {
    repairRequests = [{
      id: 'repair-1',
      createdAt: new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString(),
      taskId: 'task-1',
      unresolved: [{ check: 'search-canary', status: 'error', message: 'dark' }],
    }]
    openTaskColumns = { 'task-1': 'done' }
    await escalateCronErrors([errorRow('search-canary')], testDir, testDir)
    expect(delegateDoctorRepair).toHaveBeenCalledTimes(1)
  })

  it('a NEW error check escalates even while an older narrower task is open', async () => {
    repairRequests = [{
      id: 'repair-1',
      createdAt: new Date().toISOString(),
      taskId: 'task-1',
      unresolved: [{ check: 'search-canary', status: 'error', message: 'dark' }],
    }]
    openTaskColumns = { 'task-1': 'doing' }
    await escalateCronErrors([errorRow('search-canary'), errorRow('execution-safety')], testDir, testDir)
    expect(delegateDoctorRepair).toHaveBeenCalledTimes(1)
  })

  it('notify mode messages the main agent instead of creating a task — autoFixable errors included', async () => {
    escalationMode = 'notify'
    await escalateCronErrors([errorRow('search-canary')], testDir, testDir)
    expect(messagingSend).toHaveBeenCalledTimes(1)
    const sent = (messagingSend.mock.calls[0] as unknown[])[0] as { agentId: string; content: string }
    expect(sent.agentId).toBe('main')
    expect(sent.content).toContain('search-canary')
    expect(sent.content).toContain('repair available')
    expect(delegateDoctorRepair).not.toHaveBeenCalled()
  })

  it('a delegation failure never throws out of the cron path', async () => {
    delegateDoctorRepair.mockImplementationOnce(async () => { throw new Error('runtime down') })
    await escalateCronErrors([errorRow('search-canary')], testDir, testDir)
    // reaching here without throwing IS the assertion
    expect(delegateDoctorRepair).toHaveBeenCalledTimes(1)
  })
})
