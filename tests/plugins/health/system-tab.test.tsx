// @vitest-environment jsdom

import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { HealthCheckState, HealthObservation, HealthReport } from '@makinbakin/sdk/types'
import type { UseHealthResourceResult } from '../../../plugins/health/hooks/use-health-resource'
import type {
  SystemPluginManifestData,
  SystemRegistryData,
  UseSystemDataResult,
} from '../../../plugins/health/hooks/use-system-data'
import '../../rtl-settle'
import { SystemTabView } from '../../../plugins/health/components/system-tab'
import { performSearchReindex } from '../../../plugins/health/hooks/use-system-data'

const originalFetch = globalThis.fetch
const OBSERVED_AT = '2026-07-13T11:55:00.000Z'
const STALE_AT = '2099-07-13T12:00:00.000Z'

afterEach(() => {
  cleanup()
  globalThis.fetch = originalFetch
  window.history.replaceState({}, '', '/')
})

function resource<T>(data: T | null): UseHealthResourceResult<T> {
  return {
    data,
    error: null,
    backgroundError: null,
    loading: data === null,
    refreshing: false,
    refresh: mock(async () => data),
  }
}

function healthyObservation(): HealthObservation {
  return {
    id: 'observation:runtime', key: 'host', status: 'healthy', summary: 'The host process is responsive.',
    checkId: 'runtime.host', checkName: 'Host process',
    owner: { kind: 'core', id: 'core', label: 'Bakin' }, group: { key: 'runtime', label: 'Runtime checks' },
    checkedAt: OBSERVED_AT, observedAt: OBSERVED_AT, staleAt: STALE_AT, snapshot: 'current',
  }
}

function report(): HealthReport {
  const healthy = healthyObservation()
  const healthyCheck: HealthCheckState = {
    checkId: healthy.checkId, checkName: healthy.checkName, description: 'Verifies the host can answer requests.',
    owner: healthy.owner, group: healthy.group,
    latestExecution: {
      id: 'execution:runtime', checkId: healthy.checkId, startedAt: OBSERVED_AT,
      completedAt: OBSERVED_AT, outcome: 'observed',
    },
    latestValidSnapshot: { executionId: 'execution:runtime', observations: [healthy] },
  }
  const notApplicable: HealthCheckState = {
    checkId: 'optional.cloud', checkName: 'Cloud connector', description: 'Verifies the optional cloud connector.',
    owner: { kind: 'plugin', id: 'cloud', label: 'Cloud' }, group: { key: 'optional', label: 'Optional services' },
    latestExecution: {
      id: 'execution:cloud', checkId: 'optional.cloud', startedAt: OBSERVED_AT,
      completedAt: OBSERVED_AT, outcome: 'not_applicable', reason: 'Cloud sync is not configured.',
    },
  }
  const failed: HealthCheckState = {
    checkId: 'search.probe', checkName: 'Search verification probe', description: 'Verifies an end-to-end Search query.',
    owner: { kind: 'core', id: 'core', label: 'Bakin' }, group: { key: 'search', label: 'Search checks' },
    latestExecution: {
      id: 'execution:search', checkId: 'search.probe', startedAt: OBSERVED_AT,
      completedAt: OBSERVED_AT, outcome: 'failed', error: { code: 'timeout', message: 'The verification query timed out.' },
    },
  }
  return {
    id: 'report-1', revision: 1, generatedAt: OBSERVED_AT, overallStatus: 'degraded',
    lastFullSweep: { id: 'sweep-1', startedAt: OBSERVED_AT, completedAt: OBSERVED_AT },
    checks: [healthyCheck, notApplicable, failed], observations: [healthy], incidents: [],
    subsystems: {
      search: {
        status: 'degraded', summary: 'Search answers queries, but one index migration needs attention.',
        observedAt: OBSERVED_AT, staleAt: STALE_AT, incidentIds: [],
        stages: [
          { key: 'engine', label: 'Engine', status: 'healthy', summary: 'Engine is connected.', observedAt: OBSERVED_AT, staleAt: STALE_AT, observationIds: [] },
          { key: 'queries', label: 'Queries', status: 'healthy', summary: 'Queries are answering.', observedAt: OBSERVED_AT, staleAt: STALE_AT, observationIds: [] },
          { key: 'indexes', label: 'Indexes', status: 'degraded', summary: 'One migration is parked.', observedAt: OBSERVED_AT, staleAt: STALE_AT, observationIds: [] },
          { key: 'journal', label: 'Journal', status: 'healthy', summary: 'Journal is draining.', observedAt: OBSERVED_AT, staleAt: STALE_AT, observationIds: [] },
        ],
      },
    },
    summary: {
      checks: { registered: 3, completed: 2, failed: 1, invalid: 0, notApplicable: 1 },
      incidents: { actionRequired: 0, watching: 0, advisory: 0, unknown: 0 },
    },
  }
}

function systemData(): UseSystemDataResult {
  const canonical = report()
  const reportResource = resource(canonical)
  return {
    report: { ...reportResource, stale: false, runChecks: mock(async () => canonical) },
    live: resource({
      errors1h: { total: 1, byKind: { mcp: 1, rest: 0, agent: 0 } },
      activeSessions: [
        { agent: 'main', sessions: 2, connectedAt: OBSERVED_AT },
        { agent: 'worker', sessions: 3, connectedAt: OBSERVED_AT },
      ],
      upSince: '2026-07-13T10:00:00.000Z',
      server: { port: 3737, pid: 4321, nodeVersion: 'v24.3.0', memoryMB: 256, totalMemoryMB: 1024 },
    }),
    searchStatus: resource({
      enabled: true,
      outbox: { pending: 7, quarantined: 1, oldestPendingAt: Date.parse(OBSERVED_AT) },
      tables: [{
        logical: 'bakin_assets', physical: 'bakin_assets_v3', schemaVersion: 3,
        state: 'migrating', phase: 'parked', pluginId: 'assets', docCount: 142,
        lastIndexedAt: Date.parse(OBSERVED_AT), lastRebuildAt: Date.parse(OBSERVED_AT),
        journalPending: 7, healthy: false,
        legs: [{ name: 'text', totalIndexed: 142, rebuilding: false }, { name: 'embedding', totalIndexed: 120, rebuilding: true, pending: 22 }],
      }],
    }),
    searchTelemetry: resource({
      windows: {
        '1h': { query: { count: 87, errors: 2, medianMs: 18 }, drain: { count: 54, errors: 1 }, enrich: { count: 20, errors: 2 } },
        '24h': { query: { count: 500, errors: 3, medianMs: 20 }, drain: { count: 300, errors: 1 }, enrich: { count: 120, errors: 2 } },
      },
      outbox: { pending: 7, quarantined: 1 },
      enrichment: {
        depth: 22, running: 2, failedRecent: 2,
        coverage: { total: 142, enriched: 120, missing: 12, stale: 8, failed: 2, skipped: 0 },
      },
    }),
    registry: resource({ plugins: [
      {
        id: 'broken', name: 'Broken connector', version: '1.0.0', description: 'A failed connector.',
        source: 'user', status: 'failed', routes: 0, errorCode: 'MISSING_DEPENDENCY',
        errorMessage: 'Activation stopped before routes were registered.', missingDependencies: ['calendar-api'],
      },
      {
        id: 'assets', name: 'Assets', version: '1.2.0', description: 'Asset management.',
        source: 'built-in', status: 'active', routes: 5,
      },
      {
        id: 'notes', name: 'Notes', version: '1.0.0', description: 'Notes integration.',
        source: 'user', status: 'active', routes: 2,
      },
    ] }),
    pluginManifest: resource({ plugins: [
      {
        id: 'notes', name: 'Notes', version: '1.0.0', latestVersion: '1.1.0', source: 'github',
        installed: { version: '1.0.0' }, upgradeAvailable: true, staleHintDays: null,
      },
    ] }),
    searchMutation: { status: 'idle', message: null, target: null },
    pluginMutation: { status: 'idle', message: null, target: null },
    reindexSearch: mock(async () => {}),
    checkPluginUpdates: mock(async () => null),
    upgradePlugin: mock(async () => {}),
    refreshSystemDetails: mock(async () => {}),
  }
}

function makeSearchHealthy(data: UseSystemDataResult): void {
  const readiness = data.report.data?.subsystems.search
  if (!readiness) throw new Error('Expected canonical Search readiness')
  readiness.status = 'healthy'
  readiness.summary = 'Search is ready across every stage.'
  readiness.stages = readiness.stages.map((stage) => ({
    ...stage,
    status: 'healthy',
    summary: `${stage.label} is ready.`,
  }))
}

describe('SystemTabView', () => {
  it('leads with a compact attention-first list phrased as operator questions', () => {
    const data = systemData()
    data.report.stale = true // An unrelated failed check must not overwrite fresh Search readiness.
    const { container } = render(<SystemTabView data={data} />)

    expect(screen.getByRole('heading', { name: 'Subsystem status' })).toBeDefined()
    const subsystemList = screen.getByTestId('system-subsystem-list')
    expect(subsystemList.getAttribute('role')).toBe('list')
    expect(subsystemList.querySelectorAll('[role="listitem"]')).toHaveLength(4)
    expect(subsystemList.textContent).toContain('Can people find what they need?')
    expect(subsystemList.textContent).toContain('Are installed features available?')
    expect(subsystemList.textContent).toContain('Did every health check finish cleanly?')
    expect(subsystemList.textContent).toContain('Is the Bakin host online?')

    const content = subsystemList.textContent ?? ''
    expect(content.indexOf('Can people find what they need?')).toBeLessThan(content.indexOf('Is the Bakin host online?'))
    expect(content.indexOf('Are installed features available?')).toBeLessThan(content.indexOf('Is the Bakin host online?'))
    expect(screen.getAllByText('Search answers queries, but one index migration needs attention.')).toHaveLength(2)
    expect((container.querySelector('[data-testid="system-search-details"]') as HTMLDetailsElement).open).toBe(true)
  })

  it('makes indexes, migrations, journal, and enrichment consumable and actionable', () => {
    const data = systemData()
    render(<SystemTabView data={data} />)

    expect(screen.getByRole('heading', { name: 'Indexes & migrations' })).toBeDefined()
    expect(screen.getByText('Migrating · parked')).toBeDefined()
    expect(screen.getByText(/Pending writes/).previousElementSibling?.textContent).toBe('7')
    expect(screen.getByText('120/142')).toBeDefined()
    expect(screen.getByTestId('search-index-table-scroll').className).toContain('overflow-auto')

    fireEvent.click(screen.getByRole('button', { name: 'Reindex bakin_assets' }))
    expect(data.reindexSearch).toHaveBeenCalledWith('bakin_assets')
  })

  it('puts plugin exceptions first and shows the complete runtime inventory', () => {
    render(<SystemTabView data={systemData()} />)

    const exceptions = screen.getByRole('heading', { name: 'Plugin exceptions' })
    const installedFeatures = screen.getByText('Installed features', { selector: 'span' }).closest('details') as HTMLDetailsElement
    const hostDetails = screen.getByText('Bakin host details', { selector: 'span' }).closest('details') as HTMLDetailsElement
    const allChecks = screen.getByText('All health checks', { selector: 'span' }).closest('details') as HTMLDetailsElement
    expect(exceptions.compareDocumentPosition(installedFeatures) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(installedFeatures.open).toBe(false)
    expect(hostDetails.open).toBe(false)
    expect(allChecks.open).toBe(true)
    expect(screen.getByText('Activation stopped before routes were registered.')).toBeDefined()
    expect(screen.getByText('Missing dependencies: calendar-api')).toBeDefined()

    fireEvent.click(installedFeatures.querySelector('summary')!)
    expect(screen.getByRole('button', { name: 'Update Notes' })).toBeDefined()
    expect(screen.getByTestId('installed-plugin-table-scroll').className).toContain('overflow-auto')

    fireEvent.click(hostDetails.querySelector('summary')!)
    expect(screen.getByText('Connected sessions').closest('[data-stat-tile]')?.textContent).toContain('5')
    expect(screen.getByText('Memory').closest('[data-stat-tile]')?.textContent).toContain('256 MB1024 MB host total')
    expect(screen.getByText('Port').closest('[data-stat-tile]')?.textContent).toContain('3737')
    expect(screen.getByText('PID').closest('[data-stat-tile]')?.textContent).toContain('4321')
    expect(screen.getByText('Node').closest('[data-stat-tile]')?.textContent).toContain('v24.3.0')
  })

  it('does not call an inventory healthy while both plugin sources are still loading', () => {
    const data = systemData()
    data.registry = resource<SystemRegistryData>(null)
    data.pluginManifest = resource<SystemPluginManifestData>(null)

    render(<SystemTabView data={data} />)

    expect(screen.getByText('Waiting for the installed plugin inventory.')).toBeDefined()
    expect(screen.getByText('Loading inventory')).toBeDefined()
  })

  it('does not call a failed plugin inventory refresh loading or healthy', () => {
    const data = systemData()
    data.registry = {
      ...resource<SystemRegistryData>(null),
      error: 'Plugin registry request failed',
      loading: false,
    }
    data.pluginManifest = resource<SystemPluginManifestData>(null)

    render(<SystemTabView data={data} />)

    const subsystemList = screen.getByTestId('system-subsystem-list')
    expect(subsystemList.textContent).toContain('Plugin registry request failed')
    expect(subsystemList.textContent).toContain('Unable to verify')
    expect(subsystemList.textContent).not.toContain('Waiting for the installed plugin inventory.')
  })

  it('does not call expired health-check evidence verified', () => {
    const data = systemData()
    data.report.data!.checks = data.report.data!.checks.filter((check) => check.latestExecution.outcome === 'observed')
    data.report.data!.observations = data.report.data!.observations.filter((observation) => observation.status === 'healthy')
    data.report.stale = true

    render(<SystemTabView data={data} />)

    const subsystemList = screen.getByTestId('system-subsystem-list')
    expect(subsystemList.textContent).toContain('Health-check evidence needs to be refreshed.')
    expect(subsystemList.textContent).not.toContain('All completed checks returned healthy evidence.')
  })

  it('does not call retained host data online after its refresh fails', () => {
    const data = systemData()
    data.live = {
      ...data.live,
      backgroundError: 'Host status refresh failed',
      stale: true,
    }

    render(<SystemTabView data={data} />)

    const subsystemList = screen.getByTestId('system-subsystem-list')
    expect(subsystemList.textContent).toContain('Host status refresh failed')
    expect(subsystemList.textContent).toContain('Refresh failed')
    expect(subsystemList.textContent).not.toContain('Online5 connected sessions')
  })

  it('uses the canonical completed-check count rather than registered checks', () => {
    const data = systemData()
    data.report.data!.checks = data.report.data!.checks.filter((check) => check.latestExecution.outcome !== 'failed')
    data.report.data!.summary.checks.failed = 0
    data.report.data!.summary.checks.completed = 1
    data.report.data!.observations = data.report.data!.observations.filter((observation) => observation.status === 'healthy')
    data.report.stale = false

    render(<SystemTabView data={data} />)

    const subsystemList = screen.getByTestId('system-subsystem-list')
    expect(subsystemList.textContent).toContain('1 completed check')
    expect(subsystemList.textContent).not.toContain('2 completed checks')
  })

  it('includes healthy and not-applicable checks while opening only groups that need review', () => {
    render(<SystemTabView data={systemData()} />)

    const inventory = screen.getByTestId('all-health-checks-details') as HTMLDetailsElement
    if (!inventory.open) fireEvent.click(inventory.querySelector('summary')!)

    expect(screen.getAllByText('Healthy').length).toBeGreaterThan(0)
    expect(screen.getByText('Not applicable')).toBeDefined()
    expect(screen.getByText('Cloud sync is not configured.')).toBeDefined()
    const healthyGroup = screen.getByText('Runtime checks').closest('details')
    const concernGroup = screen.getByText('Search checks').closest('details')
    expect(healthyGroup?.open).toBe(false)
    expect(concernGroup?.open).toBe(true)
  })

  it('focuses Search detail for section=search deep links', async () => {
    const data = systemData()
    makeSearchHealthy(data)
    window.history.replaceState({}, '', '/health?tab=system&section=search')
    render(<SystemTabView data={data} section="search" />)

    const searchDetail = screen.getByLabelText('Search subsystem detail')
    expect((screen.getByTestId('system-search-details') as HTMLDetailsElement).open).toBe(true)
    await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe('Search subsystem detail'))
    expect(document.activeElement).toBe(searchDetail)
  })

  it('keeps healthy Search detail collapsed until requested', () => {
    const data = systemData()
    makeSearchHealthy(data)

    render(<SystemTabView data={data} />)

    expect((screen.getByTestId('system-search-details') as HTMLDetailsElement).open).toBe(false)
  })
})

describe('performSearchReindex', () => {
  it('validates the mutation before refreshing canonical readiness', async () => {
    const refreshReadiness = mock(async () => {})
    globalThis.fetch = mock(async () => new Response(JSON.stringify({ ok: false, error: 'Index registration rejected' }), {
      status: 409, headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch

    await expect(performSearchReindex('bakin_assets', refreshReadiness)).rejects.toThrow('Index registration rejected')
    expect(refreshReadiness).not.toHaveBeenCalled()

    globalThis.fetch = mock(async () => new Response(JSON.stringify({ ok: true }), {
      status: 202, headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch
    await performSearchReindex('bakin_assets', refreshReadiness)
    expect(refreshReadiness).toHaveBeenCalledTimes(1)

    const unavailableRefresh = mock(async () => { throw new Error('readiness endpoint unavailable') })
    await expect(performSearchReindex('bakin_assets', unavailableRefresh)).rejects.toThrow(
      'Reindex started, but Search readiness could not be refreshed: readiness endpoint unavailable',
    )
  })
})
