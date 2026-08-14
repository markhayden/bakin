// @vitest-environment jsdom

/**
 * URL contract for the AgentDetail tab bar.
 *
 * The agent detail page reads the active tab from `?tab=` via useQueryState.
 * This test pins the three behaviours that matter for bookmarks and shared
 * links: a missing param defaults to Overview, a valid param (soul) selects
 * that tab, and an unknown param falls back to Overview rather than rendering
 * nothing.  Clicking a tab must write back through setTabParam so the URL
 * stays the source of truth.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '../../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-agent-detail-tabs-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
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

mock.module('@/hooks/use-runtime-status', () => ({
  useRuntimeStatus: () => ({ restartNeeded: false, restart: mock(), restarting: false, markDirty: mock() }),
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

import { AgentDetail } from '../../../plugins/team/components/agent-detail'
import { HEALTHY_TEAM_HEALTH_REPORT } from './health-report-fixture'

const originalFetch = global.fetch

beforeEach(() => {
  queryState.tab = 'profile'
  setTabSpy.mockClear()

  // Minimal profile payload so the component falls out of its loading shell.
  global.fetch = mock((url: RequestInfo | URL) => {
    const u = String(url)
    if (u === '/api/plugins/health/doctor') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(HEALTHY_TEAM_HEALTH_REPORT) } as Response)
    }
    if (u.includes('/api/plugins/team/') && !u.includes('/avatar')) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'explorer',
            name: 'Explorer',
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
  global.fetch = originalFetch
})

describe('AgentDetail — tab URL contract', () => {
  it('defaults to Overview when no ?tab= param is present', async () => {
    queryState.tab = ''
    render(<AgentDetail agentId="explorer" />)
    const overviewTab = await waitFor(() => screen.getByRole('tab', { name: 'Overview' }))
    expect(overviewTab.getAttribute('aria-selected')).toBe('true')
  })

  it('selects the Soul tab when ?tab=soul is present', async () => {
    queryState.tab = 'soul'
    render(<AgentDetail agentId="explorer" />)
    const soulTab = await waitFor(() => screen.getByRole('tab', { name: 'Soul' }))
    expect(soulTab.getAttribute('aria-selected')).toBe('true')
    const overviewTab = screen.getByRole('tab', { name: 'Overview' })
    expect(overviewTab.getAttribute('aria-selected')).toBe('false')
  })

  it('falls back to Overview when ?tab= is an unknown value', async () => {
    queryState.tab = 'bogus'
    render(<AgentDetail agentId="explorer" />)
    const overviewTab = await waitFor(() => screen.getByRole('tab', { name: 'Overview' }))
    expect(overviewTab.getAttribute('aria-selected')).toBe('true')
  })

  it('writes the tab back to the URL when a tab is clicked', async () => {
    queryState.tab = 'overview'
    render(<AgentDetail agentId="explorer" />)
    const rulesTab = await waitFor(() => screen.getByRole('tab', { name: 'AGENTS.md' }))
    fireEvent.click(rulesTab)
    expect(setTabSpy).toHaveBeenCalledWith('rules')
  })

  it('renders the new Heartbeat, Active Context, and Memory tabs in the bar', async () => {
    queryState.tab = 'overview'
    render(<AgentDetail agentId="explorer" />)
    await waitFor(() => screen.getByRole('tab', { name: 'Overview' }))
    expect(screen.getByRole('tab', { name: 'Memory' })).toBeDefined()
    expect(screen.getByRole('tab', { name: 'Heartbeat' })).toBeDefined()
    expect(screen.getByRole('tab', { name: 'Active Context' })).toBeDefined()
  })

  it('no longer renders the legacy Profile or Stats tabs', async () => {
    queryState.tab = 'overview'
    render(<AgentDetail agentId="explorer" />)
    await waitFor(() => screen.getByRole('tab', { name: 'Overview' }))
    expect(screen.queryByRole('tab', { name: 'Profile' })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Stats' })).toBeNull()
  })

  it('uses the shared scrollable tab pattern with linked panels and keyboard navigation', async () => {
    queryState.tab = 'overview'
    render(<AgentDetail agentId="explorer" />)

    const tablist = await screen.findByRole('tablist', { name: 'Agent sections' })
    expect(tablist.getAttribute('data-variant')).toBe('underline')
    expect(tablist.className).toContain('overflow-x-auto')

    // TabsContent owns the panel wiring now, so assert the relationship
    // resolves rather than pinning ids the component used to hand-author.
    const overview = screen.getByRole('tab', { name: 'Overview' })
    const panelId = overview.getAttribute('aria-controls')
    expect(panelId).toBeTruthy()
    expect(document.getElementById(panelId!)?.getAttribute('role')).toBe('tabpanel')
    act(() => { overview.focus() })
    fireEvent.keyDown(overview, { key: 'ArrowRight' })

    await waitFor(() => expect(setTabSpy).toHaveBeenCalledWith('diagnostics'))
  })

  it('gives icon-only back and delete controls accessible names', async () => {
    render(<AgentDetail agentId="explorer" />)

    expect(await screen.findByRole('button', { name: 'Back to agents' })).toBeDefined()
    const menu = screen.getByRole('button', { name: 'Agent actions' })
    fireEvent.click(menu)
    expect(await screen.findByRole('menuitem', { name: 'Delete' })).toBeDefined()
  })

  it('keeps secondary image and delete actions in the shared context menu', async () => {
    render(<AgentDetail agentId="explorer" />)

    expect(await screen.findByRole('button', { name: 'Change agent image' })).toBeDefined()
    const menu = await screen.findByRole('button', { name: 'Agent actions' })
    fireEvent.click(menu)
    expect(await screen.findByRole('menuitem', { name: 'Change image' })).toBeDefined()
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeDefined()
  })
})
