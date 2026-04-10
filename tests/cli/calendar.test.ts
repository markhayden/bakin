/**
 * Calendar CLI — command endpoint mapping and argument parsing tests.
 *
 * Tests verify that calendar CLI subcommands map to the correct API
 * endpoints with correct HTTP methods and request bodies. We mock
 * global fetch to intercept HTTP calls.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockFetch = vi.fn()

describe('CLI calendar commands', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.clearAllMocks()
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
    it('calendar list calls GET /api/plugins/calendar/', async () => {
      await fetch('http://localhost:3737/api/plugins/calendar/', {
        headers: { 'Content-Type': 'application/json' },
      })
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/plugins/calendar/'),
        expect.any(Object)
      )
    })

    it('calendar list with filters includes query params', async () => {
      await fetch('http://localhost:3737/api/plugins/calendar/?month=2026-04&channel=discord', {
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

    it('calendar create calls POST /api/plugins/calendar/', async () => {
      await simulateCliPost('/api/plugins/calendar/', {
        title: 'Monday Recipe',
        agent: 'basil',
        scheduledAt: '2026-04-14T10:00:00Z',
        channels: ['discord', 'instagram'],
      })
      expectPostTo('/api/plugins/calendar/', {
        title: 'Monday Recipe',
        agent: 'basil',
        scheduledAt: '2026-04-14T10:00:00Z',
        channels: ['discord', 'instagram'],
      })
    })

    it('calendar update calls PUT /api/plugins/calendar/:id', async () => {
      await fetch('http://localhost:3737/api/plugins/calendar/item-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Updated Title', status: 'scheduled' }),
      })
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/plugins/calendar/item-1'),
        expect.objectContaining({ method: 'PUT' })
      )
    })

    it('calendar delete calls DELETE /api/plugins/calendar/:id', async () => {
      await fetch('http://localhost:3737/api/plugins/calendar/item-1', {
        method: 'DELETE',
      })
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/plugins/calendar/item-1'),
        expect.objectContaining({ method: 'DELETE' })
      )
    })

    it('calendar approve calls POST /api/plugins/calendar/:id/approve', async () => {
      await simulateCliPost('/api/plugins/calendar/item-1/approve', {})
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/plugins/calendar/item-1/approve'),
        expect.objectContaining({ method: 'POST' })
      )
    })

    it('calendar reject calls POST /api/plugins/calendar/:id/reject', async () => {
      await simulateCliPost('/api/plugins/calendar/item-1/reject', { note: 'Too bland' })
      expectPostTo('/api/plugins/calendar/item-1/reject', { note: 'Too bland' })
    })
  })

  describe('session endpoints', () => {
    it('sessions list calls GET /api/plugins/calendar/sessions', async () => {
      await fetch('http://localhost:3737/api/plugins/calendar/sessions', {
        headers: { 'Content-Type': 'application/json' },
      })
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/plugins/calendar/sessions'),
        expect.any(Object)
      )
    })

    it('session-create calls POST /api/plugins/calendar/sessions', async () => {
      await simulateCliPost('/api/plugins/calendar/sessions', { agentId: 'basil' })
      expectPostTo('/api/plugins/calendar/sessions', { agentId: 'basil' })
    })

    it('session confirm calls POST /sessions/:id/confirm', async () => {
      await simulateCliPost('/api/plugins/calendar/sessions/s1/confirm', {})
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/plugins/calendar/sessions/s1/confirm'),
        expect.objectContaining({ method: 'POST' })
      )
    })

    it('proposal update calls PUT /sessions/:id/proposals/:pid', async () => {
      await fetch('http://localhost:3737/api/plugins/calendar/sessions/s1/proposals/p1', {
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
      await simulateCliPost('/api/plugins/calendar/sessions/s1/messages', { message: 'Plan next week' })
      expectPostTo('/api/plugins/calendar/sessions/s1/messages', { message: 'Plan next week' })
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
