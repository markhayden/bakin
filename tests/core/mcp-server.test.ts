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

  it('should summarize both streamable and SSE sessions for health stats', async () => {
    const { summarizeMcpSessions } = await import('@/core/mcp-server')

    const summary = summarizeMcpSessions(
      [
        { agentId: 'patch', createdAt: 1_000 },
        { agentId: 'chef', createdAt: 2_000 },
      ],
      [
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

  it('should reject GET without session ID', async () => {
    const { handleMcpRequest } = require('@/core/mcp-server') as typeof import('@/core/mcp-server')

    const req = createMockRequest('GET', '/mcp', null)
    const res = createMockResponse()

    await handleMcpRequest(req, res)

    expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object))
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
