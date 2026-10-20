// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '../rtl-settle'
import { ActivityContext } from '@/context/activity-context'
import { SidebarContext } from '@/context/sidebar-context'
import { Header } from '../../packages/host/src/components/layout/header'

// Captured BEFORE the module is mocked (live namespace binding): the SDK's render helpers (useKeyedState, useNow, useMediaQuery) stay real under the narrow mock.
import * as realSdkHooks from '@makinbakin/sdk/hooks'
mock.module('@makinbakin/sdk/hooks', () => ({
  ...realSdkHooks,
  useDebug: () => [false, mock()] as const,
  useContentStore: (selector: (state: { connected: boolean }) => unknown) => selector({ connected: true }),
  toast: mock(),
}))

function renderHeader() {
  render(
    <SidebarContext value={{ collapsed: false, toggle: mock() }}>
      <Header />
    </SidebarContext>,
  )
}

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response
}

describe('Header update banner', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty('--bakin-header-top')
    document.documentElement.style.removeProperty('--bakin-shell-top')
    mock.restore()
  })

  beforeEach(() => {
    global.fetch = mock((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/version') return Promise.resolve(response({ version: '0.1.0', bootId: 'boot-old', state: 'serving' }))
      if (url === '/api/dispatch') return Promise.resolve(response({ secondsUntilNext: 120, dispatching: false }))
      return Promise.resolve(response({}))
    }) as unknown as typeof global.fetch
  })

  const bakinRecord = (outcome: 'update-available' | 'current' | 'unsupported', extra: Record<string, unknown> = {}) => ({
    id: 'bakin:bakin', group: 'available', subject: { kind: 'bakin', id: 'bakin', label: 'Bakin' }, outcome,
    installed: { version: '0.1.0', display: 'v0.1.0' },
    ...(outcome === 'update-available' ? { available: { version: '0.2.0', sha: 'abc', display: 'v0.2.0' }, reason: 'newer-version', action: { kind: 'operation', start: { route: '/api/updates/bakin%3Abakin/apply' }, impact: ['download', 'server-restart'] } } : {}),
    source: { kind: 'github-release', endpoint: 'x' }, fingerprint: 'f', ...extra,
  })
  const updatesResponse = (outcome: 'update-available' | 'current' | 'unsupported', extra: Record<string, unknown> = {}) =>
    response({ bootId: 'boot-old', records: [bakinRecord(outcome, extra)], generatedAt: '2026-10-20T12:00:00.000Z', running: false })

  it('renders a top banner from the engine\'s bakin record when a newer release is available', async () => {
    global.fetch = mock((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/version') return Promise.resolve(response({ version: '0.1.0', bootId: 'boot-old', state: 'serving' }))
      if (url === '/api/updates') return Promise.resolve(updatesResponse('update-available'))
      if (url === '/api/dispatch') return Promise.resolve(response({ secondsUntilNext: 120, dispatching: false }))
      return Promise.resolve(response({}))
    }) as unknown as typeof global.fetch
    renderHeader()
    const updateMessage = await screen.findByText(/New Bakin version available/i)
    const updateBanner = updateMessage.closest('[role="status"]')
    expect(updateBanner?.textContent).toContain('v0.1.0')
    expect(updateBanner?.textContent).toContain('v0.2.0')
    expect(screen.getByRole('button', { name: 'Update Bakin' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Skip this version' })).toBeDefined()
    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue('--bakin-shell-top')).toBe('5.75rem')
    })
  })

  it('a skipped release identity hides the banner, and Skip posts the skip and hides it (D7.7/D7.8)', async () => {
    const calls: Array<{ url: string; method?: string }> = []
    global.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, method: init?.method })
      if (url === '/api/version') return Promise.resolve(response({ version: '0.1.0', bootId: 'boot-old', state: 'serving' }))
      if (url === '/api/updates') return Promise.resolve(updatesResponse('update-available'))
      if (url === '/api/updates/bakin%3Abakin/skip') return Promise.resolve(response({ bootId: 'boot-old', record: bakinRecord('update-available', { skipped: { version: '0.2.0', sha: 'abc' } }) }))
      if (url === '/api/dispatch') return Promise.resolve(response({ secondsUntilNext: 120, dispatching: false }))
      return Promise.resolve(response({}))
    }) as unknown as typeof global.fetch
    renderHeader()
    const skip = await screen.findByRole('button', { name: 'Skip this version' })
    await act(async () => { fireEvent.click(skip) })
    await waitFor(() => expect(screen.queryByText(/New Bakin version available/i)).toBeNull())
    expect(calls.some((c) => c.url === '/api/updates/bakin%3Abakin/skip' && c.method === 'POST')).toBe(true)
    expect(document.documentElement.style.getPropertyValue('--bakin-shell-top')).toBe('')
  })

  it('Update Bakin starts the apply operation as a declared operator and shows its progress', async () => {
    const calls: Array<{ url: string; method?: string; headers?: Record<string, string> }> = []
    global.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, method: init?.method, headers: init?.headers as Record<string, string> | undefined })
      if (url === '/api/version') return Promise.resolve(response({ version: '0.1.0', bootId: 'boot-old', state: 'serving' }))
      if (url === '/api/updates') return Promise.resolve(updatesResponse('update-available'))
      if (url === '/api/updates/bakin%3Abakin/apply') return Promise.resolve(response({ operationId: 'op-1', bootId: 'boot-old' }, 202))
      if (url.startsWith('/api/operations/op-1')) return Promise.resolve(response({ bootId: 'boot-old', operation: { id: 'op-1', bootId: 'boot-old', rev: 1, status: 'running', kind: 'updates:self-update', owner: 'core', origin: 'web', title: 'Update Bakin', href: '/health', startedAt: '2026-10-20T12:00:00.000Z', updatedAt: '2026-10-20T12:00:00.000Z', stages: [{ id: 'download', kind: 'downloading', label: 'Download the release', status: 'active' }], children: [], log: [] } }))
      if (url === '/api/dispatch') return Promise.resolve(response({ secondsUntilNext: 120, dispatching: false }))
      return Promise.resolve(response({}))
    }) as unknown as typeof global.fetch
    renderHeader()
    const open = await screen.findByRole('button', { name: 'Update Bakin' })
    await act(async () => { fireEvent.click(open) })
    const confirm = await screen.findByRole('button', { name: /^Update$|Update now|Update Bakin/ })
    await act(async () => { fireEvent.click(confirm) })
    await waitFor(() => expect(calls.some((c) => c.url === '/api/updates/bakin%3Abakin/apply' && c.method === 'POST')).toBe(true))
    const apply = calls.find((c) => c.url === '/api/updates/bakin%3Abakin/apply')!
    expect(apply.headers?.['X-Bakin-Operator']).toBe('declared')
    await waitFor(() => expect(screen.getByText('Download the release')).toBeDefined())
  })

  it('does not render the banner when self-update is unsupported', async () => {
    global.fetch = mock((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/version') return Promise.resolve(response({ version: '0.0.0-dev', bootId: 'boot-dev', state: 'serving' }))
      if (url === '/api/updates') return Promise.resolve(updatesResponse('unsupported'))
      if (url === '/api/dispatch') return Promise.resolve(response({ secondsUntilNext: 120, dispatching: false }))
      return Promise.resolve(response({}))
    }) as unknown as typeof global.fetch

    renderHeader()

    await waitFor(() => expect(screen.getByText('v0.0.0-dev')).toBeDefined())
    expect(screen.queryByText(/New Bakin version available/i)).toBeNull()
    expect(document.documentElement.style.getPropertyValue('--bakin-shell-top')).toBe('')
  })

  it('puts Live Activity at the far right of the mobile header without an unread pulse', async () => {
    const toggleActivity = mock()
    // Header fires version/dispatch fetches on mount — resolve them inside
    // act so their state updates don't trip the act gate after the test.
    global.fetch = mock(() => Promise.resolve(response({}))) as unknown as typeof global.fetch
    await act(async () => {
      render(
        <ActivityContext value={{ open: false, toggle: toggleActivity, close: mock() }}>
          <SidebarContext value={{ collapsed: false, toggle: mock() }}>
            <Header />
          </SidebarContext>
        </ActivityContext>,
      )
    })

    const button = screen.getByRole('button', { name: 'Open Live Activity' })
    expect(button.className).toContain('md:hidden')
    expect(button.querySelector('.animate-pulse')).toBeNull()
    fireEvent.click(button)
    expect(toggleActivity).toHaveBeenCalledTimes(1)
  })

  it('renders the dispatch-paused banner and offsets the header (kill switch, cost-control v2)', async () => {
    global.fetch = mock((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/version') return Promise.resolve(response({ version: '0.1.0', bootId: 'boot-old', state: 'serving' }))
      if (url.startsWith('/api/plugins/spend/status')) return Promise.resolve(response({ paused: true }))
      if (url === '/api/dispatch') return Promise.resolve(response({ secondsUntilNext: 120, dispatching: false }))
      return Promise.resolve(response({}))
    }) as unknown as typeof global.fetch

    renderHeader()

    await waitFor(() => expect(screen.getByText('Dispatch paused')).toBeDefined())
    expect(screen.getByRole('button', { name: 'Resume' })).toBeDefined()
    // ONE banner active: header shifts by 2.25rem, shell by 5.75rem — the
    // banner must PUSH the header down, never be painted over by it.
    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue('--bakin-header-top')).toBe('2.25rem')
      expect(document.documentElement.style.getPropertyValue('--bakin-shell-top')).toBe('5.75rem')
    })
  })

  it('stacks BOTH banners: update at top, paused below, header offset by 4.5rem', async () => {
    global.fetch = mock((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/version') return Promise.resolve(response({ version: '0.1.0', bootId: 'boot-old', state: 'serving' }))
      if (url === '/api/updates') return Promise.resolve(updatesResponse('update-available'))
      if (url.startsWith('/api/plugins/spend/status')) return Promise.resolve(response({ paused: true }))
      if (url === '/api/dispatch') return Promise.resolve(response({ secondsUntilNext: 120, dispatching: false }))
      return Promise.resolve(response({}))
    }) as unknown as typeof global.fetch

    renderHeader()

    await waitFor(() => expect(screen.getByText('Dispatch paused')).toBeDefined())
    await waitFor(() => expect(screen.getByText(/New Bakin version available/i)).toBeDefined())
    // Both rows live in ONE fixed stack; source order is stacking order (update above paused).
    const stack = document.querySelector('[data-slot="header-banners"]')!
    const rows = Array.from(stack.querySelectorAll('[role="status"]')).map((el) => el.textContent ?? '')
    expect(rows[0]).toMatch(/New Bakin version available/)
    expect(rows[1]).toContain('Dispatch paused')
    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue('--bakin-header-top')).toBe('4.5rem')
      expect(document.documentElement.style.getPropertyValue('--bakin-shell-top')).toBe('8rem')
    })
  })

  it('aborts the version and update-status requests when the header unmounts (#966 leaked fetch)', async () => {
    const signals = new Map<string, AbortSignal | undefined>()
    global.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      signals.set(String(input), init?.signal ?? undefined)
      return new Promise<Response>(() => {}) // never settles — the unmount must not wait on it
    }) as unknown as typeof global.fetch
    const view = render(
      <SidebarContext value={{ collapsed: false, toggle: mock() }}>
        <Header />
      </SidebarContext>,
    )
    await act(async () => {})
    expect(signals.get('/api/version')?.aborted).toBe(false)
    expect(signals.get('/api/updates')?.aborted).toBe(false)
    await act(async () => { view.unmount() })
    expect(signals.get('/api/version')?.aborted).toBe(true)
    expect(signals.get('/api/updates')?.aborted).toBe(true)
  })

  it('closes the mobile navigation sheet when the viewport grows past the breakpoint (#966b)', async () => {
    let matches = false
    const listeners = new Set<() => void>()
    const originalMatchMedia = window.matchMedia
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({
        media: query,
        get matches() { return matches },
        addEventListener: (_: string, cb: () => void) => { listeners.add(cb) },
        removeEventListener: (_: string, cb: () => void) => { listeners.delete(cb) },
      }),
    })
    try {
      renderHeader()
      await act(async () => {})
      // The header's own toggle is the one button carrying aria-expanded (the sheet adds its own close control).
      const toggle = () => document.querySelector('button[aria-expanded]') as HTMLButtonElement
      await act(async () => { fireEvent.click(toggle()) })
      expect(toggle().getAttribute('aria-expanded')).toBe('true')
      expect(toggle().getAttribute('aria-label')).toBe('Close navigation')
      matches = true
      await act(async () => { for (const cb of listeners) cb() })
      expect(toggle().getAttribute('aria-expanded')).toBe('false')
      expect(toggle().getAttribute('aria-label')).toBe('Open navigation')
    } finally {
      Object.defineProperty(window, 'matchMedia', { configurable: true, value: originalMatchMedia })
    }
  })
})
