import { describe, expect, it } from 'bun:test'
import { renderToString } from 'ink'

import {
  DoctorDelegatePreview,
  DoctorDelegateResult,
  DoctorRepairApplyReport,
  DoctorRepairPlan,
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
    taskId: 'task-repair-1',
    agentId: 'main',
  },
  unresolved: [
    { check: 'channels', status: 'warn', message: 'Approval channel requires manual configuration.', autoFixable: false },
  ],
}

describe('doctor repair CLI UI', () => {
  it('renders a repair plan with shared TUI primitives', () => {
    const rendered = renderToString(<DoctorRepairPlan plan={repairPlan} color={false} />)

    expect(rendered).toContain("┃  🐷 Bakin'                  (v1.0.0) ┃")
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
    expect(rendered).not.toContain("┃  🐷 Bakin'                  (v1.0.0) ┃")
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
})
