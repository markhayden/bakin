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
import {
  performPluginUpgrade,
  performSearchReindex,
  SystemMutationOutcomeUnknownError,
} from '../../../plugins/health/hooks/use-system-data'

const originalFetch = globalThis.fetch
const OBSERVED_AT = '2026-07-13T11:55:00.000Z'
const STALE_AT = '2099-07-13T12:00:00.000Z'

afterEach(() => {
  cleanup()
  globalThis.fetch = originalFetch
  window.history.replaceState({}, '', '/')
})

async function captureError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise
  } catch (error) {
    if (error instanceof Error) return error
    throw new Error(`Expected an Error, received ${String(error)}`)
  }
  throw new Error('Expected the promise to reject')
}

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
    id: 'report-1', revision: 1, generatedAt: OBSERVED_AT, overallStatus: 'degraded', sensitivity: 'developer' as const,
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
      incidents: { actionRequired: 0, watching: 0, advisory: 0, unknown: 0, acknowledged: 0 },
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
        id: 'broken', name: 'Broken connector', version: '1.0.0', source: 'local',
        installed: { version: '1.0.0' }, upgradeAvailable: false, staleHintDays: null,
        status: 'failed', errorCode: 'MISSING_DEPENDENCY',
        errorMessage: 'Activation stopped before routes were registered.', missingDependencies: ['calendar-api'],
      },
      {
        id: 'assets', name: 'Assets', version: '1.2.0', source: 'core',
        installed: null, upgradeAvailable: false, staleHintDays: null, status: 'active',
      },
      {
        id: 'notes', name: 'Notes', version: '1.0.0', latestVersion: '1.1.0', source: 'github',
        installed: { version: '1.0.0' }, upgradeAvailable: true, staleHintDays: null, status: 'active',
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
  it('leads with a stable visual platform pulse instead of a shifting status list', () => {
    const data = systemData()
    data.report.stale = true // An unrelated failed check must not overwrite fresh Search readiness.
    const { container } = render(<SystemTabView data={data} />)

    const identity = screen.getByRole('heading', { level: 2, name: 'System' })
    expect(identity.className).toContain('sr-only')
    const intro = screen.getByText(/See whether Bakin can serve work, Search can be trusted, plugins are active, and health evidence is current/i)
    expect(intro.getAttribute('data-size')).toBe('meta')
    expect(intro.className).toContain('leading-relaxed')
    expect(intro.className).toContain('text-bakin-text-muted')
    expect(screen.getByRole('heading', { name: 'Platform pulse' })).toBeDefined()
    const pulse = screen.getByTestId('system-platform-pulse')
    const cards = [...pulse.querySelectorAll('[role="listitem"]')]
    expect(cards).toHaveLength(4)
    expect(pulse.querySelectorAll('[data-stat-tile][data-variant="surface"]')).toHaveLength(4)
    expect(cards.map((card) => card.getAttribute('data-subsystem'))).toEqual([
      'runtime',
      'search',
      'plugins',
      'diagnostics',
    ])
    expect(pulse.textContent).toContain('Host online')
    expect(pulse.textContent).toContain('Search degraded')
    expect(pulse.textContent).toContain('Plugin issue')
    expect(pulse.textContent).toContain('Checks incomplete')
    expect(container.querySelector('[data-testid="system-search-details"]')).toBeNull()
    const searchPipeline = screen.getByTestId('search-readiness-pipeline')
    expect(searchPipeline.querySelectorAll('[role="listitem"]')).toHaveLength(4)
    expect(searchPipeline.querySelector('[data-slot="grid"]')?.getAttribute('data-layout')).toBe('quarters')
    expect(searchPipeline.querySelectorAll('[data-stat-tile][data-variant="plain"]')).toHaveLength(4)
    expect((screen.getByTestId('search-technical-details') as HTMLDetailsElement).open).toBe(false)
  })

  it('caps the watch list at three findings and reveals the remaining evidence on demand', () => {
    const data = systemData()
    const warning = healthyObservation()
    warning.id = 'observation:runtime-warning'
    warning.key = 'runtime-warning'
    warning.status = 'warning'
    warning.summary = 'Runtime storage is approaching its review threshold.'
    warning.checkId = 'runtime.storage'
    warning.checkName = 'Runtime storage'
    const warningCheck: HealthCheckState = {
      checkId: warning.checkId,
      checkName: warning.checkName,
      description: 'Watches runtime storage growth.',
      owner: warning.owner,
      group: warning.group,
      latestExecution: {
        id: 'execution:runtime-warning', checkId: warning.checkId, startedAt: OBSERVED_AT,
        completedAt: OBSERVED_AT, outcome: 'observed',
      },
      latestValidSnapshot: { executionId: 'execution:runtime-warning', observations: [warning] },
    }
    const secondWarning = {
      ...warning,
      id: 'observation:runtime-channel',
      key: 'runtime-channel',
      summary: 'Runtime approvals need operator review.',
      checkId: 'runtime.channel',
      checkName: 'Runtime approvals',
    }
    const secondWarningCheck: HealthCheckState = {
      ...warningCheck,
      checkId: secondWarning.checkId,
      checkName: secondWarning.checkName,
      latestExecution: {
        ...warningCheck.latestExecution,
        id: 'execution:runtime-channel',
        checkId: secondWarning.checkId,
      },
      latestValidSnapshot: { executionId: 'execution:runtime-channel', observations: [secondWarning] },
    }
    data.report.data!.checks.push(warningCheck, secondWarningCheck)
    data.report.data!.observations.push(warning, secondWarning)

    render(<SystemTabView data={data} />)

    const watchList = screen.getByTestId('system-watch-list')
    expect(watchList.querySelectorAll('[data-system-finding]')).toHaveLength(3)
    expect(watchList.querySelector('[data-list-rows]')?.getAttribute('data-variant')).toBe('separated')
    expect(watchList.querySelectorAll('[data-slot="list-row"]')).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Show 2 more system findings' })).toBeDefined()
    expect((screen.getByTestId('all-health-checks-details') as HTMLDetailsElement).open).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Show 2 more system findings' }))
    expect(watchList.querySelectorAll('[data-system-finding]')).toHaveLength(5)
    expect(screen.getByRole('button', { name: 'Show fewer system findings' })).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'View evidence for Search verification probe' }))
    expect((screen.getByTestId('all-health-checks-details') as HTMLDetailsElement).open).toBe(true)
    expect(document.activeElement?.getAttribute('data-check-id')).toBe('search.probe')
  })

  it('lets every pulse card reveal its corresponding evidence without navigating away', () => {
    render(<SystemTabView data={systemData()} />)

    fireEvent.click(screen.getByRole('button', { name: /Bakin host.*Host online/i }))
    expect((screen.getByTestId('bakin-host-details') as HTMLDetailsElement).open).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: /Installed features.*Plugin issue/i }))
    expect((screen.getByTestId('installed-features-details') as HTMLDetailsElement).open).toBe(true)

    const healthDetails = screen.getByTestId('all-health-checks-details') as HTMLDetailsElement
    const healthSummary = healthDetails.querySelector('summary')!
    const summaryScroll = mock()
    const disclosureScroll = mock()
    healthSummary.scrollIntoView = summaryScroll
    healthDetails.scrollIntoView = disclosureScroll
    fireEvent.click(screen.getByRole('button', { name: /Health checks.*Checks incomplete/i }))
    expect(healthDetails.open).toBe(true)
    expect(summaryScroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    expect(disclosureScroll).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /Search.*Search degraded/i }))
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Search subsystem detail')
  })

  it('reveals System evidence without querying test-only selectors', () => {
    render(<SystemTabView data={systemData()} />)

    const hostButton = screen.getByRole('button', { name: /Bakin host.*Host online/i })
    const checkButton = screen.getByRole('button', { name: 'View evidence for Search verification probe' })
    const hostDetails = screen.getByTestId('bakin-host-details') as HTMLDetailsElement
    const checkDetails = screen.getByTestId('all-health-checks-details') as HTMLDetailsElement
    const originalQuerySelector = document.querySelector
    document.querySelector = ((selector: string) => {
      if (selector.includes('data-testid')) throw new Error('Production navigation queried a test-only selector')
      return originalQuerySelector.call(document, selector)
    }) as typeof document.querySelector

    try {
      fireEvent.click(hostButton)
      fireEvent.click(checkButton)
    } finally {
      document.querySelector = originalQuerySelector
    }

    expect(hostDetails.open).toBe(true)
    expect(checkDetails.open).toBe(true)
    expect(document.activeElement?.getAttribute('data-check-id')).toBe('search.probe')
  })

  it('blocks duplicate mutations while a previous server outcome is unknown', () => {
    const data = systemData()
    data.searchMutation = {
      status: 'outcome-unknown',
      message: 'Search reindex may still be running.',
      target: 'bakin_assets',
    }
    data.pluginMutation = {
      status: 'outcome-unknown',
      message: 'The Notes update may still be running.',
      target: 'notes',
    }

    render(<SystemTabView data={data} />)
    fireEvent.click(screen.getByTestId('search-technical-details').querySelector('summary')!)
    fireEvent.click(screen.getByTestId('installed-features-details').querySelector('summary')!)

    expect((screen.getByRole('button', { name: 'Reindex all' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Reindex bakin_assets' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Update Notes' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Refresh live data' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('makes indexes, migrations, journal, and enrichment consumable and actionable', () => {
    const data = systemData()
    render(<SystemTabView data={data} />)

    const pipeline = screen.getByTestId('search-readiness-pipeline')
    expect(pipeline.textContent).toContain('EngineHealthy')
    expect(pipeline.textContent).toContain('QueriesHealthy')
    expect(pipeline.textContent).toContain('IndexesDegraded')
    expect(pipeline.textContent).toContain('JournalHealthy')

    const technicalDetails = screen.getByTestId('search-technical-details') as HTMLDetailsElement
    expect(technicalDetails.open).toBe(false)
    fireEvent.click(technicalDetails.querySelector('summary')!)
    expect(screen.getByRole('heading', { name: 'Indexes & migrations' })).toBeDefined()
    expect(screen.getByText('Migrating · parked')).toBeDefined()
    expect(screen.getByText('Journal backlog').closest('[data-stat-tile]')?.textContent).toContain('7')
    expect(screen.getByText('120/142')).toBeDefined()
    expect(screen.getByTestId('search-index-table-scroll').className).toContain('overflow-y-auto')

    fireEvent.click(screen.getByRole('button', { name: 'Reindex bakin_assets' }))
    expect(data.reindexSearch).toHaveBeenCalledWith('bakin_assets')
  })

  it('distinguishes an optional enrichment provider from unavailable telemetry', () => {
    const notConfigured = systemData()
    notConfigured.searchTelemetry.data!.enrichment = null
    notConfigured.searchTelemetry.data!.enrichmentEvidence = { status: 'not_configured' }
    const first = render(<SystemTabView data={notConfigured} />)
    expect(screen.getByText('Enrichment is not configured')).toBeDefined()
    first.unmount()

    const unavailable = systemData()
    unavailable.searchTelemetry.data!.enrichment = null
    unavailable.searchTelemetry.data!.enrichmentEvidence = {
      status: 'unavailable',
      reason: 'provider_timeout',
    }
    render(<SystemTabView data={unavailable} />)
    expect(screen.getByText('Enrichment telemetry unavailable')).toBeDefined()
  })

  it('keeps plugin exceptions in the watch list and the complete runtime inventory on demand', () => {
    render(<SystemTabView data={systemData()} />)

    const watchList = screen.getByTestId('system-watch-list')
    const installedFeatures = screen.getByTestId('installed-features-details') as HTMLDetailsElement
    const hostDetails = screen.getByTestId('bakin-host-details') as HTMLDetailsElement
    const allChecks = screen.getByTestId('all-health-checks-details') as HTMLDetailsElement
    expect(watchList.textContent).toContain('Broken connector')
    expect(watchList.textContent).toContain('Activation stopped before routes were registered.')
    expect(watchList.textContent).toContain('Notes')
    expect(installedFeatures.open).toBe(false)
    expect(hostDetails.open).toBe(false)
    expect(allChecks.open).toBe(false)

    fireEvent.click(installedFeatures.querySelector('summary')!)
    expect(screen.getByText('Missing dependencies: calendar-api')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Update Notes' })).toBeDefined()
    expect(screen.getByTestId('installed-plugin-table-scroll').className).toContain('overflow-y-auto')

    fireEvent.click(hostDetails.querySelector('summary')!)
    expect(screen.getByText('Connected sessions').closest('[data-stat-tile]')?.textContent).toContain('5')
    expect(screen.getByText('Memory').closest('[data-stat-tile]')?.textContent).toContain('256 MB1024 MB host total')
    expect(screen.getByText('Port').closest('[data-stat-tile]')?.textContent).toContain('3737')
    expect(screen.getByText('PID').closest('[data-stat-tile]')?.textContent).toContain('4321')
    expect(screen.getByText('Node').closest('[data-stat-tile]')?.textContent).toContain('v24.3.0')
    expect(hostDetails.querySelector('[data-list-rows]')?.getAttribute('data-variant')).toBe('separated')
  })

  it('clears an installed-feature filter before revealing plugin evidence', async () => {
    render(<SystemTabView data={systemData()} />)

    const inventory = screen.getByTestId('installed-features-details') as HTMLDetailsElement
    fireEvent.click(inventory.querySelector('summary')!)
    const pluginSearch = screen.getByRole('searchbox', { name: 'Find a plugin' })
    // The filter rides the kit SearchInput pattern, not a bare Input.
    expect(pluginSearch.closest('[data-slot="search-input-control"]')).not.toBeNull()
    fireEvent.change(pluginSearch, { target: { value: 'assets' } })
    expect(inventory.querySelector('[data-plugin-id="notes"]')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'View evidence for Notes' }))

    await waitFor(() => expect(document.activeElement?.getAttribute('data-plugin-id')).toBe('notes'))
    expect((screen.getByRole('searchbox', { name: 'Find a plugin' }) as HTMLInputElement).value).toBe('')
  })

  it('accepts URL-backed installed-feature search state', () => {
    const setPluginSearch = mock()
    render(
      <SystemTabView
        data={systemData()}
        pluginSearch="assets"
        onPluginSearchChange={setPluginSearch}
      />,
    )

    const inventory = screen.getByTestId('installed-features-details') as HTMLDetailsElement
    fireEvent.click(inventory.querySelector('summary')!)
    const pluginSearch = screen.getByRole('searchbox', { name: 'Find a plugin' }) as HTMLInputElement
    expect(pluginSearch.value).toBe('assets')
    expect(inventory.querySelector('[data-plugin-id="assets"]')).not.toBeNull()
    expect(inventory.querySelector('[data-plugin-id="notes"]')).toBeNull()

    fireEvent.change(pluginSearch, { target: { value: 'notes' } })
    expect(setPluginSearch).toHaveBeenCalledWith('notes')
  })

  it('does not call an inventory healthy while both plugin sources are still loading', () => {
    const data = systemData()
    data.report.data!.checks = data.report.data!.checks.filter((check) => check.latestExecution.outcome === 'observed')
    data.report.data!.observations = data.report.data!.observations.filter((observation) => observation.status === 'healthy')
    data.registry = resource<SystemRegistryData>(null)
    data.pluginManifest = resource<SystemPluginManifestData>(null)

    render(<SystemTabView data={data} />)

    expect(screen.getByText('Waiting for the installed plugin inventory.')).toBeDefined()
    expect(screen.getByText('Loading inventory')).toBeDefined()
    expect(screen.getByText('Checking for findings')).toBeDefined()
    expect(screen.queryByText('Nothing needs review')).toBeNull()
  })

  it('does not call a failed plugin inventory refresh loading or healthy', () => {
    const data = systemData()
    data.report.data!.checks = data.report.data!.checks.filter((check) => check.latestExecution.outcome === 'observed')
    data.report.data!.observations = data.report.data!.observations.filter((observation) => observation.status === 'healthy')
    data.registry = {
      ...resource<SystemRegistryData>(null),
      error: 'Plugin registry request failed',
      loading: false,
    }
    data.pluginManifest = resource<SystemPluginManifestData>(null)

    render(<SystemTabView data={data} />)

    const pulse = screen.getByTestId('system-platform-pulse')
    expect(pulse.textContent).toContain('Plugin registry request failed')
    expect(pulse.textContent).toContain('Unable to verify')
    expect(pulse.textContent).not.toContain('Waiting for the installed plugin inventory.')
    expect(screen.getByText('Review status unavailable')).toBeDefined()
    expect(screen.queryByText('Nothing needs review')).toBeNull()
  })

  it('treats a manifest-only plugin as installed with unknown activation', () => {
    const data = systemData()
    data.registry = resource<SystemRegistryData>({ plugins: [] })
    data.pluginManifest = resource<SystemPluginManifestData>({ plugins: [
      {
        id: 'notes', name: 'Notes', version: '1.0.0', latestVersion: '1.1.0', source: 'github',
        installed: { version: '1.0.0' }, upgradeAvailable: true, staleHintDays: null, status: 'active',
      },
    ] })

    render(<SystemTabView data={data} />)

    const pulse = screen.getByTestId('system-platform-pulse')
    expect(pulse.textContent).toContain('Plugins unknown')
    expect(pulse.textContent).toContain('1 installed plugin has no confirmed activation state.')
    expect(screen.getByTestId('system-watch-list').textContent).toContain('Activation sources disagree')

    const inventory = screen.getByTestId('installed-features-details') as HTMLDetailsElement
    fireEvent.click(inventory.querySelector('summary')!)
    expect(screen.getByText('Activation unknown')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Update Notes' })).toBeNull()
  })

  it('treats a registry-only plugin as unknown when both current inventories were loaded', () => {
    const data = systemData()
    data.registry = resource<SystemRegistryData>({ plugins: [{
      id: 'notes', name: 'Notes', version: '1.0.0', description: 'Notes integration.',
      source: 'user', status: 'active', routes: 2,
    }] })
    data.pluginManifest = resource<SystemPluginManifestData>({ plugins: [] })

    render(<SystemTabView data={data} />)

    const pulse = screen.getByTestId('system-platform-pulse')
    expect(pulse.textContent).toContain('Plugins unknown')
    expect(pulse.textContent).not.toContain('Plugins available')
    expect(screen.getByTestId('system-watch-list').textContent).toContain('Activation sources disagree')
  })

  it('treats conflicting plugin activation snapshots as unknown', () => {
    const data = systemData()
    data.registry = resource<SystemRegistryData>({ plugins: [{
      id: 'notes', name: 'Notes', version: '1.0.0', description: 'Notes integration.',
      source: 'user', status: 'active', routes: 2,
    }] })
    data.pluginManifest = resource<SystemPluginManifestData>({ plugins: [{
      id: 'notes', name: 'Notes', version: '1.0.0', source: 'github', installed: { version: '1.0.0' },
      upgradeAvailable: false, staleHintDays: null, status: 'failed', errorMessage: 'Activation failed.',
    }] })

    render(<SystemTabView data={data} />)

    const pulse = screen.getByTestId('system-platform-pulse')
    expect(pulse.textContent).toContain('Plugins unknown')
    expect(pulse.textContent).not.toContain('Plugins available')
    expect(screen.getByTestId('system-watch-list').textContent).toContain('Activation sources disagree')
  })

  it('labels retained plugin failures as last loaded when inventory refresh fails', () => {
    const data = systemData()
    data.registry = { ...data.registry, backgroundError: 'Registry refresh failed', stale: true }

    render(<SystemTabView data={data} />)

    const pulse = screen.getByTestId('system-platform-pulse')
    expect(pulse.textContent).toContain('Refresh failed')
    expect(pulse.textContent).toContain('Showing the last loaded inventory')
    expect(pulse.textContent).not.toContain('Plugin issue')
    expect(screen.getByTestId('system-watch-list').textContent).toContain('Last loaded')

    const inventory = screen.getByTestId('installed-features-details') as HTMLDetailsElement
    fireEvent.click(inventory.querySelector('summary')!)
    expect(screen.getByText('Last loaded · Failed')).toBeDefined()
  })

  it('does not call expired health-check evidence verified', () => {
    const data = systemData()
    data.report.data!.checks = data.report.data!.checks.filter((check) => check.latestExecution.outcome === 'observed')
    data.report.data!.observations = data.report.data!.observations.filter((observation) => observation.status === 'healthy')
    data.report.data!.checks[0]!.latestValidSnapshot!.observations[0]!.staleAt = '2020-01-01T00:00:00.000Z'
    data.report.stale = true

    render(<SystemTabView data={data} />)

    const pulse = screen.getByTestId('system-platform-pulse')
    expect(pulse.textContent).toContain('Health-check evidence needs to be refreshed.')
    expect(pulse.textContent).not.toContain('All completed checks returned healthy evidence.')
    const watchList = screen.getByTestId('system-watch-list')
    expect(watchList.textContent).toContain('Evidence expired')
    expect(watchList.textContent).not.toContain('Healthy')
  })

  it('does not call retained host data online after its refresh fails', () => {
    const data = systemData()
    data.live = {
      ...data.live,
      backgroundError: 'Host status refresh failed',
      stale: true,
    }

    render(<SystemTabView data={data} />)

    const pulse = screen.getByTestId('system-platform-pulse')
    expect(pulse.textContent).toContain('Host status refresh failed')
    expect(pulse.textContent).toContain('Refresh failed')
    expect(pulse.textContent).not.toContain('Host online5 connected sessions')
  })

  it('uses the canonical completed-check count rather than registered checks', () => {
    const data = systemData()
    data.report.data!.checks = data.report.data!.checks.filter((check) => check.latestExecution.outcome !== 'failed')
    data.report.data!.summary.checks.failed = 0
    data.report.data!.summary.checks.completed = 1
    data.report.data!.observations = data.report.data!.observations.filter((observation) => observation.status === 'healthy')
    data.report.stale = false

    render(<SystemTabView data={data} />)

    const pulse = screen.getByTestId('system-platform-pulse')
    expect(pulse.textContent).toContain('1 completed check')
    expect(pulse.textContent).not.toContain('2 completed checks')
  })

  it('includes healthy and not-applicable checks while opening only groups that need review', () => {
    render(<SystemTabView data={systemData()} />)

    const inventory = screen.getByTestId('all-health-checks-details') as HTMLDetailsElement
    if (!inventory.open) fireEvent.click(inventory.querySelector('summary')!)

    expect(screen.getAllByText('Healthy').length).toBeGreaterThan(0)
    expect(screen.getByText('Not applicable')).toBeDefined()
    expect(screen.getByText('Cloud sync is not configured.')).toBeDefined()
    expect(inventory.querySelectorAll('[data-list-rows][data-variant="separated"]').length).toBeGreaterThan(0)
    const groups = [...inventory.querySelectorAll<HTMLDetailsElement>(':scope > div > div > details')]
    const healthyGroup = groups.find((group) => group.querySelector('summary')?.textContent?.includes('Runtime checks'))
    const concernGroup = groups.find((group) => group.querySelector('summary')?.textContent?.includes('Search checks'))
    expect(healthyGroup?.open).toBe(false)
    expect(concernGroup?.open).toBe(true)
  })

  it('focuses Search detail for section=search deep links', async () => {
    const data = systemData()
    makeSearchHealthy(data)
    window.history.replaceState({}, '', '/health?tab=system&section=search')
    render(<SystemTabView data={data} section="search" />)

    const searchDetail = screen.getByLabelText('Search subsystem detail')
    expect((screen.getByTestId('search-technical-details') as HTMLDetailsElement).open).toBe(true)
    await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe('Search subsystem detail'))
    expect(document.activeElement).toBe(searchDetail)
  })

  it('keeps healthy Search detail collapsed until requested', () => {
    const data = systemData()
    makeSearchHealthy(data)

    render(<SystemTabView data={data} />)

    expect((screen.getByTestId('search-technical-details') as HTMLDetailsElement).open).toBe(false)
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

  it('does not apply the short read deadline while the server is still rebuilding', async () => {
    const refreshReadiness = mock(async () => {})
    globalThis.fetch = mock(async () => await new Promise<Response>((resolve) => {
      setTimeout(() => resolve(new Response(JSON.stringify({ ok: true }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      })), 30)
    })) as unknown as typeof fetch

    await performSearchReindex('bakin_assets', refreshReadiness, {
      responseBodyMs: 5,
      operationMs: 100,
    })
    expect(refreshReadiness).toHaveBeenCalledTimes(1)
  })

  it('reports an unknown outcome when a long-running mutation never responds', async () => {
    const refreshReadiness = mock(async () => {})
    globalThis.fetch = mock(async () => await new Promise<Response>(() => {})) as unknown as typeof fetch

    const error = await captureError(performSearchReindex('bakin_assets', refreshReadiness, {
      responseBodyMs: 100,
      operationMs: 10,
    }))

    expect(error).toBeInstanceOf(SystemMutationOutcomeUnknownError)
    expect(error.message).toContain('Search reindex is taking longer than expected')
    expect(refreshReadiness).not.toHaveBeenCalled()
  })

  it('times out a hung mutation result body and rejects malformed success bodies', async () => {
    const refreshReadiness = mock(async () => {})
    globalThis.fetch = mock(async () => ({
      ok: true,
      status: 200,
      json: () => new Promise<never>(() => {}),
    }) as unknown as Response) as unknown as typeof fetch

    const unreadableConfirmation = await captureError(performSearchReindex('bakin_assets', refreshReadiness, {
      responseBodyMs: 10,
      operationMs: 100,
    }))
    expect(unreadableConfirmation).toBeInstanceOf(SystemMutationOutcomeUnknownError)
    expect(unreadableConfirmation.message).toContain('could not read its confirmation')
    expect(refreshReadiness).not.toHaveBeenCalled()

    globalThis.fetch = mock(async () => new Response('not-json', { status: 200 })) as unknown as typeof fetch
    const invalidSearchConfirmation = await captureError(performSearchReindex('bakin_assets', refreshReadiness))
    expect(invalidSearchConfirmation).toBeInstanceOf(SystemMutationOutcomeUnknownError)
    expect(invalidSearchConfirmation.message).toContain('could not confirm the result')

    const invalidPluginConfirmation = await captureError(performPluginUpgrade('notes'))
    expect(invalidPluginConfirmation).toBeInstanceOf(SystemMutationOutcomeUnknownError)
    expect(invalidPluginConfirmation.message).toContain('could not confirm the result')
  })

  it('reports a no-op plugin update as already current', async () => {
    globalThis.fetch = mock(async () => new Response(JSON.stringify({
      ok: true,
      noop: true,
      awaitingConsent: false,
      newPermissions: [],
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch

    const result = await performPluginUpgrade('notes')

    expect(result.noop).toBe(true)
    expect(result.message).toBe('notes is already current.')
  })
})
