// @vitest-environment jsdom

import { describe, expect, it, mock } from 'bun:test'
import { act } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import '../rtl-settle'
import { actRender } from '../rtl-settle'
import { SecretSlotField, type SecretSlotRow } from '../../src/components/secret-slot-field'

const base: SecretSlotRow = {
  provider: 'discord',
  name: 'botToken',
  label: 'Discord bot token',
  description: 'Bot token for the Bakin delivery bridge.',
  envVar: 'DISCORD_BOT_TOKEN',
  injectEnv: false,
  owner: { label: 'Settings → Channels', href: '/settings?tab=channels' },
  status: { present: false, source: null },
}

describe('SecretSlotField', () => {
  it('shows Not set with a disabled Set until a value is typed, then submits on Enter', async () => {
    const onSet = mock(async (_value: string) => true)
    await actRender(() => render(<SecretSlotField slot={base} busy={false} onSet={onSet} onClear={async () => true} />))

    expect(screen.getByText('Not set')).toBeTruthy()
    const input = screen.getByLabelText('Discord bot token value') as HTMLInputElement
    expect(input.type).toBe('password')
    const set = screen.getByRole('button', { name: 'Set Discord bot token' })
    expect(set.hasAttribute('disabled')).toBe(true)
    expect(screen.queryByRole('button', { name: 'Clear Discord bot token' })).toBeNull()

    fireEvent.change(input, { target: { value: ' tok-1 ' } })
    expect(set.hasAttribute('disabled')).toBe(false)
    await act(async () => { fireEvent.submit(screen.getByRole('form', { name: 'Set Discord bot token' })) })
    expect(onSet).toHaveBeenCalledWith('tok-1')
    // A successful set clears the draft so the value never lingers in the DOM.
    expect(input.value).toBe('')
  })

  it('shows Bakin store with Replace + Clear when the store holds it', async () => {
    const onClear = mock(async () => true)
    await actRender(() => render(
      <SecretSlotField slot={{ ...base, status: { present: true, source: 'store' } }} busy={false} onSet={async () => true} onClear={onClear} />,
    ))
    expect(screen.getByText('Bakin store')).toBeTruthy()
    expect((screen.getByLabelText('Discord bot token value') as HTMLInputElement).placeholder).toMatch(/Replace/)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Clear Discord bot token' })) })
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('shows Environment, hides the input, and explains precedence when the env var supplies it', async () => {
    await actRender(() => render(
      <SecretSlotField slot={{ ...base, status: { present: true, source: 'env' } }} busy={false} onSet={async () => true} onClear={async () => true} />,
    ))
    expect(screen.getByText('Environment')).toBeTruthy()
    expect(screen.queryByLabelText('Discord bot token value')).toBeNull()
    expect(screen.getByText(/set by DISCORD_BOT_TOKEN/)).toBeTruthy()
  })

  it('disables every control while busy', async () => {
    await actRender(() => render(
      <SecretSlotField slot={{ ...base, status: { present: true, source: 'store' } }} busy onSet={async () => true} onClear={async () => true} />,
    ))
    expect(screen.getByLabelText('Discord bot token value').hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Clear Discord bot token' }).hasAttribute('disabled')).toBe(true)
  })

  it('links to the owning settings surface when asked', async () => {
    await actRender(() => render(
      <SecretSlotField slot={base} busy={false} showOwner onSet={async () => true} onClear={async () => true} />,
    ))
    const link = screen.getByRole('link', { name: 'Settings → Channels' })
    expect(link.getAttribute('href')).toBe('/settings?tab=channels')
  })
})
