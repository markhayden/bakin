// @vitest-environment jsdom

/**
 * PackageCard rendering contract — covers the read-only display surface
 * inside the agent-detail Profile tab. C3 only asserts what's *visible*
 * per state; the Adopt button is intentionally inert in this commit and
 * gets fully wired in C4.
 *
 * Strategy: PackageCard is not exported. We render the AgentDetail
 * component end-to-end with a minimal profile payload so we can poke at
 * the Profile tab through the real tab bar. The package-state row comes
 * from the Zustand store, which we prime per test.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '../../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync } from 'fs'

const testDir = join(tmpdir(), `bakin-test-package-card-${Date.now()}-${Math.random().toString(36).slice(2)}`)
const navigateMock = mock()

mock.module('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
  useLocation: () => ({ pathname: '/team/pixel', searchStr: '', search: {} }),
  useParams: () => ({ agentId: 'pixel' }),
}))

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

mock.module('@/hooks/use-query-state', () => ({
  useQueryState: (_key: string, defaultValue: string) => ['overview', mock(), mock()],
}))
mock.module('@/hooks/use-runtime-status', () => ({
  useRuntimeStatus: () => ({ restartNeeded: false, restart: mock(), restarting: false, markDirty: mock() }),
}))
mock.module('@/components/agent-avatar', () => ({ AgentAvatar: () => <div /> }))
mock.module('@/components/markdown-content', () => ({ MarkdownContent: () => <div /> }))
mock.module('@/components/model-select', () => ({ ModelSelect: () => <div /> }))

import { useAgentStore } from '../../../plugins/team/hooks/use-agent-store'
import { AgentDetail } from '../../../plugins/team/components/agent-detail'
import { PackageCardBody } from '../../../plugins/team/components/package-card'
import type { PackageStateRow } from '../../../plugins/team/types'
import { HEALTHY_TEAM_HEALTH_REPORT } from './health-report-fixture'

const PROFILE = {
  id: 'pixel',
  name: 'Pixel',
  emoji: '🎨',
  role: 'designer',
  headshot: 'data:image/png;base64,iVBORw0KGgo=',
  model: 'claude-opus-4-7',
  workspacePath: '/tmp/pixel',
  identity: null,
  soul: null,
  rules: null,
  tools: null,
  heartbeatMd: null,
  subagentPerms: null,
}

function primeState(packageStates: Record<string, PackageStateRow> = {}) {
  useAgentStore.setState({
    agents: [], agentIds: [], agentMap: {}, agentsWithStatus: [],
    displaySettings: {}, teams: [], packageStates,
    mainAgentId: 'main', loaded: true,
  })
}

function mockProfileFetch() {
  global.fetch = mock((url: RequestInfo | URL) => {
    const u = String(url)
    if (u === '/api/plugins/team/pixel' || (u.startsWith('/api/plugins/team/pixel') && !u.includes('/avatar') && !u.endsWith('/stats') && !u.endsWith('/recent-activity') && !u.endsWith('/skills') && !u.endsWith('/heartbeat') && !u.endsWith('/active-context'))) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(PROFILE) } as Response)
    }
    if (u.startsWith('/api/plugins/models/available')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ models: [] }) } as Response)
    }
    if (u === '/api/plugins/health/doctor') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(HEALTHY_TEAM_HEALTH_REPORT) } as Response)
    }
    if (u.endsWith('/stats')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ usage: null }) } as Response)
    if (u.endsWith('/recent-activity')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, activity: { windowMs: { '5m': 0, '1h': 0, '24h': 0 }, errors: { '5m': 0, '1h': 0, '24h': 0 }, sinceServerStart: new Date().toISOString() } }) } as Response)
    if (u.endsWith('/skills')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ skills: [] }) } as Response)
    if (u.includes('/api/agent-packages/') && u.endsWith('/lessons')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, lessons: [] }) } as Response)
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response)
  }) as unknown as typeof global.fetch
}

afterAll(() => {
  try { rmSync(testDir, { recursive: true, force: true }) } catch {}
})

beforeEach(() => {
  navigateMock.mockClear()
  mockProfileFetch()
})

async function renderDetail() {
  render(<AgentDetail agentId="pixel" />)
  // Wait for the agent header to render (h1 is unique)
  await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Pixel' })).toBeDefined())
}

describe('PackageCard — read-only display per state', () => {
  it('renders an unmanaged badge + Adopt button + explainer when no row exists', async () => {
    primeState()
    await renderDetail()
    expect(screen.getByText('unmanaged')).toBeDefined()
    const adopt = screen.getByRole('button', { name: /Adopt/ })
    expect(adopt).toBeDefined()
    expect((adopt as HTMLButtonElement).disabled).toBe(false)
    // The explainer text appears below the button so users understand
    // what adoption means before clicking.
    expect(screen.getByText(/lesson toggles/)).toBeDefined()
    expect(screen.getByText(/workspace files stay as-is/)).toBeDefined()
  })

  it('renders a managed badge + entry fields when state=managed', async () => {
    primeState({
      pixel: {
        agentId: 'pixel',
        state: 'managed',
        packageId: 'examples/pixel@0.1.0',
        entry: {
          version: '0.1.0',
          source: 'github:examples/pixel',
          ref: 'v0.1.0',
          commitSha: 'abc1234567',
          installedAt: '2026-04-25T00:00:00Z',
          dependencies: ['examples/shared@0.1.0'],
        },
      },
    })
    await renderDetail()
    expect(screen.getByText('managed')).toBeDefined()
    expect(screen.getByText('0.1.0')).toBeDefined()
    expect(screen.getByText('github:examples/pixel')).toBeDefined()
    expect(screen.getByText('v0.1.0')).toBeDefined()
    // commitSha gets sliced to 7 chars
    expect(screen.getByText('abc1234')).toBeDefined()
    expect(screen.getByText('examples/shared@0.1.0')).toBeDefined()
    // No Adopt button on managed state
    expect(screen.queryByRole('button', { name: 'Adopt' })).toBeNull()
  })

  it('prefers the top-level installed version over nested entry metadata', async () => {
    primeState({
      pixel: {
        agentId: 'pixel',
        state: 'managed',
        version: '0.2.0',
        packageId: 'examples/pixel',
        entry: {
          version: '0.1.0',
          source: 'github:examples/pixel',
          ref: 'main',
          commitSha: 'abc1234567',
          installedAt: '2026-04-25T00:00:00Z',
        },
      },
    })
    await renderDetail()
    expect(screen.getByText('0.2.0')).toBeDefined()
    expect(screen.queryByText('0.1.0')).toBeNull()
  })

  it('renders a CLI hint with Copy button for state=drifted', async () => {
    primeState({
      pixel: { agentId: 'pixel', state: 'drifted', packageId: 'examples/pixel@0.1.0' },
    })
    await renderDetail()
    expect(screen.getByText('drifted')).toBeDefined()
    expect(screen.getByText('bakin install agent-sync')).toBeDefined()
    expect(screen.getByLabelText('Copy command')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Adopt' })).toBeNull()
  })

  it('renders an in-card Upgrade action for state=update-available', async () => {
    primeState({
      pixel: {
        agentId: 'pixel',
        state: 'update-available',
        packageId: 'examples/pixel@0.1.0',
        entry: {
          version: '0.1.0',
          source: 'github:examples/pixel',
          ref: 'main',
          commitSha: 'abc1234567',
          installedAt: '2026-04-20T00:00:00Z',
        },
      },
    })
    await renderDetail()
    expect(screen.getByText('update available')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Upgrade agent package' })).toBeDefined()
    expect(screen.queryByText('bakin agents update pixel')).toBeNull()
  })
})

describe('PackageCard — main agent special-case', () => {
  function setupMainFetch() {
    const MAIN_PROFILE = { ...PROFILE, id: 'main', name: 'Main Operator', role: 'Head Honcho' }
    global.fetch = mock((url: RequestInfo | URL) => {
      const u = String(url)
      if (u === '/api/plugins/team/main') return Promise.resolve({ ok: true, json: () => Promise.resolve(MAIN_PROFILE) } as Response)
      if (u.startsWith('/api/plugins/models/available')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ models: [] }) } as Response)
      if (u === '/api/plugins/health/doctor') return Promise.resolve({ ok: true, json: () => Promise.resolve(HEALTHY_TEAM_HEALTH_REPORT) } as Response)
      if (u.endsWith('/stats')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ usage: null }) } as Response)
      if (u.endsWith('/recent-activity')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, activity: { windowMs: { '5m': 0, '1h': 0, '24h': 0 }, errors: { '5m': 0, '1h': 0, '24h': 0 }, sinceServerStart: new Date().toISOString() } }) } as Response)
      if (u.endsWith('/skills')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ skills: [] }) } as Response)
      if (u.includes('/api/agent-packages/') && u.endsWith('/lessons')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, lessons: [] }) } as Response)
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response)
    }) as unknown as typeof global.fetch
  }

  beforeEach(() => {
    setupMainFetch()
    primeState()
  })

  it('shows "Self-managed" instead of Adopt for the main agent when unmanaged', async () => {
    render(<AgentDetail agentId="main" />)
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Main Operator' })).toBeDefined())

    // No Adopt button on main
    expect(screen.queryByRole('button', { name: /Adopt/ })).toBeNull()
    // Self-managed badge instead
    expect(screen.getByText('Self-managed')).toBeDefined()
    // Explainer copy that frames the design choice
    expect(screen.getByText(/main agent is your own persona/)).toBeDefined()
  })

  it('still shows package details for main agent if it is somehow managed', async () => {
    primeState({
      main: {
        agentId: 'main',
        state: 'managed',
        packageId: 'examples/main@0.1.0',
        entry: { version: '0.1.0', source: 'github:examples/main', ref: 'v0.1.0', commitSha: 'abcdefg', installedAt: '2026-04-25T00:00:00Z' },
      },
    })
    render(<AgentDetail agentId="main" />)
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Main Operator' })).toBeDefined())

    // Managed/adopted main bypasses the Self-managed special-case and shows
    // standard package fields. (This is an unusual state but should not crash.)
    expect(screen.getByText('managed')).toBeDefined()
    expect(screen.getByText('0.1.0')).toBeDefined()
    expect(screen.getByText('github:examples/main')).toBeDefined()
  })
})

describe('PackageCard — update and remove actions', () => {
  const UPDATE_ROW: PackageStateRow = {
    agentId: 'pixel',
    state: 'managed',
    version: '0.1.0',
    packageId: 'pixel',
    entry: {
      version: '0.1.0',
      source: 'github:examples/pixel',
      ref: 'main',
      commitSha: 'abc1234567',
      installedAt: '2026-04-25T00:00:00Z',
    },
    updateStatus: {
      currentVersion: '0.1.0',
      latestVersion: '0.2.0',
      currentCommitSha: 'abc1234567',
      latestCommitSha: 'def7654321',
      upgradeAvailable: true,
      checkedAt: '2026-06-01T12:00:00.000Z',
    },
  }

  beforeEach(() => {
    primeState({ pixel: UPDATE_ROW })
  })

  function setupActionFetch() {
    const fetchMock = mock((url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url)
      if (u === '/api/agent-packages/pixel/update' && init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: { changed: true } }) } as Response)
      }
      if (u === '/api/agent-packages/pixel' && init?.method === 'DELETE') {
        const body = typeof init.body === 'string' ? JSON.parse(init.body) as { deleteAgent?: boolean } : {}
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            result: body.deleteAgent
              ? { removed: ['pixel'], deletedAgent: true }
              : { removed: ['pixel'] },
          }),
        } as Response)
      }
      if (u === '/api/agent-packages?check=1') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, agents: [UPDATE_ROW] }) } as Response)
      }
      if (u === '/api/plugins/team/') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ agents: [], displaySettings: {}, teams: [], mainAgentId: 'main' }) } as Response)
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response)
    })
    global.fetch = fetchMock as unknown as typeof global.fetch
    return fetchMock
  }

  it('opens the sync modal and posts to the sync route', async () => {
    const fetchMock = setupActionFetch()

    render(<PackageCardBody agentId="pixel" packageState={UPDATE_ROW} />)

    expect(screen.getByText('update available')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade agent package' }))
    expect(screen.getByRole('heading', { name: 'Sync pixel' })).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Sync agent' }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.some((call) => (
        call[0] === '/api/agent-packages/pixel/sync'
        && (call[1] as RequestInit | undefined)?.method === 'POST'
      ))).toBe(true)
    })
  })

  it('opens remove modal and sends orphan/delete payloads', async () => {
    const fetchMock = setupActionFetch()

    render(<PackageCardBody agentId="pixel" packageState={UPDATE_ROW} />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete or orphan agent package' }))
    expect(screen.getByRole('heading', { name: 'Remove agent package' })).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Orphan package' }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.some((call) => (
        call[0] === '/api/agent-packages/pixel'
        && (call[1] as RequestInit | undefined)?.method === 'DELETE'
        && String((call[1] as RequestInit | undefined)?.body).includes('"deleteAgent":false')
      ))).toBe(true)
    })
  })

  it('routes back to Team after full delete succeeds', async () => {
    const fetchMock = setupActionFetch()

    render(<PackageCardBody agentId="pixel" packageState={UPDATE_ROW} />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete or orphan agent package' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete agent' }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.some((call) => (
        call[0] === '/api/agent-packages/pixel'
        && (call[1] as RequestInit | undefined)?.method === 'DELETE'
        && String((call[1] as RequestInit | undefined)?.body).includes('"deleteAgent":true')
      ))).toBe(true)
      expect(navigateMock.mock.calls.some((call) => {
        const arg = call[0] as { to?: string } | string
        return typeof arg === 'string' ? arg === '/team' : arg?.to === '/team'
      })).toBe(true)
    })
  })
})
