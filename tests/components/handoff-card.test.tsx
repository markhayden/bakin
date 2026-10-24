/**
 * HandoffCard (self-healing PR1 slice 1.4c): the exact command, copyable;
 * "Open in Terminal" only when the host provides it; busy and error states.
 */
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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
})
