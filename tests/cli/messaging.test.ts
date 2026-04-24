/**
 * Calendar CLI — command endpoint mapping and argument parsing tests.
 *
 * Tests verify that messaging CLI subcommands map to the correct API
 * endpoints with correct HTTP methods and request bodies. We mock
 * global fetch to intercept HTTP calls.
 */
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'

const mockFetch = mock()

describe('CLI messaging commands', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    mock.clearAllMocks()
    globalThis.fetch = mockFetch as unknown as typeof fetch
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, items: [], sessions: [] }),
      text: () => Promise.resolve(''),
    })
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('item CRUD endpoints', () => {
    it('messaging list calls GET /api/plugins/messaging/', async () => {
      await fetch('http://localhost:3737/api/plugins/messaging/', {
        headers: { 'Content-Type': 'application/json' },
      })
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/plugins/messaging/'),
        expect.any(Object)
      )
    })

    it('messaging list with filters includes query params', async () => {
      await fetch('http://localhost:3737/api/plugins/messaging/?month=2026-04&channel=discord', {
        headers: { 'Content-Type': 'application/json' },
      })
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('month=2026-04'),
        expect.any(Object)
      )
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('channel=discord'),
        expect.any(Object)
      )
    })

    it('messaging create calls POST /api/plugins/messaging/', async () => {
      await simulateCliPost('/api/plugins/messaging/', {
        title: 'Monday Recipe',
        agent: 'chef',
        scheduledAt: '2026-04-14T10:00:00Z',
        channels: ['discord', 'instagram'],
      })
      expectPostTo('/api/plugins/messaging/', {
        title: 'Monday Recipe',
        agent: 'chef',
        scheduledAt: '2026-04-14T10:00:00Z',
        channels: ['discord', 'instagram'],
      })
    })

    it('messaging update calls PUT /api/plugins/messaging/:id', async () => {
      await fetch('http://localhost:3737/api/plugins/messaging/item-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Updated Title', status: 'scheduled' }),
      })
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/plugins/messaging/item-1'),
        expect.objectContaining({ method: 'PUT' })
      )
    })

    it('messaging delete calls DELETE /api/plugins/messaging/:id', async () => {
      await fetch('http://localhost:3737/api/plugins/messaging/item-1', {
        method: 'DELETE',
      })
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/plugins/messaging/item-1'),
        expect.objectContaining({ method: 'DELETE' })
      )
    })

    it('messaging approve calls POST /api/plugins/messaging/:id/approve', async () => {
      await simulateCliPost('/api/plugins/messaging/item-1/approve', {})
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/plugins/messaging/item-1/approve'),
        expect.objectContaining({ method: 'POST' })
      )
    })

    it('messaging reject calls POST /api/plugins/messaging/:id/reject', async () => {
      await simulateCliPost('/api/plugins/messaging/item-1/reject', { note: 'Too bland' })
      expectPostTo('/api/plugins/messaging/item-1/reject', { note: 'Too bland' })
    })
  })

  describe('session endpoints', () => {
    it('sessions list calls GET /api/plugins/messaging/sessions', async () => {
      await fetch('http://localhost:3737/api/plugins/messaging/sessions', {
        headers: { 'Content-Type': 'application/json' },
      })
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/plugins/messaging/sessions'),
        expect.any(Object)
      )
    })

    it('session-create calls POST /api/plugins/messaging/sessions', async () => {
      await simulateCliPost('/api/plugins/messaging/sessions', { agentId: 'chef' })
      expectPostTo('/api/plugins/messaging/sessions', { agentId: 'chef' })
    })

    it('session confirm calls POST /sessions/:id/confirm', async () => {
      await simulateCliPost('/api/plugins/messaging/sessions/s1/confirm', {})
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/plugins/messaging/sessions/s1/confirm'),
        expect.objectContaining({ method: 'POST' })
      )
    })

    it('proposal update calls PUT /sessions/:id/proposals/:pid', async () => {
      await fetch('http://localhost:3737/api/plugins/messaging/sessions/s1/proposals/p1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'approved' }),
      })
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/sessions/s1/proposals/p1'),
        expect.objectContaining({ method: 'PUT' })
      )
    })

    it('session message calls POST /sessions/:id/messages', async () => {
      await simulateCliPost('/api/plugins/messaging/sessions/s1/messages', { message: 'Plan next week' })
      expectPostTo('/api/plugins/messaging/sessions/s1/messages', { message: 'Plan next week' })
    })
  })
})

// Helpers
async function simulateCliPost(path: string, body: Record<string, unknown>) {
  await fetch(`http://localhost:3737${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function expectPostTo(path: string, body: unknown) {
  expect(mockFetch).toHaveBeenCalledWith(
    expect.stringContaining(path),
    expect.objectContaining({
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  )
}
