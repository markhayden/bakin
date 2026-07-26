// @vitest-environment jsdom

/**
 * Tests for plugins/memory/components/tier-overview-cards.tsx.
 *
 * The overview renders compact metrics for the everyday memory tiers and
 * adds the noisy system-log tiers only when explicitly requested. It fetches
 * /status on mount, shows skeletons while loading, shows the per-tier counts
 * once data arrives, and tolerates a missing tier (→ 0). It is the fastest
 * feedback surface on the /memory landing page, so render-stability on
 * partial data matters more than exhaustive prettiness.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import '../../rtl-settle'

// Defensive isolation per CLAUDE.md.
mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../../src/core/content-dir', () => {
  const { join: j } = require('path') as typeof import('path')
  const { tmpdir: t } = require('os') as typeof import('os')
  const base = j(t(), `bakin-test-memory-overview-mock`)
  return {
    getContentDir: () => base,
    getBakinPaths: () => ({ root: base, plugins: j(base, 'plugin-settings') }),
  }
})
mock.module('../../../packages/core/src/content-dir', () => {
  const { join: j } = require('path') as typeof import('path')
  const { tmpdir: t } = require('os') as typeof import('os')
  const base = j(t(), `bakin-test-memory-overview-mock`)
  return {
    getContentDir: () => base,
    getBakinPaths: () => ({ root: base, plugins: j(base, 'plugin-settings') }),
  }
})

import { TierOverviewCards } from '../../../plugins/memory/components/tier-overview-cards'

type FetchFn = typeof global.fetch

function mockFetchOnce(body: unknown, status = 200): FetchFn {
  return mock(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as FetchFn
}

const originalFetch = global.fetch

beforeEach(() => {
  ;(global as { fetch: FetchFn }).fetch = originalFetch
})

afterEach(() => {
  cleanup()
  ;(global as { fetch: FetchFn }).fetch = originalFetch
})

describe('TierOverviewCards', () => {
  it('renders compact metrics for the five everyday tiers by default', async () => {
    global.fetch = mockFetchOnce({
      countsByTier: {
        audit: 10, durable: 4, daily_note: 7, session: 3, turn: 200, checkpoint: 1, dream: 5,
      },
      totalRows: 230,
      offsetsTracked: 2,
      lastUpdated: Date.now(),
    })
    render(<TierOverviewCards />)
    await waitFor(() => {
      expect(document.querySelectorAll('[data-stat-tile]').length).toBe(5)
    })
    expect(screen.getByText('Sessions')).toBeDefined()
    expect(screen.getByText('Daily Notes')).toBeDefined()
    expect(screen.queryByText('Audit')).toBeNull()
    expect(screen.queryByText('Turns')).toBeNull()
  })

  it('adds audit and turn metrics when system logs are enabled', async () => {
    global.fetch = mockFetchOnce({
      countsByTier: {
        audit: 10, durable: 4, daily_note: 7, session: 3, turn: 200, checkpoint: 1, dream: 5,
      },
      totalRows: 230,
      offsetsTracked: 2,
      lastUpdated: Date.now(),
    })
    render(<TierOverviewCards includeSystemLogs />)
    await waitFor(() => {
      expect(document.querySelectorAll('[data-stat-tile]').length).toBe(7)
    })
    expect(screen.getByText('Audit')).toBeDefined()
    expect(screen.getByText('Turns')).toBeDefined()
  })

  it('displays the count for each tier once /status responds', async () => {
    global.fetch = mockFetchOnce({
      countsByTier: {
        audit: 10, durable: 4, daily_note: 7, session: 3, turn: 200, checkpoint: 1, dream: 5,
      },
      totalRows: 230,
      offsetsTracked: 2,
      lastUpdated: Date.now(),
    })
    render(<TierOverviewCards includeSystemLogs />)
    await waitFor(() => {
      // each count shows up somewhere
      expect(screen.getByText('200')).toBeDefined()
      expect(screen.getByText('10')).toBeDefined()
      expect(screen.getByText('7')).toBeDefined()
    })
  })

  it('shows skeletons before the first response', () => {
    global.fetch = mock(() => new Promise(() => {})) as unknown as FetchFn
    const { container } = render(<TierOverviewCards />)
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0)
  })

  it('fetches /api/plugins/memory/status', async () => {
    const fn = mockFetchOnce({
      countsByTier: {
        audit: 0, durable: 0, daily_note: 0, session: 0, turn: 0, checkpoint: 0, dream: 0,
      },
      totalRows: 0, offsetsTracked: 0, lastUpdated: 0,
    })
    global.fetch = fn
    render(<TierOverviewCards />)
    await waitFor(() => {
      expect(fn).toHaveBeenCalled()
    })
    const url = (fn as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as string
    expect(url).toContain('/api/plugins/memory/status')
  })

  it('tolerates a tier missing from the response — renders 0', async () => {
    global.fetch = mockFetchOnce({
      countsByTier: { audit: 10 }, // missing every other tier
      totalRows: 10, offsetsTracked: 0, lastUpdated: Date.now(),
    })
    render(<TierOverviewCards includeSystemLogs />)
    await waitFor(() => {
      expect(document.querySelectorAll('[data-stat-tile]').length).toBe(7)
    })
    // 6 tiers should show 0 — so at least 6 zero values present.
    const zeros = screen.getAllByText('0')
    expect(zeros.length).toBeGreaterThanOrEqual(6)
  })

  it('renders an error state when /status fails', async () => {
    global.fetch = mock(async () => {
      throw new Error('network blip')
    }) as unknown as FetchFn
    render(<TierOverviewCards />)
    await waitFor(() => {
      expect(screen.getByText(/network blip|failed/i)).toBeDefined()
    })
  })
})
