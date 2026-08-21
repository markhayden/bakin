/**
 * Button `busy` public contract.
 *
 * Eight refresh buttons hand-rolled `RefreshCw className={x ? 'animate-spin' : ''}`
 * with no announcement, no activation guard, and (once) no reduced-motion
 * fallback. The prop pins the shape they now share: aria-busy, inert but
 * focusable, leading icon in motion. Spinner stays the indicator for content
 * that is loading; busy is for the control the user just pressed.
 */
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '../../rtl-settle'

import { Button, Form, SubmitButton } from '@makinbakin/sdk/ui'

afterEach(() => cleanup())

function Icon() {
  return <svg data-testid="icon" aria-hidden="true" />
}

describe('Button busy contract', () => {
  it('announces the in-flight action and stops accepting activation', () => {
    const onClick = mock(() => {})
    render(<Button busy onClick={onClick}><Icon />Refresh</Button>)
    const button = screen.getByRole('button', { name: 'Refresh' })
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(button.hasAttribute('data-busy')).toBe(true)
    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('stays in the tab order while busy so keyboard focus is not dropped mid-action', () => {
    render(<Button busy><Icon />Refresh</Button>)
    const button = screen.getByRole('button', { name: 'Refresh' })
    // Inert, not removed: aria-disabled rather than the disabled attribute.
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(button.hasAttribute('disabled')).toBe(false)
    expect(button.tabIndex).toBe(0)
  })

  it('is a plain button when not busy', () => {
    const onClick = mock(() => {})
    render(<Button onClick={onClick}><Icon />Refresh</Button>)
    const button = screen.getByRole('button', { name: 'Refresh' })
    expect(button.getAttribute('aria-busy')).toBeNull()
    expect(button.hasAttribute('data-busy')).toBe(false)
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('keeps the real disabled attribute on a busy SubmitButton so implicit submission cannot double-fire', () => {
    render(
      <Form aria-label="Settings" onSubmit={(event) => event.preventDefault()}>
        <SubmitButton busy busyLabel="Saving…">Save</SubmitButton>
      </Form>,
    )
    const submit = screen.getByRole('button', { name: 'Saving…' })
    expect(submit.getAttribute('aria-busy')).toBe('true')
    expect(submit.hasAttribute('disabled')).toBe(true)
  })
})
