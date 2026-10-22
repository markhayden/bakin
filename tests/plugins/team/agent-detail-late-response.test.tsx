// @vitest-environment jsdom
/**
 * AgentDetail re-keyed while its profile request is in flight (#966 leaked
 * fetch): the effect for the OLD agent aborts its request on cleanup and a
 * body that still arrives late never overwrites the NEW agent's profile.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, render, screen, waitFor } from '@testing-library/react'
import '../../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'
const testDir = join(tmpdir(), `bakin-test-agent-detail-late-${Date.now()}`)
mock.module('@bakin/core/main-agent', () => ({ getMainAgentId: () => 'main', tryGetMainAgentId: () => 'main', getMainAgentName: () => 'Main' }))
const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({}) })
mock.module('@/core/content-dir', contentDirMock)
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
const openClawHome = () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
})
mock.module('@bakin/adapter-openclaw/home', openClawHome)
mock.module('../../../packages/adapter-openclaw/src/home', openClawHome)
mock.module('../../../packages/sdk/src/hooks/use-query-state', () => ({
  useQueryState: (_key: string, defaultValue: string) => [defaultValue, mock(), mock()],
}))
mock.module('../../../packages/sdk/src/hooks/use-runtime-status', () => ({
  useRuntimeStatus: () => ({ restartNeeded: false, restart: mock(), restarting: false, markDirty: mock() }),
}))
mock.module('../../../plugins/team/hooks/use-agent-store', () => ({
  useAgentStore: (selector: (s: unknown) => unknown) => selector({ teams: [], displaySettings: {}, load: mock() }),
  useAgentColor: () => '#888',
  useMainAgentId: () => 'main',
}))
mock.module('@/components/agent-avatar', () => ({ AgentAvatar: () => <div /> }))
import { AgentDetail } from '../../../plugins/team/components/agent-detail'
import { HEALTHY_TEAM_HEALTH_REPORT } from './health-report-fixture'

type Deferred = { resolve: (body: unknown) => void; signal: AbortSignal | undefined }
const profileRequests = new Map<string, Deferred>()
const profile = (id: string, name: string) => ({ id, name, role: 'Researcher', model: 'opus', soul: '', rules: '', tools: '' })
const originalFetch = global.fetch
beforeEach(() => {
  profileRequests.clear()
  global.fetch = mock((url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url)
    if (u === '/api/plugins/health/doctor') return Promise.resolve({ ok: true, json: () => Promise.resolve(HEALTHY_TEAM_HEALTH_REPORT) } as Response)
    const match = /^\/api\/plugins\/team\/([^/?]+)$/.exec(u)
    if (match) {
      // Each profile request stays open until the test releases it.
      return new Promise<Response>((resolve) => {
        profileRequests.set(match[1]!, {
          signal: init?.signal ?? undefined,
          resolve: (body) => resolve({ ok: true, json: () => Promise.resolve(body) } as Response),
        })
      })
    }
    if (u.includes('/api/plugins/models/available')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ models: [] }) } as Response)
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response)
  }) as unknown as typeof fetch
})
afterEach(() => { global.fetch = originalFetch })

describe('AgentDetail — late profile response after a re-key', () => {
  it('aborts the old agent\'s request and keeps the new agent\'s profile when the old body arrives late', async () => {
    const view = render(<AgentDetail agentId="alpha" />)
    await waitFor(() => expect(profileRequests.has('alpha')).toBe(true))
    expect(profileRequests.get('alpha')!.signal?.aborted).toBe(false)

    await act(async () => { view.rerender(<AgentDetail agentId="beta" />) })
    expect(profileRequests.get('alpha')!.signal?.aborted).toBe(true)
    await waitFor(() => expect(profileRequests.has('beta')).toBe(true))

    await act(async () => { profileRequests.get('beta')!.resolve(profile('beta', 'Beta Agent')) })
    await screen.findByText('Beta Agent')

    // The old body lands after the switch: alpha must not replace beta.
    await act(async () => { profileRequests.get('alpha')!.resolve(profile('alpha', 'Alpha Agent')) })
    await act(async () => {})
    expect(screen.queryByText('Alpha Agent')).toBeNull()
    expect(screen.getByText('Beta Agent')).toBeDefined()
  })
})
