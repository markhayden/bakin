// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '../rtl-settle'
import { ActivityContext } from '@/context/activity-context'
import { SidebarContext } from '@/context/sidebar-context'
import { Header } from '../../packages/host/src/components/layout/header'

mock.module('@makinbakin/sdk/hooks', () => ({
  useDebug: () => [false, mock()] as const,
  useContentStore: (selector: (state: { connected: boolean }) => unknown) => selector({ connected: true }),
  toast: mock(),
}))

function renderHeader() {
  render(
    <SidebarContext.Provider value={{ collapsed: false, toggle: mock() }}>
      <Header />
    </SidebarContext.Provider>,
  )
}

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response
}

const WARNING_ROW = { id: 5, window: 'monthly', milestone: 90, spentValue: 91_000_000, capValue: 100_000_000, unit: 'usd_micros', acknowledgedAt: null }
const CAP_ROW = { id: 7, eventId: 'evt-7-1', episode: 1, scope: 'global', scopeId: '', lane: 'metered', window: 'monthly', unit: 'usd_micros', capValue: 100_000_000, spentValue: 101_000_000, atCap: 'pause', status: 'open' }

describe('Header update banner', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty('--bakin-header-top')
    document.documentElement.style.removeProperty('--bakin-shell-top')
    mock.restore()
  })

  beforeEach(() => {
    global.fetch = mock((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/version') return Promise.resolve(response({ version: '0.1.0' }))
      if (url === '/api/dispatch') return Promise.resolve(response({ secondsUntilNext: 120, dispatching: false }))
      return Promise.resolve(response({}))
    }) as unknown as typeof global.fetch
  })

  it('renders a top banner when a Bakin update is available', async () => {
    global.fetch = mock((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/version') return Promise.resolve(response({ version: '0.1.0' }))
      if (url === '/api/update/status') {
        return Promise.resolve(response({
          ok: true,
          supported: true,
          currentVersion: '0.1.0',
          latestVersion: '0.2.0',
          latestTag: 'v0.2.0',
          updateAvailable: true,
          checkedAt: '2026-06-01T12:00:00.000Z',
        }))
      }
      if (url === '/api/dispatch') return Promise.resolve(response({ secondsUntilNext: 120, dispatching: false }))
      return Promise.resolve(response({}))
    }) as unknown as typeof global.fetch

    renderHeader()

    const updateMessage = await screen.findByText(/New Bakin version available/i)
    const updateBanner = updateMessage.closest('[role="status"]')
    expect(updateBanner?.textContent).toContain('v0.1.0')
    expect(updateBanner?.textContent).toContain('v0.2.0')
    expect(screen.getByRole('button', { name: 'Update Bakin' })).toBeDefined()
    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue('--bakin-shell-top')).toBe('5.75rem')
    })
  })

  it('does not render the banner when self-update is unsupported', async () => {
    global.fetch = mock((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/version') return Promise.resolve(response({ version: '0.0.0-dev' }))
      if (url === '/api/update/status') {
        return Promise.resolve(response({
          ok: true,
          supported: false,
          currentVersion: '0.0.0-dev',
          latestVersion: null,
          latestTag: null,
          updateAvailable: false,
          checkedAt: '2026-06-01T12:00:00.000Z',
          reason: 'source/dev runtime',
        }))
      }
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
        <ActivityContext.Provider value={{ open: false, toggle: toggleActivity, close: mock() }}>
          <SidebarContext.Provider value={{ collapsed: false, toggle: mock() }}>
            <Header />
          </SidebarContext.Provider>
        </ActivityContext.Provider>,
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
      if (url === '/api/version') return Promise.resolve(response({ version: '0.1.0' }))
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
      if (url === '/api/version') return Promise.resolve(response({ version: '0.1.0' }))
      if (url === '/api/update/status') {
        return Promise.resolve(response({
          ok: true, supported: true, currentVersion: '0.1.0', latestVersion: '0.2.0',
          latestTag: 'v0.2.0', updateAvailable: true, checkedAt: '2026-06-01T12:00:00.000Z',
        }))
      }
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

  it('spend ladder: bars derive from durable rows on reload (no SSE) — cap bars above 90% bars, header offset by the whole stack', async () => {
    const calls: string[] = []
    global.fetch = mock((input: RequestInfo | URL) => {
      const url = String(input)
      calls.push(url)
      if (url === '/api/version') return Promise.resolve(response({ version: '0.1.0' }))
      if (url.startsWith('/api/plugins/spend/status')) return Promise.resolve(response({ paused: false, milestones: [WARNING_ROW], openIncidents: [CAP_ROW] }))
      if (url === '/api/dispatch') return Promise.resolve(response({ secondsUntilNext: 120, dispatching: false }))
      return Promise.resolve(response({}))
    }) as unknown as typeof global.fetch

    renderHeader()
    await waitFor(() => expect(screen.getByText('monthly limit reached')).toBeDefined())
    await waitFor(() => expect(screen.getByText('90% of your monthly limit')).toBeDefined())
    const cap = screen.getByText('monthly limit reached').closest('[role="status"]') as HTMLElement
    const rows = Array.from(document.querySelector('[data-slot="header-banners"]')!.querySelectorAll('[role="status"]')).map((el) => el.textContent ?? '')
    expect(rows[0]).toContain('monthly limit reached')
    expect(rows[1]).toContain('90% of your monthly limit')
    expect(cap.textContent).toContain('$101.00 of $100.00 metered')
    expect(cap.textContent).toContain('paused until you act')
    expect(screen.getByRole('link', { name: 'Raise limit' }).getAttribute('href')).toBe('/spend?tab=limits')
    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue('--bakin-header-top')).toBe('4.5rem')
      expect(document.documentElement.style.getPropertyValue('--bakin-shell-top')).toBe('8rem')
    })
    // The ladder rows rode the SAME lite poll the kill switch uses — one request, not a second poller.
    expect(calls.filter((u) => u.startsWith('/api/plugins/spend/status')).length).toBe(1)
  })

  it('spend ladder: Dismiss acknowledges the 90% row and the bar goes away; Resume on a still-over cap turns into "Raise limit to resume" (409)', async () => {
    let acked = false
    global.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/version') return Promise.resolve(response({ version: '0.1.0' }))
      if (url === '/api/plugins/spend/milestones/5/ack' && init?.method === 'POST') { acked = true; return Promise.resolve(response({ ok: true })) }
      if (url === '/api/plugins/spend/incidents/7/resolve' && init?.method === 'POST') return Promise.resolve(response({ error: 'still_over_limit' }, 409))
      if (url.startsWith('/api/plugins/spend/status')) return Promise.resolve(response({ paused: false, milestones: acked ? [] : [WARNING_ROW], openIncidents: [CAP_ROW] }))
      if (url === '/api/dispatch') return Promise.resolve(response({ secondsUntilNext: 120, dispatching: false }))
      return Promise.resolve(response({}))
    }) as unknown as typeof global.fetch

    renderHeader()
    await waitFor(() => expect(screen.getByText('90% of your monthly limit')).toBeDefined())
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Dismiss' })) })
    await waitFor(() => expect(screen.queryByText('90% of your monthly limit')).toBeNull())
    expect(acked).toBe(true)

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Resume as-is' })) })
    await waitFor(() => expect(screen.getByRole('link', { name: 'Raise limit to resume' })).toBeDefined())
    expect(screen.queryByRole('button', { name: 'Resume as-is' })).toBeNull()
    // The SERVER's reason is what the bar prints, not a guess.
    expect(screen.getByText(/raise the limit to resume/)).toBeDefined()
  })

  it('spend ladder: a "wait" (defer) cap bar offers Acknowledge — never a Resume that is refused all window — and a failed 90% Dismiss says so instead of pretending', async () => {
    const acked = { action: null as string | null }
    global.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/version') return Promise.resolve(response({ version: '0.1.0' }))
      if (url === '/api/plugins/spend/milestones/5/ack' && init?.method === 'POST') return Promise.resolve(response({ error: 'No unacknowledged milestone 5' }, 404))
      if (url === '/api/plugins/spend/incidents/7/resolve' && init?.method === 'POST') { acked.action = String((JSON.parse(String(init.body)) as { action: string }).action); return Promise.resolve(response({ ok: true })) }
      if (url.startsWith('/api/plugins/spend/status')) return Promise.resolve(response({ paused: false, milestones: [WARNING_ROW], openIncidents: acked.action ? [] : [{ ...CAP_ROW, atCap: 'defer' }] }))
      if (url === '/api/dispatch') return Promise.resolve(response({ secondsUntilNext: 120, dispatching: false }))
      return Promise.resolve(response({}))
    }) as unknown as typeof global.fetch

    renderHeader()
    await waitFor(() => expect(screen.getByText('monthly limit reached')).toBeDefined())
    expect(screen.queryByRole('button', { name: 'Resume as-is' })).toBeNull()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' })) })
    await waitFor(() => expect(screen.queryByText('monthly limit reached')).toBeNull())
    expect(acked.action).toBe('ack')

    // The 90% Dismiss failed (already rolled over): the bar stays and carries the reason.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Dismiss' })) })
    await waitFor(() => expect(screen.getByText(/No unacknowledged milestone 5/)).toBeDefined())
    expect(screen.getByText('90% of your monthly limit')).toBeDefined()
  })
})
