/**
 * HandoffCard (self-healing PR1 slice 1.4c): the exact command, copyable;
 * "Open in Terminal" only when the host provides it; busy and error states.
 */
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '../rtl-settle'

import { HandoffCard } from '@makinbakin/sdk/patterns'

afterEach(cleanup)

describe('HandoffCard', () => {
  it('names the step, shows the command verbatim with a copy action, and offers no terminal without a handler', () => {
    render(<HandoffCard title="Sign in to the model provider" description="Run Pi and sign in." command="pi /login" cwd="~/.bakin" />)
    const card = screen.getByRole('region', { name: 'Sign in to the model provider' })
    expect(within(card).getByText('pi /login')).toBeTruthy()
    expect(within(card).getByRole('button', { name: /copy/i })).toBeTruthy()
    expect(within(card).queryByRole('button', { name: 'Open in Terminal' })).toBeNull()
    expect(within(card).getByText('~/.bakin')).toBeTruthy()
  })
  it('with a handler the terminal action calls it; busy disables it; an error is announced and the copy block stays', () => {
    const onOpenTerminal = mock()
    const { rerender } = render(<HandoffCard command="gh auth login" onOpenTerminal={onOpenTerminal} />)
    expect(screen.getByRole('region', { name: 'Run this yourself' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open in Terminal' }))
    expect(onOpenTerminal).toHaveBeenCalledTimes(1)
    rerender(<HandoffCard command="gh auth login" onOpenTerminal={onOpenTerminal} busy />)
    expect((screen.getByRole('button', { name: 'Opening…' }) as HTMLButtonElement).disabled).toBe(true)
    rerender(<HandoffCard command="gh auth login" onOpenTerminal={onOpenTerminal} error="The Terminal plugin refused to start a session." />)
    expect(screen.getByRole('alert').textContent).toContain('refused to start a session')
    expect(screen.getByText('gh auth login')).toBeTruthy()
  })
  it('onCopied runs only after the clipboard write succeeds — a refused write reports nothing', async () => {
    const onCopied = mock()
    const clipboardBefore = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    const execBefore = (document as { execCommand?: unknown }).execCommand
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new Error('denied') } }, configurable: true })
    ;(document as { execCommand?: unknown }).execCommand = () => false
    try {
      render(<HandoffCard command="pi /login" onCopied={onCopied} />)
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy Command' })) })
      expect(onCopied).not.toHaveBeenCalled()
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => {} }, configurable: true })
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy Command' })) })
      expect(onCopied).toHaveBeenCalledTimes(1)
    } finally {
      if (clipboardBefore) Object.defineProperty(navigator, 'clipboard', clipboardBefore)
      else delete (navigator as { clipboard?: unknown }).clipboard
      ;(document as { execCommand?: unknown }).execCommand = execBefore
    }
  })
})
