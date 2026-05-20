import { describe, expect, it } from 'bun:test'
import { renderToString } from 'ink'

import {
  DoctorDelegatePreview,
  DoctorDelegateResult,
  DoctorRepairApplyReport,
  DoctorRepairPlan,
  DoctorRepairRequestReport,
  DoctorRepairRequestsReport,
  DoctorRepairVerifyReport,
} from '../../src/core/cli/ui/doctor-repair'

const repairPlan = {
  diagnostics: [
    { check: 'team.install-agent-assets', status: 'warn', message: '1 agent-package projection needs repair.', autoFixable: true },
    { check: 'channels', status: 'warn', message: 'Approval channel requires manual configuration.', autoFixable: false },
  ],
  items: [{
    id: 'repair.team.install-agent-assets',
    checkId: 'team.install-agent-assets',
    healthCheckId: 'team.install-agent-assets',
    pluginId: 'team',
    checkName: 'Agent assets',
    title: 'Repair agent-package projections',
    reason: '1 agent-package projection needs repair.',
    safety: 'safe' as const,
    requiresConfirmation: true,
    changes: [{
      kind: 'command',
      target: 'agent-assets',
      action: 'invoke',
      description: 'Run the agent-package install flow to repair missing or drifted projected files.',
    }],
  }],
  errors: [],
  summary: { diagnostics: 2, repairableChecks: 1, totalItems: 1, safeItems: 1, blockedItems: 0, planErrors: 0 },
}

const repairApply = {
  status: 'applied' as const,
  plan: repairPlan,
  applied: [{
    id: 'repair.team.install-agent-assets',
    checkId: 'team.install-agent-assets',
    status: 'applied',
    message: 'Repaired agent-package projections.',
    changes: repairPlan.items[0].changes,
  }],
  skipped: [],
  errors: [],
  verification: [{ check: 'team.install-agent-assets', status: 'ok', message: 'Agent assets are healthy.', autoFixable: false }],
  summary: { planned: 1, applied: 1, skipped: 0, failed: 0, verificationErrors: 0, verificationWarnings: 0 },
}

const delegateReport = {
  status: 'sent' as const,
  request: {
    id: 'repair-1',
    status: 'sent',
    taskId: 'task-repair-1',
    agentId: 'main',
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:01:00.000Z',
    unresolved: [
      { check: 'channels', status: 'warn', message: 'Approval channel requires manual configuration.', autoFixable: false },
    ],
    events: [{
      ts: '2026-04-01T00:01:00.000Z',
      type: 'task-created',
      message: 'Created linked repair task task-repair-1.',
    }],
  },
  unresolved: [
    { check: 'channels', status: 'warn', message: 'Approval channel requires manual configuration.', autoFixable: false },
  ],
}

describe('doctor repair CLI UI', () => {
  it('renders a repair plan with shared TUI primitives', () => {
    const rendered = renderToString(<DoctorRepairPlan plan={repairPlan} color={false} />)

    expect(rendered).toContain("┃ 🐷 Bakin'")
    expect(rendered).toContain('Doctor repair plan')
    expect(rendered).toContain(' READY    1 safe')
    expect(rendered).toContain('SAFE DETERMINISTIC REPAIRS')
    expect(rendered).toContain('team.install-agent')
    expect(rendered).toContain('Repair agent-package projections')
    expect(rendered).not.toContain('NEXT\n------------')
    expect(rendered).not.toContain('bakin doctor --fix --yes')
    expect(rendered).not.toContain('[SAFE]')
  })

  it('renders applied repair results and verification', () => {
    const rendered = renderToString(<DoctorRepairApplyReport report={repairApply} color={false} />)

    expect(rendered).toContain('Doctor repair results')
    expect(rendered).toContain(' APPLIED  1 applied')
    expect(rendered).toContain('APPLIED\n------------')
    expect(rendered).toContain('Repaired agent-package projections.')
    expect(rendered).toContain('VERIFICATION\n------------')
    expect(rendered).toContain('Agent assets are healthy.')
    expect(rendered).not.toContain('[APPLIED]')
  })

  it('can render repair results as a continuation without the brand header', () => {
    const rendered = renderToString(<DoctorRepairApplyReport report={repairApply} color={false} showBrand={false} />)

    expect(rendered).toContain('Doctor repair results')
    expect(rendered).not.toContain("┃ 🐷 Bakin'")
  })

  it('renders delegated repair preview and sent result', () => {
    const preview = renderToString(<DoctorDelegatePreview unresolved={delegateReport.unresolved} color={false} />)
    const result = renderToString(<DoctorDelegateResult report={delegateReport} color={false} />)

    expect(preview).toContain('Doctor delegated repair preview')
    expect(preview).toContain('UNRESOLVED FINDINGS')
    expect(preview).toContain('channels')
    expect(preview).not.toContain('NEXT\n------------')
    expect(preview).not.toContain('bakin doctor --delegate --yes')
    expect(preview).not.toContain('[WARN]')

    expect(result).toContain('Delegated doctor repair')
    expect(result).toContain(' SENT     repair-1 request')
    expect(result).toContain(' TODO     task-repair-1 task')
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

  it('renders delegated repair request details with findings and events', () => {
    const rendered = renderToString(<DoctorRepairRequestReport request={delegateReport.request} color={false} />)

    expect(rendered).toContain('Doctor repair request')
    expect(rendered).toContain('repair-1')
    expect(rendered).toContain('REQUEST')
    expect(rendered).toContain('UNRESOLVED FINDINGS')
    expect(rendered).toContain('channels')
    expect(rendered).toContain('EVENTS')
    expect(rendered).toContain('Created linked repair task task-repair-1.')
    expect(rendered).not.toContain('"request"')
  })

  it('renders delegated repair verification results', () => {
    const rendered = renderToString(
      <DoctorRepairVerifyReport
        requestId="repair-1"
        result={{
          request: { ...delegateReport.request, status: 'verified' },
          remaining: [],
          verified: true,
        }}
        color={false}
      />,
    )

    expect(rendered).toContain('Doctor repair verification')
    expect(rendered).toContain('RESULT')
    expect(rendered).toContain('repair-1')
    expect(rendered).toContain('Original delegated findings are resolved.')
    expect(rendered).not.toContain('"verified"')
  })
})
