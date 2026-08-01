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
import '../../rtl-settle'

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

mock.module('@makinbakin/sdk/components', () => ({
  AgentAvatar: ({ agentId }: { agentId: string }) => <span>{agentId}</span>,
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

afterEach(() => {
  occurrenceFixtures.length = 0
  eventFixtures.length = 0
  fetchCalls.length = 0
  postCalls.length = 0
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
    expect(screen.getByText('11:05pm')).toBeDefined()
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
    expect(screen.getByTitle('Fired')).toBeDefined()
  })

  it('Week: a skipped past beat carries its skip reason', async () => {
    occurrenceFixtures.push({
      jobId: 'late-night-release', at: todayAtLocal(23, 5), past: true,
      disposition: 'skipped', skipReason: 'overlap',
    })
    await act(async () => {
      render(<CalendarWeekly jobs={[makeJob()]} onSelectJob={() => {}} />)
    })

    expect(screen.getByTitle('Skipped — overlap')).toBeDefined()
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
