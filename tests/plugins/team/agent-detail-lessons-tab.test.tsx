// @vitest-environment jsdom

/**
 * Lessons tab contract for agent-detail.
 *
 * - Tab is always visible in the tab bar (regardless of package state)
 * - For managed agents the tab renders LessonToggleList
 *   (which fetches from /api/agent-packages/:id/lessons)
 * - For unmanaged/absent/undefined the tab renders a "Lessons require a package"
 *   placeholder with a hint pointing back at the Package card
 * - Tab click writes ?tab=lessons to the URL via useQueryState
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '../../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync } from 'fs'

const testDir = join(tmpdir(), `bakin-test-lessons-tab-${Date.now()}-${Math.random().toString(36).slice(2)}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))
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

const queryState: { tab: string } = { tab: 'profile' }
const setTabSpy = mock((v: string) => { queryState.tab = v })

mock.module('@/hooks/use-query-state', () => ({
  useQueryState: (_key: string, defaultValue: string) => [queryState.tab || defaultValue, setTabSpy, mock()],
}))
mock.module('@/hooks/use-runtime-status', () => ({
  useRuntimeStatus: () => ({ restartNeeded: false, restart: mock(), restarting: false, markDirty: mock() }),
}))
mock.module('@/components/agent-avatar', () => ({ AgentAvatar: () => <div /> }))

import { useAgentStore } from '../../../plugins/team/hooks/use-agent-store'
import { AgentDetail } from '../../../plugins/team/components/agent-detail'
import type { PackageStateRow } from '../../../plugins/team/types'
import { HEALTHY_TEAM_HEALTH_REPORT } from './health-report-fixture'

const PROFILE = {
  id: 'pixel', name: 'Pixel', emoji: '🎨', role: 'designer',
  headshot: 'data:image/png;base64,iVBORw0KGgo=',
  model: 'claude-opus-4-7', workspacePath: '/tmp/pixel',
  identity: null, soul: null, rules: null, tools: null, heartbeatMd: null, subagentPerms: null,
}

function setupFetch() {
  global.fetch = mock((url: RequestInfo | URL) => {
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
    if (u.includes('/api/agent-packages/pixel/lessons')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          packageId: 'examples/pixel@0.1.0',
          lessons: [
            { lessonId: 'l1', title: 'Lesson One', tags: [], defaultEnabled: true, enabled: true },
            { lessonId: 'l2', title: 'Lesson Two', tags: [], defaultEnabled: false, enabled: false },
          ],
        }),
      } as Response)
    }
    if (u.endsWith('/stats')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ usage: null }) } as Response)
    if (u.endsWith('/recent-activity')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, activity: { windowMs: { '5m': 0, '1h': 0, '24h': 0 }, errors: { '5m': 0, '1h': 0, '24h': 0 }, sinceServerStart: new Date().toISOString() } }) } as Response)
    if (u.endsWith('/skills')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ skills: [] }) } as Response)
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response)
  }) as unknown as typeof global.fetch
}

function primeState(packageStates: Record<string, PackageStateRow> = {}) {
  useAgentStore.setState({
    agents: [], agentIds: [], agentMap: {}, agentsWithStatus: [],
    displaySettings: {}, teams: [], packageStates,
    mainAgentId: 'main', loaded: true,
  })
}

afterAll(() => {
  try { rmSync(testDir, { recursive: true, force: true }) } catch {}
})

afterEach(() => {
  queryState.tab = 'overview'
  setTabSpy.mockClear()
})

beforeEach(() => {
  setupFetch()
})

async function openDetail() {
  render(<AgentDetail agentId="pixel" />)
  await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Pixel' })).toBeDefined())
}

describe('AgentDetail — Lessons tab', () => {
  it('shows the Lessons tab in the tab bar', async () => {
    primeState()
    await openDetail()
    expect(screen.getByRole('tab', { name: 'Lessons' })).toBeDefined()
  })

  it('clicking Lessons writes tab=lessons to the URL', async () => {
    primeState()
    await openDetail()
    fireEvent.click(screen.getByRole('tab', { name: 'Lessons' }))
    expect(setTabSpy).toHaveBeenCalledWith('lessons')
  })

  it('renders LessonToggleList for state=managed', async () => {
    primeState({
      pixel: { agentId: 'pixel', state: 'managed', packageId: 'examples/pixel@0.1.0' },
    })
    queryState.tab = 'lessons'
    await openDetail()
    await waitFor(() => expect(screen.getByText('Lesson One')).toBeDefined())
    expect(screen.getByText('Lesson Two')).toBeDefined()
    expect(screen.queryByText('Lessons require a package')).toBeNull()
  })

  it('renders "Lessons require a package" empty state for state=unmanaged', async () => {
    primeState({ pixel: { agentId: 'pixel', state: 'unmanaged' } })
    queryState.tab = 'lessons'
    await openDetail()
    await waitFor(() => expect(screen.getByText('Lessons require a package')).toBeDefined())
    expect(screen.queryByText('Lesson One')).toBeNull()
  })

  it('renders "Lessons require a package" when no package state row exists', async () => {
    primeState()
    queryState.tab = 'lessons'
    await openDetail()
    await waitFor(() => expect(screen.getByText('Lessons require a package')).toBeDefined())
  })
})
