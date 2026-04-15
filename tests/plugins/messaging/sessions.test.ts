/**
 * Calendar plugin — planning session tests.
 *
 * Tests session CRUD routes, session exec tools, proposal lifecycle,
 * and plan confirmation (creates CalendarItems from approved proposals).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdirSync, rmSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'

const testDir = vi.hoisted(() => {
  const { join } = require('path')
  const { tmpdir } = require('os')
  return join(tmpdir(), `bakin-test-sessions-${Date.now()}`)
})

// ---------------------------------------------------------------------------
// Mocks — must be before any plugin imports
// ---------------------------------------------------------------------------

vi.mock('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ calendar: testDir }),
}))

vi.mock('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('../../../src/core/audit', () => ({
  appendAudit: vi.fn(),
}))

vi.mock('../../../src/core/watcher', () => ({
  watchDir: vi.fn(),
}))

// Mock the gateway module so tests don't hit a real gateway
vi.mock('../../../plugins/messaging/lib/gateway', () => ({
  streamChatCompletion: vi.fn(async () => {
    // Return a mock Response with SSE body
    const encoder = new TextEncoder()
    const body = new ReadableStream({
      start(controller) {
        const reply = '[mock:Basil] Acknowledged. Task understood — working on it.'
        const words = reply.split(/(\s+)/)
        for (const word of words) {
          if (!word) continue
          const chunk = JSON.stringify({ choices: [{ delta: { content: word } }] })
          controller.enqueue(encoder.encode(`data: ${chunk}\n\n`))
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      },
    })
    return new Response(body, {
      headers: { 'Content-Type': 'text/event-stream' },
    })
  }),
  chatCompletion: vi.fn(async () =>
    '[mock:Basil] Acknowledged. Task understood — working on it.'
  ),
}))

// Mock openclaw-home to prevent filesystem access
vi.mock('@bakin/core/openclaw-home', () => ({
  getOpenClawPath: vi.fn(() => '/tmp/mock-openclaw.json'),
  getOpenClawHome: vi.fn(() => '/tmp/mock-openclaw'),
}))

// Suppress SSE broadcast
;(globalThis as any).__bakinBroadcast = vi.fn()

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import messagingPlugin from '../../../plugins/messaging/index'
import {
  activatePlugin,
  findRoute,
  findTool,
  callRoute,
  callTool,
} from '../test-helpers'
import type { ActivatedPlugin } from '../test-helpers'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let plugin: ActivatedPlugin

beforeAll(async () => {
  mkdirSync(testDir, { recursive: true })
  // Seed empty messaging.json for calendar item storage
  const { writeFileSync } = await import('fs')
  writeFileSync(join(testDir, 'messaging.json'), '[]')
  plugin = await activatePlugin(messagingPlugin, testDir)
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  // Clear sessions directory between tests
  const sessionsDir = join(testDir, 'messaging', 'sessions')
  if (existsSync(sessionsDir)) {
    rmSync(sessionsDir, { recursive: true, force: true })
  }
  // Reset messaging.json
  const { writeFileSync } = require('fs')
  writeFileSync(join(testDir, 'messaging.json'), '[]')
  vi.clearAllMocks()
})

// ===========================================================================
// SESSION ROUTES
// ===========================================================================

describe('Session routes', () => {
  // ── GET /sessions ─────────────────────────────────────────────────────

  describe('GET /sessions', () => {
    it('is registered', () => {
      expect(findRoute(plugin.routes, 'GET', '/sessions')).toBeDefined()
    })

    it('returns empty list when no sessions exist', async () => {
      const route = findRoute(plugin.routes, 'GET', '/sessions')!
      const { status, body } = await callRoute(route, plugin.ctx)
      expect(status).toBe(200)
      expect(body.sessions).toEqual([])
    })

    it('returns sessions after creation', async () => {
      // Create a session first via POST
      const postRoute = findRoute(plugin.routes, 'POST', '/sessions')!
      await callRoute(postRoute, plugin.ctx, {
        body: { agentId: 'basil', title: 'Test Session' },
      })

      const route = findRoute(plugin.routes, 'GET', '/sessions')!
      const { status, body } = await callRoute(route, plugin.ctx)
      expect(status).toBe(200)
      const sessions = body.sessions as Array<Record<string, unknown>>
      expect(sessions.length).toBe(1)
      expect(sessions[0].agentId).toBe('basil')
      expect(sessions[0].title).toBe('Test Session')
    })

    it('filters by status', async () => {
      const postRoute = findRoute(plugin.routes, 'POST', '/sessions')!
      await callRoute(postRoute, plugin.ctx, {
        body: { agentId: 'basil', title: 'Active One' },
      })

      const route = findRoute(plugin.routes, 'GET', '/sessions')!
      const { body: active } = await callRoute(route, plugin.ctx, {
        searchParams: { status: 'active' },
      })
      expect((active.sessions as unknown[]).length).toBe(1)

      const { body: completed } = await callRoute(route, plugin.ctx, {
        searchParams: { status: 'completed' },
      })
      expect((completed.sessions as unknown[]).length).toBe(0)
    })

    it('filters by agentId', async () => {
      const postRoute = findRoute(plugin.routes, 'POST', '/sessions')!
      await callRoute(postRoute, plugin.ctx, {
        body: { agentId: 'basil', title: 'Basil Session' },
      })
      await callRoute(postRoute, plugin.ctx, {
        body: { agentId: 'scout', title: 'Scout Session' },
      })

      const route = findRoute(plugin.routes, 'GET', '/sessions')!
      const { body } = await callRoute(route, plugin.ctx, {
        searchParams: { agentId: 'scout' },
      })
      const sessions = body.sessions as Array<Record<string, unknown>>
      expect(sessions.length).toBe(1)
      expect(sessions[0].agentId).toBe('scout')
    })
  })

  // ── POST /sessions ────────────────────────────────────────────────────

  describe('POST /sessions', () => {
    it('is registered', () => {
      expect(findRoute(plugin.routes, 'POST', '/sessions')).toBeDefined()
    })

    it('creates a session with agentId and title', async () => {
      const route = findRoute(plugin.routes, 'POST', '/sessions')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        body: { agentId: 'basil', title: 'My Plan' },
      })
      expect(status).toBe(200)
      expect(body.ok).toBe(true)
      const session = body.session as Record<string, unknown>
      expect(session.agentId).toBe('basil')
      expect(session.title).toBe('My Plan')
      expect(session.status).toBe('active')
      expect(session.id).toBeDefined()
    })

    it('creates a session with default title', async () => {
      const route = findRoute(plugin.routes, 'POST', '/sessions')!
      const { body } = await callRoute(route, plugin.ctx, {
        body: { agentId: 'nemo' },
      })
      const session = body.session as Record<string, unknown>
      expect(session.title).toBe('New planning session')
    })

    it('returns 400 without agentId', async () => {
      const route = findRoute(plugin.routes, 'POST', '/sessions')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        body: { title: 'No Agent' },
      })
      expect(status).toBe(400)
      expect(body.error).toBeDefined()
    })

    it('emits audit event on creation', async () => {
      const route = findRoute(plugin.routes, 'POST', '/sessions')!
      await callRoute(route, plugin.ctx, {
        body: { agentId: 'basil', title: 'Audit Test' },
      })
      expect(plugin.ctx.activity.audit).toHaveBeenCalledWith(
        'session.created',
        'basil',
        expect.objectContaining({ sessionId: expect.any(String) })
      )
    })
  })

  // ── GET /sessions/:id ─────────────────────────────────────────────────

  describe('GET /sessions/:id', () => {
    it('is registered', () => {
      expect(findRoute(plugin.routes, 'GET', '/sessions/:id')).toBeDefined()
    })

    it('returns a session by id', async () => {
      // Create first
      const postRoute = findRoute(plugin.routes, 'POST', '/sessions')!
      const { body: createBody } = await callRoute(postRoute, plugin.ctx, {
        body: { agentId: 'zen', title: 'Zen Plan' },
      })
      const sessionId = (createBody.session as Record<string, unknown>).id as string

      const route = findRoute(plugin.routes, 'GET', '/sessions/:id')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        searchParams: { id: sessionId },
      })
      expect(status).toBe(200)
      const session = body.session as Record<string, unknown>
      expect(session.id).toBe(sessionId)
      expect(session.title).toBe('Zen Plan')
    })

    it('returns 404 for nonexistent session', async () => {
      const route = findRoute(plugin.routes, 'GET', '/sessions/:id')!
      const { status } = await callRoute(route, plugin.ctx, {
        searchParams: { id: 'nonexistent' },
      })
      expect(status).toBe(404)
    })

    it('returns 400 without id', async () => {
      const route = findRoute(plugin.routes, 'GET', '/sessions/:id')!
      const { status } = await callRoute(route, plugin.ctx)
      expect(status).toBe(400)
    })
  })

  // ── PUT /sessions/:id ─────────────────────────────────────────────────

  describe('PUT /sessions/:id', () => {
    it('updates session title', async () => {
      const postRoute = findRoute(plugin.routes, 'POST', '/sessions')!
      const { body: createBody } = await callRoute(postRoute, plugin.ctx, {
        body: { agentId: 'basil', title: 'Original' },
      })
      const sessionId = (createBody.session as Record<string, unknown>).id as string

      const route = findRoute(plugin.routes, 'PUT', '/sessions/:id')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        searchParams: { id: sessionId },
        body: { title: 'Updated Title' },
      })
      expect(status).toBe(200)
      expect((body.session as Record<string, unknown>).title).toBe('Updated Title')
    })

    it('returns 404 for nonexistent session', async () => {
      const route = findRoute(plugin.routes, 'PUT', '/sessions/:id')!
      const { status } = await callRoute(route, plugin.ctx, {
        searchParams: { id: 'nonexistent' },
        body: { title: 'X' },
      })
      expect(status).toBe(404)
    })
  })

  // ── DELETE /sessions/:id ──────────────────────────────────────────────

  describe('DELETE /sessions/:id', () => {
    it('deletes a session', async () => {
      const postRoute = findRoute(plugin.routes, 'POST', '/sessions')!
      const { body: createBody } = await callRoute(postRoute, plugin.ctx, {
        body: { agentId: 'basil' },
      })
      const sessionId = (createBody.session as Record<string, unknown>).id as string

      const route = findRoute(plugin.routes, 'DELETE', '/sessions/:id')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        searchParams: { id: sessionId },
      })
      expect(status).toBe(200)
      expect(body.ok).toBe(true)

      // Verify it's gone
      const getRoute = findRoute(plugin.routes, 'GET', '/sessions/:id')!
      const { status: getStatus } = await callRoute(getRoute, plugin.ctx, {
        searchParams: { id: sessionId },
      })
      expect(getStatus).toBe(404)
    })

    it('returns 404 for nonexistent session', async () => {
      const route = findRoute(plugin.routes, 'DELETE', '/sessions/:id')!
      const { status } = await callRoute(route, plugin.ctx, {
        searchParams: { id: 'nonexistent' },
      })
      expect(status).toBe(404)
    })
  })

  // ── POST /sessions/:id/messages ───────────────────────────────────────

  describe('POST /sessions/:id/messages', () => {
    it('is registered', () => {
      expect(findRoute(plugin.routes, 'POST', '/sessions/:id/messages')).toBeDefined()
    })

    it('returns SSE stream and persists messages', async () => {
      const postRoute = findRoute(plugin.routes, 'POST', '/sessions')!
      const { body: createBody } = await callRoute(postRoute, plugin.ctx, {
        body: { agentId: 'basil' },
      })
      const sessionId = (createBody.session as Record<string, unknown>).id as string

      const msgRoute = findRoute(plugin.routes, 'POST', '/sessions/:id/messages')!
      const { makeRequest } = await import('../test-helpers')
      const req = makeRequest('/sessions/:id/messages', {
        method: 'POST',
        body: { message: 'Plan some content for next week' },
        searchParams: { id: sessionId },
      })
      const res = await msgRoute.handler(req, plugin.ctx)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('text/event-stream')

      // Consume the SSE stream
      const text = await res.text()
      expect(text).toContain('event: token')
      expect(text).toContain('event: done')

      // Verify messages were stored
      const getRoute = findRoute(plugin.routes, 'GET', '/sessions/:id')!
      const { body: getBody } = await callRoute(getRoute, plugin.ctx, {
        searchParams: { id: sessionId },
      })
      const session = getBody.session as Record<string, unknown>
      const messages = session.messages as Array<Record<string, unknown>>
      expect(messages.length).toBe(2) // user + assistant
      expect(messages[0].role).toBe('user')
      expect(messages[1].role).toBe('assistant')
    })

    it('returns 404 for nonexistent session', async () => {
      const route = findRoute(plugin.routes, 'POST', '/sessions/:id/messages')!
      const { status } = await callRoute(route, plugin.ctx, {
        searchParams: { id: 'nonexistent' },
        body: { message: 'hello' },
      })
      expect(status).toBe(404)
    })

    it('returns 400 without message', async () => {
      const postRoute = findRoute(plugin.routes, 'POST', '/sessions')!
      const { body: createBody } = await callRoute(postRoute, plugin.ctx, {
        body: { agentId: 'basil' },
      })
      const sessionId = (createBody.session as Record<string, unknown>).id as string

      const route = findRoute(plugin.routes, 'POST', '/sessions/:id/messages')!
      const { status } = await callRoute(route, plugin.ctx, {
        searchParams: { id: sessionId },
        body: {},
      })
      expect(status).toBe(400)
    })

    it('returns 400 for completed session', async () => {
      const postRoute = findRoute(plugin.routes, 'POST', '/sessions')!
      const { body: createBody } = await callRoute(postRoute, plugin.ctx, {
        body: { agentId: 'basil' },
      })
      const sessionId = (createBody.session as Record<string, unknown>).id as string

      // Mark as completed
      const putRoute = findRoute(plugin.routes, 'PUT', '/sessions/:id')!
      await callRoute(putRoute, plugin.ctx, {
        searchParams: { id: sessionId },
        body: { status: 'completed' },
      })

      const route = findRoute(plugin.routes, 'POST', '/sessions/:id/messages')!
      const { status } = await callRoute(route, plugin.ctx, {
        searchParams: { id: sessionId },
        body: { message: 'hello' },
      })
      expect(status).toBe(400)
    })
  })

  // ── PUT /sessions/:id/proposals/:proposalId ───────────────────────────

  describe('PUT /sessions/:id/proposals/:proposalId', () => {
    it('is registered', () => {
      expect(findRoute(plugin.routes, 'PUT', '/sessions/:id/proposals/:proposalId')).toBeDefined()
    })
  })

  // ── POST /sessions/:id/confirm ────────────────────────────────────────

  describe('POST /sessions/:id/confirm', () => {
    it('is registered', () => {
      expect(findRoute(plugin.routes, 'POST', '/sessions/:id/confirm')).toBeDefined()
    })
  })
})

// ===========================================================================
// SESSION EXEC TOOLS
// ===========================================================================

describe('Session exec tools', () => {
  describe('session_list', () => {
    it('is registered', () => {
      expect(findTool(plugin.execTools, 'bakin_exec_messaging_session_list')).toBeDefined()
    })

    it('returns empty list initially', async () => {
      const tool = findTool(plugin.execTools, 'bakin_exec_messaging_session_list')!
      const result = await callTool(tool, {})
      expect(result.ok).toBe(true)
      expect(result.count).toBe(0)
      expect(result.sessions).toEqual([])
    })
  })

  describe('session_create', () => {
    it('is registered', () => {
      expect(findTool(plugin.execTools, 'bakin_exec_messaging_session_create')).toBeDefined()
    })

    it('creates a session', async () => {
      const tool = findTool(plugin.execTools, 'bakin_exec_messaging_session_create')!
      const result = await callTool(tool, { agentId: 'scout', title: 'Scout Plan' })
      expect(result.ok).toBe(true)
      const session = result.session as Record<string, unknown>
      expect(session.agentId).toBe('scout')
      expect(session.title).toBe('Scout Plan')
    })

    it('returns error without agentId', async () => {
      const tool = findTool(plugin.execTools, 'bakin_exec_messaging_session_create')!
      const result = await callTool(tool, {})
      expect(result.ok).toBe(false)
    })
  })

  describe('session_get', () => {
    it('is registered', () => {
      expect(findTool(plugin.execTools, 'bakin_exec_messaging_session_get')).toBeDefined()
    })

    it('returns a session by id', async () => {
      const createTool = findTool(plugin.execTools, 'bakin_exec_messaging_session_create')!
      const created = await callTool(createTool, { agentId: 'zen' })
      const sessionId = (created.session as Record<string, unknown>).id as string

      const tool = findTool(plugin.execTools, 'bakin_exec_messaging_session_get')!
      const result = await callTool(tool, { sessionId })
      expect(result.ok).toBe(true)
      expect((result.session as Record<string, unknown>).id).toBe(sessionId)
    })

    it('returns error for nonexistent session', async () => {
      const tool = findTool(plugin.execTools, 'bakin_exec_messaging_session_get')!
      const result = await callTool(tool, { sessionId: 'nope' })
      expect(result.ok).toBe(false)
    })
  })

  describe('session_update', () => {
    it('is registered', () => {
      expect(findTool(plugin.execTools, 'bakin_exec_messaging_session_update')).toBeDefined()
    })

    it('updates title', async () => {
      const createTool = findTool(plugin.execTools, 'bakin_exec_messaging_session_create')!
      const created = await callTool(createTool, { agentId: 'basil' })
      const sessionId = (created.session as Record<string, unknown>).id as string

      const tool = findTool(plugin.execTools, 'bakin_exec_messaging_session_update')!
      const result = await callTool(tool, { sessionId, title: 'New Title' })
      expect(result.ok).toBe(true)
      expect((result.session as Record<string, unknown>).title).toBe('New Title')
    })
  })

  describe('session_delete', () => {
    it('is registered', () => {
      expect(findTool(plugin.execTools, 'bakin_exec_messaging_session_delete')).toBeDefined()
    })

    it('deletes a session', async () => {
      const createTool = findTool(plugin.execTools, 'bakin_exec_messaging_session_create')!
      const created = await callTool(createTool, { agentId: 'basil' })
      const sessionId = (created.session as Record<string, unknown>).id as string

      const tool = findTool(plugin.execTools, 'bakin_exec_messaging_session_delete')!
      const result = await callTool(tool, { sessionId })
      expect(result.ok).toBe(true)

      // Verify gone
      const getTool = findTool(plugin.execTools, 'bakin_exec_messaging_session_get')!
      const getResult = await callTool(getTool, { sessionId })
      expect(getResult.ok).toBe(false)
    })
  })

  describe('session_message', () => {
    it('is registered', () => {
      expect(findTool(plugin.execTools, 'bakin_exec_messaging_session_message')).toBeDefined()
    })

    it('appends messages to session', async () => {
      const createTool = findTool(plugin.execTools, 'bakin_exec_messaging_session_create')!
      const created = await callTool(createTool, { agentId: 'basil' })
      const sessionId = (created.session as Record<string, unknown>).id as string

      const tool = findTool(plugin.execTools, 'bakin_exec_messaging_session_message')!
      const result = await callTool(tool, { sessionId, message: 'Plan next week' })
      expect(result.ok).toBe(true)
      expect(result.messageId).toBeDefined()
      expect(result.userMessageId).toBeDefined()
    })

    it('returns error for completed session', async () => {
      const createTool = findTool(plugin.execTools, 'bakin_exec_messaging_session_create')!
      const created = await callTool(createTool, { agentId: 'basil' })
      const sessionId = (created.session as Record<string, unknown>).id as string

      // Mark completed
      const updateTool = findTool(plugin.execTools, 'bakin_exec_messaging_session_update')!
      await callTool(updateTool, { sessionId, status: 'completed' })

      const tool = findTool(plugin.execTools, 'bakin_exec_messaging_session_message')!
      const result = await callTool(tool, { sessionId, message: 'hello' })
      expect(result.ok).toBe(false)
    })
  })

  describe('proposal_update', () => {
    it('is registered', () => {
      expect(findTool(plugin.execTools, 'bakin_exec_messaging_proposal_update')).toBeDefined()
    })
  })

  describe('session_confirm', () => {
    it('is registered', () => {
      expect(findTool(plugin.execTools, 'bakin_exec_messaging_session_confirm')).toBeDefined()
    })
  })
})

// ===========================================================================
// PROPOSAL LIFECYCLE (direct storage module tests)
// ===========================================================================

describe('Proposal lifecycle', () => {
  // Import storage module functions directly for deeper testing
  let createSessionDirect: typeof import('../../../plugins/messaging/lib/sessions').createSession
  let loadSessionDirect: typeof import('../../../plugins/messaging/lib/sessions').loadSession
  let addProposalsDirect: typeof import('../../../plugins/messaging/lib/sessions').addProposals
  let updateProposalDirect: typeof import('../../../plugins/messaging/lib/sessions').updateProposal
  let confirmSessionDirect: typeof import('../../../plugins/messaging/lib/sessions').confirmSession
  let appendMessageDirect: typeof import('../../../plugins/messaging/lib/sessions').appendMessage

  beforeAll(async () => {
    const sessions = await import('../../../plugins/messaging/lib/sessions')
    createSessionDirect = sessions.createSession
    loadSessionDirect = sessions.loadSession
    addProposalsDirect = sessions.addProposals
    updateProposalDirect = sessions.updateProposal
    confirmSessionDirect = sessions.confirmSession
    appendMessageDirect = sessions.appendMessage
  })

  it('creates proposals linked to a message', () => {
    const session = createSessionDirect({ agentId: 'basil' })
    const msg = appendMessageDirect(session.id, { role: 'assistant', content: 'Here are ideas' })

    const proposals = addProposalsDirect(session.id, msg.id, [
      {
        title: 'Monday Recipe',
        scheduledAt: '2026-04-13T10:00:00Z',
        contentType: 'recipe',
        tone: 'energetic',
        brief: 'A quick pasta dish',
      },
      {
        title: 'Wednesday Tip',
        scheduledAt: '2026-04-15T10:00:00Z',
        contentType: 'tip',
        tone: 'educational',
        brief: 'Kitchen knife care',
      },
    ])

    expect(proposals.length).toBe(2)
    expect(proposals[0].status).toBe('proposed')
    expect(proposals[0].messageId).toBe(msg.id)
    expect(proposals[0].agentId).toBe('basil')

    // Verify stored in session
    const loaded = loadSessionDirect(session.id)!
    expect(loaded.proposals.length).toBe(2)
  })

  it('approves and rejects proposals', () => {
    const session = createSessionDirect({ agentId: 'scout' })
    const msg = appendMessageDirect(session.id, { role: 'assistant', content: 'Ideas' })
    const proposals = addProposalsDirect(session.id, msg.id, [
      { title: 'Hike A', scheduledAt: '2026-04-13T09:00:00Z', contentType: 'outdoor', tone: 'inspiring', brief: 'Mountain hike' },
      { title: 'Hike B', scheduledAt: '2026-04-14T09:00:00Z', contentType: 'outdoor', tone: 'calm', brief: 'Lake walk' },
    ])

    // Approve first
    const approved = updateProposalDirect(session.id, proposals[0].id, { status: 'approved' })
    expect(approved.status).toBe('approved')

    // Reject second with note
    const rejected = updateProposalDirect(session.id, proposals[1].id, {
      status: 'rejected',
      rejectionNote: 'Too similar to last week',
    })
    expect(rejected.status).toBe('rejected')
    expect(rejected.rejectionNote).toBe('Too similar to last week')
  })

  it('confirmSession creates CalendarItems from approved proposals', () => {
    const session = createSessionDirect({ agentId: 'basil' })
    const msg = appendMessageDirect(session.id, { role: 'assistant', content: 'Plan' })
    const proposals = addProposalsDirect(session.id, msg.id, [
      { title: 'Approved Item', scheduledAt: '2026-04-13T10:00:00Z', contentType: 'recipe', tone: 'energetic', brief: 'Good stuff' },
      { title: 'Rejected Item', scheduledAt: '2026-04-14T10:00:00Z', contentType: 'tip', tone: 'calm', brief: 'Skipped' },
    ])

    updateProposalDirect(session.id, proposals[0].id, { status: 'approved' })
    updateProposalDirect(session.id, proposals[1].id, { status: 'rejected' })

    const result = confirmSessionDirect(session.id)
    expect(result.itemsCreated).toBe(1)
    expect(result.itemIds.length).toBe(1)

    // Session should be completed
    const loaded = loadSessionDirect(session.id)!
    expect(loaded.status).toBe('completed')

    // Approved proposal should have calendarItemId set
    const approvedProposal = loaded.proposals.find(p => p.id === proposals[0].id)
    expect(approvedProposal?.calendarItemId).toBe(result.itemIds[0])

    // Verify calendar item was created on disk
    const calendarData = JSON.parse(readFileSync(join(testDir, 'messaging.json'), 'utf-8'))
    const created = calendarData.find((item: Record<string, unknown>) => item.id === result.itemIds[0])
    expect(created).toBeDefined()
    expect(created.title).toBe('Approved Item')
    expect(created.sessionId).toBe(session.id)
    expect(created.status).toBe('draft')
  })

  it('confirmSession throws when no approved proposals', () => {
    const session = createSessionDirect({ agentId: 'basil' })
    const msg = appendMessageDirect(session.id, { role: 'assistant', content: 'Ideas' })
    addProposalsDirect(session.id, msg.id, [
      { title: 'Proposed Only', scheduledAt: '2026-04-13T10:00:00Z', contentType: 'tip', tone: 'calm', brief: 'Not approved' },
    ])

    expect(() => confirmSessionDirect(session.id)).toThrow('No approved proposals')
  })

  it('confirmSession throws for already completed session', () => {
    const session = createSessionDirect({ agentId: 'basil' })
    const msg = appendMessageDirect(session.id, { role: 'assistant', content: 'Plan' })
    const proposals = addProposalsDirect(session.id, msg.id, [
      { title: 'Item', scheduledAt: '2026-04-13T10:00:00Z', contentType: 'recipe', tone: 'energetic', brief: 'Test' },
    ])
    updateProposalDirect(session.id, proposals[0].id, { status: 'approved' })
    confirmSessionDirect(session.id)

    expect(() => confirmSessionDirect(session.id)).toThrow('already completed')
  })
})

// ===========================================================================
// REGISTRATION COUNTS (updated)
// ===========================================================================

describe('Calendar plugin registration (updated)', () => {
  it('registers exactly 17 routes', () => {
    expect(plugin.routes.length).toBe(17)
  })

  it('registers exactly 15 exec tools', () => {
    expect(plugin.execTools.length).toBe(15)
  })
})
