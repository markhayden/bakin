// @vitest-environment jsdom
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { fireEvent, render, screen } from '@testing-library/react'
import '../../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'

// Pure jsdom component test — no storage access. Defensive content-dir mocks per convention.
const testDir = join(tmpdir(), 'bakin-test-delete-schedule-dialog')
mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))

// DeleteScheduleDialog now delegates to the shared ConfirmDialog (WS3b A3); mock it to a
// minimal renderer so this test verifies the title/description/labels the component contributes.
import { DeleteScheduleDialog } from '../../../plugins/schedule/components/delete-schedule-dialog'

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
