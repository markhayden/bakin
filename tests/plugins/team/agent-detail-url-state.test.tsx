// @vitest-environment jsdom
/**
 * Agent detail in-page selection rides the URL (spec settings-url-state,
 * Phase 2 rule 1): the Skills tab's selected skill is `?skill=<id>` and the
 * Memory tab's selected daily file is `?file=<name>`. The default (first
 * item) is omitted from the URL, a stale id falls back to the first item
 * WITHOUT rewriting the URL, and a selection writes one replace navigation.
 *
 * Renders the real tab bodies under the router shim with a stable spy
 * navigate; useLocation reads happy-dom's window.location.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '../../rtl-settle'
import { actRender } from '../../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'
import { settleFor } from '../../helpers/wait'

const testDir = join(tmpdir(), `bakin-test-agent-detail-url-state-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))
mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
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
mock.module('@/hooks/use-runtime-status', () => ({
  useRuntimeStatus: () => ({ restartNeeded: false, restart: mock(), restarting: false, markDirty: mock() }),
}))
mock.module('../../../plugins/team/hooks/use-agent-store', () => ({
  useAgentStore: (selector: (s: unknown) => unknown) => selector({ teams: [], displaySettings: {}, load: mock() }),
  useAgentColor: () => '#888',
  useMainAgentId: () => 'main',
}))
mock.module('@/components/agent-avatar', () => ({ AgentAvatar: () => <div /> }))

// Router shim + a STABLE spy navigate (a per-render function churns the SDK
// setters and re-fires URL effects the product never sees).
const navigations: Array<Record<string, unknown>> = []
const navigate = (opts: Record<string, unknown>) => navigations.push(opts)
mock.module('@tanstack/react-router', () => ({
  ...require('../../shims/tanstack-router'),
  useNavigate: () => navigate,
}))

import { MemoryTab, SkillsTab } from '../../../plugins/team/components/agent-detail'

function setURL(url: string) {
  const happy = (window as unknown as { happyDOM?: { setURL: (u: string) => void } }).happyDOM
  happy?.setURL(url)
}

let fetched: string[]
function installFetch() {
  fetched = []
  globalThis.fetch = mock(async (input: RequestInfo | URL) => {
    const url = String(input)
    fetched.push(url)
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
    if (url.endsWith('/pixel/skills')) {
      return json({ skills: [
        { id: 'alpha', name: 'Alpha', hasSkillMd: true },
        { id: 'beta', name: 'Beta', hasSkillMd: true },
      ] })
    }
    if (url.includes('/pixel/skills/')) return json({ content: `# ${url.split('/').pop()}` })
    if (url.endsWith('/pixel/memory')) return json({ files: ['2026-09-17.md', '2026-09-18.md'] })
    if (url.includes('/pixel/memory/')) return json({ content: `memory ${url.split('/').pop()}` })
    return json({})
  }) as unknown as typeof fetch
}

beforeEach(() => {
  navigations.length = 0
  installFetch()
})
afterEach(() => {
  cleanup()
  setURL('http://localhost/')
})

async function mountAt(url: string, node: React.ReactElement) {
  setURL(`http://localhost${url}`)
  await actRender(() => render(node))
}

// Skill items carry a "Guide" badge in their accessible name ("Alpha Guide"),
// so names match by prefix.
const current = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}\\b`) }).getAttribute('aria-current')

describe('Skills tab ?skill=', () => {
  it('cold-loads the skill named by ?skill= without navigating', async () => {
    await mountAt('/team/pixel?tab=skills&skill=beta', <SkillsTab agentId="pixel" />)
    await waitFor(() => expect(current('Beta')).toBe('true'))
    await waitFor(() => expect(fetched.some((u) => u.endsWith('/skills/beta'))).toBe(true))
    expect(screen.getByText('# beta')).toBeTruthy()
    expect(navigations).toHaveLength(0)
  })

  it('shows the first skill with a clean URL when ?skill= is absent', async () => {
    await mountAt('/team/pixel?tab=skills', <SkillsTab agentId="pixel" />)
    await waitFor(() => expect(current('Alpha')).toBe('true'))
    await waitFor(() => expect(fetched.some((u) => u.endsWith('/skills/alpha'))).toBe(true))
    await settleFor(50, 'the default selection must not write itself into the URL')
    expect(navigations).toHaveLength(0)
  })

  it('falls back to the first skill for a stale id without rewriting the URL', async () => {
    await mountAt('/team/pixel?tab=skills&skill=nope', <SkillsTab agentId="pixel" />)
    await waitFor(() => expect(current('Alpha')).toBe('true'))
    await settleFor(50, 'a stale in-page selection shows the first item; nothing to normalize')
    expect(navigations).toHaveLength(0)
    expect(fetched.some((u) => u.endsWith('/skills/nope'))).toBe(false)
  })

  it('selecting a skill writes ?skill= in one replace navigation, keeping ?tab=', async () => {
    await mountAt('/team/pixel?tab=skills', <SkillsTab agentId="pixel" />)
    await waitFor(() => expect(current('Alpha')).toBe('true'))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Beta\b/ })) })
    await waitFor(() => expect(navigations).toHaveLength(1))
    expect(navigations[0]).toMatchObject({ to: '/team/pixel', search: { tab: 'skills', skill: 'beta' }, replace: true })
  })
})

describe('Memory tab ?file=', () => {
  it('cold-loads the file named by ?file= without navigating', async () => {
    await mountAt('/team/pixel?tab=memory&file=2026-09-18.md', <MemoryTab agentId="pixel" />)
    await waitFor(() => expect(current('2026-09-18')).toBe('true'))
    await waitFor(() => expect(fetched.some((u) => u.endsWith('/memory/2026-09-18.md'))).toBe(true))
    expect(screen.getByText('memory 2026-09-18.md')).toBeTruthy()
    expect(navigations).toHaveLength(0)
  })

  it('shows the first file with a clean URL when ?file= is absent', async () => {
    await mountAt('/team/pixel?tab=memory', <MemoryTab agentId="pixel" />)
    await waitFor(() => expect(current('2026-09-17')).toBe('true'))
    await waitFor(() => expect(fetched.some((u) => u.endsWith('/memory/2026-09-17.md'))).toBe(true))
    await settleFor(50, 'the default selection must not write itself into the URL')
    expect(navigations).toHaveLength(0)
  })

  it('falls back to the first file for a stale name without rewriting the URL', async () => {
    await mountAt('/team/pixel?tab=memory&file=1999-01-01.md', <MemoryTab agentId="pixel" />)
    await waitFor(() => expect(current('2026-09-17')).toBe('true'))
    await settleFor(50, 'a stale in-page selection shows the first item; nothing to normalize')
    expect(navigations).toHaveLength(0)
    expect(fetched.some((u) => u.endsWith('/memory/1999-01-01.md'))).toBe(false)
  })

  it('selecting a file writes ?file= in one replace navigation, keeping ?tab=', async () => {
    await mountAt('/team/pixel?tab=memory', <MemoryTab agentId="pixel" />)
    await waitFor(() => expect(current('2026-09-17')).toBe('true'))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '2026-09-18' })) })
    await waitFor(() => expect(navigations).toHaveLength(1))
    expect(navigations[0]).toMatchObject({ to: '/team/pixel', search: { tab: 'memory', file: '2026-09-18.md' }, replace: true })
  })
})
