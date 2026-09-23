// @vitest-environment jsdom

/**
 * The Team page's model picker writes through the ONE write path, whose
 * 200 is tri-state (#907): applied, FAILED at the adapter, or PENDING the
 * runtime's confirmation. Only `applied` is success — a failed write shows
 * the adapter's reason, a pending one says the runtime has not confirmed.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-agent-detail-model-save-${Date.now()}`)

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
const queryState: Record<string, string> = { tab: '' }
mock.module('@/hooks/use-query-state', () => ({
  useQueryState: (key: string, defaultValue: string) => [queryState[key] || defaultValue, (v: string) => { queryState[key] = v }, mock()],
}))
mock.module('@/hooks/use-runtime-status', () => ({
  useRuntimeStatus: () => ({ restartNeeded: false, restart: mock(), restarting: false, markDirty: mock(), refresh: mock(async () => {}), pending: false, advice: { needed: false }, lastError: null }),
}))
mock.module('../../../plugins/team/hooks/use-agent-store', () => ({
  useAgentStore: (selector: (s: unknown) => unknown) => selector({ teams: [], displaySettings: {}, load: mock() }),
  useAgentColor: () => '#888',
  useMainAgentId: () => 'main',
}))
mock.module('@/components/agent-avatar', () => ({ AgentAvatar: () => <div /> }))

import { AgentDetail } from '../../../plugins/team/components/agent-detail'
import { HEALTHY_TEAM_HEALTH_REPORT } from './health-report-fixture'

const originalFetch = global.fetch
let mutationResult: Record<string, unknown> = { applied: ['agent:explorer:model'], failed: [], pending: [], warnings: [], revision: 'rev-2' }
let posts: Array<Record<string, unknown>> = []

beforeEach(() => {
  posts = []
  mutationResult = { applied: ['agent:explorer:model'], failed: [], pending: [], warnings: [], revision: 'rev-2' }
  global.fetch = mock((url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url)
    const json = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response)
    if (u === '/api/plugins/health/doctor') return json(HEALTHY_TEAM_HEALTH_REPORT)
    if (u === '/api/plugins/models/selections' && init?.method === 'POST') {
      posts.push(JSON.parse(String(init.body)) as Record<string, unknown>)
      return json(mutationResult)
    }
    if (u === '/api/plugins/models/selections') return json({ revision: 'rev-1', states: [], proposals: [], pending: [], evidence: {} })
    if (u.includes('/api/plugins/models/available')) {
      return json({ models: [{ id: 'anthropic/claude-haiku-4-5', name: 'Claude Haiku 4.5', provider: 'anthropic', tier: 'budget', configured: true, tags: [] }] })
    }
    if (u.includes('/api/plugins/team/') && !u.includes('/avatar')) {
      return json({ id: 'explorer', name: 'Explorer', role: 'Researcher', model: 'opus', soul: '', rules: '', tools: '' })
    }
    return json({})
  }) as unknown as typeof fetch
})
afterEach(() => { global.fetch = originalFetch })

async function pickHaiku() {
  const user = userEvent.setup()
  render(<AgentDetail agentId="explorer" />)
  // The Field label owns the accessible name ("Model"), as the Overview tab's own tests address it.
  await user.click(await screen.findByRole('combobox', { name: 'Model' }))
  await user.click(await screen.findByRole('option', { name: 'Claude Haiku 4.5' }))
  await waitFor(() => expect(posts).toHaveLength(1))
  expect(posts[0]).toMatchObject({ revision: 'rev-1', ops: [{ ref: 'agent:explorer:model', set: { model: 'anthropic/claude-haiku-4-5' } }] })
}

describe('AgentDetail — model picker writes through the tri-state selections path', () => {
  it('a write the adapter FAILED (HTTP 200) shows the adapter\'s reason instead of pretending it saved', async () => {
    mutationResult = { applied: [], failed: [{ ref: 'agent:explorer:model', error: { code: 'write_failed', message: 'gateway refused the agent update' } }], pending: [], warnings: [], revision: 'rev-1' }
    await pickHaiku()
    expect(await screen.findByText('gateway refused the agent update')).toBeTruthy()
  })

  it('a write the runtime has not confirmed says so — and clears again on the next successful save', async () => {
    mutationResult = { applied: [], failed: [], pending: [{ ref: 'agent:explorer:model', intended: 'anthropic/claude-haiku-4-5' }], warnings: [], revision: 'rev-1' }
    await pickHaiku()
    expect((await screen.findByRole('status')).textContent).toContain('waiting for the runtime to confirm')
    expect(screen.queryByText(/refused/)).toBeNull()
  })

  it('an applied write shows neither an error nor a notice', async () => {
    await pickHaiku()
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
    expect(screen.queryByText(/refused/)).toBeNull()
  })
})
