// @vitest-environment jsdom
/**
 * Smoke test for SchedulePage — issue #67 commit C24.
 *
 * Verifies the search wiring works end-to-end at the component level:
 *  - useQueryState('q', '') feeds useSearch
 *  - When useSearch returns hits, the filtered list is reduced to those ids
 *    and ordered by score
 *  - When useSearch returns no hits, the local substring fallback runs over
 *    displayName / id / agentId / humanSchedule
 *
 * The schedule page imports a large dep web (job-list, drawers, calendar
 * views, agent store, etc.). All of them are stubbed to keep the test
 * focused on filter/search behavior in `view='list'` mode.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '../../rtl-settle'
import { rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// ---------------------------------------------------------------------------
// Mandatory test isolation mocks (per CLAUDE.md). Even though this is a
// pure component test that doesn't import storage directly, the schedule
// page transitively touches modules that may resolve content-dir. These
// mocks guarantee no test data ever leaks into ~/.bakin/ or ~/.openclaw/.
// ---------------------------------------------------------------------------

const testDir = join(tmpdir(), `bakin-test-schedule-page-${process.pid}-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  resetContentDir: mock(),
  initBakinHome: mock(),
  isUsingBakinHome: () => false,
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

// ---------------------------------------------------------------------------
// useQueryState — held in module-level refs so each test can prime values
// before render.
// ---------------------------------------------------------------------------

const queryStateRefs: Record<string, string> = {}

mock.module('@/hooks/use-query-state', () => ({
  useQueryState: (key: string, defaultValue: string) => {
    if (!(key in queryStateRefs)) queryStateRefs[key] = defaultValue
    const setter = (v: string) => { queryStateRefs[key] = v }
    return [queryStateRefs[key], setter, setter] as const
  },
  useQueryArrayState: (key: string) => {
    return [[], () => {}] as const
  },
}))

// ---------------------------------------------------------------------------
// useSearch — controlled per-test.
// ---------------------------------------------------------------------------

interface SearchHookState {
  results: Array<{ id: string; table: string; score: number; fields: Record<string, unknown> }>
  search: ReturnType<typeof mock>
  clear: ReturnType<typeof mock>
}

const searchHookState: SearchHookState = {
  results: [],
  search: mock(),
  clear: mock(),
}

mock.module('@/hooks/use-search', () => ({
  useSearch: () => ({
    results: searchHookState.results,
    aggregations: {},
    status: 'ok',
    loading: false,
    error: null,
    meta: null,
    search: searchHookState.search,
    clear: searchHookState.clear,
    retry: mock(),
  }),
}))

// ---------------------------------------------------------------------------
// useScheduleJobs — controlled per-test.
// ---------------------------------------------------------------------------

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

const scheduleState: { jobs: ScheduleJobStub[]; allJobs: ScheduleJobStub[] | null; loading: boolean; fetchFailed: boolean } = {
  jobs: [],
  // null = mirror `jobs` (most tests don't filter); set explicitly to test
  // the filtered-list vs unfiltered-list distinction.
  allJobs: null,
  loading: false,
  fetchFailed: false,
}

const scheduleActions = {
  refresh: mock(),
  pauseJob: mock(),
  resumeJob: mock(),
  deleteJob: mock(async () => true),
  runNow: mock(),
  updateJob: mock(),
  skipNext: mock(),
  duplicateJob: mock(),
}

mock.module('@/hooks/use-schedule', () => ({
  useScheduleJobs: () => ({
    jobs: scheduleState.jobs,
    allJobs: scheduleState.allJobs ?? scheduleState.jobs,
    loading: scheduleState.loading,
    fetchFailed: scheduleState.fetchFailed,
    ...scheduleActions,
  }),
}))

// ---------------------------------------------------------------------------
// Stubbed children — each renders a small, observable marker.
// ---------------------------------------------------------------------------

mock.module('@bakin/team/hooks/use-agent-store', () => ({
  useAgentIds: () => ['chef', 'pixel'],
  useAgent: (id: string) => ({ id, name: id }),
  useAgentDisplayName: () => undefined,
}))

mock.module('@/components/plugin-header', () => ({
  PluginHeader: ({ title, count }: { title: string; count?: number }) => (
    <div data-testid="plugin-header">
      <span>{title}</span>
      <span data-testid="header-count">{count ?? '—'}</span>
    </div>
  ),
}))

mock.module('@/components/agent-avatar', () => ({
  AgentAvatar: ({ agentId }: { agentId: string }) => <span>{agentId}</span>,
}))

mock.module('@/components/bakin-drawer', () => ({
  BakinDrawer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}))

mock.module('@/components/ui/button', () => ({
  Button: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
}))

mock.module('@bakin/schedule/components/job-list', () => ({
  JobList: ({ jobs, onDelete }: { jobs: ScheduleJobStub[]; onDelete: (jobId: string) => void }) => (
    <ul data-testid="job-list">
      {jobs.map(j => (
        <li key={j.id} data-testid={`job-${j.id}`}>
          {j.displayName}
          <button onClick={() => onDelete(j.id)}>Delete {j.displayName}</button>
        </li>
      ))}
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
  DeleteScheduleDialog: ({
    job,
    onConfirm,
    onCancel,
  }: {
    job: ScheduleJobStub | null
    onConfirm: () => void
    onCancel: () => void
  }) => job ? (
    <div role="dialog" aria-label="Delete scheduled job">
      <span>Delete scheduled job</span>
      <span>{job.displayName}</span>
      <button onClick={onCancel}>Cancel</button>
      <button onClick={onConfirm}>Delete</button>
    </div>
  ) : null,
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

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { SchedulePage } from '../../../plugins/schedule/components/schedule-page'

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

beforeEach(() => {
  cleanup()
  // Reset module state
  for (const k of Object.keys(queryStateRefs)) delete queryStateRefs[k]
  searchHookState.results = []
  searchHookState.search.mockReset()
  searchHookState.clear.mockReset()
  for (const action of Object.values(scheduleActions)) action.mockReset()
  scheduleActions.deleteJob.mockImplementation(async () => true)
  scheduleState.jobs = []
  scheduleState.allJobs = null
  scheduleState.fetchFailed = false
  scheduleState.loading = false
})

describe('SchedulePage smoke', () => {
  it('renders a loading state while jobs are loading', () => {
    scheduleState.loading = true
    queryStateRefs.view = 'list'

    const { container } = render(<SchedulePage />)

    expect(screen.getByText('Loading scheduled jobs')).toBeDefined()
  })

  it('shows an honest notice when ?jobId= matches no job (stale deep link)', () => {
    scheduleState.jobs = [makeJob({ id: 'a', displayName: 'Alpha' })]
    queryStateRefs.view = 'list'
    queryStateRefs.jobId = 'deleted-job'

    render(<SchedulePage />)

    expect(screen.getByTestId('schedule-job-not-found')).toBeDefined()
  })

  it('does not show the not-found notice while jobs are still loading', () => {
    scheduleState.loading = true
    queryStateRefs.view = 'list'
    queryStateRefs.jobId = 'some-job'

    render(<SchedulePage />)

    expect(screen.queryByTestId('schedule-job-not-found')).toBeNull()
  })

  it('no false not-found when the active agent filter excludes the deep-linked job', () => {
    // The visible list is agent-filtered; the deep link must resolve
    // against the UNFILTERED list — the job exists, so no notice.
    scheduleState.jobs = []
    scheduleState.allJobs = [makeJob({ id: 'other-agent-job', displayName: 'Other', agentId: 'pixel' })]
    queryStateRefs.view = 'list'
    queryStateRefs.agent = 'chef'
    queryStateRefs.jobId = 'other-agent-job'

    render(<SchedulePage />)

    expect(screen.queryByTestId('schedule-job-not-found')).toBeNull()
  })

  it('no false not-found when the jobs fetch failed', () => {
    // A failed fetch (empty stale list) is not evidence of deletion.
    scheduleState.jobs = []
    scheduleState.fetchFailed = true
    queryStateRefs.view = 'list'
    queryStateRefs.jobId = 'some-job'

    render(<SchedulePage />)

    expect(screen.queryByTestId('schedule-job-not-found')).toBeNull()
  })

  it('renders the JobList in list view with all jobs when no search is active', () => {
    scheduleState.jobs = [
      makeJob({ id: 'a', displayName: 'Alpha' }),
      makeJob({ id: 'b', displayName: 'Beta' }),
      makeJob({ id: 'c', displayName: 'Gamma' }),
    ]
    queryStateRefs.view = 'list'

    render(<SchedulePage />)

    expect(screen.getByTestId('job-list')).toBeDefined()
    expect(screen.getByTestId('job-a')).toBeDefined()
    expect(screen.getByTestId('job-b')).toBeDefined()
    expect(screen.getByTestId('job-c')).toBeDefined()
    expect(screen.getByTestId('header-count').textContent).toBe('3 shown')
  })

  it('filters and reorders by score when useSearch returns hits', () => {
    scheduleState.jobs = [
      makeJob({ id: 'a', displayName: 'Alpha' }),
      makeJob({ id: 'b', displayName: 'Beta' }),
      makeJob({ id: 'c', displayName: 'Gamma' }),
    ]
    queryStateRefs.view = 'list'
    queryStateRefs.q = 'plan'
    searchHookState.results = [
      { id: 'b', table: 'bakin_schedule', score: 0.4, fields: {} },
      { id: 'c', table: 'bakin_schedule', score: 0.9, fields: {} },
    ]

    render(<SchedulePage />)

    // Both matched ids render — ordered by score (c before b).
    const jobNodes = screen.getAllByTestId(/^job-[a-c]$/)
    expect(jobNodes.map(n => n.getAttribute('data-testid'))).toEqual(['job-c', 'job-b'])
    expect(screen.queryByTestId('job-a')).toBeNull()
    expect(screen.getByTestId('header-count').textContent).toBe('2 shown')
  })

  it('falls back to local substring filter when useSearch returns no hits', () => {
    scheduleState.jobs = [
      makeJob({ id: 'job-alpha', displayName: 'Alpha report', agentId: 'chef', humanSchedule: 'Every day' }),
      makeJob({ id: 'job-beta', displayName: 'Beta digest', agentId: 'pixel', humanSchedule: 'Every Monday' }),
      makeJob({ id: 'job-gamma', displayName: 'Gamma weekly', agentId: 'chef', humanSchedule: 'Every Friday' }),
    ]
    queryStateRefs.view = 'list'
    queryStateRefs.q = 'monday'
    searchHookState.results = []

    render(<SchedulePage />)

    // Only job-beta matches "monday" via humanSchedule
    expect(screen.getByTestId('job-job-beta')).toBeDefined()
    expect(screen.queryByTestId('job-job-alpha')).toBeNull()
    expect(screen.queryByTestId('job-job-gamma')).toBeNull()
    expect(screen.getByTestId('header-count').textContent).toBe('1 shown')
  })

  it('renders agent filter buttons for All + each agent id', () => {
    scheduleState.jobs = [makeJob()]
    queryStateRefs.view = 'list'

    render(<SchedulePage />)

    expect(screen.getByRole('radio', { name: 'All' })).toBeDefined()
    // AgentAvatar stubs render the agent id as text
    expect(screen.getAllByText('chef').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('pixel').length).toBeGreaterThanOrEqual(1)
  })

  it('confirms before deleting a scheduled job from the list', async () => {
    scheduleState.jobs = [makeJob({ id: 'job-delete', displayName: 'Delete candidate' })]
    queryStateRefs.view = 'list'

    render(<SchedulePage />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete Delete candidate' }))

    expect(scheduleActions.deleteJob).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Delete scheduled job' })).toBeDefined()
    expect(screen.getAllByText('Delete candidate').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }))

    await waitFor(() => {
      expect(scheduleActions.deleteJob).toHaveBeenCalledWith('job-delete')
    })
  })
})
