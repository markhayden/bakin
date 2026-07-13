import { describe, expect, it } from 'bun:test'
import { renderToString } from 'ink'
import type { HealthRepairPlan } from '@makinbakin/sdk/types'

import {
  DoctorDelegatePreview,
  DoctorDelegateResult,
  DoctorRepairApplyReport,
  DoctorRepairPlan,
  DoctorRepairRequestReport,
  DoctorRepairRequestsReport,
  DoctorRepairVerifyReport,
} from '../../src/core/cli/ui/doctor-repair'
import {
  actionableHealthReport,
  actionableIncident,
  actionableObservation,
  makeHealthReport,
} from './doctor-fixtures'

const repairPlan: HealthRepairPlan = {
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
      reason: 'The canonical task board check found missing columns.',
      safety: 'safe',
      incidentIds: [actionableIncident.id],
      observationIds: [actionableObservation.id],
      preconditions: [{
        observationId: actionableObservation.id,
        executionId: 'execution:tasks.taskboard',
        status: 'error',
        resolutionKey: 'restore-columns',
      }],
      changes: [{
        kind: 'file',
        target: 'tasks/board.json',
        action: 'update',
        description: 'Add the missing workflow columns.',
      }],
    },
    {
      id: 'channels.configure:approval-channel',
      actionId: 'channels.configure',
      title: 'Configure an approval channel',
      reason: 'Credentials require an operator decision.',
      safety: 'manual',
      incidentIds: ['core:channels:approval-missing'],
      observationIds: ['core.channels:approval-missing'],
      preconditions: [],
      changes: [{
        kind: 'setting',
        target: 'channels.approval',
        action: 'update',
        description: 'Choose and authenticate an approval channel.',
      }],
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

const repairApply = {
  planId: repairPlan.planId,
  basedOnReportId: repairPlan.basedOnReportId,
  results: [{
    itemId: repairPlan.items[0]!.id,
    actionId: repairPlan.items[0]!.actionId,
    status: 'applied' as const,
    message: 'Restored the task board columns.',
    affectedCheckIds: ['tasks.taskboard'],
    changes: repairPlan.items[0]!.changes,
  }],
  affectedCheckIds: ['tasks.taskboard'],
  verifiedReportId: repairedReport.id,
  verifiedIncidentIds: [],
  report: repairedReport,
}

const delegateReport = {
  status: 'sent' as const,
  request: {
    version: 2 as const,
    id: 'repair-1',
    kind: 'delegate' as const,
    status: 'sent',
    taskId: 'task-repair-1',
    agentId: 'main',
    createdAt: '2026-07-12T12:00:00.000Z',
    updatedAt: '2026-07-12T12:01:00.000Z',
    plan: repairPlan,
    incidentIds: [actionableIncident.id],
    observationIds: [actionableObservation.id],
    events: [{
      ts: '2026-07-12T12:01:00.000Z',
      type: 'task-created',
      message: 'Created linked repair task task-repair-1.',
    }],
  },
  incidents: [actionableIncident],
}

describe('doctor repair CLI UI', () => {
  it('renders canonical repair plan items with shared TUI primitives', () => {
    const rendered = renderToString(<DoctorRepairPlan plan={repairPlan} color={false} />)

    expect(rendered).toContain("┃ 🐷 Bakin'")
    expect(rendered).toContain('Doctor repair plan')
    expect(rendered).toContain(' READY    1 safe')
    expect(rendered).toContain(' WARN     1 manual')
    expect(rendered).toContain('SAFE DETERMINISTIC REPAIRS')
    expect(rendered).toContain('tasks.repair-taskboar')
    expect(rendered).toContain('Restore task board columns')
    expect(rendered).not.toContain('NEXT\n------------')
    expect(rendered).not.toContain('[SAFE]')
  })

  it('renders canonical apply results and verified incident IDs', () => {
    const rendered = renderToString(<DoctorRepairApplyReport report={repairApply} color={false} />)

    expect(rendered).toContain('Doctor repair results')
    expect(rendered).toContain(' APPLIED  1 applied')
    expect(rendered).toContain('APPLIED\n------------')
    expect(rendered).toContain('Restored the task board columns.')
    expect(rendered).toContain('VERIFICATION\n------------')
    expect(rendered).toContain('Selected repair incidents no longer reproduce.')
    expect(rendered).not.toContain('[APPLIED]')
  })

  it('can render repair results as a continuation without the brand header', () => {
    const rendered = renderToString(<DoctorRepairApplyReport report={repairApply} color={false} showBrand={false} />)

    expect(rendered).toContain('Doctor repair results')
    expect(rendered).not.toContain("┃ 🐷 Bakin'")
  })

  it('renders delegated repair preview and sent result from canonical incidents', () => {
    const preview = renderToString(<DoctorDelegatePreview incidents={delegateReport.incidents} color={false} />)
    const result = renderToString(<DoctorDelegateResult report={delegateReport} color={false} />)

    expect(preview).toContain('Doctor delegated repair preview')
    expect(preview).toContain('ACTION-REQUIRED INCIDENTS')
    expect(preview).toContain(actionableIncident.id)
    expect(preview).not.toContain('NEXT\n------------')

    expect(result).toContain('Delegated doctor repair')
    expect(result).toContain(' SENT     repair-1 request')
    expect(result).toContain(' TODO     task-repair-1 task')
    expect(result).toContain(actionableIncident.id)
    expect(result).toContain('Watch the board for task-repair-1')
  })

  it('renders delegated repair request lists with shared TUI primitives', () => {
    const rendered = renderToString(<DoctorRepairRequestsReport requests={[delegateReport.request]} color={false} />)

    expect(rendered).toContain('Doctor repair requests')
    expect(rendered).toContain('REQUESTS')
    expect(rendered).toContain('REQUEST')
    expect(rendered).toContain('TASK')
    expect(rendered).toContain('repair-1')
    expect(rendered).toContain('task-repair-1')
    expect(rendered).not.toContain('repair-1  sent  task=task-repair-1')
  })

  it('keeps delegated repair request tables compact at 80 columns', () => {
    const rendered = renderToString(
      <DoctorRepairRequestsReport
        requests={[{
          ...delegateReport.request,
          id: 'repair-1a263583-f4d4-4927-8051-8f39c813z',
          taskId: 'task-1a263583-f4d4-4927',
        }]}
        color={false}
      />,
      { columns: 80 },
    )

    expect(rendered).toContain('REQUEST')
    expect(rendered).toContain('TASK')
    expect(rendered).toContain('AGENT')
    expect(rendered).not.toContain('UPDATED')
    expect(rendered.split('\n').some(line => line.trim().length === 1)).toBe(false)
  })

  it('keeps trailing breathing room for empty delegated repair request lists', () => {
    const rendered = renderToString(<DoctorRepairRequestsReport requests={[]} color={false} />)

    expect(rendered).toContain('No doctor repair requests.')
    expect(rendered.endsWith('\n')).toBe(true)
  })

  it('renders request details from stable incident IDs, plan items, and events', () => {
    const rendered = renderToString(<DoctorRepairRequestReport request={delegateReport.request} color={false} />)

    expect(rendered).toContain('Doctor repair request')
    expect(rendered).toContain('repair-1')
    expect(rendered).toContain('REQUEST')
    expect(rendered).toContain('INCIDENTS')
    expect(rendered).toContain(actionableIncident.id)
    expect(rendered).toContain('PLANNED ACTIONS')
    expect(rendered).toContain('tasks.repair-taskboar')
    expect(rendered).toContain('EVENTS')
    expect(rendered).toContain('Created linked repair task task-repair-1.')
    expect(rendered).not.toContain('"request"')
  })

  it('renders delegated repair verification from remaining incident IDs', () => {
    const rendered = renderToString(
      <DoctorRepairVerifyReport
        requestId="repair-1"
        result={{
          request: { ...delegateReport.request, status: 'verified' },
          remainingIncidentIds: [],
          verified: true,
          reportId: repairedReport.id,
        }}
        color={false}
      />,
    )

    expect(rendered).toContain('Doctor repair verification')
    expect(rendered).toContain('RESULT')
    expect(rendered).toContain('repair-1')
    expect(rendered).toContain('Original delegated incidents are resolved.')
    expect(rendered).not.toContain('"verified"')
  })
})
