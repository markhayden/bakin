// @vitest-environment jsdom

/**
 * URL contract for the AgentDetail tab bar.
 *
 * The agent detail page reads the active tab from `?tab=` via useQueryState.
 * This test pins the three behaviours that matter for bookmarks and shared
 * links: a missing param defaults to Profile, a valid param (soul) selects
 * that tab, and an unknown param falls back to Profile rather than rendering
 * nothing.  Clicking a tab must write back through setTabParam so the URL
 * stays the source of truth.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-agent-detail-tabs-${Date.now()}`)

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))

// useQueryState is what we're actually pinning.  The factory reads a global
// seed that each test sets so we can simulate different URLs without touching
// jsdom's window.location.
const queryState: { tab: string } = { tab: 'profile' }
const setTabSpy = mock((v: string) => { queryState.tab = v })

mock.module('@/hooks/use-query-state', () => ({
  useQueryState: (_key: string, defaultValue: string) => {
    // Mirror the real hook's shape: [value, setValue, pushValue].  The
    // component uses setTabParam (the replace variant) to switch tabs.
    return [queryState.tab || defaultValue, setTabSpy, mock()]
  },
}))

mock.module('@/hooks/use-gateway-status', () => ({
  useGatewayStatus: () => ({ restartNeeded: false, restart: mock(), restarting: false, markDirty: mock() }),
}))

mock.module('../../../plugins/team/hooks/use-agent-store', () => ({
  useAgentStore: (selector: (s: unknown) => unknown) =>
    selector({ teams: [], displaySettings: {}, load: mock() }),
  useAgentColor: () => '#888',
  useMainAgentId: () => 'main',
}))

// Keep the heavy tab content out of the render tree — we only care about the
// header/tab-bar wiring here.
mock.module('@/components/agent-avatar', () => ({ AgentAvatar: () => <div /> }))
mock.module('@/components/markdown-content', () => ({ MarkdownContent: () => <div /> }))
mock.module('@/components/model-select', () => ({ ModelSelect: () => <div /> }))

import { AgentDetail } from '../../../plugins/team/components/agent-detail'

const originalFetch = global.fetch

beforeEach(() => {
  queryState.tab = 'profile'
  setTabSpy.mockClear()

  // Minimal profile payload so the component falls out of its loading shell.
  global.fetch = mock((url: RequestInfo | URL) => {
    const u = String(url)
    if (u.includes('/api/plugins/team/') && !u.includes('/avatar')) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'scout',
            name: 'Scout',
            role: 'Researcher',
            model: 'opus',
            soul: '',
            rules: '',
            tools: '',
          }),
      } as Response)
    }
    if (u.includes('/api/plugins/models/available')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ models: [] }) } as Response)
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response)
  }) as unknown as typeof fetch
})

afterEach(() => {
  cleanup()
  global.fetch = originalFetch
})

describe('AgentDetail — tab URL contract', () => {
  it('defaults to Profile when no ?tab= param is present', async () => {
    queryState.tab = ''
    render(<AgentDetail agentId="scout" />)
    const profileBtn = await waitFor(() => screen.getByRole('button', { name: 'Profile' }))
    // Active tab gets the accent underline style applied inline.
    expect(profileBtn.getAttribute('style') ?? '').toMatch(/border-color/i)
  })

  it('selects the Soul tab when ?tab=soul is present', async () => {
    queryState.tab = 'soul'
    render(<AgentDetail agentId="scout" />)
    const soulBtn = await waitFor(() => screen.getByRole('button', { name: 'Soul' }))
    expect(soulBtn.getAttribute('style') ?? '').toMatch(/border-color/i)
    // Profile button must NOT be active when Soul is selected.
    const profileBtn = screen.getByRole('button', { name: 'Profile' })
    expect(profileBtn.getAttribute('style') ?? '').not.toMatch(/border-color/i)
  })

  it('falls back to Profile when ?tab= is an unknown value', async () => {
    queryState.tab = 'bogus'
    render(<AgentDetail agentId="scout" />)
    const profileBtn = await waitFor(() => screen.getByRole('button', { name: 'Profile' }))
    expect(profileBtn.getAttribute('style') ?? '').toMatch(/border-color/i)
  })

  it('writes the tab back to the URL when a tab is clicked', async () => {
    queryState.tab = 'profile'
    render(<AgentDetail agentId="scout" />)
    const rulesBtn = await waitFor(() => screen.getByRole('button', { name: 'Rules' }))
    fireEvent.click(rulesBtn)
    expect(setTabSpy).toHaveBeenCalledWith('rules')
  })
})
