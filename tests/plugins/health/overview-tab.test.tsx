// @vitest-environment jsdom

import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { HealthIncident, HealthObservation, HealthReport, SearchReadiness } from '@makinbakin/sdk/types'
import '../../rtl-settle'
import { buildHealthOverviewViewModel } from '../../../plugins/health/lib/health-view-model'
import { OverviewTabView } from '../../../plugins/health/components/overview-tab'

const NOW = Date.parse('2026-07-13T12:00:00.000Z')
const OBSERVED_AT = '2026-07-13T11:55:00.000Z'
const STALE_AT = '2099-07-13T12:00:00.000Z'

afterEach(cleanup)

function search(): SearchReadiness {
  return {
    status: 'healthy', summary: 'Search is ready.', observedAt: OBSERVED_AT, staleAt: STALE_AT, incidentIds: [],
    stages: (['engine', 'queries', 'indexes', 'journal'] as const).map((key) => ({
      key, label: key[0]!.toUpperCase() + key.slice(1), status: 'healthy' as const,
      summary: `${key} is ready.`, observedAt: OBSERVED_AT, staleAt: STALE_AT, observationIds: [],
    })),
  }
}

function incident(overrides: Partial<HealthIncident> & Pick<HealthIncident, 'id'>): HealthIncident {
  const { id, ...rest } = overrides
  return {
    id,
    status: 'warning', disposition: 'watch', title: id, impact: 'Operator impact.', resources: [],
    resolution: { key: 'again', type: 'rerun', label: 'Check again' },
    observationIds: [`observation:${id}`], observedAt: OBSERVED_AT, staleAt: STALE_AT, stale: false,
    ...rest,
  }
}

function observation(source: HealthIncident): HealthObservation {
  return {
    id: source.observationIds[0]!, key: source.id, status: source.status, summary: `${source.title} evidence`,
    detail: 'The probe returned a concrete technical detail.', evidence: { probe: 'failed', attempts: 2 },
    checkId: `check:${source.id}`, checkName: source.title,
    owner: { kind: 'core', id: 'core', label: 'Bakin' }, group: { key: 'runtime', label: 'Runtime' },
    checkedAt: OBSERVED_AT, observedAt: source.observedAt, staleAt: source.staleAt,
    snapshot: source.stale ? 'last_known' : 'current', incidentId: source.id,
    incident: {
      key: source.id, title: source.title, impact: source.impact, disposition: source.disposition,
      resources: source.resources, resolution: source.resolution,
    },
  } as HealthObservation
}

function report(incidents: HealthIncident[] = [], status: HealthReport['overallStatus'] = 'healthy'): HealthReport {
  const observations = incidents.map(observation)
  const checks = observations.map((row) => ({
    checkId: row.checkId, checkName: row.checkName, description: `Checks ${row.checkName}.`,
    owner: row.owner, group: row.group,
    latestExecution: {
      id: `execution:${row.id}`, checkId: row.checkId, startedAt: OBSERVED_AT,
      completedAt: OBSERVED_AT, outcome: 'observed' as const,
    },
    latestValidSnapshot: { executionId: `execution:${row.id}`, observations: [row] },
  }))
  return {
    id: 'report-1', revision: 1, generatedAt: '2026-07-13T12:00:00.000Z', overallStatus: status,
    lastFullSweep: { id: 'sweep-1', startedAt: OBSERVED_AT, completedAt: '2026-07-13T12:00:00.000Z' },
    checks, observations, incidents, subsystems: { search: search() },
    summary: {
      checks: { registered: checks.length, completed: checks.length, failed: 0, invalid: 0, notApplicable: 0 },
      incidents: {
        actionRequired: incidents.filter((row) => row.disposition === 'action_required').length,
        watching: incidents.filter((row) => row.disposition === 'watch').length,
        advisory: incidents.filter((row) => row.disposition === 'advisory').length,
        unknown: incidents.filter((row) => row.status === 'unknown').length,
      },
    },
  }
}

describe('OverviewTabView', () => {
  it('keeps Search up front, orders action sections, and shows exact live facts', () => {
    const repair = incident({
      id: 'repair', status: 'error', disposition: 'action_required', title: 'Search engine is unavailable',
      impact: 'Search requests cannot complete.', resources: [{ kind: 'service', id: 'search', label: 'Search' }],
      resolution: { key: 'restart', type: 'repair', label: 'Restart Search', actionId: 'health.restart-search' },
    })
    const unknown = incident({ id: 'unknown', status: 'unknown', title: 'Runtime could not be verified' })
    const watching = incident({ id: 'watching', title: 'Journal backlog is growing' })
    const onRepair = mock()
    const model = buildHealthOverviewViewModel({
      report: report([watching, unknown, repair], 'needs_attention'),
      summary: {
        errors1h: { total: 3, byKind: { mcp: 1, rest: 1, agent: 1 } },
        activeSessions: [{ agent: 'main', sessions: 4, connectedAt: OBSERVED_AT }],
        upSince: OBSERVED_AT, server: null,
      },
      liveNow: {
        generatedAt: OBSERVED_AT,
        runs: [
          { agent: 'main', taskId: 'one', taskTitle: 'One', runId: 'run-one', startedAt: NOW, runningForMs: 0, heartbeatAgeMs: 0 },
          { agent: 'main', taskId: 'two', taskTitle: 'Two', runId: 'run-two', startedAt: NOW, runningForMs: 0, heartbeatAgeMs: 0 },
        ],
      },
      now: NOW,
    })

    const { container } = render(<OverviewTabView model={model} onRepair={onRepair} />)

    expect(screen.getByRole('heading', { name: 'Overall health' })).toBeDefined()
    expect(screen.getByRole('heading', { name: /Needs action/ })).toBeDefined()
    expect(screen.getByRole('heading', { name: /Unable to verify/ })).toBeDefined()
    expect(screen.getByRole('heading', { name: /Watching/ })).toBeDefined()
    const text = container.textContent ?? ''
    expect(text.indexOf('Search readiness')).toBeLessThan(text.indexOf('Needs action'))
    expect(text.indexOf('Needs action')).toBeLessThan(text.indexOf('Unable to verify'))
    expect(text.indexOf('Unable to verify')).toBeLessThan(text.indexOf('Watching'))

    expect(screen.getByRole('heading', { name: 'Search readiness' })).toBeDefined()
    for (const label of ['Engine', 'Queries', 'Indexes', 'Journal']) {
      expect(screen.getByText(label)).toBeDefined()
    }
    expect(screen.getByText(/2 running.*4 sessions.*3 failed events in the last hour/i)).toBeDefined()
    expect(screen.getByRole('link', { name: 'View activity' }).getAttribute('href')).toBe('/health?tab=activity')
    expect(screen.getByRole('heading', { name: /Needs action/ }).closest('[data-section-card]')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Restart Search' }))
    expect(onRepair).toHaveBeenCalledWith(repair)
    const repairRow = container.querySelector('[data-incident-id="repair"]') as HTMLElement
    expect(within(repairRow).getByText('Technical evidence')).toBeDefined()
    expect(within(repairRow).getByText('The probe returned a concrete technical detail.')).toBeDefined()
    expect(within(repairRow).getByText(/"attempts": 2/)).toBeDefined()
  })

  it('shows a calm explicit healthy state without hiding the Search strip', () => {
    const model = buildHealthOverviewViewModel({ report: report(), now: NOW })

    render(<OverviewTabView model={model} />)

    expect(screen.getByText('Everything looks healthy.')).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Search readiness' })).toBeDefined()
    expect(screen.getByText('Journal')).toBeDefined()
    expect(screen.queryByRole('heading', { name: /Needs action/ })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'All clear' })).toBeNull()
  })

  it('explains decisions in plain language and keeps healthy Search mechanics secondary', () => {
    const model = buildHealthOverviewViewModel({ report: report(), now: NOW })

    render(<OverviewTabView model={model} />)

    expect(screen.getByText(/Checked using evidence from/i)).toBeDefined()
    expect(screen.getByText(/Can Bakin find existing information and save new changes/i)).toBeDefined()
    expect(screen.getByText(/These numbers do not change the health verdict above/i)).toBeDefined()

    const searchDetails = screen.getByText('How Search was checked').closest('details')
    expect(searchDetails).not.toBeNull()
    expect(searchDetails?.open).toBe(false)
    expect(within(searchDetails!).getByText('Can Bakin reach the Search service?')).toBeDefined()
    expect(within(searchDetails!).getByText('Can Bakin find existing information?')).toBeDefined()
    expect(within(searchDetails!).getByText('Is searchable information up to date?')).toBeDefined()
    expect(within(searchDetails!).getByText('Can Bakin save new changes for Search?')).toBeDefined()
  })

  it('preserves focus on a stable incident action across a report refresh', () => {
    const retry = incident({ id: 'retry-runtime', status: 'unknown', title: 'Runtime probe failed' })
    const first = buildHealthOverviewViewModel({ report: report([retry], 'unknown_stale'), now: NOW })
    const onRerun = mock()
    const view = render(<OverviewTabView model={first} onRerun={onRerun} />)
    const button = screen.getByRole('button', { name: 'Check again' })
    button.focus()
    expect(document.activeElement).toBe(button)

    const refreshedIncident = { ...retry, impact: 'The latest probe still did not complete.' }
    const refreshed = buildHealthOverviewViewModel({ report: { ...report([refreshedIncident], 'unknown_stale'), id: 'report-2', revision: 2 }, now: NOW })
    view.rerender(<OverviewTabView model={refreshed} onRerun={onRerun} />)

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Check again' }))
  })

  it('keeps Search visible when the initial report fails', () => {
    const retry = mock()
    const model = buildHealthOverviewViewModel({ report: null, now: NOW })

    render(
      <OverviewTabView
        model={model}
        error="Health endpoint unavailable"
        backgroundError="Request failed (404)"
        onRetry={retry}
      />,
    )

    expect(screen.getByRole('alert').textContent).toContain('Health endpoint unavailable')
    expect(screen.getByRole('alert').textContent).toContain('Bakin can still show live activity')
    expect(screen.getByRole('alert').textContent).toContain('restart the Bakin host')
    expect(screen.queryByText(/Verified evidence remains visible/)).toBeNull()
    expect(screen.getByRole('heading', { name: 'Search readiness' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalledTimes(1)
  })
})
