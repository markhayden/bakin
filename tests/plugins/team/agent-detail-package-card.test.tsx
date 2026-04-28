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
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync } from 'fs'

const testDir = join(tmpdir(), `bakin-test-package-card-${Date.now()}-${Math.random().toString(36).slice(2)}`)

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
mock.module('@bakin/core/openclaw-home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../../packages/core/src/openclaw-home', () => ({
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
import type { PackageStateRow } from '../../../plugins/team/types'

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
    if (u.endsWith('/stats')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ usage: null }) } as Response)
    if (u.endsWith('/recent-activity')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, activity: { windowMs: { '5m': 0, '1h': 0, '24h': 0 }, errors: { '5m': 0, '1h': 0, '24h': 0 }, sinceServerStart: new Date().toISOString() } }) } as Response)
    if (u.endsWith('/skills')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ skills: [] }) } as Response)
    if (u.includes('/api/agent-packages/') && u.endsWith('/knowledge')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, lessons: [] }) } as Response)
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response)
  }) as unknown as typeof global.fetch
}

afterAll(() => {
  try { rmSync(testDir, { recursive: true, force: true }) } catch {}
})

afterEach(() => {
  cleanup()
})

beforeEach(() => {
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
    expect(screen.getByText(/knowledge-lesson toggles/)).toBeDefined()
    expect(screen.getByText(/workspace files stay as-is/)).toBeDefined()
  })

  it('renders a managed badge + entry fields when state=managed', async () => {
    primeState({
      pixel: {
        agentId: 'pixel',
        state: 'managed',
        packageId: 'examples/pixel@0.1.0',
        entry: {
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
    expect(screen.getByText('github:examples/pixel')).toBeDefined()
    expect(screen.getByText('v0.1.0')).toBeDefined()
    // commitSha gets sliced to 7 chars
    expect(screen.getByText('abc1234')).toBeDefined()
    expect(screen.getByText('examples/shared@0.1.0')).toBeDefined()
    // No Adopt button on managed state
    expect(screen.queryByRole('button', { name: 'Adopt' })).toBeNull()
  })

  it('renders an adopted badge + entry fields when state=adopted', async () => {
    primeState({
      pixel: {
        agentId: 'pixel',
        state: 'adopted',
        packageId: 'examples/pixel@0.1.0',
        entry: {
          source: 'github:examples/pixel',
          ref: 'main',
          commitSha: 'feedface',
          installedAt: '2026-04-20T00:00:00Z',
        },
      },
    })
    await renderDetail()
    expect(screen.getByText('adopted')).toBeDefined()
    expect(screen.getByText('github:examples/pixel')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Adopt' })).toBeNull()
  })

  it('renders a CLI hint with Copy button for state=drifted', async () => {
    primeState({
      pixel: { agentId: 'pixel', state: 'drifted', packageId: 'examples/pixel@0.1.0' },
    })
    await renderDetail()
    expect(screen.getByText('drifted')).toBeDefined()
    expect(screen.getByText('bakin install agent-assets')).toBeDefined()
    expect(screen.getByLabelText('Copy command')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Adopt' })).toBeNull()
  })

  it('renders a CLI hint with the agent id baked in for state=update-available', async () => {
    primeState({
      pixel: { agentId: 'pixel', state: 'update-available', packageId: 'examples/pixel@0.1.0' },
    })
    await renderDetail()
    expect(screen.getByText('update available')).toBeDefined()
    expect(screen.getByText('bakin agents update pixel')).toBeDefined()
    expect(screen.getByLabelText('Copy command')).toBeDefined()
  })
})

describe('PackageCard — main agent special-case', () => {
  function setupMainFetch() {
    const MAIN_PROFILE = { ...PROFILE, id: 'main', name: 'Main Operator', role: 'Head Honcho' }
    global.fetch = mock((url: RequestInfo | URL) => {
      const u = String(url)
      if (u === '/api/plugins/team/main') return Promise.resolve({ ok: true, json: () => Promise.resolve(MAIN_PROFILE) } as Response)
      if (u.startsWith('/api/plugins/models/available')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ models: [] }) } as Response)
      if (u.endsWith('/stats')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ usage: null }) } as Response)
      if (u.endsWith('/recent-activity')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, activity: { windowMs: { '5m': 0, '1h': 0, '24h': 0 }, errors: { '5m': 0, '1h': 0, '24h': 0 }, sinceServerStart: new Date().toISOString() } }) } as Response)
      if (u.endsWith('/skills')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ skills: [] }) } as Response)
      if (u.includes('/api/agent-packages/') && u.endsWith('/knowledge')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, lessons: [] }) } as Response)
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
        entry: { source: 'github:examples/main', ref: 'v0.1.0', commitSha: 'abcdefg', installedAt: '2026-04-25T00:00:00Z' },
      },
    })
    render(<AgentDetail agentId="main" />)
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Main Operator' })).toBeDefined())

    // Managed/adopted main bypasses the Self-managed special-case and shows
    // standard package fields. (This is an unusual state but should not crash.)
    expect(screen.getByText('managed')).toBeDefined()
    expect(screen.getByText('github:examples/main')).toBeDefined()
  })
})
