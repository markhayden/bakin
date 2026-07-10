// @vitest-environment jsdom
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import '../../rtl-settle'

mock.module('@makinbakin/sdk/hooks', () => ({
  useAgent: (id: string) => id ? { id, name: id } : null,
}))

mock.module('@makinbakin/sdk/components', () => ({
  AgentAvatar: ({ agentId }: { agentId: string }) => <span>{agentId}</span>,
}))

import { CalendarToday } from '../../../plugins/schedule/components/calendar-today'
import { CalendarWeekly } from '../../../plugins/schedule/components/calendar-weekly'
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

afterEach(() => {
  cleanup()
})

describe('Schedule calendar views', () => {
  it('shows jobs scheduled after 10pm in the Today timeline', () => {
    render(<CalendarToday jobs={[makeJob()]} onSelectJob={() => {}} />)

    expect(screen.getByText('11 PM')).toBeDefined()
    expect(screen.getByText('Late night release')).toBeDefined()
    expect(screen.getByText('11:05pm')).toBeDefined()
  })

  it('shows jobs scheduled after 10pm in the Week grid', () => {
    render(<CalendarWeekly jobs={[makeJob()]} onSelectJob={() => {}} />)

    expect(screen.getByText('11 PM')).toBeDefined()
    expect(screen.getAllByText('Late night release').length).toBeGreaterThan(0)
    expect(screen.getAllByText('11:05pm').length).toBeGreaterThan(0)
  })
})
