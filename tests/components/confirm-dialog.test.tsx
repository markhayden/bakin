// @vitest-environment jsdom
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'

// Pure jsdom component test — no storage access. Defensive content-dir mocks per
// the repo's test-isolation convention.
const testDir = join(tmpdir(), 'bakin-test-confirm-dialog')
mock.module('../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))
mock.module('../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))

import { ConfirmDialog } from '@makinbakin/sdk/patterns'

afterEach(() => cleanup())

describe('ConfirmDialog', () => {
  it('renders nothing when closed', () => {
    render(<ConfirmDialog open={false} title="Delete thing" onConfirm={() => {}} onCancel={() => {}} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders title, description, and default Delete/Cancel labels when open', () => {
    render(
      <ConfirmDialog open title="Delete thing" description="This cannot be undone." onConfirm={() => {}} onCancel={() => {}} />,
    )
    expect(screen.getByText('Delete thing')).toBeDefined()
    expect(screen.getByText('This cannot be undone.')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDefined()
  })

  it('honors a custom confirm label and fires the callbacks', () => {
    const onConfirm = mock()
    const onCancel = mock()
    render(<ConfirmDialog open title="t" confirmLabel="Delete Agent" onConfirm={onConfirm} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete Agent' }))
    expect(onConfirm).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('disables both buttons and shows the busy label while busy', () => {
    render(<ConfirmDialog open title="t" busy busyLabel="Deleting..." onConfirm={() => {}} onCancel={() => {}} />)
    expect(screen.getByText('Deleting...')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: /Deleting/ })).toHaveProperty('disabled', true)
  })

  it('renders an inline error', () => {
    render(<ConfirmDialog open title="t" error="Delete failed" onConfirm={() => {}} onCancel={() => {}} />)
    expect(screen.getByText('Delete failed')).toBeDefined()
  })

  it('cancels on the canonical close control when idle, but not while busy', () => {
    const onCancel = mock()
    const { rerender } = render(<ConfirmDialog open title="t" onConfirm={() => {}} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }))
    expect(onCancel).toHaveBeenCalledTimes(1)

    rerender(<ConfirmDialog open busy title="t" onConfirm={() => {}} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }))
    expect(onCancel).toHaveBeenCalledTimes(1) // unchanged — busy blocks self-close
  })

  it('forwards a confirm test id', () => {
    render(<ConfirmDialog open title="t" confirmTestId="my-confirm" onConfirm={() => {}} onCancel={() => {}} />)
    expect(screen.getByTestId('my-confirm')).toBeDefined()
  })

  it('confirmValue gates the confirm button until the exact value is typed', () => {
    const onConfirm = mock()
    render(
      <ConfirmDialog open title="t" confirmValue="acme" confirmTestId="typed-confirm" onConfirm={onConfirm} onCancel={() => {}} />,
    )
    expect(screen.getByTestId('typed-confirm')).toHaveProperty('disabled', true)
    fireEvent.change(screen.getByPlaceholderText('acme'), { target: { value: 'ACME' } })
    expect(screen.getByTestId('typed-confirm')).toHaveProperty('disabled', true) // exact match only
    fireEvent.change(screen.getByPlaceholderText('acme'), { target: { value: 'acme' } })
    expect(screen.getByTestId('typed-confirm')).toHaveProperty('disabled', false)
    fireEvent.click(screen.getByTestId('typed-confirm'))
    expect(onConfirm).toHaveBeenCalled()
  })

  it('without confirmValue no typed input renders (existing consumers untouched)', () => {
    render(<ConfirmDialog open title="t" onConfirm={() => {}} onCancel={() => {}} />)
    expect(document.querySelector('[data-confirm-typed]')).toBeNull()
  })
})
