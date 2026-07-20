// @vitest-environment jsdom
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '../../rtl-settle'

import {
  Banner,
  Button,
  Skeleton,
  SystemState,
  Toast,
  ToastRegion,
} from '@makinbakin/sdk/ui'

afterEach(() => cleanup())

describe('SystemState public contract', () => {
  it('provides useful defaults and announces only dynamic states by default', () => {
    const { rerender } = render(<SystemState kind="loading" />)

    let state = screen.getByRole('status', { name: 'Loading' })
    expect(state.getAttribute('aria-live')).toBe('polite')
    expect(state.getAttribute('aria-atomic')).toBe('true')
    expect(state.getAttribute('aria-busy')).toBe('true')
    expect(screen.getByText('The latest information will appear here when it is ready.')).toBeTruthy()

    rerender(
      <SystemState
        kind="no-results"
        action={<Button>Clear filters</Button>}
      />,
    )
    state = screen.getByRole('status', { name: 'No results' })
    expect(state.getAttribute('aria-live')).toBe('polite')
    expect(state.hasAttribute('aria-busy')).toBe(false)
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeTruthy()

    rerender(<SystemState kind="initial-empty" {...({ role: 'alert', 'aria-live': 'assertive' } as Record<string, string>)} />)
    const initial = screen.getByText('Nothing here yet').closest('[data-slot="system-state"]')
    expect(initial?.hasAttribute('role')).toBe(false)
    expect(initial?.hasAttribute('aria-live')).toBe(false)

    rerender(<SystemState kind="permission-denied" />)
    const permission = screen.getByText('Access restricted').closest('[data-slot="system-state"]')
    expect(permission?.hasAttribute('role')).toBe(false)
    expect(screen.getByText('You do not have permission to view this content.')).toBeTruthy()
  })

  it('makes recoverable errors urgent and terminal errors explicit', () => {
    const { rerender } = render(
      <SystemState kind="error" action={<Button>Try again</Button>} />,
    )

    let state = screen.getByRole('alert', { name: 'Something went wrong' })
    expect(state.getAttribute('aria-live')).toBe('assertive')
    expect(state.getAttribute('data-recovery')).toBe('available')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()

    rerender(
      <SystemState
        kind="error"
        recovery="unavailable"
        title="Archived run is unavailable"
        description="This run was removed by the retention policy."
      />,
    )
    state = screen.getByRole('alert', { name: 'Archived run is unavailable' })
    expect(state.getAttribute('data-recovery')).toBe('unavailable')
    expect(state.querySelector('[data-slot="system-state-actions"]')).toBeNull()
  })

  it('supports scope, heading hierarchy, skeleton previews, and deliberate announcement overrides', () => {
    render(
      <SystemState
        kind="loading"
        scope="inline"
        headingLevel={3}
        announce="off"
        title="Refreshing task history"
        description="Existing rows remain available."
        preview={<Skeleton shape="text" className="w-full" />}
      />,
    )

    const heading = screen.getByRole('heading', { level: 3, name: 'Refreshing task history' })
    const state = heading.closest('[data-slot="system-state"]')
    expect(state?.getAttribute('data-scope')).toBe('inline')
    expect(state?.hasAttribute('role')).toBe(false)
    expect(state?.getAttribute('aria-busy')).toBe('true')
    expect(state?.querySelector('[data-slot="system-state-preview"] [data-slot="skeleton"]')?.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('Banner public contract', () => {
  it('keeps persistent notices quiet and gives opt-in updates the requested urgency', () => {
    const { rerender } = render(
      <Banner
        tone="attention"
        title="Dispatch is paused"
        description="Queued work remains visible."
        {...({ role: 'alert', 'aria-live': 'assertive' } as Record<string, string>)}
      />,
    )

    let banner = screen.getByText('Dispatch is paused').closest('[data-slot="banner"]')
    expect(banner?.hasAttribute('role')).toBe(false)
    expect(banner?.hasAttribute('aria-live')).toBe(false)

    rerender(
      <Banner
        tone="danger"
        announce="assertive"
        title="Runtime disconnected"
        description="Reconnect before starting more work."
        action={<Button variant="outline">Reconnect</Button>}
      />,
    )
    banner = screen.getByRole('alert', { name: 'Runtime disconnected' })
    expect(banner.getAttribute('aria-live')).toBe('assertive')
    expect(banner.getAttribute('aria-describedby')).toBe(screen.getByText('Reconnect before starting more work.').id)
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeTruthy()
  })
})

describe('Toast presentation contract', () => {
  it('labels the owning region, maps urgency by tone, and exposes an accessible dismiss action', () => {
    const dismiss = mock(() => {})
    render(
      <ToastRegion label="Task notifications">
        <Toast tone="success" title="Task created" description="Draft brief is ready." />
        <Toast tone="error" description="The workflow could not be started." onDismiss={dismiss} />
      </ToastRegion>,
    )

    const region = screen.getByRole('region', { name: 'Task notifications' })
    expect(region.getAttribute('aria-relevant')).toBe('additions removals')

    const success = screen.getByRole('status', { name: 'Task created' })
    expect(success.getAttribute('aria-live')).toBe('polite')

    const error = screen.getByRole('alert', { name: 'Action failed' })
    expect(error.getAttribute('aria-live')).toBe('assertive')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }))
    expect(dismiss).toHaveBeenCalled()
  })
})
