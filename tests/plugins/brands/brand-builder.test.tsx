// @vitest-environment jsdom
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '../../rtl-settle'
import { settleReact } from '../../rtl-settle'

mock.module('@makinbakin/sdk/patterns', () => ({
  ...require('../../../packages/sdk/src/patterns'),
  AgentSelect: ({
    onValueChange,
    value,
  }: {
    onValueChange: (value: string) => void
    value: string
  }) => (
    <select aria-label="Which agent drafts it?" value={value} onChange={(event) => onValueChange(event.target.value)}>
      <option value="">Choose an agent</option>
      <option value="pixel">Pixel</option>
    </select>
  ),
}))

import { BrandBuilder } from '../../../plugins/brands/components/brand-builder'

afterEach(() => {
  cleanup()
  mock.restore()
})

describe('BrandBuilder', () => {
  it('uses one labelled progress contract and canonical fields for each wizard step', async () => {
    render(<BrandBuilder open onOpenChange={mock()} onCreated={mock()} />)

    const progress = screen.getByRole('list', { name: 'Brand creation progress' })
    expect(progress.querySelector('[aria-current="step"]')?.textContent).toContain('Basics')
    expect(document.querySelectorAll('[data-slot="field"]').length).toBe(2)

    fireEvent.change(screen.getByRole('textbox', { name: 'Brand name' }), {
      target: { value: 'Acme' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'What do you sell?' }), {
      target: { value: 'Tools for independent studios' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(progress.querySelector('[aria-current="step"]')?.textContent).toContain('Voice')
    expect(screen.getByRole('textbox', { name: 'Audience' })).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    const draftStatus = screen.getByText('Draft').closest('[data-status-badge]')
    expect(progress.querySelector('[aria-current="step"]')?.textContent).toContain('Review')
    expect(draftStatus?.getAttribute('data-variant')).toBe('solid')
    await settleReact()
  })
})
