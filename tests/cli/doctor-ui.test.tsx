import { describe, expect, it } from 'bun:test'
import { renderToString } from 'ink'
import type { HealthObservation } from '@makinbakin/sdk/types'

import { DoctorReport } from '../../src/core/cli/ui/doctor'
import {
  actionableHealthReport,
  actionableIncident,
  actionableObservation,
  advisoryHealthReport,
  checkState,
  makeHealthReport,
  unknownHealthReport,
  unknownIncident,
  unknownObservation,
} from './doctor-fixtures'

describe('doctor CLI UI', () => {
  it('renders canonical observations and incident counts with shared TUI primitives', () => {
    const report = makeHealthReport('needs_attention', {
      ...actionableHealthReport,
      checks: [checkState(actionableObservation), checkState(unknownObservation)],
      observations: [actionableObservation, unknownObservation],
      incidents: [actionableIncident, unknownIncident],
      summary: {
        checks: { registered: 2, completed: 2, failed: 0, invalid: 0, notApplicable: 0 },
        incidents: { actionRequired: 1, watching: 1, advisory: 0, unknown: 1 },
      },
    })
    const rendered = renderToString(<DoctorReport report={report} mode="offline" color={false} />)

    expect(rendered).toContain("┃ 🐷 Bakin'")
    expect(rendered).toContain('Doctor  mode: offline')
    expect(rendered).toContain(' FAIL     1 action required')
    expect(rendered).toContain(' RUN      1 unknown')
    expect(rendered).toContain('2 checks')
    expect(rendered).toContain('HEALTH FINDINGS\n-------------------')
    expect(rendered).toContain('tasks.taskboard')
    expect(rendered).toContain('Task board columns are missing.')
    expect(rendered).toContain('Runtime health has not been verified.')
    expect(rendered).toContain('NEXT\n------------')
    expect(rendered).toContain('Run `bakin start`, then `bakin doctor --full`')
    expect(rendered).toContain('Run `bakin doctor --fix`')
    expect(rendered).not.toContain('[FAIL]')
  })

  it('keeps advisory-only reports healthy and action-free', () => {
    const rendered = renderToString(<DoctorReport report={advisoryHealthReport} mode="full" color={false} />)

    expect(rendered).toContain(' OK       healthy')
    expect(rendered).toContain('1 advisory')
    expect(rendered).toContain('Usage is trending upward.')
    expect(rendered).not.toContain('NEXT\n------------')
  })

  it('uses Unknown status structurally without parsing observation copy', () => {
    const report = {
      ...unknownHealthReport,
      observations: [{ ...unknownObservation, summary: 'Live runtime evidence was not collected.' }],
    }
    const rendered = renderToString(<DoctorReport report={report} mode="offline" color={false} />)

    expect(rendered).toContain(' RUN      1 unknown')
    expect(rendered).toContain('Live runtime evidence was not collected.')
    expect(rendered).toContain('Run `bakin start`, then `bakin doctor --full`')
    expect(rendered).not.toContain('Run `bakin doctor --delegate`')
  })

  it('demotes retained last-known healthy evidence instead of showing it as current OK', () => {
    const retained: HealthObservation = {
      id: 'tasks.taskboard:last-known',
      key: 'last-known',
      status: 'healthy',
      summary: 'Task board columns were present.',
      detail: 'This evidence predates the latest failed check.',
      checkId: 'tasks.taskboard',
      checkName: 'Task board',
      owner: actionableObservation.owner,
      group: actionableObservation.group,
      checkedAt: actionableObservation.checkedAt,
      observedAt: actionableObservation.observedAt,
      staleAt: actionableObservation.staleAt,
      snapshot: 'last_known',
    }
    const report = makeHealthReport('unknown_stale', {
      checks: [checkState(retained)],
      observations: [retained],
      incidents: [unknownIncident],
      summary: {
        checks: { registered: 1, completed: 0, failed: 1, invalid: 0, notApplicable: 0 },
        incidents: { actionRequired: 0, watching: 1, advisory: 0, unknown: 1 },
      },
    })
    const rendered = renderToString(<DoctorReport report={report} mode="full" color={false} />)

    expect(rendered).toContain('RUN       tasks.taskboard')
    expect(rendered).toContain('Last known: Task board columns were present.')
    expect(rendered).not.toContain('OK        tasks.taskboard')
  })
})
