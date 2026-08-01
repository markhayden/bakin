// @vitest-environment jsdom

/**
 * Heartbeat tab contract — view-only markdown render with last-updated.
 *
 * Covers: loading state, error state, empty state, populated state,
 * last-updated formatting, absence of any edit/save affordance.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, render, screen, waitFor } from '@testing-library/react'
import '../../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync } from 'fs'

const testDir = join(tmpdir(), `bakin-test-heartbeat-tab-${Date.now()}-${Math.random().toString(36).slice(2)}`)

mock.module('@/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({}) }))
mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({}) }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({}) }))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../../packages/adapter-openclaw/src/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

mock.module('@makinbakin/sdk/content', () => ({
  MarkdownContent: ({ content }: { content: string }) => <div data-testid="markdown">{content}</div>,
}))

import { HeartbeatTab } from '../../../plugins/team/components/heartbeat-tab'

function setupFetch(body: { ok: boolean; heartbeat: { content: string; lastUpdated: string | null } | null; error?: string }) {
  global.fetch = mock(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response),
  ) as unknown as typeof global.fetch
}

afterAll(() => {
  try { rmSync(testDir, { recursive: true, force: true }) } catch {}
})

describe('HeartbeatTab', () => {
  it('shows the loading state before the fetch resolves', async () => {
    let resolveFetch: (value: Response) => void
    global.fetch = mock(
      () => new Promise<Response>((res) => { resolveFetch = res }),
    ) as unknown as typeof global.fetch

    await act(async () => {
      render(<HeartbeatTab agentId="pixel" />)
    })
    expect(screen.getByText(/Loading heartbeat/)).toBeDefined()
    // Resolve INSIDE act so the resulting re-render lands in this test rather
    // than during the settle hook — the loading assertion above already ran.
    await act(async () => {
      resolveFetch!({ ok: true, json: () => Promise.resolve({ ok: true, heartbeat: null }) } as Response)
    })
    await waitFor(() => expect(screen.getByText(/No heartbeat yet/)).toBeDefined())
  })

  it('renders the empty state when heartbeat is null', async () => {
    setupFetch({ ok: true, heartbeat: null })
    await act(async () => {
      render(<HeartbeatTab agentId="pixel" />)
    })
    const title = await screen.findByText(/No heartbeat yet/)
    expect(title.closest('[data-slot="system-state"]')?.getAttribute('data-scope')).toBe('page')
  })

  it('renders the markdown content + last updated badge for a populated heartbeat', async () => {
    setupFetch({
      ok: true,
      heartbeat: {
        content: '## Status\n\nAlive.',
        lastUpdated: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5 minutes ago
      },
    })
    await act(async () => {
      render(<HeartbeatTab agentId="pixel" />)
    })
    await waitFor(() => expect(screen.getByTestId('markdown')).toBeDefined())
    expect(screen.getByTestId('markdown').textContent).toBe('## Status\n\nAlive.')
    expect(screen.getByText(/Last updated 5m ago/)).toBeDefined()
  })

  it('formats sub-minute updates in seconds', async () => {
    setupFetch({
      ok: true,
      heartbeat: { content: 'x', lastUpdated: new Date(Date.now() - 12 * 1000).toISOString() },
    })
    await act(async () => {
      render(<HeartbeatTab agentId="pixel" />)
    })
    await waitFor(() => expect(screen.getByText(/Last updated/)).toBeDefined())
    expect(screen.getByText(/Last updated 1[12]s ago/)).toBeDefined()
  })

  it('formats day-old updates in days', async () => {
    setupFetch({
      ok: true,
      heartbeat: { content: 'x', lastUpdated: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString() },
    })
    await act(async () => {
      render(<HeartbeatTab agentId="pixel" />)
    })
    await waitFor(() => expect(screen.getByText(/Last updated 3d ago/)).toBeDefined())
  })

  it('renders an error state when the API returns ok:false', async () => {
    setupFetch({ ok: false, heartbeat: null, error: 'boom' })
    await act(async () => {
      render(<HeartbeatTab agentId="pixel" />)
    })
    await waitFor(() => expect(screen.getByText('boom')).toBeDefined())
  })

  it('shows a disabled edit button (visual parity with markdown tabs) but no editable surface', async () => {
    setupFetch({
      ok: true,
      heartbeat: { content: 'alive', lastUpdated: new Date().toISOString() },
    })
    await act(async () => {
      render(<HeartbeatTab agentId="pixel" />)
    })
    await waitFor(() => expect(screen.getByTestId('markdown')).toBeDefined())

    // Button is present so the corner real-estate matches Soul/Rules/Tools
    // tabs, but it's explicitly disabled with an explanatory tooltip.
    const btn = screen.getByLabelText(/Edit disabled/) as HTMLButtonElement
    expect(btn).toBeDefined()
    expect(btn.disabled).toBe(true)

    // No save button, no editable textbox — the disabled affordance is
    // visual parity only, never lets the user edit.
    expect(screen.queryByLabelText(/Save/i)).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})
