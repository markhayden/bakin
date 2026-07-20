// @vitest-environment jsdom
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '../../rtl-settle'

import {
  ConfirmDialog,
  DangerZone,
  SaveBar,
  UnsavedChangesDialog,
} from '@makinbakin/sdk/patterns'

afterEach(() => cleanup())

describe('destructive and dirty-state patterns', () => {
  it('requires an exact typed value and keeps retryable errors in the confirmation dialog', () => {
    const onConfirm = mock()
    const onCancel = mock()
    render(
      <ConfirmDialog
        open
        title="Delete archived workflow?"
        description="This cannot be undone."
        confirmLabel="Delete workflow"
        confirmValue="launch-publishing"
        error="Deletion failed. Check the runtime and retry."
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )

    expect(screen.getByRole('dialog', { name: 'Delete archived workflow?' })).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('Deletion failed')
    const confirm = screen.getByRole('button', { name: 'Delete workflow' })
    expect(confirm.hasAttribute('disabled')).toBe(true)

    const input = screen.getByLabelText(/Type launch-publishing to confirm/)
    fireEvent.change(input, { target: { value: 'LAUNCH-PUBLISHING' } })
    expect(confirm.hasAttribute('disabled')).toBe(true)
    fireEvent.change(input, { target: { value: 'launch-publishing' } })
    expect(confirm.hasAttribute('disabled')).toBe(false)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('makes dirty, saving, failed, and saved outcomes explicit without duplicating page actions', () => {
    const onSave = mock()
    const onDiscard = mock()
    const { rerender } = render(
      <SaveBar
        dirty
        error="The workflow could not be saved."
        onSave={onSave}
        onDiscard={onDiscard}
      >
        <span>3 fields changed</span>
      </SaveBar>,
    )

    expect(screen.getByRole('region', { name: 'Unsaved changes' })).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('could not be saved')
    expect(screen.getByText('3 fields changed')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry save' }))
    expect(onSave).toHaveBeenCalledTimes(1)

    rerender(<SaveBar dirty saving onSave={onSave} onDiscard={onDiscard} />)
    expect(screen.getByRole('region', { name: 'Saving changes' }).getAttribute('aria-busy')).toBe('true')
    expect(screen.getByRole('button', { name: 'Saving…' }).hasAttribute('disabled')).toBe(true)

    rerender(<SaveBar dirty={false} saving={false} onSave={onSave} onDiscard={onDiscard} />)
    expect(screen.getByRole('status', { name: 'Changes saved' })).toBeTruthy()
  })

  it('keeps a danger zone non-color-specific and delegates irreversible work to typed confirmation', () => {
    const onConfirm = mock()
    render(
      <DangerZone
        headingLevel={2}
        description="Deletes this workflow and its preserved run history."
        confirmLabel="Delete this workflow"
        confirmValue="launch-publishing"
        onConfirm={onConfirm}
      />,
    )

    expect(screen.getByRole('heading', { level: 2, name: 'Danger zone' })).toBeTruthy()
    expect(document.querySelector('[data-slot="danger-zone-signal"]')?.textContent).toBe('!')
    fireEvent.click(screen.getByRole('button', { name: 'Delete this workflow' }))
    fireEvent.change(screen.getByLabelText(/Type launch-publishing to confirm/), {
      target: { value: 'launch-publishing' },
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete this workflow' }).at(-1)!)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('keeps discard, cancel, and optional save decisions distinct in the exit dialog', () => {
    const onDiscard = mock()
    const onCancel = mock()
    const onSave = mock()
    const { rerender } = render(
      <UnsavedChangesDialog
        open
        error="The draft is still unsaved."
        onDiscard={onDiscard}
        onCancel={onCancel}
        onSave={onSave}
      />,
    )

    expect(screen.getByRole('dialog', { name: 'Unsaved changes' })).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('still unsaved')
    fireEvent.click(screen.getByRole('button', { name: 'Save and exit' }))
    expect(onSave).toHaveBeenCalledTimes(1)

    rerender(
      <UnsavedChangesDialog
        open
        busy
        canSaveInPlace={false}
        onDiscard={onDiscard}
        onCancel={onCancel}
        onSave={onSave}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Save and exit' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Discard changes' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(true)
  })
})
