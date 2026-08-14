// @vitest-environment jsdom

/**
 * SchedulePage — honest search signals (spec D11 / search-trust-and-speed
 * WS6/T16).
 *
 * Unlike schedule-page.test.tsx (which stubs useSearch wholesale), this file
 * keeps the REAL `useSearch` hook and stubs `fetch` so the plugin search
 * route answers 503 `{ error: 'search_unavailable' }` (engine down) or a
 * `meta.partial` response (budget degrade). The page must show:
 *   - a loading indicator while the search is in flight,
 *   - the "Search is unavailable — showing basic text matching" chip on 503
 *     WHILE the substring fallback keeps the list browsable,
 *   - the SearchPartialChip when the response is partial.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import '../../rtl-settle'
import { rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// ─── Test isolation mocks (mandatory per CLAUDE.md) ─────────────────────────

const testDir = join(tmpdir(), `bakin-test-schedule-degraded-${process.pid}-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))

mock.module('@/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

mock.module('@/core/watcher', () => ({
  registerSyncHook: mock(),
  registerUnlinkHook: mock(),
  watchPath: mock(),
}))

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

// ─── URL state — primed per test ────────────────────────────────────────────

const queryStateRefs: Record<string, string> = {}

mock.module('@/hooks/use-query-state', () => ({
  useQueryState: (key: string, defaultValue: string) => {
    if (!(key in queryStateRefs)) queryStateRefs[key] = defaultValue
    const setter = (v: string) => { queryStateRefs[key] = v }
    return [queryStateRefs[key], setter, setter] as const
  },
  useQueryArrayState: (_key: string) => {
    return [[], () => {}] as const
  },
}))

// ─── Stubbed dep web (per schedule-page.test.tsx) ───────────────────────────

interface ScheduleJobStub {
  id: string
  displayName: string
  agentId?: string
  humanSchedule: string
  paused: boolean
  enabled: boolean
  isBakinJob: boolean
  allowOverlap: boolean
  maxFailures: number
  consecutiveFailures: number
}

const scheduleState: { jobs: ScheduleJobStub[] } = { jobs: [] }

mock.module('@/hooks/use-schedule', () => ({
  useScheduleJobs: () => ({
    jobs: scheduleState.jobs,
    allJobs: scheduleState.jobs,
    loading: false,
    fetchFailed: false,
    refresh: mock(),
    pauseJob: mock(),
    resumeJob: mock(),
    deleteJob: mock(async () => true),
    runNow: mock(),
    updateJob: mock(),
    adoptJob: mock(),
    restoreNative: mock(),
    skipNext: mock(),
  }),
}))

mock.module('@bakin/team/hooks/use-agent-store', () => ({
  useAgentIds: () => ['chef'],
  useAgent: (id: string) => ({ id, name: id }),
  useAgentDisplayName: () => undefined,
  useAgentList: () => [],
}))


mock.module('@bakin/schedule/components/job-list', () => ({
  JobList: ({ jobs }: { jobs: ScheduleJobStub[] }) => (
    <ul data-testid="job-list">
      {jobs.map(j => <li key={j.id} data-testid={`job-${j.id}`}>{j.displayName}</li>)}
    </ul>
  ),
}))

mock.module('@bakin/schedule/components/job-drawer', () => ({
  JobDrawer: () => null,
}))
mock.module('@bakin/schedule/components/job-form', () => ({
  JobForm: () => null,
}))
mock.module('@bakin/schedule/components/delete-schedule-dialog', () => ({
  DeleteScheduleDialog: () => null,
}))
mock.module('@bakin/schedule/components/calendar-monthly', () => ({
  CalendarMonthly: () => null,
}))
mock.module('@bakin/schedule/components/calendar-weekly', () => ({
  CalendarWeekly: () => null,
}))
mock.module('@bakin/schedule/components/calendar-today', () => ({
  CalendarToday: () => null,
}))

// Import AFTER mocks. useSearch stays REAL — engine states arrive via fetch.
import { SchedulePage } from '../../../plugins/schedule/components/schedule-page'

// ─── Fixtures + fetch stub ──────────────────────────────────────────────────

function makeJob(overrides: Partial<ScheduleJobStub> = {}): ScheduleJobStub {
  return {
    id: 'job-1',
    displayName: 'Daily Report',
    agentId: 'chef',
    humanSchedule: 'Every day at 9am',
    paused: false,
    enabled: true,
    isBakinJob: true,
    allowOverlap: false,
    maxFailures: 3,
    consecutiveFailures: 0,
    ...overrides,
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function stubSearchFetch(searchImpl: () => Response) {
  vi.stubGlobal('fetch', mock(async (url: string | URL) => {
    const u = String(url)
    if (u.includes('/search')) return searchImpl()
    return json({})
  }))
}

beforeEach(() => {
  cleanup()
  for (const k of Object.keys(queryStateRefs)) delete queryStateRefs[k]
  scheduleState.jobs = []
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('SchedulePage — search signals', () => {
  it('shows loading, then the degraded chip on 503 — substring fallback keeps working', async () => {
    stubSearchFetch(() => json({ error: 'search_unavailable' }, 503))
    scheduleState.jobs = [
      makeJob({ id: 'a', displayName: 'Beef digest' }),
      makeJob({ id: 'b', displayName: 'Other job' }),
    ]
    queryStateRefs.view = 'list'
    queryStateRefs.q = 'beef'

    render(<SchedulePage />)

    // In-flight search → visible loading indicator. The immersive frame
    // renders a desktop and a mobile SearchInput (visibility is CSS
    // viewport-scoped), so more than one indicator exists in jsdom.
    await waitFor(() => {
      expect(screen.getAllByText('Searching Schedule search').length).toBeGreaterThan(0)
    })

    // Engine down → the honest degraded chip…
    await waitFor(() => {
      expect(screen.getByTestId('schedule-search-degraded')).toBeDefined()
    }, { timeout: 3000 })
    expect(screen.queryAllByText('Searching Schedule search').length).toBe(0)

    // …while basic text matching keeps the list usable.
    expect(screen.getByTestId('job-a')).toBeDefined()
    expect(screen.queryAllByTestId('job-b').length).toBe(0)
  })

  it('shows the SearchPartialChip when the response is partial', async () => {
    stubSearchFetch(() => json({
      results: [{ id: 'a', table: 'bakin_schedule', score: 0.8, fields: {} }],
      aggregations: {},
      meta: {
        query: 'beef',
        total: 1,
        took_ms: 9,
        source: 'search',
        partial: true,
        tables: [{ table: 'bakin_schedule', hits: 1, took_ms: 9, budget: 'degraded' as const }],
      },
    }))
    scheduleState.jobs = [makeJob({ id: 'a', displayName: 'Beef digest' })]
    queryStateRefs.view = 'list'
    queryStateRefs.q = 'beef'

    render(<SchedulePage />)

    await waitFor(() => {
      expect(screen.getByTestId('search-partial-chip')).toBeDefined()
    }, { timeout: 3000 })
    expect(screen.queryAllByTestId('schedule-search-degraded').length).toBe(0)
    expect(screen.getByTestId('job-a')).toBeDefined()
  })

  it('renders no signal row for a healthy complete search', async () => {
    // Gate on the debounced search request actually having fired — ending
    // earlier leaves its setState outside act (the CI act-gate flake).
    let searchFetched = false
    stubSearchFetch(() => {
      searchFetched = true
      return json({
        results: [{ id: 'a', table: 'bakin_schedule', score: 0.8, fields: {} }],
        aggregations: {},
        meta: { query: 'beef', total: 1, took_ms: 4, source: 'search' },
      })
    })
    scheduleState.jobs = [makeJob({ id: 'a', displayName: 'Beef digest' })]
    queryStateRefs.view = 'list'
    queryStateRefs.q = 'beef'

    render(<SchedulePage />)

    await waitFor(() => expect(searchFetched).toBe(true), { timeout: 3000 })
    await waitFor(() => {
      expect(screen.getByTestId('job-a')).toBeDefined()
      expect(screen.queryAllByTestId('schedule-search-loading').length).toBe(0)
    }, { timeout: 3000 })
    expect(screen.queryAllByTestId('schedule-search-degraded').length).toBe(0)
    expect(screen.queryAllByTestId('search-partial-chip').length).toBe(0)
  })
})
