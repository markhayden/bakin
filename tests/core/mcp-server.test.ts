import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock all service layer functions
vi.mock('@/core/task-service', () => ({
  logProgress: vi.fn(() => Promise.resolve()),
  moveTaskWithEffects: vi.fn(() => Promise.resolve()),
  blockTaskWithEffects: vi.fn(() => Promise.resolve()),
  createTaskWithEffects: vi.fn(() => Promise.resolve({ id: 'created-123' })),
  reportComplete: vi.fn(() => Promise.resolve()),
  setDependencyWithEffects: vi.fn(() => Promise.resolve()),
  getTaskDetails: vi.fn(() => ({ task: { id: 'task-1', title: 'Test' }, column: 'inProgress' })),
  triggerDispatch: vi.fn(),
}))

vi.mock('@/core/content-dir', () => ({
  getContentDir: vi.fn(() => '/tmp/test'),
  getBakinPaths: vi.fn(() => ({
    home: '/tmp/test',
    taskboard: '/tmp/test/TASKBOARD.md',
    assets: '/tmp/test/assets',
  })),
}))

vi.mock('@/core/audit', () => ({
  appendAudit: vi.fn(),
}))

vi.mock('@bakin/workflows/runtime', () => ({
  getCurrentStep: vi.fn(() => ({
    stepId: 'write-copy',
    label: 'Write Copy',
    instructions: 'Write engaging copy',
    output_schema: { type: 'object', properties: { text: { type: 'string' } } },
  })),
  completeStep: vi.fn(() => ({ success: true, workflowComplete: false })),
}))

vi.mock('@/core/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}))

describe('MCP Server', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should export handleMcpRequest and getActiveSessions', async () => {
    const mcp = await import('@/core/mcp-server')
    expect(typeof mcp.handleMcpRequest).toBe('function')
    expect(typeof mcp.getActiveSessions).toBe('function')
  })

  it('should start with no active sessions', async () => {
    const { getActiveSessions } = await import('@/core/mcp-server')
    expect(getActiveSessions()).toEqual([])
  })

  it('should reject requests without agent param and no session ID', async () => {
    const { handleMcpRequest } = await import('@/core/mcp-server')

    const req = createMockRequest('POST', '/mcp', null)
    const res = createMockResponse()

    await handleMcpRequest(req, res)

    expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object))
    expect(res._body).toContain('agent query parameter required')
  })

  it('should return 404 for unknown session ID', async () => {
    const { handleMcpRequest } = await import('@/core/mcp-server')

    const req = createMockRequest('GET', '/mcp', null, { 'mcp-session-id': 'nonexistent' })
    const res = createMockResponse()

    await handleMcpRequest(req, res)

    expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object))
  })

  it('should reject GET without session ID', async () => {
    const { handleMcpRequest } = await import('@/core/mcp-server')

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
    on: vi.fn((event: string, cb: (...args: any[]) => void) => {
      if (event === 'data' && body) {
        cb(Buffer.from(JSON.stringify(body)))
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
    writeHead: vi.fn(),
    end: vi.fn((data?: string) => {
      if (data) bodyContent = data
    }),
    headersSent: false,
    get _body() {
      return bodyContent
    },
  }
  return res
}
