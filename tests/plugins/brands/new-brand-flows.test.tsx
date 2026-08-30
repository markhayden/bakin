// @vitest-environment jsdom
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '../../rtl-settle'
import { settleReact } from '../../rtl-settle'

mock.module('@makinbakin/sdk/patterns', () => ({
  ...require('../../../packages/sdk/src/patterns'),
  AgentSelect: ({
    id,
    onValueChange,
    value,
  }: {
    id?: string
    onValueChange: (value: string) => void
    value: string
  }) => (
    <select id={id} aria-label="Which agent drafts it?" value={value} onChange={(event) => onValueChange(event.target.value)}>
      <option value="">Choose an agent</option>
      <option value="pixel">Pixel</option>
    </select>
  ),
}))

import {
  FromWebsiteDialog,
  ImportBrandDialog,
  NewBrandChooser,
} from '../../../plugins/brands/components/new-brand-flows'

afterEach(() => {
  cleanup()
  mock.restore()
})

describe('brand creation flows', () => {
  it('uses canonical interactive cards for each brands-local creation choice', async () => {
    const onPick = mock()
    render(<NewBrandChooser open onOpenChange={mock()} onPick={onPick} />)

    // Each path is a Card with a whole-surface action: the accessible button
    // is the card's overlay control, and the path identity rides the card.
    const build = await screen.findByRole('button', { name: 'Build my brand' })
    expect(build.dataset.slot).toBe('surface-overlay')
    const card = build.closest('[data-slot="card"]') as HTMLElement | null
    expect(card).not.toBeNull()
    expect(card!.dataset.createPath).toBe('build')
    expect(card!.dataset.interactive).toBe('')
    expect(build.closest('[data-slot="dialog-content"]')).not.toBeNull()

    fireEvent.click(build)
    expect(onPick).toHaveBeenCalledWith('build')
    await settleReact()
  })

  it('composes the website path from the canonical form and field contracts', async () => {
    render(<FromWebsiteDialog open onOpenChange={mock()} onCreated={mock()} />)

    const form = await screen.findByRole('form', { name: 'Create brand from website' })
    expect(form.dataset.slot).toBe('form')
    expect(form.querySelectorAll('[data-slot="field"]').length).toBe(4)
    expect(screen.getByRole('button', { name: 'Create draft' }).getAttribute('type')).toBe('submit')
    await settleReact()
  })

  it('shows an import preview with canonical bounded content and warning feedback', async () => {
    globalThis.fetch = mock(async () => new Response(JSON.stringify({
      preview: {
        id: 'acme',
        name: 'Acme',
        palette: [{ name: 'Primary', hex: '#ff5a00' }],
        rules: 2,
        guidelines: 1,
        lessons: 3,
        assets: 4,
        exists: true,
      },
    }), { status: 200 })) as unknown as typeof fetch

    render(<ImportBrandDialog open onOpenChange={mock()} onImported={mock()} />)
    const form = await screen.findByRole('form', { name: 'Import a brand' })
    expect(form.dataset.slot).toBe('form')

    fireEvent.change(screen.getByRole('textbox', { name: 'Import source' }), {
      target: { value: 'github:acme/brand' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))

    await waitFor(() => expect(document.querySelector('[data-import-preview]')).not.toBeNull())
    expect(document.querySelector('[data-import-preview]')?.getAttribute('data-slot')).toBe('card')
    expect(screen.getByRole('status').textContent).toContain('already exists')
    await settleReact()
  })
})
