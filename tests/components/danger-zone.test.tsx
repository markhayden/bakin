// @vitest-environment jsdom
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'

// Pure jsdom component test — no storage access. Defensive content-dir mocks per
// the repo's test-isolation convention.
const testDir = join(tmpdir(), 'bakin-test-danger-zone')
mock.module('../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))
mock.module('../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))

import { DangerZone } from '../../src/components/danger-zone'

afterEach(() => cleanup())

function renderZone(onConfirm = mock()) {
  render(
    <DangerZone
      description="Deletes the brand. Tasks linked to it will pause."
      confirmLabel="Delete this brand"
      confirmValue="acme"
      onConfirm={onConfirm}
    />,
  )
  return onConfirm
}

describe('DangerZone', () => {
  it('renders the section with description and destructive trigger', () => {
    renderZone()
    expect(screen.getByText('Danger zone')).toBeDefined()
    expect(screen.getByText(/Tasks linked to it will pause/)).toBeDefined()
    expect(document.querySelector('[data-danger-zone]')).not.toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens the confirm dialog and keeps confirm disabled until the exact value is typed', () => {
    const onConfirm = renderZone()
    fireEvent.click(screen.getByRole('button', { name: 'Delete this brand' }))
    expect(screen.getByRole('dialog')).toBeDefined()

    const confirmBtn = screen.getByTestId('danger-zone-confirm')
    expect(confirmBtn).toHaveProperty('disabled', true)

    const input = screen.getByPlaceholderText('acme')
    fireEvent.change(input, { target: { value: 'acm' } })
    expect(screen.getByTestId('danger-zone-confirm')).toHaveProperty('disabled', true)

    fireEvent.change(input, { target: { value: 'acme' } })
    const armed = screen.getByTestId('danger-zone-confirm')
    expect(armed).toHaveProperty('disabled', false)
    fireEvent.click(armed)
    expect(onConfirm).toHaveBeenCalled()
  })

  it('forgets the typed value after cancel (reopen starts disarmed)', () => {
    renderZone()
    fireEvent.click(screen.getByRole('button', { name: 'Delete this brand' }))
    fireEvent.change(screen.getByPlaceholderText('acme'), { target: { value: 'acme' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Delete this brand' }))
    expect(screen.getByTestId('danger-zone-confirm')).toHaveProperty('disabled', true)
    expect((screen.getByPlaceholderText('acme') as HTMLInputElement).value).toBe('')
  })
})
