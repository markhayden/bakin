// @vitest-environment jsdom

/**
 * OverviewTab — consolidated agent dashboard.
 *
 * Covers all the panels: Identity, Settings (model + team), Package
 * card (delegated), Workspace, Capacity (skills + lessons counts),
 * Latest Session (folded-in Stats data), Recent Activity.
 *
 * Tests the wiring shape — fetches happen, UI reflects responses,
 * model + team interactions fire the right round-trips.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync } from 'fs'

const testDir = join(tmpdir(), `bakin-test-overview-tab-${Date.now()}-${Math.random().toString(36).slice(2)}`)

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

import { useAgentStore } from '../../../plugins/team/hooks/use-agent-store'
import { OverviewTab } from '../../../plugins/team/components/overview-tab'
import type { PackageStateRow } from '../../../plugins/team/types'
import { HEALTHY_TEAM_HEALTH_REPORT } from './health-report-fixture'

const PROFILE = {
  id: 'pixel',
  name: 'Pixel',
  emoji: '🎨',
  role: 'designer',
  headshot: '',
  model: 'claude-opus-4-7',
  workspacePath: '/tmp/openclaw/workspaces/pixel',
  identity: null, soul: null, rules: null, tools: null, heartbeatMd: null,
  subagentPerms: null,
}

interface FetchExpectation {
  stats?: { usage: { agent: string; sessionId: string; sessionStarted: string; model: string; messages: number; costedMessages?: number; tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number }; cost: { input: number | null; output: number | null; cacheRead: number | null; cacheWrite: number | null; total: number | null; source: 'runtime' | 'unavailable' } } | null }
  recentActivity?: { ok: boolean; activity?: { windowMs: Record<string, number>; errors: Record<string, number>; sinceServerStart: string } }
  skills?: { skills: Array<{ id: string }> }
  lessons?: { ok: boolean; lessons?: Array<{ enabled: boolean }> }
}

const teamRoutes: Array<{ url: string; init?: RequestInit }> = []

function setupFetch(exp: FetchExpectation) {
  teamRoutes.length = 0
  global.fetch = mock((url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url)
    teamRoutes.push({ url: u, init })
    if (u === '/api/plugins/health/doctor') return Promise.resolve({ ok: true, json: () => Promise.resolve(HEALTHY_TEAM_HEALTH_REPORT) } as Response)
    if (u.endsWith('/stats')) return Promise.resolve({ ok: true, json: () => Promise.resolve(exp.stats ?? { usage: null }) } as Response)
    if (u.endsWith('/recent-activity')) return Promise.resolve({ ok: true, json: () => Promise.resolve(exp.recentActivity ?? { ok: true, activity: { windowMs: { '5m': 0, '1h': 0, '24h': 0 }, errors: { '5m': 0, '1h': 0, '24h': 0 }, sinceServerStart: new Date().toISOString() } }) } as Response)
    if (u.endsWith('/skills')) return Promise.resolve({ ok: true, json: () => Promise.resolve(exp.skills ?? { skills: [] }) } as Response)
    if (u.includes('/api/agent-packages/') && u.endsWith('/lessons')) return Promise.resolve({ ok: true, json: () => Promise.resolve(exp.lessons ?? { ok: true, lessons: [] }) } as Response)
    if (u.endsWith('/team')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) } as Response)
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response)
  }) as unknown as typeof global.fetch
}

afterAll(() => {
  try { rmSync(testDir, { recursive: true, force: true }) } catch {}
})

beforeEach(() => {
  useAgentStore.setState({
    agents: [], agentIds: [], agentMap: {}, agentsWithStatus: [],
    displaySettings: { pixel: { teamId: 'team-design' } as never },
    teams: [{ id: 'team-design', label: 'Design', leaderId: '', reportsTo: null }],
    packageStates: {},
    mainAgentId: 'main', loaded: true,
  } as never)
  setupFetch({})
})

describe('OverviewTab', () => {
  function renderTab(packageState?: PackageStateRow) {
    return render(
      <OverviewTab
        agentId="pixel"
        profile={PROFILE}
        packageState={packageState}
        availableModels={[{ id: 'claude-opus-4-7', name: 'Opus 4.7', label: 'Opus' } as never, { id: 'claude-sonnet-4-6', name: 'Sonnet', label: 'Sonnet' } as never]}
        onModelChange={mock(async () => {})}
        savingModel={false}
      />,
    )
  }

  function holdUnrelatedPanelFetches() {
    global.fetch = mock(() => new Promise<Response>(() => {})) as unknown as typeof global.fetch
  }

  it('does NOT render identity (name/role/emoji) — header owns that surface', () => {
    holdUnrelatedPanelFetches()
    renderTab()
    // OverviewTab is rendered standalone in this test (no AgentDetail
    // header), so the identity strings should be entirely absent.
    expect(screen.queryByText('Pixel')).toBeNull()
    expect(screen.queryByText('designer')).toBeNull()
    expect(screen.queryByText('🎨')).toBeNull()
  })

  it('renders the model selector pre-set to the agent\'s model', () => {
    holdUnrelatedPanelFetches()
    renderTab()
    const select = screen.getByRole('combobox', { name: 'Model' })
    expect(select.textContent).toContain('Opus 4.7')
  })

  it('renders the team selector with the current team', () => {
    holdUnrelatedPanelFetches()
    renderTab()
    const teamSelect = screen.getByRole('combobox', { name: 'Team' })
    expect(teamSelect.textContent).toContain('Design')
  })

  it('does NOT render the workspace path — header owns that surface now', () => {
    holdUnrelatedPanelFetches()
    renderTab()
    expect(screen.queryByText('/tmp/openclaw/workspaces/pixel')).toBeNull()
  })

  it('fetches stats / recent-activity / skills / lessons in parallel and renders the counts', async () => {
    setupFetch({
      stats: { usage: { agent: 'pixel', sessionId: 's', sessionStarted: '', model: 'claude-opus-4-7', messages: 12, tokens: { input: 1000, output: 500, cacheRead: 200, cacheWrite: 50, total: 1750 }, cost: { input: 0.01, output: 0.02, cacheRead: 0.001, cacheWrite: 0.001, total: 0.03, source: 'runtime' } } },
      recentActivity: { ok: true, activity: { windowMs: { '5m': 1, '1h': 7, '24h': 23 }, errors: { '5m': 0, '1h': 1, '24h': 1 }, sinceServerStart: new Date().toISOString() } },
      skills: { skills: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
      lessons: { ok: true, lessons: [{ enabled: true }, { enabled: true }, { enabled: false }, { enabled: false }, { enabled: false }] },
    })
    renderTab()
    await waitFor(() => expect(screen.getByText('1,750')).toBeDefined())
    // Distinct values per tile so getByText is unambiguous
    expect(screen.getByText('3')).toBeDefined() // skills count
    expect(screen.getByText('5')).toBeDefined() // lessons total
    expect(screen.getByText('2 enabled')).toBeDefined()
    expect(screen.getByText('1')).toBeDefined() // 5m count
    expect(screen.getByText('7')).toBeDefined() // 1h count
    expect(screen.getByText('23')).toBeDefined() // 24h count
  })

  it('shows em-dash placeholders + suppresses the secondary metric row when stats is null', async () => {
    setupFetch({ stats: { usage: null } })
    renderTab()
    // Top-row tiles render '—' for missing data
    await waitFor(() => expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2))
    // The secondary row (Model / Messages / Cache reads / Cache writes) only
    // renders when usage is present — confirm via labels unique to that row.
    expect(screen.queryByText('Cache reads')).toBeNull()
    expect(screen.queryByText('Cache writes')).toBeNull()
    expect(screen.queryByText('Messages')).toBeNull()
  })

  it('does not render missing runtime cost as zero dollars', async () => {
    setupFetch({
      stats: {
        usage: {
          agent: 'pixel',
          sessionId: 's',
          sessionStarted: '',
          model: 'local-model',
          messages: 1,
          tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, total: 150 },
          cost: { input: null, output: null, cacheRead: null, cacheWrite: null, total: null, source: 'unavailable' },
        },
      },
    })
    renderTab()
    await waitFor(() => expect(screen.getByText('150')).toBeDefined())
    expect(screen.queryByText('$0.00')).toBeNull()
  })

  it('qualifies a partial latest-session cost and omits the misleading per-message average', async () => {
    setupFetch({
      stats: {
        usage: {
          agent: 'pixel',
          sessionId: 's',
          sessionStarted: '',
          model: 'gpt-test',
          messages: 2,
          costedMessages: 1,
          tokens: { input: 200, output: 100, cacheRead: 0, cacheWrite: 0, total: 300 },
          cost: { input: null, output: null, cacheRead: null, cacheWrite: null, total: 0.03, source: 'runtime' },
        },
      },
    })

    renderTab()

    await waitFor(() => expect(screen.getByText('$0.03+')).toBeDefined())
    expect(screen.getByText('Partial reported cost · 1 of 2 messages')).toBeDefined()
    expect(screen.queryByText(/\/msg$/)).toBeNull()
  })

  it('only shows a per-message average when every message reported cost', async () => {
    setupFetch({
      stats: {
        usage: {
          agent: 'pixel',
          sessionId: 's',
          sessionStarted: '',
          model: 'gpt-test',
          messages: 2,
          costedMessages: 2,
          tokens: { input: 200, output: 100, cacheRead: 0, cacheWrite: 0, total: 300 },
          cost: { input: null, output: null, cacheRead: null, cacheWrite: null, total: 0.04, source: 'runtime' },
        },
      },
    })

    renderTab()

    await waitFor(() => expect(screen.getByText('$0.04')).toBeDefined())
    expect(screen.getByText('$0.02/msg')).toBeDefined()
    expect(screen.queryByText('$0.04+')).toBeNull()
  })

  it('treats legacy cost coverage as unknown instead of exact', async () => {
    setupFetch({
      stats: {
        usage: {
          agent: 'pixel',
          sessionId: 's',
          sessionStarted: '',
          model: 'gpt-test',
          messages: 2,
          tokens: { input: 200, output: 100, cacheRead: 0, cacheWrite: 0, total: 300 },
          cost: { input: null, output: null, cacheRead: null, cacheWrite: null, total: 0.03, source: 'runtime' },
        },
      },
    })

    renderTab()

    await waitFor(() => expect(screen.getByText('$0.03+')).toBeDefined())
    expect(screen.getByText('Reported cost · coverage unavailable')).toBeDefined()
    expect(screen.queryByText(/\/msg$/)).toBeNull()
  })

  it('writes /team on team select change', async () => {
    const user = userEvent.setup()
    renderTab()
    await user.click(screen.getByRole('combobox', { name: 'Team' }))
    await user.click(screen.getByRole('option', { name: 'No team' }))
    await waitFor(() => {
      const teamWrites = teamRoutes.filter((c) => c.url === '/api/plugins/team/pixel/team' && c.init?.method === 'PUT')
      expect(teamWrites.length).toBeGreaterThan(0)
    })
  })

  it('renders the embedded PackageCard for the agent (delegating to its own surface)', () => {
    holdUnrelatedPanelFetches()
    renderTab({ agentId: 'pixel', state: 'managed', packageId: 'examples/pixel@0.1.0' })
    expect(screen.getByText('managed')).toBeDefined()
  })

  it('never renders agent A\'s stats on agent B when B\'s fetch fails (error-guarded)', async () => {
    // useJsonFetch keeps the previous payload across url changes; a surviving
    // component instance navigating pixel → blur with a failing stats
    // endpoint must render blur's fallback, never pixel's numbers.
    global.fetch = mock((url: RequestInfo | URL) => {
      const u = String(url)
      if (u === '/api/plugins/health/doctor') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(HEALTHY_TEAM_HEALTH_REPORT) } as Response)
      }
      if (u.endsWith('/pixel/stats')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ usage: { agent: 'pixel', sessionId: 's', sessionStarted: '', model: 'claude-opus-4-7', messages: 12, tokens: { input: 1000, output: 500, cacheRead: 200, cacheWrite: 50, total: 1750 }, cost: { input: 0.01, output: 0.02, cacheRead: 0.001, cacheWrite: 0.001, total: 0.03, source: 'runtime' } } }) } as Response)
      }
      if (u.endsWith('/blur/stats')) {
        return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) } as Response)
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, skills: [], lessons: [] }) } as Response)
    }) as unknown as typeof global.fetch

    const props = {
      profile: PROFILE,
      packageState: undefined,
      availableModels: [{ id: 'claude-opus-4-7', name: 'Opus 4.7', label: 'Opus' } as never],
      onModelChange: mock(async () => {}),
      savingModel: false,
    }
    const view = render(<OverviewTab agentId="pixel" {...props} />)
    await waitFor(() => expect(screen.getByText('1,750')).toBeDefined())

    view.rerender(<OverviewTab agentId="blur" {...props} />)
    await waitFor(() => expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2))
    expect(screen.queryByText('1,750')).toBeNull()
  })
})
