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
  ToastAction,
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

  it('gives page-scoped replacement states a useful vertical region', () => {
    render(
      <SystemState
        kind="initial-empty"
        scope="page"
        title="No memory yet"
        description="The first durable lesson will appear here."
      />,
    )

    const state = screen.getByText('No memory yet').closest('[data-slot="system-state"]')
    expect(state?.className).toContain('min-h-[calc(var(--bakin-layout-space-8)*12)]')
    expect(state?.className).toContain('flex-1')
  })

  it('maps inline scope to the compact presentation and keeps full states distinct', () => {
    const { rerender } = render(
      <SystemState
        kind="initial-empty"
        scope="inline"
        title="No custom workflows yet"
        description="Matching workflows will appear here."
      />,
    )

    let state = screen.getByText('No custom workflows yet').closest('[data-slot="system-state"]')
    const copy = state?.querySelector('[data-slot="system-state-copy"]')
    expect(state?.getAttribute('data-presentation')).toBe('compact')
    expect(state?.getAttribute('data-align')).toBe('center')
    expect(state?.className.split(' ')).toContain('w-full')
    expect(state?.className).toContain('items-center')
    expect(state?.className).toContain('text-center')
    expect(state?.className).toContain('px-bakin-4')
    expect(copy).not.toBeNull()

    rerender(
      <SystemState
        kind="initial-empty"
        scope="section"
        title="No workflows yet"
      />,
    )

    state = screen.getByText('No workflows yet').closest('[data-slot="system-state"]')
    expect(state?.getAttribute('data-presentation')).toBe('full')
  })

  it('drops the status dot on empty kinds and keeps it for dynamic states', () => {
    const { rerender } = render(
      <SystemState kind="initial-empty" title="No workflows yet" />,
    )

    let state = screen.getByText('No workflows yet').closest('[data-slot="system-state"]')
    expect(state?.querySelector('[data-slot="system-state-signal"]')).toBeNull()

    rerender(
      <SystemState
        kind="no-results"
        title="No workflows match"
        action={<Button variant="outline">Clear filters</Button>}
      />,
    )
    state = screen.getByText('No workflows match').closest('[data-slot="system-state"]')
    expect(state?.querySelector('[data-slot="system-state-signal"]')).toBeNull()

    rerender(<SystemState kind="loading" title="Loading workflows" />)
    state = screen.getByText('Loading workflows').closest('[data-slot="system-state"]')
    expect(state?.querySelector('[data-slot="system-state-signal"]')).not.toBeNull()

    rerender(
      <SystemState kind="error" title="Refresh failed" action={<Button>Try again</Button>} />,
    )
    state = screen.getByText('Refresh failed').closest('[data-slot="system-state"]')
    expect(state?.querySelector('[data-slot="system-state-signal"]')).not.toBeNull()
  })

  it('supports alignment overrides and a custom icon above the copy', () => {
    const { rerender } = render(
      <SystemState
        kind="initial-empty"
        align="left"
        title="No lessons yet"
        icon={<svg data-testid="empty-glyph" viewBox="0 0 16 16" />}
      />,
    )

    let state = screen.getByText('No lessons yet').closest('[data-slot="system-state"]')
    expect(state?.getAttribute('data-align')).toBe('left')
    expect(state?.className).toContain('items-start')
    expect(state?.className).toContain('text-left')

    const icon = state?.querySelector('[data-slot="system-state-icon"]')
    const copy = state?.querySelector('[data-slot="system-state-copy"]')
    expect(icon).not.toBeNull()
    expect(icon?.getAttribute('aria-hidden')).toBe('true')
    expect(icon?.querySelector('[data-testid="empty-glyph"]')).not.toBeNull()
    expect(
      icon!.compareDocumentPosition(copy!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0)

    rerender(
      <SystemState
        kind="loading"
        align="right"
        title="Loading lessons"
        icon={<svg data-testid="loading-glyph" viewBox="0 0 16 16" />}
      />,
    )
    state = screen.getByText('Loading lessons').closest('[data-slot="system-state"]')
    expect(state?.getAttribute('data-align')).toBe('right')
    expect(state?.querySelector('[data-slot="system-state-icon"]')).not.toBeNull()
    expect(state?.querySelector('[data-slot="system-state-signal"]')).toBeNull()
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

  it('claims full width so shrink-to-fit parents cannot collapse the minmax(0,1fr) copy column', () => {
    render(<Banner tone="info" title="Scheduled maintenance" />)
    const banner = screen.getByText('Scheduled maintenance').closest('[data-slot="banner"]')
    expect(banner?.className.split(' ')).toContain('w-full')
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

  it('claims full width and gives the copy column an intrinsic contribution', () => {
    render(
      <ToastRegion label="Notifications">
        <Toast tone="info" title="Agent replied" description="Patch added routing evidence." />
      </ToastRegion>,
    )

    const toast = screen.getByRole('status', { name: 'Agent replied' })
    expect(toast.className.split(' ')).toContain('w-full')
    expect(toast.className).toContain('minmax(min-content,1fr)')
  })

  it('styles in-toast actions in the owning toast tone', () => {
    const open = mock(() => {})
    render(
      <ToastRegion label="Notifications">
        <Toast
          tone="error"
          description="The workflow could not be started."
          action={<ToastAction onClick={open}>Retry</ToastAction>}
        />
      </ToastRegion>,
    )

    const action = screen.getByRole('button', { name: 'Retry' })
    expect(action.getAttribute('data-slot')).toBe('toast-action')
    expect(action.getAttribute('data-tone')).toBe('error')
    expect(action.getAttribute('type')).toBe('button')
    expect(action.className).toContain('text-bakin-text-primary')
    fireEvent.click(action)
    expect(open).toHaveBeenCalled()
  })
})
