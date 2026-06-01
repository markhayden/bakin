// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
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

function response(body: unknown): Response {
  return {
    ok: true,
    json: () => Promise.resolve(body),
  } as Response
}

describe('Header update banner', () => {
  afterEach(() => {
    cleanup()
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

    await waitFor(() => expect(screen.getByText(/New Bakin version available/i)).toBeDefined())
    expect(screen.getByRole('status').textContent).toContain('v0.1.0')
    expect(screen.getByRole('status').textContent).toContain('v0.2.0')
    expect(screen.getByRole('button', { name: 'Update Bakin' })).toBeDefined()
    expect(document.documentElement.style.getPropertyValue('--bakin-shell-top')).toBe('5.75rem')
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
})
