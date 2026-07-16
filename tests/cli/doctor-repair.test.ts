import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { HealthRepairPlan } from '@makinbakin/sdk/types'
// Warm Ink before exercising the CLI's lazy TUI import under Bun's module-isolated runner.
import 'ink'
import { setupTtyCliHarness } from './helpers/tty-cli-harness'
import {
  actionableHealthReport,
  actionableIncident,
  actionableObservation,
  advisoryHealthReport,
  makeHealthReport,
} from './doctor-fixtures'

let nextQuestionAnswer = 'y'
let prompts: string[] = []

mock.module('node:readline/promises', () => ({
  createInterface: () => ({
    question: async (prompt: string) => {
      prompts.push(prompt)
      return nextQuestionAnswer
    },
    close: () => {},
  }),
}))

const mockPlan: HealthRepairPlan = {
  planId: 'plan-1',
  basedOnReportId: actionableHealthReport.id,
  target: { type: 'all_actionable', reportId: actionableHealthReport.id },
  createdAt: '2026-07-12T12:00:00.000Z',
  expiresAt: '2026-07-12T12:05:00.000Z',
  items: [
    {
      id: 'tasks.repair-taskboard:restore-columns',
      actionId: 'tasks.repair-taskboard',
      title: 'Restore task board columns',
      reason: 'The task board is missing required columns.',
      safety: 'safe',
      incidentIds: [actionableIncident.id],
      observationIds: [actionableObservation.id],
      preconditions: [{
        observationId: actionableObservation.id,
        executionId: 'execution:tasks.taskboard',
        status: 'error',
        resolutionKey: 'restore-columns',
      }],
      changes: [{ kind: 'file', target: 'tasks/board.json', action: 'update', description: 'Add missing columns.' }],
    },
    {
      id: 'channels.configure:approval',
      actionId: 'channels.configure',
      title: 'Configure an approval channel',
      reason: 'Credentials require an operator decision.',
      safety: 'manual',
      incidentIds: ['core:channels:approval'],
      observationIds: ['core.channels:approval'],
      preconditions: [],
      changes: [{ kind: 'setting', target: 'channels.approval', action: 'update', description: 'Choose a channel.' }],
    },
  ],
}

const repairedReport = makeHealthReport('healthy', {
  id: 'health-report-repaired',
  summary: {
    checks: { registered: 1, completed: 1, failed: 0, invalid: 0, notApplicable: 0 },
    incidents: { actionRequired: 0, watching: 0, advisory: 0, unknown: 0 },
  },
})

const mockApply = {
  planId: mockPlan.planId,
  basedOnReportId: mockPlan.basedOnReportId,
  results: [{
    itemId: mockPlan.items[0]!.id,
    actionId: mockPlan.items[0]!.actionId,
    status: 'applied',
    message: 'Restored the task board columns.',
    affectedCheckIds: ['tasks.taskboard'],
    changes: mockPlan.items[0]!.changes,
  }],
  affectedCheckIds: ['tasks.taskboard'],
  verifiedReportId: repairedReport.id,
  verifiedIncidentIds: [],
  report: repairedReport,
}

const mockRequest = {
  version: 2,
  id: 'repair-1',
  kind: 'delegate',
  status: 'sent',
  createdAt: '2026-07-12T12:00:00.000Z',
  updatedAt: '2026-07-12T12:01:00.000Z',
  plan: mockPlan,
  incidentIds: [actionableIncident.id],
  observationIds: [actionableObservation.id],
  taskId: 'task-repair-1',
  agentId: 'main',
  events: [],
}

const mockDelegate = {
  status: 'sent',
  request: mockRequest,
  incidents: [actionableIncident],
}

const harness = setupTtyCliHarness({ exitMode: 'always-throws', defaultIsTTY: null })
const { fetchMock, setStdoutIsTTY, output: loggedOutput } = harness

function response(body: unknown): Response {
  return harness.jsonResponse(body)
}

describe('canonical CLI doctor repair', () => {
  function headerCount(output: string): number {
    return output.split("┃ 🐷 Bakin'").length - 1
  }

  beforeEach(() => {
    prompts = []
    nextQuestionAnswer = 'y'
  })

  it('plans against the current report and does not mutate without confirmation', async () => {
    fetchMock
      .mockResolvedValueOnce(response(actionableHealthReport))
      .mockResolvedValueOnce(response(mockPlan))
    process.argv = ['bun', 'cli/bakin.ts', 'doctor', '--fix', '--json']

    const { main } = await import('../../cli/bakin')
    await expect(main()).rejects.toThrow('exit:1')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toContain('/api/plugins/health/doctor/run')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST' })
    expect(fetchMock.mock.calls[1][0]).toContain('/api/plugins/health/doctor/repair/plan')
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'POST' })
    expect(fetchMock.mock.calls[1][1]?.body).toBe(JSON.stringify({
      target: { type: 'all_actionable', reportId: actionableHealthReport.id },
    }))
    const body = JSON.parse(String(harness.log.mock.calls[0][0]))
    expect(body.error.code).toBe('CONFIRMATION_REQUIRED')
    expect(body.data.plan.planId).toBe(mockPlan.planId)
  })

  it('plans first and applies only safe item IDs with --yes', async () => {
    fetchMock
      .mockResolvedValueOnce(response(actionableHealthReport))
      .mockResolvedValueOnce(response(mockPlan))
      .mockResolvedValueOnce(response(mockApply))
    process.argv = ['bun', 'cli/bakin.ts', 'doctor', '--fix', '--json', '--yes']

    const { main } = await import('../../cli/bakin')
    await main()

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[2][0]).toContain('/api/plugins/health/doctor/repair/apply')
    expect(fetchMock.mock.calls[2][1]).toMatchObject({ method: 'POST' })
    expect(fetchMock.mock.calls[2][1]?.body).toBe(JSON.stringify({
      planId: mockPlan.planId,
      itemIds: [mockPlan.items[0]!.id],
      confirmedItemIds: [],
    }))
    const body = JSON.parse(String(harness.log.mock.calls[0][0]))
    expect(body.ok).toBe(true)
    expect(body.data.report.id).toBe(repairedReport.id)
  })

  it('does not apply a plan that has no safe items', async () => {
    const manualPlan = { ...mockPlan, items: [mockPlan.items[1]!] }
    fetchMock
      .mockResolvedValueOnce(response(actionableHealthReport))
      .mockResolvedValueOnce(response(manualPlan))
    process.argv = ['bun', 'cli/bakin.ts', 'doctor', '--fix', '--json', '--yes']

    const { main } = await import('../../cli/bakin')
    await main()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const body = JSON.parse(String(harness.log.mock.calls[0][0]))
    expect(body.data.status).toBe('no_safe_repairs')
    expect(body.data.plan.planId).toBe(mockPlan.planId)
  })

  it('renders an empty TTY repair plan with the shared doctor repair UI', async () => {
    const emptyPlan = { ...mockPlan, items: [] }
    fetchMock
      .mockResolvedValueOnce(response(actionableHealthReport))
      .mockResolvedValueOnce(response(emptyPlan))
    setStdoutIsTTY(true)
    process.argv = ['bun', 'cli/bakin.ts', 'doctor', '--fix']

    const { main } = await import('../../cli/bakin')
    await main()

    const output = loggedOutput()
    expect(output).toContain("┃ 🐷 Bakin'")
    expect(output).toContain('Doctor repair plan')
    expect(output).toContain('No deterministic repairs available.')
    expect(output).not.toContain('[SAFE]')
  })

  it('renders TTY repair application results with canonical verification', async () => {
    fetchMock
      .mockResolvedValueOnce(response(actionableHealthReport))
      .mockResolvedValueOnce(response(mockPlan))
      .mockResolvedValueOnce(response(mockApply))
    setStdoutIsTTY(true)
    process.argv = ['bun', 'cli/bakin.ts', 'doctor', '--fix', '--yes']

    const { main } = await import('../../cli/bakin')
    await main()

    const output = loggedOutput()
    expect(output).toContain('Doctor repair results')
    expect(output).toContain('APPLIED\n------------')
    expect(output).toContain('Restored the task board columns.')
    expect(output).toContain('Selected repair incidents no longer reproduce.')
  })

  it('keeps a single brand header across interactive plan and apply', async () => {
    fetchMock
      .mockResolvedValueOnce(response(actionableHealthReport))
      .mockResolvedValueOnce(response(mockPlan))
      .mockResolvedValueOnce(response(mockApply))
    setStdoutIsTTY(true)
    process.argv = ['bun', 'cli/bakin.ts', 'doctor', '--fix']

    const { main } = await import('../../cli/bakin')
    await main()

    const output = loggedOutput()
    expect(prompts[0]).toStartWith('\nApply 1 safe repair item? [y/N]')
    expect(output).toContain('Doctor repair plan')
    expect(output).toContain('Doctor repair results')
    expect(headerCount(output)).toBe(1)
  })

  it('does not apply when interactive confirmation is declined', async () => {
    nextQuestionAnswer = 'n'
    fetchMock
      .mockResolvedValueOnce(response(actionableHealthReport))
      .mockResolvedValueOnce(response(mockPlan))
    setStdoutIsTTY(true)
    process.argv = ['bun', 'cli/bakin.ts', 'doctor', '--fix']

    const { main } = await import('../../cli/bakin')
    await expect(main()).rejects.toThrow('exit:1')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(prompts).toHaveLength(1)
    expect(loggedOutput()).toContain('Repair cancelled.')
  })

  it('previews canonical action-required incidents without creating a task', async () => {
    fetchMock.mockResolvedValueOnce(response(actionableHealthReport))
    process.argv = ['bun', 'cli/bakin.ts', 'doctor', '--delegate', '--json']

    const { main } = await import('../../cli/bakin')
    await expect(main()).rejects.toThrow('exit:1')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse(String(harness.log.mock.calls[0][0]))
    expect(body.error.code).toBe('CONFIRMATION_REQUIRED')
    expect(body.data.incidents.map((incident: { id: string }) => incident.id)).toEqual([actionableIncident.id])
  })

  it('creates a delegated task with an explicit incident target', async () => {
    fetchMock
      .mockResolvedValueOnce(response(actionableHealthReport))
      .mockResolvedValueOnce(response(mockDelegate))
    process.argv = ['bun', 'cli/bakin.ts', 'doctor', '--delegate', '--json', '--yes']

    const { main } = await import('../../cli/bakin')
    await main()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][0]).toContain('/api/plugins/health/doctor/delegate')
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'POST' })
    expect(fetchMock.mock.calls[1][1]?.body).toBe(JSON.stringify({
      accepted: true,
      target: {
        type: 'incidents',
        reportId: actionableHealthReport.id,
        ids: [actionableIncident.id],
      },
    }))
    const body = JSON.parse(String(harness.log.mock.calls[0][0]))
    expect(body.data.request.taskId).toBe('task-repair-1')
  })

  it('does not delegate advisory incidents', async () => {
    fetchMock.mockResolvedValueOnce(response(advisoryHealthReport))
    process.argv = ['bun', 'cli/bakin.ts', 'doctor', '--delegate', '--json', '--yes']

    const { main } = await import('../../cli/bakin')
    await main()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse(String(harness.log.mock.calls[0][0]))
    expect(body.data.status).toBe('no_action_required')
    expect(body.data.incidents).toEqual([])
  })

  it('renders TTY delegated repair results with canonical incidents', async () => {
    fetchMock
      .mockResolvedValueOnce(response(actionableHealthReport))
      .mockResolvedValueOnce(response(mockDelegate))
    setStdoutIsTTY(true)
    process.argv = ['bun', 'cli/bakin.ts', 'doctor', '--delegate', '--yes']

    const { main } = await import('../../cli/bakin')
    await main()

    const output = loggedOutput()
    expect(output).toContain('Delegated doctor repair')
    expect(output).toContain(actionableIncident.id)
    expect(output).toContain('task-repair-1')
    expect(output).toContain('Watch the board for task-repair-1')
  })

  it('lists canonical delegated repair requests', async () => {
    fetchMock.mockResolvedValueOnce(response({ requests: [mockRequest] }))
    process.argv = ['bun', 'cli/bakin.ts', 'doctor', 'repair', 'list', '--json']

    const { main } = await import('../../cli/bakin')
    await main()

    expect(fetchMock.mock.calls[0][0]).toContain('/api/plugins/health/doctor/repair')
    const body = JSON.parse(String(harness.log.mock.calls[0][0]))
    expect(body.data.requests[0].incidentIds).toEqual([actionableIncident.id])
  })

  it('renders canonical request details in a TTY', async () => {
    fetchMock.mockResolvedValueOnce(response({ request: mockRequest }))
    setStdoutIsTTY(true)
    process.argv = ['bun', 'cli/bakin.ts', 'doctor', 'repair', 'show', 'repair-1']

    const { main } = await import('../../cli/bakin')
    await main()

    const output = loggedOutput()
    expect(output).toContain('Doctor repair request')
    expect(output).toContain('INCIDENTS')
    expect(output).toContain(actionableIncident.id)
    expect(output).toContain('PLANNED ACTIONS')
  })

  it('renders canonical delegated repair verification', async () => {
    fetchMock.mockResolvedValueOnce(response({
      request: { ...mockRequest, status: 'verified' },
      remainingIncidentIds: [],
      verified: true,
      reportId: repairedReport.id,
    }))
    setStdoutIsTTY(true)
    process.argv = ['bun', 'cli/bakin.ts', 'doctor', 'repair', 'verify', 'repair-1']

    const { main } = await import('../../cli/bakin')
    await main()

    expect(fetchMock.mock.calls[0][0]).toContain('/api/plugins/health/doctor/repair/repair-1/verify')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST' })
    const output = loggedOutput()
    expect(output).toContain('Doctor repair verification')
    expect(output).toContain('Original delegated incidents are resolved.')
  })

  it('uses a failed apply result as exit 1 even when verification is healthy', async () => {
    const failedApply = {
      ...mockApply,
      results: [{ ...mockApply.results[0], status: 'failed', message: 'Repair action failed.' }],
    }
    fetchMock
      .mockResolvedValueOnce(response(actionableHealthReport))
      .mockResolvedValueOnce(response(mockPlan))
      .mockResolvedValueOnce(response(failedApply))
    process.argv = ['bun', 'cli/bakin.ts', 'doctor', '--fix', '--json', '--yes']

    const { main } = await import('../../cli/bakin')
    await expect(main()).rejects.toThrow('exit:1')
  })
})
