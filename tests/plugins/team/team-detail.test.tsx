// @vitest-environment jsdom

/**
 * Tests for the team detail page (layered-context spec, C11).
 *
 * Coverage:
 *   - loads members + shared context for a real team
 *   - saving context PUTs to the team context route
 *   - "Sync team" posts to /teams/:id/sync and renders per-member results
 *     including user-edited skips
 *   - global pseudo-team loads the roster + global context file
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '../../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-team-detail-${Date.now()}`)

mock.module('@/core/content-dir', () => ({
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
mock.module('@tanstack/react-router', () => ({
  useNavigate: () => mock(),
  useLocation: () => ({ pathname: '/team/teams/media', searchStr: '', search: {} }),
  useParams: () => ({ teamId: 'media' }),
}))

import { TeamDetail } from '../../../plugins/team/components/team-detail'

let fetchCalls: Array<{ url: string; init?: RequestInit }> = []

const MEMBERS = {
  team: { id: 'media', label: 'Media', color: '#fff' },
  members: [
    { id: 'pixel', name: 'Pixel', emoji: '🎨' },
    { id: 'rolo', name: 'Rolo', emoji: '🎬' },
  ],
}

const SYNC_RESULTS = {
  ok: true,
  teamId: 'media',
  results: [
    {
      agentId: 'pixel',
      receipt: {
        verification: { status: 'ok', findings: [] },
        blocks: [{ file: 'AGENTS.md', action: 'recomposed' }],
        skipped: [],
      },
    },
    {
      agentId: 'rolo',
      receipt: {
        verification: { status: 'ok', findings: [] },
        blocks: [],
        skipped: [{ target: 'runtime:agent-skill:rolo:video-gen', hint: 'bakin agents sync rolo --reclaim …' }],
      },
    },
  ],
}

function installFetch() {
  fetchCalls = []
  global.fetch = mock(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url)
    fetchCalls.push({ url: u, init })
    if (u.endsWith('/teams/media/members')) return { ok: true, json: async () => MEMBERS } as Response
    if (u.includes('/context/team?id=media') && (!init || init.method === undefined)) {
      return { ok: true, json: async () => ({ ok: true, path: '/x/media.md', content: '# Media Team' }) } as Response
    }
    if (u.includes('/context/team?id=media') && init?.method === 'PUT') {
      return { ok: true, json: async () => ({ ok: true, path: '/x/media.md', content: JSON.parse(String(init.body)).content }) } as Response
    }
    if (u.endsWith('/teams/media/sync')) return { ok: true, json: async () => SYNC_RESULTS } as Response
    if (u.endsWith('/context/global')) return { ok: true, json: async () => ({ ok: true, path: '/x/global.md', content: '' }) } as Response
    if (u === '/api/plugins/team/') return { ok: true, json: async () => [{ id: 'main', name: 'Roscoe' }, { id: 'pixel', name: 'Pixel' }] } as Response
    return { ok: false, json: async () => ({}) } as Response
  }) as unknown as typeof global.fetch
}

beforeEach(() => {
  cleanup()
  installFetch()
})

afterEach(() => cleanup())
afterAll(() => {})

describe('TeamDetail', () => {
  it('loads members and the shared context file', async () => {
    render(<TeamDetail teamId="media" />)
    await waitFor(() => expect(screen.getByText('Pixel')).toBeDefined())
    expect(screen.getByText('Rolo')).toBeDefined()
    const editor = screen.getByLabelText('Shared context content') as HTMLTextAreaElement
    expect(editor.value).toBe('# Media Team')
    expect(screen.getByText('/x/media.md')).toBeDefined()
  })

  it('saves edited context via PUT', async () => {
    render(<TeamDetail teamId="media" />)
    await waitFor(() => expect(screen.getByLabelText('Shared context content')).toBeDefined())

    fireEvent.change(screen.getByLabelText('Shared context content'), { target: { value: '# Media Team v2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      const put = fetchCalls.find((c) => c.init?.method === 'PUT')
      expect(put).toBeDefined()
      expect(JSON.parse(String(put!.init!.body)).content).toBe('# Media Team v2')
    })
  })

  it('syncs the team and shows per-member results incl. user-edited skips', async () => {
    render(<TeamDetail teamId="media" />)
    await waitFor(() => expect(screen.getByText('Pixel')).toBeDefined())

    fireEvent.click(screen.getByRole('button', { name: /Sync team/ }))
    await waitFor(() => expect(fetchCalls.some((c) => c.url.endsWith('/teams/media/sync'))).toBe(true))

    await waitFor(() => expect(screen.getByText(/Synced · 1 updated/)).toBeDefined())
    expect(screen.getByText('User-edited content was preserved')).toBeDefined()
  })

  it('renders the global pseudo-team from the roster + global.md', async () => {
    render(<TeamDetail teamId="global" />)
    await waitFor(() => expect(screen.getByText('Roscoe')).toBeDefined())
    expect(screen.getByRole('button', { name: /Sync all agents/ })).toBeDefined()
    expect(fetchCalls.some((c) => c.url.endsWith('/context/global'))).toBe(true)
  })
})
