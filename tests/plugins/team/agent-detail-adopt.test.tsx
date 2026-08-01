// @vitest-environment jsdom

/**
 * Adopt-flow wiring contract for the Package card.
 *
 * Click on the Adopt button must:
 *   - mount AdoptDialog with the current agentId baked in
 *   - submit POST /api/agent-packages/install with { source, adopt: agentId }
 *   - on success, fire refreshPackageStates() so the card reflects the new
 *     state without a page reload
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '../../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync } from 'fs'

const testDir = join(tmpdir(), `bakin-test-adopt-wiring-${Date.now()}-${Math.random().toString(36).slice(2)}`)

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
  useQueryState: (_key: string, _default: string) => ['overview', mock(), mock()],
}))
mock.module('@/hooks/use-runtime-status', () => ({
  useRuntimeStatus: () => ({ restartNeeded: false, restart: mock(), restarting: false, markDirty: mock() }),
}))
mock.module('@/components/agent-avatar', () => ({ AgentAvatar: () => <div /> }))

import { useAgentStore } from '../../../plugins/team/hooks/use-agent-store'
import { AgentDetail } from '../../../plugins/team/components/agent-detail'
import { HEALTHY_TEAM_HEALTH_REPORT } from './health-report-fixture'

const PROFILE = {
  id: 'pixel',
  name: 'Pixel',
  emoji: '🎨',
  role: 'designer',
  headshot: 'data:image/png;base64,iVBORw0KGgo=',
  model: 'claude-opus-4-7',
  workspacePath: '/tmp/pixel',
  identity: null, soul: null, rules: null, tools: null, heartbeatMd: null, subagentPerms: null,
}

const installCalls: Array<{ url: string; init?: RequestInit }> = []
let installResponseOk = true

function setupFetch() {
  installCalls.length = 0
  installResponseOk = true
  global.fetch = mock((url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url)
    if (u === '/api/plugins/team/pixel') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(PROFILE) } as Response)
    }
    if (u.startsWith('/api/plugins/models/available')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ models: [] }) } as Response)
    }
    if (u === '/api/plugins/health/doctor') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(HEALTHY_TEAM_HEALTH_REPORT) } as Response)
    }
    if (u === '/api/agent-packages?check=1' && init?.method !== 'POST') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true, agents: [{ agentId: 'pixel', state: 'managed', packageId: 'examples/pixel' }] }),
      } as Response)
    }
    if (u === '/api/agent-packages/install' && init?.method === 'POST') {
      installCalls.push({ url: u, init })
      return Promise.resolve({
        ok: installResponseOk,
        json: () => Promise.resolve(installResponseOk ? { ok: true } : { ok: false, error: 'fail' }),
      } as Response)
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
  setupFetch()
  // Prime store with no row so the Package card renders unmanaged + Adopt button.
  useAgentStore.setState({
    agents: [], agentIds: [], agentMap: {}, agentsWithStatus: [],
    displaySettings: {}, teams: [], packageStates: {},
    mainAgentId: 'main', loaded: true,
  })
})

async function openDetail() {
  await act(async () => {
    render(<AgentDetail agentId="pixel" />)
  })
  await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Pixel' })).toBeDefined())
}

describe('PackageCard — Adopt flow', () => {
  // The Package card's Adopt button has a verbose aria-label that explains
  // what adopting means. The dialog's submit button is just "Adopt". Match
  // the trigger via the aria-label substring; the submit via exact name.
  const triggerName = /Adopt this agent/

  it('opens AdoptDialog with the agentId baked in when Adopt is clicked', async () => {
    await openDetail()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: triggerName })) })
    // Dialog title bakes in the agentId
    await waitFor(() => expect(screen.getByText(/Adopt pixel into a package/)).toBeDefined())
  })

  it('POSTs /api/agent-packages/install with { source, adopt: agentId } on submit', async () => {
    await openDetail()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: triggerName })) })
    await waitFor(() => screen.getByLabelText('Package source'))
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Package source'), {
        target: { value: 'github:examples/pixel@v0.1.0' },
      })
    })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Adopt agent' })) })

    await waitFor(() => expect(installCalls.length).toBe(1))
    const call = installCalls[0]
    expect(call.init?.method).toBe('POST')
    const body = JSON.parse((call.init?.body as string) ?? '{}')
    expect(body).toEqual({ source: 'github:examples/pixel@v0.1.0', adopt: 'pixel' })
  })

  it('refreshes package state on successful adopt', async () => {
    await openDetail()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: triggerName })) })
    await waitFor(() => screen.getByLabelText('Package source'))
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Package source'), {
        target: { value: 'github:examples/pixel' },
      })
    })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Adopt agent' })) })

    // After successful adopt the store should pick up the new state
    // from /api/agent-packages?check=1 (which our mock returns as managed).
    await waitFor(() => expect(useAgentStore.getState().packageStates['pixel']?.state).toBe('managed'))
  })
})
