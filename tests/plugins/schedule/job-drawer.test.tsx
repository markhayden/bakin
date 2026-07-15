// @vitest-environment jsdom
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { fireEvent, render, screen } from '@testing-library/react'
import '../../rtl-settle'

mock.module('@makinbakin/sdk/hooks', () => ({
  useAgent: (id: string) => id ? { id, name: id } : null,
}))

mock.module('@makinbakin/sdk/components', () => ({
  AgentAvatar: ({ agentId }: { agentId: string }) => <span>{agentId}</span>,
  BakinDrawer: ({
    open,
    title,
    actions,
    children,
  }: {
    open: boolean
    title?: React.ReactNode
    actions?: React.ReactNode
    children?: React.ReactNode
  }) => open ? (
    <section>
      <div>{title}</div>
      <div>{actions}</div>
      <div>{children}</div>
    </section>
  ) : null,
}))

mock.module('@makinbakin/sdk/ui', () => ({
  Badge: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  Button: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
  Separator: () => <hr />,
  DropdownMenu: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children?: React.ReactNode }) => <button>{children}</button>,
  DropdownMenuContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children?: React.ReactNode
    onClick?: () => void
  }) => <button onClick={onClick}>{children}</button>,
  DropdownMenuSeparator: () => <hr />,
}))

mock.module('@bakin/schedule/components/run-history', () => ({
  RunHistory: () => <div>Run history</div>,
}))

mock.module('@bakin/schedule/components/pause-controls', () => ({
  PauseControls: () => <div>Pause controls</div>,
}))

import { JobDrawer } from '../../../plugins/schedule/components/job-drawer'
import type { ScheduleJob } from '../../../src/hooks/use-schedule'

function makeJob(overrides: Partial<ScheduleJob> = {}): ScheduleJob {
  return {
    id: 'job-delete',
    displayName: 'Delete me',
    agentId: 'main',
    humanSchedule: 'Every day at 9am',
    cron: '0 9 * * *',
    paused: false,
    enabled: true,
    isBakinJob: true,
    allowOverlap: false,
    maxFailures: 3,
    consecutiveFailures: 0,
    ...overrides,
  }
}

describe('JobDrawer', () => {
  it('requests deletion from the drawer actions menu', () => {
    const onDelete = mock()
    const onClose = mock()

    render(
      <JobDrawer
        job={makeJob()}
        open
        onClose={onClose}
        onPause={mock(async () => true)}
        onResume={mock(async () => true)}
        onDelete={onDelete}
        onRunNow={mock(async () => true)}
        onEdit={mock()}
        onDuplicate={mock()}
        onAdopt={mock()}
        onRestoreNative={mock(async () => true)}
        onSkipNext={mock(async () => true)}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /delete/i }))

    expect(onDelete).toHaveBeenCalledWith('job-delete')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows the completed state for a fired one-shot (no Next run)', () => {
    render(
      <JobDrawer
        job={makeJob({
          id: 'job-once',
          displayName: 'One-shot reminder',
          humanSchedule: 'Once at 2026-06-07T15:00:00.000Z',
          cron: undefined,
          enabled: false,
          completed: true,
          completedAt: '2026-06-07T15:00:00.000Z',
          nextRun: undefined,
        })}
        open
        onClose={mock()}
        onPause={mock(async () => true)}
        onResume={mock(async () => true)}
        onDelete={mock()}
        onRunNow={mock(async () => true)}
        onEdit={mock()}
        onDuplicate={mock()}
        onAdopt={mock()}
        onRestoreNative={mock(async () => true)}
        onSkipNext={mock(async () => true)}
      />,
    )

    expect(screen.getByText('Completed')).toBeTruthy()
    expect(screen.getByText(/Ran once/)).toBeTruthy()
    expect(screen.queryByText('Active')).toBeNull()
    expect(screen.queryByText('Disabled')).toBeNull()
    expect(screen.queryByText(/^Next:/)).toBeNull()
  })
})
