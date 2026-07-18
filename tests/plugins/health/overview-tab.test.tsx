// @vitest-environment jsdom

import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { AgentUsage, HealthIncident, HealthObservation, HealthReport, SearchReadiness } from '@makinbakin/sdk/types'
import type { InteractionSummaryData, UsageHistoryData } from '../../../plugins/health/types'
import '../../rtl-settle'
import { buildHealthOverviewViewModel } from '../../../plugins/health/lib/health-view-model'
import { OverviewTabView } from '../../../plugins/health/components/overview-tab'
import type { OverviewTelemetry } from '../../../plugins/health/components/overview-telemetry'

mock.module('@tanstack/react-router', () => ({
  useNavigate: () => () => undefined,
}))

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
    status: 'warning', disposition: 'watch', effectiveDisposition: 'watch', title: id, impact: 'Operator impact.', resources: [],
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
    id: 'report-1', revision: 1, generatedAt: '2026-07-13T12:00:00.000Z', overallStatus: status, sensitivity: 'developer' as const,
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

function dashboardTelemetry(): OverviewTelemetry {
  const history: UsageHistoryData = {
    window: '24h',
    since: '2026-07-12',
    throughDay: '2026-07-13',
    scannedAt: OBSERVED_AT,
    byAgent: [
      {
        agent: 'main',
        tokens: { input: 200_000, output: 20_000, cacheRead: 780_000, cacheWrite: 0, total: 1_000_000 },
        costUsdMicros: 4_900_000, costedMessages: 10, messageCount: 10,
      },
      {
        agent: 'pixel',
        tokens: { input: 100_000, output: 20_000, cacheRead: 180_000, cacheWrite: 0, total: 300_000 },
        costUsdMicros: 1_300_000, costedMessages: 4, messageCount: 4,
      },
    ],
    byDay: [
      {
        day: '2026-07-12',
        tokens: { input: 240_000, output: 30_000, cacheRead: 630_000, cacheWrite: 0, total: 900_000 },
        costUsdMicros: 4_200_000, costedMessages: 8, messageCount: 8,
      },
      {
        day: '2026-07-13',
        tokens: { input: 60_000, output: 10_000, cacheRead: 330_000, cacheWrite: 0, total: 400_000 },
        costUsdMicros: 2_000_000, costedMessages: 6, messageCount: 6,
      },
    ],
    byAgentDay: [
      {
        agent: 'main', day: '2026-07-12',
        tokens: { input: 180_000, output: 20_000, cacheRead: 500_000, cacheWrite: 0, total: 700_000 },
        costUsdMicros: 3_500_000, costedMessages: 6, messageCount: 6,
      },
      {
        agent: 'pixel', day: '2026-07-12',
        tokens: { input: 60_000, output: 10_000, cacheRead: 130_000, cacheWrite: 0, total: 200_000 },
        costUsdMicros: 700_000, costedMessages: 2, messageCount: 2,
      },
      {
        agent: 'main', day: '2026-07-13',
        tokens: { input: 20_000, output: 0, cacheRead: 280_000, cacheWrite: 0, total: 300_000 },
        costUsdMicros: 1_400_000, costedMessages: 4, messageCount: 4,
      },
      {
        agent: 'pixel', day: '2026-07-13',
        tokens: { input: 40_000, output: 10_000, cacheRead: 50_000, cacheWrite: 0, total: 100_000 },
        costUsdMicros: 600_000, costedMessages: 2, messageCount: 2,
      },
    ],
  }
  const sessions: AgentUsage[] = [
    {
      agent: 'main', sessionId: 'main-session', sessionStarted: OBSERVED_AT, model: 'gpt-5.5', messages: 12,
      tokens: { input: 100, output: 20, cacheRead: 880, cacheWrite: 0, total: 1_000 },
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, source: 'runtime' },
    },
    {
      agent: 'pixel', sessionId: 'pixel-session', sessionStarted: OBSERVED_AT, model: 'gpt-5.4-mini', messages: 3,
      tokens: { input: 100, output: 100, cacheRead: 0, cacheWrite: 0, total: 200 },
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, source: 'runtime' },
    },
  ]
  const interactions: InteractionSummaryData = {
    window: '1h',
    coverage: {
      startsAt: '2026-07-13T11:00:00.000Z',
      hasFullWindow: true,
      reason: 'full_window',
    },
    totals: { count: 132, errors: 2, unverified: 0, foreground: 52, background: 80 },
    categories: [
      { key: 'tools', count: 42, errors: 0 },
      { key: 'api', count: 80, errors: 2 },
      { key: 'agents', count: 10, errors: 0 },
    ],
    topDestinations: [
      { category: 'api', name: '/api/search/query', count: 20, errors: 2, medianDurationMs: 40 },
      { category: 'tools', name: 'web_search', count: 18, errors: 0, medianDurationMs: 230 },
      { category: 'tools', name: 'bakin_exec_images_generate', count: 15, errors: 0, medianDurationMs: 1_100 },
      { category: 'agents', name: 'dispatch', count: 10, errors: 0, medianDurationMs: null },
    ],
    timeBuckets: [
      { start: '2026-07-13T11:00:00.000Z', count: 24, failureCount: 0, failureRate: 0 },
      { start: '2026-07-13T11:15:00.000Z', count: 32, failureCount: 1, failureRate: 1 / 32 },
      { start: '2026-07-13T11:30:00.000Z', count: 48, failureCount: 1, failureRate: 1 / 48 },
      { start: '2026-07-13T11:45:00.000Z', count: 28, failureCount: 0, failureRate: 0 },
    ],
  }

  return {
    history: { data: history, loading: false, error: null, onRetry: mock() },
    sessions: { data: sessions, loading: false, error: null, onRetry: mock() },
    interactions: { data: interactions, loading: false, error: null, onRetry: mock() },
    context: {
      data: {
        ok: true,
        tokenEstimateNote: 'byte-derived estimates are approximate',
        agents: [
          { agentId: 'main', staticTaskBytes: 300, staticWorkflowBytes: 3_000, estimatedMaxTaskBytes: 22_000, workspaceAvailable: true, workspaceTotalBytes: 17_000, lastObserved: null },
          { agentId: 'pixel', staticTaskBytes: 2_000, staticWorkflowBytes: 3_000, estimatedMaxTaskBytes: 70_000, workspaceAvailable: true, workspaceTotalBytes: 23_000, lastObserved: null },
        ],
      },
      budgetBytes: 65_536,
      loading: false,
      error: null,
      onRetry: mock(),
    },
  }
}

describe('OverviewTabView', () => {
  it('renders a visual monitoring cockpit with alerts before platform telemetry', () => {
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

    const { container } = render(
      <OverviewTabView model={model} telemetry={dashboardTelemetry()} onRepair={onRepair} />,
    )

    const identity = screen.getByRole('heading', { level: 2, name: 'Overview' })
    expect(identity.className).toContain('sr-only')
    const intro = screen.getByText('See what needs attention, fix it, and confirm Bakin is working.')
    expect(intro.className).toContain('text-xs')
    expect(intro.className).toContain('leading-relaxed')
    expect(intro.className).toContain('text-muted-foreground/80')

    const pulse = screen.getByTestId('overview-platform-pulse')
    expect(pulse.textContent).toMatch(/Bakin.*Needs attention.*Search.*Healthy.*1 working.*4 sessions.*3 failed/i)
    expect(screen.getByRole('link', { name: /Search: Healthy/i }).getAttribute('href')).toBe('/health?tab=system&section=search')
    expect(within(pulse).getByRole('link', { name: /Recent failures: 3 failed/i }).getAttribute('href'))
      .toBe('/health?tab=activity&activity_window=1h#activity-needs-attention')
    expect(screen.getByRole('heading', { name: 'Fix first' })).toBeDefined()
    const text = container.textContent ?? ''
    expect(text.indexOf('Fix first')).toBeLessThan(text.indexOf('Agent spend'))
    expect(screen.queryByRole('heading', { name: 'Search readiness' })).toBeNull()
    expect(screen.queryByText('Engine')).toBeNull()
    expect(screen.queryByText('Technical evidence')).toBeNull()

    const notices = screen.getByRole('button', { name: '1 notice' })
    expect(notices.getAttribute('data-slot')).toBe('popover-trigger')
    expect(notices.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(notices)
    expect(screen.getByText('Journal backlog is growing')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Restart Search' }))
    expect(onRepair).toHaveBeenCalledWith(repair)

    const spend = screen.getByTestId('overview-agent-spend')
    expect(within(spend).getByText('1.3M tokens')).toBeDefined()
    expect(within(spend).getByText('$6.20')).toBeDefined()
    expect(within(spend).getByText('Today + yesterday')).toBeDefined()
    expect(within(spend).getByRole('group', { name: 'Agent token use by day' })).toBeDefined()
    expect(within(spend).getAllByText('main').length).toBeGreaterThan(0)
    expect(within(spend).getAllByText('pixel').length).toBeGreaterThan(0)
    expect(within(spend).getByText('Working')).toBeDefined()

    const context = screen.getByTestId('overview-context-traffic')
    expect(within(context).getByText('Context budget')).toBeDefined()
    expect(within(context).getByText('1 over budget')).toBeDefined()
    expect(within(context).getByText('81% from cache')).toBeDefined()

    const interactions = screen.getByTestId('overview-interactions')
    expect(within(interactions).getByRole('heading', { name: 'Interactions' })).toBeDefined()
    expect(within(interactions).getByText('132 interactions')).toBeDefined()
    expect(within(interactions).getByText('2 failed')).toBeDefined()
    expect(within(interactions).getByText('· 1h')).toBeDefined()
    expect(within(interactions).getByText('52 foreground')).toBeDefined()
    expect(within(interactions).getByText('80 background')).toBeDefined()
    expect(within(interactions).getByText('Tools')).toBeDefined()
    expect(within(interactions).getByText('42')).toBeDefined()
    expect(within(interactions).getByText('API')).toBeDefined()
    expect(within(interactions).getByText('80')).toBeDefined()
    expect(within(interactions).getByText('Agents')).toBeDefined()
    expect(within(interactions).getByText('10')).toBeDefined()
    expect(within(interactions).getByText('web search')).toBeDefined()
    expect(within(interactions).getByText('images generate')).toBeDefined()
    expect(within(interactions).getByText('monitoring excluded').getAttribute('title'))
      .toBe('Successful routine polling and static delivery are excluded; failures always count.')
    expect(within(interactions).getByRole('group', { name: /Recorded meaningful Bakin interactions/i })).toBeDefined()
    expect(within(interactions).getByRole('link', { name: 'View recorded interaction activity' }).getAttribute('href'))
      .toBe('/health?tab=activity&activity_window=1h')
  })

  it('links the interaction failure badge to the one-hour Activity attention section', () => {
    render(
      <OverviewTabView
        model={buildHealthOverviewViewModel({ report: report(), now: NOW })}
        telemetry={dashboardTelemetry()}
      />,
    )

    const interactions = screen.getByTestId('overview-interactions')
    const failedBadge = within(interactions).getByText('2 failed').closest('[data-status-badge]')
    expect(failedBadge?.closest('a')?.getAttribute('href'))
      .toBe('/health?tab=activity&activity_window=1h#activity-needs-attention')
  })

  it('labels restart and buffer-limited interaction coverage without claiming a full hour', () => {
    const telemetry = dashboardTelemetry()
    telemetry.interactions.data!.coverage = {
      startsAt: '2026-07-13T11:45:00.000Z',
      hasFullWindow: false,
      reason: 'process_restart',
    }
    const view = render(
      <OverviewTabView model={buildHealthOverviewViewModel({ report: report(), now: NOW })} telemetry={telemetry} />,
    )

    const interactions = within(screen.getByTestId('overview-interactions'))
    const restart = interactions.getByText('· since restart')
    expect(restart.getAttribute('aria-label')).toMatch(/since restart at .*2026/i)

    telemetry.interactions.data!.coverage = {
      startsAt: '2026-07-13T11:50:00.000Z',
      hasFullWindow: false,
      reason: 'buffer_limit',
    }
    view.rerender(
      <OverviewTabView model={buildHealthOverviewViewModel({ report: report(), now: NOW })} telemetry={telemetry} />,
    )

    const partial = within(screen.getByTestId('overview-interactions')).getByText('· partial hour')
    expect(partial.getAttribute('aria-label')).toMatch(/buffer limit.*2026/i)
  })

  it('warns when a completed tool result was not observed and no failures are recorded', () => {
    const telemetry = dashboardTelemetry()
    telemetry.interactions.data!.totals.errors = 0
    telemetry.interactions.data!.totals.unverified = 1

    render(<OverviewTabView model={buildHealthOverviewViewModel({ report: report(), now: NOW })} telemetry={telemetry} />)

    const badge = within(screen.getByTestId('overview-interactions')).getByText('1 result not observed')
    expect(badge.closest('[data-status-badge]')?.getAttribute('data-status-badge')).toBe('warning')
  })

  it('keeps result-observation gaps visible when failures take badge priority', () => {
    const telemetry = dashboardTelemetry()
    telemetry.interactions.data!.totals.unverified = 1

    render(<OverviewTabView model={buildHealthOverviewViewModel({ report: report(), now: NOW })} telemetry={telemetry} />)

    const badge = within(screen.getByTestId('overview-interactions')).getByText('2 failed · 1 result not observed')
    expect(badge.closest('[data-status-badge]')?.getAttribute('data-status-badge')).toBe('destructive')
  })

  it('uses recorded meaningful wording for an empty interaction window', () => {
    const telemetry = dashboardTelemetry()
    telemetry.interactions.data!.totals = {
      count: 0,
      errors: 0,
      unverified: 0,
      foreground: 0,
      background: 0,
    }
    telemetry.interactions.data!.categories = telemetry.interactions.data!.categories.map((category) => ({
      ...category,
      count: 0,
      errors: 0,
    }))
    telemetry.interactions.data!.topDestinations = []
    telemetry.interactions.data!.timeBuckets = []

    render(<OverviewTabView model={buildHealthOverviewViewModel({ report: report(), now: NOW })} telemetry={telemetry} />)

    expect(within(screen.getByTestId('overview-interactions')).getByText(
      'No recorded meaningful Bakin interactions in the last hour.',
    )).toBeDefined()
  })

  it('shows a calm explicit healthy state without hiding the Search strip', () => {
    const model = buildHealthOverviewViewModel({ report: report(), now: NOW })

    render(<OverviewTabView model={model} telemetry={dashboardTelemetry()} />)

    const status = screen.getByTestId('overview-platform-pulse')
    expect(status.textContent).toMatch(/Bakin.*Healthy/)
    expect(screen.getByRole('link', { name: /Search: Healthy/i })).toBeDefined()
    expect(screen.queryByRole('heading', { name: /Needs attention|Fix now|Needs verification/ })).toBeNull()
    expect(screen.getByText('No problems need attention')).toBeDefined()
  })

  it('keeps the default status view terse and sends Search detail to System', () => {
    const model = buildHealthOverviewViewModel({ report: report(), now: NOW })

    render(<OverviewTabView model={model} />)

    const status = screen.getByTestId('overview-platform-pulse')
    expect(status.textContent).toContain('Checked')
    expect(status.querySelectorAll('p')).toHaveLength(0)
    expect(screen.queryByText('How Search was checked')).toBeNull()
    expect(screen.getByRole('link', { name: /Search: Healthy/i }).getAttribute('href')).toBe('/health?tab=system&section=search')
  })

  it('shows at most three distinct primary alerts before a closed remainder', () => {
    const issues = [
      incident({ id: 'search-one', status: 'error', disposition: 'action_required', title: 'Search index is missing' }),
      incident({ id: 'search-two', status: 'error', disposition: 'action_required', title: 'Search index is missing' }),
      incident({ id: 'budget', status: 'error', disposition: 'action_required', title: 'Token budget was exceeded' }),
      incident({ id: 'runtime', status: 'error', disposition: 'action_required', title: 'Runtime is unavailable' }),
      incident({ id: 'assets', status: 'warning', disposition: 'action_required', title: 'Assets need repair' }),
    ]
    const model = buildHealthOverviewViewModel({ report: report(issues, 'needs_attention'), now: NOW })

    render(<OverviewTabView model={model} telemetry={dashboardTelemetry()} />)

    const visible = screen.getByTestId('overview-primary-alerts')
    expect(visible.querySelectorAll(':scope > li')).toHaveLength(3)
    expect(visible.textContent).toContain('Search index is missing')
    expect(visible.textContent).toContain('Token budget was exceeded')
    expect(visible.textContent).toContain('Runtime is unavailable')
    expect(visible.textContent).not.toContain('Assets need repair')

    const remainder = screen.getByText('View 2 more problems').closest('details')
    expect(remainder?.open).toBe(false)
  })

  it('lets a single primary alert use the full available row', () => {
    const issue = incident({
      id: 'search',
      status: 'error',
      disposition: 'action_required',
      title: 'Search index is missing',
    })
    const model = buildHealthOverviewViewModel({ report: report([issue], 'needs_attention'), now: NOW })

    render(<OverviewTabView model={model} telemetry={dashboardTelemetry()} />)

    const alerts = screen.getByTestId('overview-primary-alerts')
    expect(alerts.className).not.toContain('grid-cols-2')
    expect(alerts.className).not.toContain('grid-cols-3')
  })

  it('keeps the all-agent total when the visual ranking is capped', () => {
    const telemetry = dashboardTelemetry()
    telemetry.history.data?.byAgent.push(
      {
        agent: 'enrich', tokens: { input: 300_000, output: 0, cacheRead: 0, cacheWrite: 0, total: 300_000 },
        costUsdMicros: 0, costedMessages: 1, messageCount: 1,
      },
      {
        agent: 'scout', tokens: { input: 200_000, output: 0, cacheRead: 0, cacheWrite: 0, total: 200_000 },
        costUsdMicros: 0, costedMessages: 1, messageCount: 1,
      },
      {
        agent: 'writer', tokens: { input: 100_000, output: 0, cacheRead: 0, cacheWrite: 0, total: 100_000 },
        costUsdMicros: 0, costedMessages: 1, messageCount: 1,
      },
    )

    render(<OverviewTabView model={buildHealthOverviewViewModel({ report: report(), now: NOW })} telemetry={telemetry} />)

    expect(within(screen.getByTestId('overview-agent-spend')).getByText('1.9M tokens')).toBeDefined()
  })

  it('marks incomplete runtime cost as partial instead of presenting it as total spend', () => {
    const telemetry = dashboardTelemetry()
    const row = telemetry.history.data?.byAgent[0]
    if (row) row.costedMessages = 2

    render(<OverviewTabView model={buildHealthOverviewViewModel({ report: report(), now: NOW })} telemetry={telemetry} />)

    const spend = screen.getByTestId('overview-agent-spend')
    expect(within(spend).getByText('$6.20+')).toBeDefined()
    expect(within(spend).getByText('Partial runtime-reported cost')).toBeDefined()
  })

  it('limits overview spend to fully scanned agents when coverage is partial', () => {
    const telemetry = dashboardTelemetry()
    const history = telemetry.history.data!
    history.scannedAt = null
    history.coverage = {
      status: 'partial',
      reason: 'agent_scan_failed',
      agents: [
        { agent: 'main', status: 'complete' },
        { agent: 'pixel', status: 'partial' },
      ],
    }

    render(<OverviewTabView model={buildHealthOverviewViewModel({ report: report(), now: NOW })} telemetry={telemetry} />)

    const spend = screen.getByTestId('overview-agent-spend')
    expect(within(spend).getByText('Partial coverage')).toBeDefined()
    expect(within(spend).getByText('1.0M tokens')).toBeDefined()
    expect(within(spend).getByText('Fully scanned agents only')).toBeDefined()
    expect(within(spend).queryByText('pixel', { exact: true })).toBeNull()
    expect(spend.textContent).not.toContain('1.3M tokens')
  })

  it('does not show retained usage as current spend when the new scan is unavailable', () => {
    const telemetry = dashboardTelemetry()
    const history = telemetry.history.data!
    history.scannedAt = null
    history.coverage = { status: 'unavailable', reason: 'scan_not_run', agents: [] }

    render(<OverviewTabView model={buildHealthOverviewViewModel({ report: report(), now: NOW })} telemetry={telemetry} />)

    const spend = screen.getByTestId('overview-agent-spend')
    expect(within(spend).getByText('Scan unavailable')).toBeDefined()
    expect(spend.textContent).toContain('Retained rows are not shown as current agent spend')
    expect(spend.textContent).not.toContain('1.3M tokens')
  })

  it('holds the context verdict until its budget is known', () => {
    const telemetry = dashboardTelemetry()
    telemetry.context.loading = true
    telemetry.context.budgetBytes = null

    render(<OverviewTabView model={buildHealthOverviewViewModel({ report: report(), now: NOW })} telemetry={telemetry} />)

    const context = screen.getByTestId('overview-context-traffic')
    expect(within(context).queryByText('1 over budget')).toBeNull()
    expect(within(context).queryByText('Within budget')).toBeNull()
  })

  it('keeps a failed interaction visible even when it is not top three by volume', () => {
    const telemetry = dashboardTelemetry()
    telemetry.interactions.data!.topDestinations = [
      { category: 'api', name: '/api/plugins/health/doctor', count: 30, errors: 0, medianDurationMs: 4 },
      { category: 'tools', name: 'web_search', count: 24, errors: 0, medianDurationMs: 230 },
      { category: 'agents', name: 'dispatch', count: 18, errors: 0, medianDurationMs: null },
      { category: 'tools', name: 'bakin_exec_search_reindex', count: 2, errors: 1, medianDurationMs: 410 },
    ]

    render(<OverviewTabView model={buildHealthOverviewViewModel({ report: report(), now: NOW })} telemetry={telemetry} />)

    const interactions = within(screen.getByTestId('overview-interactions'))
    const failedRow = interactions.getByText('search reindex').closest<HTMLElement>('[data-testid="interaction-destination-row"]')!
    const successful = within(failedRow).getByTestId('interaction-destination-success')
    const failed = within(failedRow).getByTestId('interaction-destination-failed')

    expect(successful.className).toContain('bg-chart-1')
    expect(successful.getAttribute('style')).toContain('flex-grow: 1')
    expect(failed.className).toContain('bg-destructive')
    expect(failed.getAttribute('style')).toContain('flex-grow: 1')
  })

  it('keeps incident explanations compact while allowing the full impact to be read', () => {
    const impact = 'Search cannot answer queries while the index is unavailable, so agents may miss relevant workspace context and produce incomplete answers until indexing recovers.'
    const issue = incident({
      id: 'long-impact',
      status: 'error',
      disposition: 'action_required',
      title: 'Search index is unavailable',
      impact,
    })

    render(
      <OverviewTabView
        model={buildHealthOverviewViewModel({ report: report([issue], 'needs_attention'), now: NOW })}
      />,
    )

    const explanation = screen.getByText(impact)
    const disclosure = screen.getByRole('button', { name: 'Show full explanation for Search index is unavailable' })
    expect(explanation.className).toContain('line-clamp-2')
    expect(disclosure.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(disclosure)

    expect(explanation.className).not.toContain('line-clamp-2')
    expect(disclosure.getAttribute('aria-expanded')).toBe('true')
    expect(disclosure.textContent).toContain('Less')
  })

  it('keeps telemetry rows shrink-safe while reserving aligned metric cells', () => {
    render(
      <OverviewTabView
        model={buildHealthOverviewViewModel({ report: report(), now: NOW })}
        telemetry={dashboardTelemetry()}
      />,
    )

    const rows = within(screen.getByTestId('overview-interactions'))
      .getAllByTestId('interaction-destination-row')
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      expect(row.className).toContain('min-w-0')
      expect(within(row).getByTestId('interaction-destination-bar')).toBeDefined()
      expect(within(row).getByTestId('interaction-destination-metric').className).toContain('w-24')
    }

    const spendRows = within(screen.getByTestId('overview-agent-spend'))
      .getAllByTestId('agent-spend-row')
    expect(spendRows).toHaveLength(2)
    for (const row of spendRows) {
      expect(row.className).toContain('min-w-0')
      expect(within(row).getByTestId('agent-spend-bar')).toBeDefined()
      expect(within(row).getByTestId('agent-spend-metric').className).toContain('w-16')
    }
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
    expect(screen.getByTestId('overview-platform-pulse').textContent).toContain('Unable to verify')
    expect(screen.getByRole('alert').textContent).toContain('Health endpoint unavailable')
    expect(screen.queryByText(/Verified evidence remains visible/)).toBeNull()
    expect(screen.getByRole('link', { name: /Search: Unknown/i })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalledTimes(1)
  })
})
