// @vitest-environment jsdom
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  AssetPicker,
  ColorPicker,
  DEFAULT_MODEL_VALUE,
  ModelSelect,
  type AssetPickerCollection,
} from '@makinbakin/sdk/patterns'
import '../../rtl-settle'

afterEach(cleanup)

const assets: AssetPickerCollection = {
  status: 'ready',
  assets: [
    { id: 'logo-1', label: 'Primary logo', description: 'Approved brand mark', type: 'image' },
    { id: 'brief-1', label: 'Launch brief', description: 'Campaign notes', type: 'document' },
  ],
}

describe('focused asset picker', () => {
  it('filters controlled inline choices and commits the exact asset id', async () => {
    const onPick = mock(() => {})
    const onQueryChange = mock(() => {})
    const user = userEvent.setup()
    const { rerender } = render(
      <AssetPicker
        variant="inline"
        title="Attach an asset"
        collection={assets}
        query=""
        onQueryChange={onQueryChange}
        onPick={onPick}
        view="list"
      />,
    )

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search assets' }), { target: { value: 'brief' } })
    expect(onQueryChange).toHaveBeenLastCalledWith('brief')
    rerender(
      <AssetPicker
        variant="inline"
        title="Attach an asset"
        collection={assets}
        query="brief"
        onQueryChange={onQueryChange}
        onPick={onPick}
        view="list"
      />,
    )
    expect(screen.queryByText('Primary logo')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Select Launch brief' }))
    expect(onPick).toHaveBeenCalledWith('brief-1')
  })

  it('keeps recoverable errors explicit', async () => {
    const onRetry = mock(() => {})
    render(
      <AssetPicker
        variant="inline"
        collection={{ status: 'error', message: 'The asset library is unavailable.' }}
        query=""
        onQueryChange={() => {}}
        onPick={() => {}}
        onRetry={onRetry}
      />,
    )

    expect(screen.getByRole('alert').textContent).toContain('The asset library is unavailable.')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})

describe('focused model and color pickers', () => {
  it('groups models, exposes the default sentinel, and commits a model id', async () => {
    const onValueChange = mock(() => {})
    const user = userEvent.setup()
    render(
      <ModelSelect
        ariaLabel="Execution model"
        value={DEFAULT_MODEL_VALUE}
        onValueChange={onValueChange}
        defaultLabel="Use workspace default"
        models={[
          { id: 'fast', name: 'Fast model', provider: 'acme-cloud' },
          { id: 'deep', name: 'Deep model', provider: 'research' },
        ]}
      />,
    )

    const trigger = screen.getByRole('combobox', { name: 'Execution model' })
    await user.click(trigger)
    expect(await screen.findByRole('group', { name: 'acme cloud' })).toBeTruthy()
    await user.click(screen.getByRole('option', { name: 'Deep model' }))
    expect(onValueChange).toHaveBeenCalledWith('deep')
  })

  it('uses native radio semantics and rejects URL paint values', async () => {
    const onValueChange = mock(() => {})
    const user = userEvent.setup()
    const { container } = render(
      <ColorPicker
        ariaLabel="Agent color"
        value="safe"
        onValueChange={onValueChange}
        options={[
          { value: 'safe', label: 'Ocean', color: 'var(--bakin-color-data-series-1)' },
          { value: 'unsafe', label: 'Unsafe', color: 'url(https://example.test/paint.svg)' },
        ]}
      />,
    )

    const ocean = screen.getByRole('radio', { name: 'Ocean' })
    const unsafe = screen.getByRole('radio', { name: 'Unsafe' })
    expect(ocean.getAttribute('aria-checked')).toBe('true')
    expect(container.querySelector('[data-color-option="unsafe"] circle[fill]')).toBeNull()
    await user.click(unsafe)
    expect(onValueChange).toHaveBeenCalledWith('unsafe')
  })

  it('keeps an enabled color in the tab order when the selected option is disabled', () => {
    render(
      <ColorPicker
        ariaLabel="Agent color"
        value="retired"
        onValueChange={() => {}}
        options={[
          { value: 'retired', label: 'Retired', color: '#111111', disabled: true },
          { value: 'ocean', label: 'Ocean', color: '#2266cc' },
        ]}
      />,
    )

    expect(screen.getByRole('radio', { name: 'Retired' }).getAttribute('tabindex')).toBe('-1')
    expect(screen.getByRole('radio', { name: 'Ocean' }).getAttribute('tabindex')).toBe('0')
  })
})
