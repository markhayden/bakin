/**
 * Bakin MCP Server.
 *
 * Exposes agent-facing operations as MCP tools over Streamable HTTP and SSE.
 * Agents connect to /mcp?agent=<name> and get tools for task management,
 * progress logging, workflow step submission, etc.
 *
 * Supports two transports:
 * - Streamable HTTP (POST-only, session ID in headers) — modern MCP clients
 * - SSE (GET to establish stream, POST to send messages) — mcporter and legacy clients
 *
 * All tools are registered dynamically via the exec tool registry:
 * - Plugin tools: registered via ctx.registerExecTool() in plugin activate()
 * - Script tools: self-register via addExecTool() on import (scripts/lib/*.ts)
 *
 * Each agent session gets its own McpServer + transport pair.
 * Agent identity is bound at session initialization from the query param.
 */
import { randomUUID } from 'crypto'
import type { IncomingMessage, ServerResponse } from 'http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { createLogger } from './logger'
import { getContentDir } from './content-dir'
import { appendAudit } from './audit'
import { getAllExecTools, recordExecToolCall, getToolContext } from '../../scripts/lib/registry'

// Script execution tools that stay in scripts/lib/ — self-register on import.
// Must be imported AFTER registry.ts so the Map is initialized.
import '../../scripts/lib/log-progress'
import '../../scripts/lib/generate-image'
import '../../scripts/lib/post-discord'
import '../../scripts/lib/get-paths'
import '../../scripts/lib/heartbeat'
import '../../scripts/lib/search-tools'

const log = createLogger('mcp')

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

interface McpSession {
  server: McpServer
  transport: StreamableHTTPServerTransport
  agentId: string
  createdAt: number
}

const sessions = new Map<string, McpSession>()

// SSE sessions are keyed by session ID from the SSE transport
interface SseSession {
  server: McpServer
  transport: SSEServerTransport
  agentId: string
  createdAt: number
}
const sseSessions = new Map<string, SseSession>()

// ---------------------------------------------------------------------------
// In-memory stats (reset on server restart)
// ---------------------------------------------------------------------------

interface McpStats {
  toolCalls: Record<string, number>
  totalRequests: number
  sessionsByAgent: Record<string, number>
}

const stats: McpStats = {
  toolCalls: {},
  totalRequests: 0,
  sessionsByAgent: {},
}

const startedAt = new Date().toISOString()

function recordToolCall(toolName: string, agent: string): void {
  stats.toolCalls[toolName] = (stats.toolCalls[toolName] || 0) + 1
  stats.sessionsByAgent[agent] = (stats.sessionsByAgent[agent] || 0) + 1
  stats.totalRequests++
}

// Clean up stale sessions every 5 minutes.
const SESSION_TTL_MS = 30 * 60 * 1000
setInterval(() => {
  const now = Date.now()
  let cleaned = 0
  for (const [id, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      session.transport.close?.()
      sessions.delete(id)
      cleaned++
    }
  }
  for (const [id, session] of sseSessions) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      session.transport.close?.()
      sseSessions.delete(id)
      cleaned++
    }
  }
  if (cleaned > 0) {
    log.info('Cleaned up stale MCP sessions', { cleaned, remaining: sessions.size + sseSessions.size })
  }
}, 5 * 60 * 1000)

// ---------------------------------------------------------------------------
// Tool registration — all tools come from the exec tool registry
// ---------------------------------------------------------------------------

function registerTools(server: McpServer, getAgent: () => string): void {
  for (const tool of getAllExecTools()) {
    server.tool(
      tool.name,
      tool.description,
      tool.parameters as Record<string, import('zod').ZodType>,
      async (params) => {
        const agent = getAgent()
        recordToolCall(tool.name, agent)
        recordExecToolCall(tool.name)

        const taskId = (params as Record<string, unknown>).taskId as string | undefined
        log.info('Exec tool called', { tool: tool.name, agent, taskId })

        try {
          const toolCtx = getToolContext(tool.name)
          const result = await tool.handler(params as Record<string, unknown>, agent, toolCtx)

          appendAudit(
            getContentDir(),
            result.ok ? `exec.${tool.name}.ok` : `exec.${tool.name}.fail`,
            agent,
            { taskId, label: tool.label, ...(tool.activityDuplicate ? { duplicate: true } : {}), ...(result.ok ? {} : { error: result.error }) },
            'mcp',
          )

          const text = result.ok
            ? JSON.stringify(result, null, 2)
            : `ERROR: ${result.error}${result.details ? '\n' + JSON.stringify(result.details, null, 2) : ''}`
          return { content: [{ type: 'text' as const, text }], isError: !result.ok }
        } catch (err) {
          appendAudit(getContentDir(), `exec.${tool.name}.error`, agent, { taskId, label: tool.label, ...(tool.activityDuplicate ? { duplicate: true } : {}), error: err instanceof Error ? err.message : String(err) }, 'mcp')
          return { content: [{ type: 'text' as const, text: `Exec tool error: ${err instanceof Error ? err.message : String(err)}` }], isError: true }
        }
      },
    )
  }
}

// ---------------------------------------------------------------------------
// Session factory
// ---------------------------------------------------------------------------

function createSession(agentId: string): McpSession {
  const server = new McpServer(
    { name: 'bakin', version: '1.0.0' },
    { capabilities: { logging: {} } },
  )

  let sessionId: string | undefined

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => {
      sessionId = randomUUID()
      return sessionId
    },
    onsessioninitialized: (id: string) => {
      log.info('MCP session initialized', { sessionId: id, agent: agentId })
    },
  })

  // Register tools with agent identity closure
  registerTools(server, () => agentId)

  const session: McpSession = {
    server,
    transport,
    agentId,
    createdAt: Date.now(),
  }

  return session
}

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------

/**
 * Handle an incoming MCP HTTP request.
 * Called from server.ts for requests to /mcp or /mcp/*.
 */
export async function handleMcpRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const method = req.method?.toUpperCase()

  // /mcp/stats — lightweight observability endpoint
  if (url.pathname === '/mcp/stats' && method === 'GET') {
    const agentMap = new Map<string, { sessions: number; latestAt: number; toolCalls: number }>()
    for (const [, s] of sessions) {
      const existing = agentMap.get(s.agentId)
      if (existing) {
        existing.sessions++
        existing.latestAt = Math.max(existing.latestAt, s.createdAt)
      } else {
        agentMap.set(s.agentId, {
          sessions: 1,
          latestAt: s.createdAt,
          toolCalls: stats.sessionsByAgent[s.agentId] || 0,
        })
      }
    }
    const activeSessions = Array.from(agentMap.entries()).map(([agent, info]) => ({
      agent,
      sessions: info.sessions,
      connectedAt: new Date(info.latestAt).toISOString(),
      toolCalls: info.toolCalls,
    }))
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      activeSessions,
      toolCallCounts: stats.toolCalls,
      totalRequests: stats.totalRequests,
      upSince: startedAt,
    }, null, 2))
    return
  }

  const agentId = url.searchParams.get('agent')

  // ─── SSE Transport (GET) ───────────────────────────────────────────
  // Legacy clients (mcporter) connect via GET to establish an SSE stream.
  // The SSE transport sends an `endpoint` event with a POST URL for messages.
  if (method === 'GET') {
    if (!agentId) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'agent query parameter required (e.g. /mcp?agent=basil)' }))
      return
    }

    const server = new McpServer(
      { name: 'bakin', version: '1.0.0' },
      { capabilities: { logging: {} } },
    )
    registerTools(server, () => agentId)

    // The endpoint is where the SSE client will POST messages back.
    // Use /mcp with a sessionId query param so we can route them.
    const transport = new SSEServerTransport(`/mcp`, res)
    await server.connect(transport)
    await transport.start()

    const sid = transport.sessionId
    sseSessions.set(sid, { server, transport, agentId, createdAt: Date.now() })
    log.info('SSE MCP session created', { sessionId: sid, agent: agentId })

    // Clean up on disconnect
    res.on('close', () => {
      transport.close?.()
      sseSessions.delete(sid)
      log.info('SSE MCP session closed', { sessionId: sid, agent: agentId })
    })
    return
  }

  // ─── POST: route to correct transport ──────────────────────────────
  if (method === 'POST') {
    const body = await parseBody(req)

    // Check for Streamable HTTP session (header-based)
    const existingSessionId = req.headers['mcp-session-id'] as string | undefined
    if (existingSessionId) {
      const session = sessions.get(existingSessionId)
      if (!session) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Session not found' }))
        return
      }
      await session.transport.handleRequest(req, res, body)
      return
    }

    // Check for SSE session (query param-based — SSE transport POSTs to /mcp?sessionId=...)
    const sseSessionId = url.searchParams.get('sessionId')
    if (sseSessionId) {
      const sseSession = sseSessions.get(sseSessionId)
      if (!sseSession) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'SSE session not found' }))
        return
      }
      await sseSession.transport.handlePostMessage(req, res, body)
      return
    }

    // New Streamable HTTP session
    if (!agentId) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'agent query parameter required (e.g. /mcp?agent=basil)' }))
      return
    }

    const session = createSession(agentId)
    await session.server.connect(session.transport)

    await session.transport.handleRequest(req, res, body)

    const sid = session.transport.sessionId
    if (sid) {
      sessions.set(sid, session)
      log.info('MCP session created', { sessionId: sid, agent: agentId })
    }
    return
  }

  // ─── DELETE: close Streamable HTTP session ─────────────────────────
  if (method === 'DELETE') {
    const existingSessionId = req.headers['mcp-session-id'] as string | undefined
    if (existingSessionId) {
      const session = sessions.get(existingSessionId)
      if (session) {
        await session.transport.handleRequest(req, res)
        sessions.delete(existingSessionId)
        log.info('MCP session closed', { sessionId: existingSessionId, agent: session.agentId })
        return
      }
    }
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Session not found' }))
    return
  }

  res.writeHead(405, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'Method not allowed. Use GET (SSE) or POST (Streamable HTTP).' }))
}

// ---------------------------------------------------------------------------
// Body parsing helper
// ---------------------------------------------------------------------------

function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8')
        resolve(raw ? JSON.parse(raw) : undefined)
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

// ---------------------------------------------------------------------------
// Exports for server.ts
// ---------------------------------------------------------------------------

export function getActiveSessions(): Array<{ sessionId: string; agentId: string; createdAt: number }> {
  return Array.from(sessions.entries()).map(([id, s]) => ({
    sessionId: id,
    agentId: s.agentId,
    createdAt: s.createdAt,
  }))
}
