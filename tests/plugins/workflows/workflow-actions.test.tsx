// @vitest-environment jsdom

import { afterEach, describe, expect, it, mock } from 'bun:test'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { settleReact } from '../../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-workflow-actions-${Date.now()}`)

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
mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  resetContentDir: mock(),
  initBakinHome: mock(),
  isUsingBakinHome: () => false,
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  resetContentDir: mock(),
  initBakinHome: mock(),
  isUsingBakinHome: () => false,
}))

import { ManagedWorkflowCopyDialog } from '../../../plugins/workflows/components/managed-workflow-copy-dialog'
import { WorkflowDeleteAction } from '../../../plugins/workflows/components/workflow-delete-action'

describe('workflow action components', () => {
  it('collects copy metadata before creating a managed workflow copy', async () => {
    const onCopyNameChange = mock()
    const onCopyIdChange = mock()
    const onDisableOriginalChange = mock()
    const onCancel = mock()
    const onCreate = mock()
    await act(async () => {
      render(
        <ManagedWorkflowCopyDialog
          open
          creating={false}
          copyName="Video Script Copy"
          copyId="video-script-copy"
          disableOriginal
          onOpenChange={() => {}}
          onCopyNameChange={onCopyNameChange}
          onCopyIdChange={onCopyIdChange}
          onDisableOriginalChange={onDisableOriginalChange}
          onCancel={onCancel}
          onCreate={onCreate}
        />,
      )
    })

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Edit managed workflow')).toBeDefined()
    expect(within(dialog).getByText(/Bakin will create a custom copy/i)).toBeDefined()

    await act(async () => {
      fireEvent.change(within(dialog).getByLabelText(/copy name/i), {
        target: { value: 'Draft Script Copy' },
      })
    })
    await act(async () => {
      fireEvent.change(within(dialog).getByLabelText(/workflow id/i), {
        target: { value: 'draft-script-copy' },
      })
    })
    await act(async () => { fireEvent.click(within(dialog).getByRole('checkbox')) })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: /create copy/i })) })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: /back/i })) })

    expect(onCopyNameChange).toHaveBeenCalledWith('Draft Script Copy')
    expect(onCopyIdChange).toHaveBeenCalledWith('draft-script-copy')
    expect(onDisableOriginalChange).toHaveBeenCalledWith(false)
    expect(onCreate).toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalled()
  })

  it('uses a confirmation dialog for workflow deletion and closes after success', async () => {
    const onDelete = mock(() => Promise.resolve(true))
    const onClearError = mock()
    await act(async () => {
      render(
        <WorkflowDeleteAction
          workflowName="Video Script Copy"
          error="Previous delete failed"
          onClearError={onClearError}
          onDelete={onDelete}
        />,
      )
    })

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /delete workflow/i })) })
    expect(onClearError).toHaveBeenCalled()
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/Video Script Copy/)).toBeDefined()
    expect(within(dialog).getByText('Previous delete failed')).toBeDefined()

    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: /^delete$/i })) })

    expect(onDelete).toHaveBeenCalled()
    // Drain the scheduler before polling: the close re-render resumes via
    // the scheduler's MessageChannel, which waitFor's timers can't join —
    // under CI worker contention this wedged past the 15s harness timeout
    // (rc.21 release attempt 3).
    await settleReact()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('keeps the delete confirmation open when deletion reports failure', async () => {
    const onDelete = mock(() => Promise.resolve(false))
    await act(async () => {
      render(
        <WorkflowDeleteAction
          workflowName="Video Script Copy"
          onDelete={onDelete}
        />,
      )
    })

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /delete workflow/i })) })
    const dialog = screen.getByRole('dialog')
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: /^delete$/i })) })

    expect(onDelete).toHaveBeenCalled()
    await settleReact()
    await waitFor(() => expect(screen.getByRole('dialog')).toBeDefined())
  })
})
