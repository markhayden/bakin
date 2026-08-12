// @vitest-environment jsdom
/**
 * Calendar views render from the server-computed occurrences endpoint —
 * placement math lives in lib/occurrences.ts (kind-aware, tz/DST-correct);
 * the views are pure renderers of fetched instants in browser-local time.
 */
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { join } from 'path'
import { tmpdir } from 'os'
import { settleReact } from '../../rtl-settle'

// Pure component tests (fixtured fetch, no storage), but isolation rules are
// blanket: nothing in a test run may resolve the real ~/.bakin.
const testDir = join(tmpdir(), `bakin-test-calendar-views-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
  isUsingBakinHome: () => true,
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)

// The views fetch /occurrences and subscribe to /api/events — both fixtured.
const occurrenceFixtures: Array<Record<string, unknown>> = []
const eventFixtures: Array<Record<string, unknown>> = []
const fetchCalls: string[] = []
const postCalls: Array<{ url: string; body: unknown }> = []
const navigationPushes: string[] = []
let reschedulePostStatus = 200
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input)
  fetchCalls.push(url)
  if (init?.method === 'POST') {
    postCalls.push({ url, body: JSON.parse(String(init.body)) })
    return new Response(
      JSON.stringify(reschedulePostStatus === 200 ? { ok: true } : { error: 'owner said no' }),
      { status: reschedulePostStatus, headers: { 'Content-Type': 'application/json' } },
    )
  }
  if (url.includes('/occurrences')) {
    return new Response(JSON.stringify({ occurrences: occurrenceFixtures, events: eventFixtures, unevaluated: [], droppedProviders: [] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  }
  return new Response(JSON.stringify({}), { status: 200 })
}) as typeof fetch

class FakeEventSource {
  addEventListener() {}
  removeEventListener() {}
  close() {}
}
;(globalThis as Record<string, unknown>).EventSource = FakeEventSource

mock.module('@makinbakin/sdk/hooks', () => {
  const actual = require('../../../src/hooks/use-schedule')
  return {
    useAgent: (id: string) => id ? { id, name: id } : null,
    useOccurrences: actual.useOccurrences,
  }
})

mock.module('@makinbakin/sdk/navigation', () => ({
  PluginLink: ({
    to,
    children,
    onClick,
    ...props
  }: {
    to: string
    children?: React.ReactNode
    onClick?: React.MouseEventHandler<HTMLAnchorElement>
  }) => (
    <a
      href={to}
      onClick={(event) => {
        onClick?.(event)
        if (event.defaultPrevented) return
        event.preventDefault()
        navigationPushes.push(to)
      }}
      {...props}
    >
      {children}
    </a>
  ),
}))

import { CalendarToday } from '../../../plugins/schedule/components/calendar-today'
import { CalendarWeekly } from '../../../plugins/schedule/components/calendar-weekly'
import { CalendarMonthly } from '../../../plugins/schedule/components/calendar-monthly'
import type { ScheduleJob } from '../../../src/hooks/use-schedule'

function makeJob(overrides: Partial<ScheduleJob> = {}): ScheduleJob {
  return {
    id: 'late-night-release',
    displayName: 'Late night release',
    agentId: 'main',
    humanSchedule: 'Every day at 11:05pm',
    cron: '5 23 * * *',
    paused: false,
    enabled: true,
    isBakinJob: true,
    allowOverlap: false,
    maxFailures: 3,
    consecutiveFailures: 0,
    taskPrompt: 'Build release notes',
    ...overrides,
  }
}

/** An instant at local wall-clock hh:mm today (what the server would return). */
function todayAtLocal(hour: number, minute: number): string {
  const d = new Date()
  d.setHours(hour, minute, 0, 0)
  return d.toISOString()
}

/** An instant in the currently displayed Sunday–Saturday week. */
function currentWeekAtLocal(day: number, hour: number, minute = 0): string {
  const d = new Date()
  d.setDate(d.getDate() - d.getDay() + day)
  d.setHours(hour, minute, 0, 0)
  return d.toISOString()
}

afterEach(() => {
  occurrenceFixtures.length = 0
  eventFixtures.length = 0
  fetchCalls.length = 0
  postCalls.length = 0
  navigationPushes.length = 0
  reschedulePostStatus = 200
})

describe('Schedule calendar views (occurrence-fed)', () => {
  it('Today: renders a fetched 11:05pm occurrence in the 11 PM row', async () => {
    occurrenceFixtures.push({ jobId: 'late-night-release', at: todayAtLocal(23, 5), past: false })
    await act(async () => {
      render(<CalendarToday jobs={[makeJob()]} onSelectJob={() => {}} />)
    })

    expect(screen.getByText('11 PM')).toBeDefined()
    expect(screen.getByText('Late night release')).toBeDefined()
    // Hour-gridded surfaces carry no per-item time label — the row says when.
    expect(screen.queryByText('11:05pm')).toBeNull()
    expect(fetchCalls.some(u => u.includes('/occurrences'))).toBe(true)
  })

  it('Week: renders the fetched occurrence and marks a past fired beat', async () => {
    occurrenceFixtures.push({
      jobId: 'late-night-release', at: todayAtLocal(23, 5), past: true,
      disposition: 'created', taskId: 'task-1',
    })
    await act(async () => {
      render(<CalendarWeekly jobs={[makeJob()]} onSelectJob={() => {}} />)
    })

    expect(screen.getByText('11 PM')).toBeDefined()
    expect(screen.getAllByText('Late night release').length).toBeGreaterThan(0)
    // Disposition markers are screen-reader text, never a title tooltip.
    expect(screen.getByText('Fired').className).toContain('sr-only')
  })

  it('Week: a skipped past beat carries its skip reason', async () => {
    occurrenceFixtures.push({
      jobId: 'late-night-release', at: todayAtLocal(23, 5), past: true,
      disposition: 'skipped', skipReason: 'overlap',
    })
    await act(async () => {
      render(<CalendarWeekly jobs={[makeJob()]} onSelectJob={() => {}} />)
    })

    expect(screen.getByText('Skipped — overlap').className).toContain('sr-only')
  })

  it('Week: collapses a multi-occurrence daily series into one day summary', async () => {
    occurrenceFixtures.push(
      { jobId: 'hourly-inbox', at: currentWeekAtLocal(2, 1), past: false },
      { jobId: 'hourly-inbox', at: currentWeekAtLocal(2, 2), past: false },
      { jobId: 'hourly-inbox', at: currentWeekAtLocal(2, 3), past: false },
      { jobId: 'late-night-release', at: currentWeekAtLocal(2, 9), past: false },
    )
    render(
      <CalendarWeekly
        jobs={[
          makeJob({
            id: 'hourly-inbox',
            displayName: 'Hourly Inbox Sync',
            humanSchedule: 'Every hour',
            cron: '0 * * * *',
          }),
          makeJob(),
        ]}
        onSelectJob={() => {}}
      />,
    )
    await settleReact()

    // Kit CalendarItem binding: the visible title + detail ARE the name.
    const summary = screen.getByRole('button', { name: /Hourly Inbox Sync/ })
    expect(summary.textContent).toContain('0 done · 3 scheduled')
    expect(screen.getAllByText('Hourly Inbox Sync')).toHaveLength(1)
    expect(screen.getByText('Late night release')).toBeDefined()
  })

  it('Week: reports a skipped beat in the daily summary without repeating the recurring card', async () => {
    occurrenceFixtures.push(
      {
        jobId: 'hourly-inbox',
        at: currentWeekAtLocal(1, 1),
        past: true,
        disposition: 'created',
        taskId: 'task-1',
      },
      {
        jobId: 'hourly-inbox',
        at: currentWeekAtLocal(1, 2),
        past: true,
        disposition: 'created',
        taskId: 'task-2',
      },
      {
        jobId: 'hourly-inbox',
        at: currentWeekAtLocal(1, 3),
        past: true,
        disposition: 'skipped',
        skipReason: 'overlap',
      },
    )
    render(
      <CalendarWeekly
        jobs={[makeJob({
          id: 'hourly-inbox',
          displayName: 'Hourly Inbox Sync',
          humanSchedule: 'Every hour',
          cron: '0 * * * *',
        })]}
        onSelectJob={() => {}}
      />,
    )
    await settleReact()

    const summary = screen.getByRole('button', { name: /Hourly Inbox Sync/ })
    expect(summary.textContent).toContain('2 done · 1 skipped')
    expect(screen.queryByText('Skipped — overlap')).toBeNull()
    expect(screen.getAllByText('Hourly Inbox Sync')).toHaveLength(1)
  })

  it('Week: keeps the remaining scheduled count visible beside past exceptions', async () => {
    occurrenceFixtures.push(
      {
        jobId: 'hourly-inbox',
        at: currentWeekAtLocal(1, 1),
        past: true,
        disposition: 'skipped',
        skipReason: 'overlap',
      },
      { jobId: 'hourly-inbox', at: currentWeekAtLocal(1, 2), past: false },
      { jobId: 'hourly-inbox', at: currentWeekAtLocal(1, 3), past: false },
    )
    render(
      <CalendarWeekly
        jobs={[makeJob({
          id: 'hourly-inbox',
          displayName: 'Hourly Inbox Sync',
          humanSchedule: 'Every hour',
          cron: '0 * * * *',
        })]}
        onSelectJob={() => {}}
      />,
    )
    await settleReact()

    const summary = screen.getByRole('button', { name: /Hourly Inbox Sync/ })
    expect(summary.textContent).toContain('0 done · 1 skipped · 2 scheduled')
    expect(screen.getAllByText('Hourly Inbox Sync')).toHaveLength(1)
  })

  it('Week: does not map the next week boundary back onto the current Sunday column', async () => {
    occurrenceFixtures.push(
      { jobId: 'late-night-release', at: currentWeekAtLocal(0, 1), past: false },
      { jobId: 'late-night-release', at: currentWeekAtLocal(7, 0), past: false },
    )
    render(<CalendarWeekly jobs={[makeJob()]} onSelectJob={() => {}} />)
    await settleReact()

    expect(screen.getAllByText('Late night release')).toHaveLength(1)
    expect(screen.queryByText('12am')).toBeNull()
  })

  it('Week: keeps compact job and domain-event details inside their card boxes', async () => {
    occurrenceFixtures.push({
      jobId: 'late-night-release',
      at: currentWeekAtLocal(2, 9),
      past: false,
    })
    eventFixtures.push({
      id: 'publish-1',
      pluginId: 'messaging',
      title: 'No-Knead Artisan Bread Recipe',
      kind: 'publish',
      status: 'published',
      startsAt: currentWeekAtLocal(2, 10),
      reschedulable: false,
    })

    render(<CalendarWeekly jobs={[makeJob()]} onSelectJob={() => {}} />)
    await settleReact()

    const occurrenceButton = screen.getByText('Late night release').closest('button')
    const occurrencePrompt = screen.getByText('Build release notes')
    const eventButton = screen.getByText('No-Knead Artisan Bread Recipe').closest('button')
    const eventMetadata = screen.getByText('messaging · publish · published')

    // Both entries ride the ONE kit CalendarItem — no bespoke button-as-card.
    expect(occurrenceButton?.getAttribute('data-slot')).toBe('calendar-item')
    expect(occurrenceButton?.getAttribute('data-tone')).toBe('neutral')
    expect(occurrenceButton?.getAttribute('data-density')).toBe('compact')
    expect(occurrenceButton?.className).toContain('overflow-hidden')
    expect(occurrenceButton?.querySelector('[data-slot="avatar"]')?.getAttribute('data-size')).toBe('sm')
    expect(occurrenceButton?.textContent).not.toContain('Margo')
    expect(occurrencePrompt.className).toContain('line-clamp-1')
    expect(eventButton?.getAttribute('data-slot')).toBe('calendar-item')
    expect(eventButton?.getAttribute('data-tone')).toBe('accent')
    expect(eventButton?.getAttribute('data-density')).toBe('compact')
    expect(eventButton?.className).toContain('overflow-hidden')
    expect(
      eventMetadata.closest('[data-slot="calendar-item-detail"]')?.className,
    ).toContain('line-clamp-1')
    // Hour-gridded entries carry no time label — the 9 AM / 10 AM rows say when.
    expect(screen.queryByText('9am')).toBeNull()
    expect(screen.queryByText('10am')).toBeNull()
  })

  it('Week: reserves the second line for authored description copy, not a runtime slug', async () => {
    occurrenceFixtures.push(
      { jobId: 'daily-brief', at: currentWeekAtLocal(2, 9), past: false },
      { jobId: 'social-metrics', at: currentWeekAtLocal(2, 10), past: false },
    )

    render(
      <CalendarWeekly
        jobs={[
          makeJob({
            id: 'daily-brief',
            displayName: 'Daily Brief',
            taskPrompt: 'daily-brief',
          }),
          makeJob({
            id: 'social-metrics',
            displayName: 'Social Metrics Collector',
            description: 'Collect yesterday’s channel metrics.',
            taskPrompt: 'social-metrics',
          }),
        ]}
        onSelectJob={() => {}}
      />,
    )
    await settleReact()

    const dailyBrief = screen.getByText('Daily Brief').closest('button')
    const socialMetrics = screen.getByText('Social Metrics Collector').closest('button')

    expect(dailyBrief?.textContent).not.toContain('daily-brief')
    expect(socialMetrics?.textContent).toContain('Collect yesterday’s channel metrics.')
  })

  it('Month: renders a day dot for the fetched occurrence', async () => {
    occurrenceFixtures.push({ jobId: 'late-night-release', at: todayAtLocal(9, 0), past: false })
    await act(async () => {
      render(<CalendarMonthly jobs={[makeJob()]} onSelectJob={() => {}} />)
    })

    expect(screen.getByText('Late night release')).toBeDefined()
  })

  it('renders a domain event chip, visually labeled by its owner, in the Today timeline', async () => {
    eventFixtures.push({
      id: 't-wait:scheduled', pluginId: 'tasks', title: 'Waiting task', kind: 'task-scheduled',
      startsAt: todayAtLocal(9, 0), url: '/tasks?taskId=t-wait', reschedulable: true,
    })
    await act(async () => {
      render(<CalendarToday jobs={[]} onSelectJob={() => {}} />)
    })

    expect(screen.getByText('Waiting task')).toBeDefined()
    expect(screen.getByText(/tasks · task-scheduled/)).toBeDefined()
  })

  it('opens an event owner through the shared client router without reloading the shell', async () => {
    eventFixtures.push({
      id: 't-wait:scheduled', pluginId: 'tasks', title: 'Waiting task', kind: 'task-scheduled',
      startsAt: todayAtLocal(9, 0), url: '/tasks?taskId=t-wait', reschedulable: true,
    })
    render(<CalendarToday jobs={[]} onSelectJob={() => {}} />)
    await settleReact()

    fireEvent.click(screen.getByText('Waiting task'))
    await settleReact()
    fireEvent.click(screen.getByRole('link', { name: /^open$/i }))

    expect(navigationPushes).toEqual(['/tasks?taskId=t-wait'])
  })

  it('reschedules an event through the owner and refetches on success', async () => {
    eventFixtures.push({
      id: 't-wait:scheduled', pluginId: 'tasks', title: 'Waiting task', kind: 'task-scheduled',
      startsAt: todayAtLocal(9, 0), reschedulable: true,
    })
    await act(async () => {
      render(<CalendarToday jobs={[]} onSelectJob={() => {}} />)
    })

    await act(async () => { fireEvent.click(screen.getByText('Waiting task')) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /reschedule/i })) })

    const input = screen.getByLabelText('New date and time') as HTMLInputElement
    fireEvent.change(input, { target: { value: '2026-08-01T10:30' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^reschedule$/i })) })

    expect(postCalls).toHaveLength(1)
    expect(postCalls[0]!.url).toContain('/events/reschedule')
    expect(postCalls[0]!.body).toMatchObject({ pluginId: 'tasks', eventId: 't-wait:scheduled' })
    // Success refetches the feed (initial fetch + post-reschedule refetch).
    expect(fetchCalls.filter(u => u.includes('/occurrences')).length).toBeGreaterThanOrEqual(2)
  })

  it("surfaces the owner's rejection inside the dialog", async () => {
    reschedulePostStatus = 400
    eventFixtures.push({
      id: 't-wait:scheduled', pluginId: 'tasks', title: 'Waiting task', kind: 'task-scheduled',
      startsAt: todayAtLocal(9, 0), reschedulable: true,
    })
    await act(async () => {
      render(<CalendarToday jobs={[]} onSelectJob={() => {}} />)
    })

    await act(async () => { fireEvent.click(screen.getByText('Waiting task')) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /reschedule/i })) })
    fireEvent.change(screen.getByLabelText('New date and time'), { target: { value: '2026-08-01T10:30' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^reschedule$/i })) })

    expect(screen.getByText('owner said no')).toBeDefined()
  })

  it('renders nothing for an occurrence whose job is unknown (stale feed)', async () => {
    occurrenceFixtures.push({ jobId: 'ghost-job', at: todayAtLocal(9, 0), past: false })
    await act(async () => {
      render(<CalendarToday jobs={[makeJob()]} onSelectJob={() => {}} />)
    })

    expect(screen.queryByText('ghost-job')).toBeNull()
  })
})

// restore for co-scheduled files (though --isolate gives each file a fresh global)
afterEach(() => { void realFetch })
