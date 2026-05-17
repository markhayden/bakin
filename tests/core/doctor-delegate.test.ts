import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = mkdtempSync(join(tmpdir(), 'bakin-doctor-delegate-'))

process.env.BAKIN_HOME = testDir

const mockPlan = {
  diagnostics: [
    { check: 'runtime', status: 'error', message: 'Runtime unreachable', autoFixable: false },
    { check: 'taskboard', status: 'warn', message: 'Missing columns', autoFixable: true },
  ],
  items: [{
    id: 'repair.taskboard',
    checkId: 'taskboard',
    healthCheckId: 'tasks.taskboard',
    pluginId: 'tasks',
    checkName: 'Taskboard',
    title: 'Repair taskboard',
    reason: 'Missing columns',
    safety: 'safe',
    requiresConfirmation: true,
    changes: [{ kind: 'file', target: 'tasks/board.json', action: 'update', description: 'Add missing columns' }],
  }],
  errors: [],
  summary: { diagnostics: 2, repairableChecks: 1, totalItems: 1, safeItems: 1, blockedItems: 0, planErrors: 0 },
}

const createTaskWithEffects = mock(async () => ({ id: 'task-doctor-repair' }))
const dispatchSingleTask = mock(async () => {})

mock.module('../../src/core/doctor-repair', () => ({
  planDoctorRepair: mock(async () => mockPlan),
}))

mock.module('../../src/core/task-service', () => ({
  createTaskWithEffects,
}))

mock.module('../../src/core/dispatch', () => ({
  dispatchSingleTask,
}))

mock.module('../../src/core/app-services', () => ({
  getAppServices: () => ({
    runtime: {
      agents: {
        list: async () => [{ id: 'main', name: 'Main', role: 'Orchestrator' }],
      },
    },
  }),
}))

mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

import { delegateDoctorRepair } from '../../src/core/doctor-delegate'
import { getDoctorRepairRequest, listDoctorRepairRequests } from '../../src/core/doctor-repair-store'

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mock.clearAllMocks()
})

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('delegateDoctorRepair', () => {
  it('creates a planned request without task mutation until accepted', async () => {
    const report = await delegateDoctorRepair({
      contentDir: testDir,
      projectRoot: testDir,
      accepted: false,
    })

    expect(report.status).toBe('confirmation_required')
    expect(report.request.status).toBe('planned')
    expect(report.unresolved.map(row => row.check)).toEqual(['runtime'])
    expect(createTaskWithEffects).not.toHaveBeenCalled()
    expect(dispatchSingleTask).not.toHaveBeenCalled()

    const stored = getDoctorRepairRequest(testDir, report.request.id)
    expect(stored?.status).toBe('planned')
  })

  it('creates a board task assigned to main and kicks dispatch when accepted', async () => {
    const report = await delegateDoctorRepair({
      contentDir: testDir,
      projectRoot: testDir,
      accepted: true,
    })

    expect(report.status).toBe('sent')
    expect(report.request.taskId).toBe('task-doctor-repair')
    expect(report.request.agentId).toBe('main')
    expect(createTaskWithEffects).toHaveBeenCalledWith(expect.objectContaining({
      title: expect.stringContaining('Doctor repair'),
      column: 'todo',
      assignee: 'main',
      createdBy: 'system',
      source: expect.objectContaining({
        pluginId: 'health',
        entityType: 'doctor-repair',
        entityId: report.request.id,
        purpose: 'delegated-repair',
      }),
    }))
    expect(dispatchSingleTask).toHaveBeenCalledWith('task-doctor-repair', testDir, 3737, 'kick')

    const stored = getDoctorRepairRequest(testDir, report.request.id)
    expect(stored?.status).toBe('sent')
    expect(stored?.events.map(event => event.type)).toEqual(['created', 'task-created', 'dispatch-kicked'])
    expect(listDoctorRepairRequests(testDir)).toHaveLength(1)
  })
})
