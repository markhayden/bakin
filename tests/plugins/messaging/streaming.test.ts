/**
 * Streaming endpoint tests — verifies SSE format, token events,
 * proposal extraction, session persistence, and error handling.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'

const testDir = (() => {
  const { join } = require('path')
  const { tmpdir } = require('os')
  return join(tmpdir(), `bakin-test-streaming-${Date.now()}`)
})()

// ES imports are hoisted above mock.module — set env so the content-dir
// guard doesn't trip when plugin modules call getContentDir at init.
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = testDir + '-openclaw'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ messaging: testDir }),
}))

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(), warn: mock(), error: mock(), debug: mock(),
  }),
}))

mock.module('../../../src/core/audit', () => ({ appendAudit: mock() }))
mock.module('../../../src/core/watcher', () => ({ watchDir: mock() }))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawPath: mock(() => '/tmp/mock-openclaw.json'),
  getOpenClawHome: mock(() => '/tmp/mock-openclaw'),
}))

;(globalThis as any).__bakinBroadcast = mock()

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

const messagingPlugin = require('../../../plugins/messaging/index').default as typeof import('../../../plugins/messaging/index').default
import {
  activatePlugin,
  findRoute,
  findTool,
  callRoute,
  makeRequest,
} from '../test-helpers'
import type { ActivatedPlugin } from '../test-helpers'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type RuntimeSend = ActivatedPlugin['ctx']['runtime']['messaging']['send']
type RuntimeStream = ActivatedPlugin['ctx']['runtime']['messaging']['stream']

let mockRuntimeSend = mock(async () => ({ id: 'runtime-msg', content: '' }))
let mockRuntimeStream = mock(() => streamRuntimeText(''))

async function* streamRuntimeText(content: string): AsyncIterable<{ type: 'text'; content: string }> {
  const words = content.split(/(\s+)/)
  for (const word of words) {
    if (!word) continue
    yield { type: 'text', content: word }
  }
}

function installRuntimeMessagingMocks(): void {
  plugin.ctx.runtime.messaging.send = mockRuntimeSend as RuntimeSend
  plugin.ctx.runtime.messaging.stream = mockRuntimeStream as RuntimeStream
}

function resetRuntimeMessagingMocks(): void {
  mockRuntimeSend = mock(async () => ({ id: 'runtime-msg', content: '' }))
  mockRuntimeStream = mock(() => streamRuntimeText(''))
  installRuntimeMessagingMocks()
}

function streamRuntimeResponse(content: string): void {
  mockRuntimeStream.mockImplementationOnce(() => streamRuntimeText(content))
}

function sendRuntimeResponse(content: string): void {
  mockRuntimeSend.mockImplementationOnce(async () => ({ id: 'runtime-msg', content }))
}

function failRuntimeStream(error: Error): void {
  mockRuntimeStream.mockImplementationOnce(() => {
    throw error
  })
}

function failRuntimeSend(error: Error): void {
  mockRuntimeSend.mockImplementationOnce(async () => {
    throw error
  })
}

function parseSSEEvents(text: string): Array<{ event: string; data: Record<string, unknown> }> {
  const events: Array<{ event: string; data: Record<string, unknown> }> = []
  const lines = text.split('\n')
  let currentEvent = ''
  for (const line of lines) {
    if (line.startsWith('event: ')) {
      currentEvent = line.slice(7).trim()
    } else if (line.startsWith('data: ') && currentEvent) {
      try {
        events.push({ event: currentEvent, data: JSON.parse(line.slice(6)) })
      } catch { /* skip */ }
      currentEvent = ''
    }
  }
  return events
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let plugin: ActivatedPlugin

beforeAll(async () => {
  mkdirSync(testDir, { recursive: true })
  writeFileSync(join(testDir, 'messaging.json'), '[]')
  plugin = await activatePlugin(messagingPlugin, testDir)
  installRuntimeMessagingMocks()
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  const sessionsDir = join(testDir, 'messaging', 'sessions')
  if (existsSync(sessionsDir)) rmSync(sessionsDir, { recursive: true, force: true })
  writeFileSync(join(testDir, 'messaging.json'), '[]')
  mock.clearAllMocks()
  resetRuntimeMessagingMocks()
})

async function createTestSession(agentId = 'basil'): Promise<string> {
  const postRoute = findRoute(plugin.routes, 'POST', '/sessions')!
  const { body } = await callRoute(postRoute, plugin.ctx, {
    body: { agentId },
  })
  return (body.session as Record<string, unknown>).id as string
}

async function sendMessage(sessionId: string, message: string): Promise<Response> {
  const route = findRoute(plugin.routes, 'POST', '/sessions/:id/messages')!
  const req = makeRequest('/sessions/:id/messages', {
    method: 'POST',
    body: { message },
    searchParams: { id: sessionId },
  })
  return route.handler(req, plugin.ctx)
}

// ===========================================================================
// TESTS
// ===========================================================================

describe('Streaming endpoint', () => {
  it('returns text/event-stream content type', async () => {
    streamRuntimeResponse('Hello world')
    const sessionId = await createTestSession()
    const res = await sendMessage(sessionId, 'Plan next week')
    expect(res.headers.get('content-type')).toBe('text/event-stream')
  })

  it('streams token events from runtime SSE', async () => {
    streamRuntimeResponse('Here are some ideas for next week.')
    const sessionId = await createTestSession()
    const res = await sendMessage(sessionId, 'Plan next week')
    const text = await res.text()
    const events = parseSSEEvents(text)

    const tokenEvents = events.filter(e => e.event === 'token')
    expect(tokenEvents.length).toBeGreaterThan(0)
    // Reassemble tokens
    const fullText = tokenEvents.map(e => e.data.text).join('')
    expect(fullText).toContain('Here')
    expect(fullText).toContain('ideas')
  })

  it('sends done event after stream completes', async () => {
    streamRuntimeResponse('All done.')
    const sessionId = await createTestSession()
    const res = await sendMessage(sessionId, 'quick')
    const text = await res.text()
    const events = parseSSEEvents(text)

    const doneEvents = events.filter(e => e.event === 'done')
    expect(doneEvents.length).toBe(1)
    expect(doneEvents[0].data.messageId).toBeDefined()
    expect(doneEvents[0].data.content).toContain('All done')
  })

  it('extracts proposals from JSON block and sends proposals event', async () => {
    const responseWithProposals = `Great ideas for next week!

\`\`\`json
[{"title":"Monday Recipe","scheduledAt":"2026-04-13T10:00:00Z","contentType":"recipe","tone":"energetic","brief":"A quick pasta dish"}]
\`\`\``

    streamRuntimeResponse(responseWithProposals)
    const sessionId = await createTestSession()
    const res = await sendMessage(sessionId, 'Plan next week')
    const text = await res.text()
    const events = parseSSEEvents(text)

    const proposalEvents = events.filter(e => e.event === 'proposal')
    expect(proposalEvents.length).toBe(1)
    const proposal = proposalEvents[0].data.proposal as Record<string, unknown>
    expect(proposal.title).toBe('Monday Recipe')
    expect(proposal.status).toBe('proposed')
  })

  it('persists user and assistant messages to session file', async () => {
    streamRuntimeResponse('Sounds good, let me think...')
    const sessionId = await createTestSession()
    const res = await sendMessage(sessionId, 'Plan content for Monday')
    await res.text() // Must consume stream to trigger side effects

    // Read session file directly
    const sessionPath = join(testDir, 'messaging', 'sessions', `${sessionId}.json`)
    expect(existsSync(sessionPath)).toBe(true)
    const session = JSON.parse(readFileSync(sessionPath, 'utf-8'))
    expect(session.messages.length).toBe(2)
    expect(session.messages[0].role).toBe('user')
    expect(session.messages[0].content).toBe('Plan content for Monday')
    expect(session.messages[1].role).toBe('assistant')
  })

  it('persists proposals to session file', async () => {
    const responseWithProposals = `Ideas:\n\`\`\`json\n[{"title":"Test","scheduledAt":"2026-04-13T10:00:00Z","contentType":"tip","tone":"calm","brief":"A tip"}]\n\`\`\``
    streamRuntimeResponse(responseWithProposals)
    const sessionId = await createTestSession()
    const res = await sendMessage(sessionId, 'Suggest something')
    await res.text() // Consume stream

    const sessionPath = join(testDir, 'messaging', 'sessions', `${sessionId}.json`)
    const session = JSON.parse(readFileSync(sessionPath, 'utf-8'))
    expect(session.proposals.length).toBe(1)
    expect(session.proposals[0].title).toBe('Test')
    expect(session.proposals[0].agentId).toBe('basil')
  })

  it('links proposals to their message via proposalIds', async () => {
    const responseWithProposals = `Here:\n\`\`\`json\n[{"title":"Linked","scheduledAt":"2026-04-13T10:00:00Z","contentType":"tip","tone":"calm","brief":"A tip"}]\n\`\`\``
    streamRuntimeResponse(responseWithProposals)
    const sessionId = await createTestSession()
    const res = await sendMessage(sessionId, 'Ideas')
    await res.text() // Consume stream

    const sessionPath = join(testDir, 'messaging', 'sessions', `${sessionId}.json`)
    const session = JSON.parse(readFileSync(sessionPath, 'utf-8'))
    const assistantMsg = session.messages.find((m: Record<string, unknown>) => m.role === 'assistant')
    expect(assistantMsg.proposalIds).toBeDefined()
    expect(assistantMsg.proposalIds.length).toBe(1)
    expect(assistantMsg.proposalIds[0]).toBe(session.proposals[0].id)
  })

  it('falls back to non-streaming when runtime streaming throws', async () => {
    failRuntimeStream(new Error('Stream not supported'))
    sendRuntimeResponse('Fallback response here.')

    const sessionId = await createTestSession()
    const res = await sendMessage(sessionId, 'Plan')
    const text = await res.text()
    const events = parseSSEEvents(text)

    const tokenEvents = events.filter(e => e.event === 'token')
    expect(tokenEvents.length).toBe(1) // Single token with full content
    expect(tokenEvents[0].data.text).toBe('Fallback response here.')

    const doneEvents = events.filter(e => e.event === 'done')
    expect(doneEvents.length).toBe(1)
  })

  it('sends error event when both streaming and fallback fail', async () => {
    failRuntimeStream(new Error('Stream failed'))
    failRuntimeSend(new Error('Fallback also failed'))

    const sessionId = await createTestSession()
    const res = await sendMessage(sessionId, 'Plan')
    const text = await res.text()
    const events = parseSSEEvents(text)

    const errorEvents = events.filter(e => e.event === 'error')
    expect(errorEvents.length).toBe(1)
    expect(errorEvents[0].data.message).toContain('Fallback also failed')
  })

  it('returns JSON 400 for missing params (before stream starts)', async () => {
    const route = findRoute(plugin.routes, 'POST', '/sessions/:id/messages')!
    const { status, body } = await callRoute(route, plugin.ctx, {
      searchParams: { id: 'some-id' },
      body: {},
    })
    expect(status).toBe(400)
    expect(body.error).toContain('message required')
  })

  it('returns JSON 404 for nonexistent session', async () => {
    const route = findRoute(plugin.routes, 'POST', '/sessions/:id/messages')!
    const { status } = await callRoute(route, plugin.ctx, {
      searchParams: { id: 'nonexistent' },
      body: { message: 'hello' },
    })
    expect(status).toBe(404)
  })

  it('strips JSON block from stored assistant message content', async () => {
    const responseWithJson = `Great plan!\n\`\`\`json\n[{"title":"X","scheduledAt":"2026-04-13T10:00:00Z","contentType":"tip","tone":"calm","brief":"Y"}]\n\`\`\``
    streamRuntimeResponse(responseWithJson)
    const sessionId = await createTestSession()
    const res = await sendMessage(sessionId, 'Plan')
    await res.text() // Consume stream

    const sessionPath = join(testDir, 'messaging', 'sessions', `${sessionId}.json`)
    const session = JSON.parse(readFileSync(sessionPath, 'utf-8'))
    const assistantMsg = session.messages.find((m: Record<string, unknown>) => m.role === 'assistant')
    expect(assistantMsg.content).not.toContain('```json')
    expect(assistantMsg.content).toContain('Great plan!')
  })
})

describe('Session message exec tool (non-streaming)', () => {
  it('calls runtime non-streaming and returns response', async () => {
    sendRuntimeResponse('Here are my ideas for you.')

    const createTool = findTool(plugin.execTools, 'bakin_exec_messaging_session_create')!
    const created = await createTool.handler({ agentId: 'basil' }, 'test')
    const sessionId = (created.session as Record<string, unknown>).id as string

    const tool = findTool(plugin.execTools, 'bakin_exec_messaging_session_message')!
    const result = await tool.handler({ sessionId, message: 'Plan next week' }, 'test')

    expect(result.ok).toBe(true)
    expect(result.response).toBe('Here are my ideas for you.')
    expect(result.messageId).toBeDefined()
    expect(mockRuntimeSend).toHaveBeenCalled()
  })

  it('returns error when runtime completion fails', async () => {
    failRuntimeSend(new Error('Runtime down'))

    const createTool = findTool(plugin.execTools, 'bakin_exec_messaging_session_create')!
    const created = await createTool.handler({ agentId: 'basil' }, 'test')
    const sessionId = (created.session as Record<string, unknown>).id as string

    const tool = findTool(plugin.execTools, 'bakin_exec_messaging_session_message')!
    const result = await tool.handler({ sessionId, message: 'Plan' }, 'test')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('Runtime down')
  })
})
