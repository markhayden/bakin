import { describe, it, expect, beforeEach, mock } from 'bun:test'

// Mock all service layer functions
mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('@/core/task-service', () => ({
  logProgress: mock(() => Promise.resolve()),
  moveTaskWithEffects: mock(() => Promise.resolve()),
  blockTaskWithEffects: mock(() => Promise.resolve()),
  createTaskWithEffects: mock(() => Promise.resolve({ id: 'created-123' })),
  reportComplete: mock(() => Promise.resolve()),
  setDependencyWithEffects: mock(() => Promise.resolve()),
  getTaskDetails: mock(() => ({ task: { id: 'task-1', title: 'Test' }, column: 'inProgress' })),
  triggerDispatch: mock(),
}))

mock.module('@/core/content-dir', () => ({
  getContentDir: mock(() => process.env.BAKIN_HOME || '/tmp/test'),
  getBakinPaths: mock(() => ({
    root: process.env.BAKIN_HOME || '/tmp/test',
    home: process.env.BAKIN_HOME || '/tmp/test',
    assets: `${process.env.BAKIN_HOME || '/tmp/test'}/assets`,
    settings: `${process.env.BAKIN_HOME || '/tmp/test'}/settings.json`,
    pluginSettings: `${process.env.BAKIN_HOME || '/tmp/test'}/plugin-settings`,
    plugins: `${process.env.BAKIN_HOME || '/tmp/test'}/plugins`,
    audit: `${process.env.BAKIN_HOME || '/tmp/test'}/audit.jsonl`,
    logs: `${process.env.BAKIN_HOME || '/tmp/test'}/logs`,
    db: `${process.env.BAKIN_HOME || '/tmp/test'}/bakin.db`,
  })),
  isUsingBakinHome: () => true,
  resetContentDir: () => {},
  initBakinHome: () => {},
}))

mock.module('@/core/task-store', () => ({
  readTaskboard: mock(() => ({ columns: { todo: [], inProgress: [], review: [], done: [] } })),
  getTask: mock(() => null),
  getSharedBakinTaskStore: mock(() => ({})),
  normalizeColumn: mock((c: string) => c),
  localDateString: mock(() => '2026-01-01'),
}))

mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: mock(() => process.env.BAKIN_HOME || '/tmp/test'),
  getBakinPaths: mock(() => ({
    root: process.env.BAKIN_HOME || '/tmp/test',
    home: process.env.BAKIN_HOME || '/tmp/test',
    assets: `${process.env.BAKIN_HOME || '/tmp/test'}/assets`,
    settings: `${process.env.BAKIN_HOME || '/tmp/test'}/settings.json`,
    pluginSettings: `${process.env.BAKIN_HOME || '/tmp/test'}/plugin-settings`,
    plugins: `${process.env.BAKIN_HOME || '/tmp/test'}/plugins`,
    audit: `${process.env.BAKIN_HOME || '/tmp/test'}/audit.jsonl`,
    logs: `${process.env.BAKIN_HOME || '/tmp/test'}/logs`,
    db: `${process.env.BAKIN_HOME || '/tmp/test'}/bakin.db`,
  })),
  isUsingBakinHome: () => true,
  resetContentDir: () => {},
  initBakinHome: () => {},
}))

mock.module('@/core/audit', () => ({
  appendAudit: mock(),
}))

mock.module('@bakin/workflows/lib/runtime', () => ({
  createInstance: mock(() => ({ taskId: 'task-1', workflowId: 'wf', status: 'in_progress' })),
  loadInstance: mock(() => null),
  saveInstance: mock(),
  getCurrentStep: mock(() => ({
    stepId: 'write-copy',
    label: 'Write Copy',
    instructions: 'Write engaging copy',
    output_schema: { type: 'object', properties: { text: { type: 'string' } } },
  })),
  completeStep: mock(() => ({ success: true, workflowComplete: false })),
  approveGate: mock(() => ({ success: true })),
  rejectGate: mock(() => ({ success: true })),
  listInstances: mock(() => []),
  getActiveAgents: mock(() => []),
  authorizeWorkflowToolUse: mock(() => ({ allowed: true })),
  isGateNotified: mock(() => false),
  markGateNotified: mock(),
  cancelInstance: mock(),
}))

mock.module('@/core/logger', () => ({
  createLogger: mock(() => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  })),
}))

describe('MCP Server', () => {
  beforeEach(() => {
    mock.clearAllMocks()
  })

  it('should export handleMcpRequest and getActiveSessions', async () => {
    const mcp = await import('@/core/mcp-server')
    expect(typeof mcp.handleMcpRequest).toBe('function')
    expect(typeof mcp.getActiveSessions).toBe('function')
  })

  it('should start with no active sessions', async () => {
    const { getActiveSessions } = require('@/core/mcp-server') as typeof import('@/core/mcp-server')
    expect(getActiveSessions()).toEqual([])
  })

  it('should summarize streamable sessions for health stats', async () => {
    const { summarizeMcpSessions } = await import('@/core/mcp-server')

    const summary = summarizeMcpSessions(
      [
        { agentId: 'patch', createdAt: 1_000 },
        { agentId: 'chef', createdAt: 2_000 },
        { agentId: 'patch', createdAt: 3_000 },
      ],
      '2026-05-04T00:00:00.000Z',
    )

    expect(summary.upSince).toBe('2026-05-04T00:00:00.000Z')
    expect(summary.activeSessions).toEqual([
      { agent: 'patch', sessions: 2, connectedAt: '1970-01-01T00:00:03.000Z' },
      { agent: 'chef', sessions: 1, connectedAt: '1970-01-01T00:00:02.000Z' },
    ])
  })

  it('should reject requests without agent param and no session ID', async () => {
    const { handleMcpRequest } = require('@/core/mcp-server') as typeof import('@/core/mcp-server')

    const req = createMockRequest('POST', '/mcp', null)
    const res = createMockResponse()

    await handleMcpRequest(req, res)

    expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object))
    expect(res._body).toContain('agent query parameter required')
  })

  it('should return 400 for malformed JSON bodies', async () => {
    const { handleMcpRequest } = require('@/core/mcp-server') as typeof import('@/core/mcp-server')

    const req = createMockRequest('POST', '/mcp?agent=chef', '{ broken')
    const res = createMockResponse()

    await handleMcpRequest(req, res)

    expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object))
    expect(res._body).toContain('Invalid JSON body')
  })

  it('should return 413 when the request body is too large', async () => {
    const { DEFAULT_MAX_REQUEST_BODY_BYTES } = await import('@/core/request-body')
    const { handleMcpRequest } = require('@/core/mcp-server') as typeof import('@/core/mcp-server')

    const req = createMockRequest('POST', '/mcp?agent=chef', null, {
      'content-length': String(DEFAULT_MAX_REQUEST_BODY_BYTES + 1),
    })
    const res = createMockResponse()

    await handleMcpRequest(req, res)

    expect(res.writeHead).toHaveBeenCalledWith(413, expect.any(Object))
    expect(res._body).toContain('Request body too large')
  })

  it('should return 404 for unknown Streamable HTTP session ID', async () => {
    const { handleMcpRequest } = require('@/core/mcp-server') as typeof import('@/core/mcp-server')

    const req = createMockRequest('POST', '/mcp', {}, { 'mcp-session-id': 'nonexistent' })
    const res = createMockResponse()

    await handleMcpRequest(req, res)

    expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object))
  })

  // Sessionless GETs previously auto-started a legacy SSE handshake. The
  // codex MCP client ignores that handshake and waits a fixed 5s before
  // falling back to streamable-http — a 5s tax on EVERY codex turn (579 of
  // 1,074 logged MCP inits sat at 5.0±0.1s). Per the streamable-http spec a
  // GET without Mcp-Session-Id is 405, which makes clients fall back
  // immediately.
  it('should 405 a GET without Mcp-Session-Id (no agent param)', async () => {
    const { handleMcpRequest } = require('@/core/mcp-server') as typeof import('@/core/mcp-server')

    const req = createMockRequest('GET', '/mcp', null)
    const res = createMockResponse()

    await handleMcpRequest(req, res)

    expect(res.writeHead).toHaveBeenCalledWith(405, expect.objectContaining({ Allow: expect.any(String) }))
  })

  it('should 405 a sessionless GET even with an agent param (the codex transport probe)', async () => {
    const { handleMcpRequest } = require('@/core/mcp-server') as typeof import('@/core/mcp-server')

    const req = createMockRequest('GET', '/mcp?agent=main', null)
    const res = createMockResponse()

    await handleMcpRequest(req, res)

    expect(res.writeHead).toHaveBeenCalledWith(405, expect.objectContaining({ Allow: expect.any(String) }))
    expect(res._body).toContain('Mcp-Session-Id')
  })

  it('should 404 a GET with an unknown Mcp-Session-Id', async () => {
    const { handleMcpRequest } = require('@/core/mcp-server') as typeof import('@/core/mcp-server')

    const req = createMockRequest('GET', '/mcp', null, { 'mcp-session-id': 'nope' })
    const res = createMockResponse()

    await handleMcpRequest(req, res)

    expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object))
  })

  it('should serve the streamable notification stream on GET with a live session', async () => {
    const { handleMcpRequest, getActiveSessions } = require('@/core/mcp-server') as typeof import('@/core/mcp-server')
    const { createServer } = require('http') as typeof import('http')
    // Bun.fetch, NOT global fetch: the test preload registers happy-dom,
    // whose window fetch breaks on real HTTP sockets.
    const nativeFetch = (Bun as unknown as { fetch: typeof fetch }).fetch

    // Real HTTP round-trip: hand mocks can't satisfy the MCP SDK transport's
    // ServerResponse expectations. Bun.fetch, NOT global fetch — the
    // happy-dom preload's fetch breaks on real sockets (CLAUDE.md).
    const server = createServer((req, res) => {
      void handleMcpRequest(req, res)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as { port: number }).port
    const base = `http://127.0.0.1:${port}`

    try {
      const initRes = await nativeFetch(`${base}/mcp?agent=main`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'test', version: '0' },
          },
        }),
      })
      expect(initRes.status).toBe(200)
      const sid = initRes.headers.get('mcp-session-id')
      expect(sid).toBeTruthy()
      expect(getActiveSessions().some((s) => s.sessionId === sid && s.agentId === 'main')).toBe(true)
      await initRes.body?.cancel()

      // GET with the live session id = the notification stream, not a 4xx.
      const streamRes = await nativeFetch(`${base}/mcp`, {
        method: 'GET',
        headers: {
          'mcp-session-id': sid!,
          accept: 'text/event-stream',
          'mcp-protocol-version': '2025-06-18',
        },
      })
      // 200 = the session's transport owns the response (the notification
      // stream), vs the 405/404 the routing layer returns itself. The real
      // content-type is text/event-stream, but the happy-dom preload's
      // Response implementation makes Hono's request-listener coerce the
      // streamed body to text/plain in-test — so only status is asserted
      // here; the SSE content-type is exercised against real node HTTP by
      // the transport SDK itself.
      expect(streamRes.status).toBe(200)
      await streamRes.body?.cancel()

      // And the sessionless GET a real codex client probes with → immediate 405.
      const probeRes = await nativeFetch(`${base}/mcp?agent=main`, {
        method: 'GET',
        headers: { accept: 'text/event-stream' },
      })
      expect(probeRes.status).toBe(405)
    } finally {
      server.close()
    }
  })
})

// Minimal mock helpers for IncomingMessage / ServerResponse
function createMockRequest(
  method: string,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  const url = `http://localhost:3737${path}`
  const req: any = {
    method,
    url,
    headers: {
      host: 'localhost:3737',
      'content-type': 'application/json',
      ...headers,
    },
    on: mock((event: string, cb: (...args: any[]) => void) => {
      if (event === 'data' && body) {
        const raw = typeof body === 'string' ? body : JSON.stringify(body)
        cb(Buffer.from(raw))
      }
      if (event === 'end') {
        cb()
      }
      return req
    }),
  }
  return req
}

function createMockResponse() {
  let bodyContent = ''
  const res: any = {
    writeHead: mock(),
    end: mock((data?: string) => {
      if (data) bodyContent = data
    }),
    headersSent: false,
    get _body() {
      return bodyContent
    },
  }
  return res
}

// Richer mock for paths where the MCP SDK transport owns the response
// (initialize round-trips, notification streams): records status/headers,
// supports write/flush, and behaves as a minimal ServerResponse.
function createStreamingMockResponse() {
  let bodyContent = ''
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>()
  const res: any = {
    statusCode: 0,
    headers: {} as Record<string, unknown>,
    headersSent: false,
    writeHead: mock(function (this: unknown, status: number, headers?: Record<string, unknown>) {
      res.statusCode = status
      if (headers) Object.assign(res.headers, headers)
      res.headersSent = true
      return res
    }),
    setHeader: mock((k: string, v: unknown) => {
      res.headers[k.toLowerCase()] = v
    }),
    getHeader: mock((k: string) => res.headers[k.toLowerCase()]),
    write: mock((chunk: unknown) => {
      bodyContent += String(chunk)
      return true
    }),
    end: mock((data?: string) => {
      if (data) bodyContent += data
    }),
    flushHeaders: mock(() => {
      res.headersSent = true
    }),
    on: mock((event: string, cb: (...args: unknown[]) => void) => {
      const arr = listeners.get(event) ?? []
      arr.push(cb)
      listeners.set(event, arr)
      return res
    }),
    once: mock((event: string, cb: (...args: unknown[]) => void) => {
      const arr = listeners.get(event) ?? []
      arr.push(cb)
      listeners.set(event, arr)
      return res
    }),
    removeListener: mock(() => res),
    get _body() {
      return bodyContent
    },
  }
  return res
}
