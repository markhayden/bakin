// @vitest-environment jsdom
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import '../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'

// Pure jsdom component test — no storage access. Defensive content-dir mocks per
// the repo's test-isolation convention.
const testDir = join(tmpdir(), 'bakin-test-save-bar')
mock.module('../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))
mock.module('../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))

import { SaveBar } from '@makinbakin/sdk/patterns'
import { settleFor } from '../helpers/wait'

afterEach(() => cleanup())

describe('SaveBar', () => {
  it('renders nothing when clean', () => {
    render(<SaveBar dirty={false} onSave={() => {}} onDiscard={() => {}} />)
    expect(document.querySelector('[data-savebar]')).toBeNull()
  })

  it('shows unsaved state with Save + Discard when dirty', () => {
    const onSave = mock()
    const onDiscard = mock()
    render(<SaveBar dirty onSave={onSave} onDiscard={onDiscard} />)
    expect(screen.getByText('Unsaved changes')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(onSave).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(onDiscard).toHaveBeenCalled()
  })

  it('disables actions and shows Saving... while saving', () => {
    render(<SaveBar dirty saving onSave={() => {}} onDiscard={() => {}} />)
    expect(document.querySelector('[data-savebar]')?.getAttribute('data-savebar-state')).toBe('saving')
    expect(screen.getByRole('button', { name: /Saving/ })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Discard' })).toHaveProperty('disabled', true)
  })

  it('renders the save error inline', () => {
    render(<SaveBar dirty error="Save failed (500)" onSave={() => {}} onDiscard={() => {}} />)
    expect(screen.getByText('Save failed (500)')).toBeDefined()
  })

  it('flashes Saved after a successful save, then hides', async () => {
    const { rerender } = render(<SaveBar dirty saving onSave={() => {}} onDiscard={() => {}} />)
    // save lands: no longer saving, draft clean
    rerender(<SaveBar dirty={false} saving={false} onSave={() => {}} onDiscard={() => {}} />)
    expect(screen.getByText('Saved ✓')).toBeDefined()
    expect(document.querySelector('[data-savebar]')?.getAttribute('data-savebar-state')).toBe('saved')
    // The auto-dismiss is a 2s wall-clock timer inside the component; the
    // elapsed window IS the behaviour under test.
    await act(async () => {
      await settleFor(2100, 'outlast the SaveBar 2s auto-dismiss timer')
    })
    expect(document.querySelector('[data-savebar]')).toBeNull()
  })

  it('does not flash when the save failed', () => {
    const { rerender } = render(<SaveBar dirty saving onSave={() => {}} onDiscard={() => {}} />)
    rerender(<SaveBar dirty saving={false} error="boom" onSave={() => {}} onDiscard={() => {}} />)
    expect(screen.queryByText('Saved ✓')).toBeNull()
    expect(screen.getByText('boom')).toBeDefined()
  })

  it('custom save label is honored', () => {
    render(<SaveBar dirty saveLabel="Save brand" onSave={() => {}} onDiscard={() => {}} />)
    expect(screen.getByRole('button', { name: 'Save brand' })).toBeDefined()
  })
})
