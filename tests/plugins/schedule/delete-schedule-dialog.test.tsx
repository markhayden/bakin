// @vitest-environment jsdom
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

mock.module('@makinbakin/sdk/ui', () => ({
  Dialog: ({ open, children }: { open: boolean; children?: React.ReactNode }) => open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children?: React.ReactNode }) => <div role="dialog">{children}</div>,
  DialogHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children?: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children?: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children?: React.ReactNode
    onClick?: () => void
    disabled?: boolean
  }) => <button onClick={onClick} disabled={disabled}>{children}</button>,
}))

import { DeleteScheduleDialog } from '../../../plugins/schedule/components/delete-schedule-dialog'

afterEach(() => {
  cleanup()
})

describe('DeleteScheduleDialog', () => {
  it('renders the standard destructive confirmation dialog', () => {
    const onConfirm = mock()
    const onCancel = mock()

    render(
      <DeleteScheduleDialog
        job={{ id: 'job-delete', displayName: 'Delete candidate' }}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )

    expect(screen.getByRole('dialog')).toBeDefined()
    expect(screen.getByText('Delete scheduled job')).toBeDefined()
    expect(screen.getByText(/Delete candidate/)).toBeDefined()
    expect(screen.getByText(/runtime cron job and Bakin schedule records/)).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onConfirm).toHaveBeenCalled()
  })
})
