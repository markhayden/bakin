/**
 * Bakin MCP Server.
 *
 * Exposes agent-facing operations as MCP tools over Streamable HTTP.
 * Agents connect to /mcp?agent=<name> and get tools for task management,
 * progress logging, workflow step submission, etc.
 *
 * Transport: Streamable HTTP only (POST initialize; Mcp-Session-Id header;
 * GET with a session id opens the notification stream). Sessionless GETs are
 * 405 per spec — the legacy SSE auto-handshake was removed because the codex
 * MCP client ignores it and waits a fixed 5s before falling back to
 * streamable-http, taxing every codex-runtime turn ~5s. Provisioned OpenClaw
 * entries declare `type: "streamable-http"` so the embedded runtime (whose
 * HTTP client DEFAULTS to legacy SSE) picks the right transport too.
 *
 * All tools are registered dynamically via the exec tool registry:
 * - Plugin tools: registered via ctx.registerExecTool() in plugin activate()
 * - Built-in tools: self-register via addExecTool() on import (src/core/exec-tools/tools/*.ts)
 *
 * Each agent session gets its own McpServer + transport pair.
 * Agent identity is bound at session initialization from the query param.
 */
import { randomUUID } from 'crypto'
import type { IncomingMessage, ServerResponse } from 'http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { ActivityClass } from '@makinbakin/sdk/types'
import { createLogger } from './logger'
import { getContentDir } from './content-dir'
import { appendAudit } from './audit'
import {
  isInvalidJsonBodyError,
  isRequestBodyTooLargeError,
  readJsonBody,
} from './request-body'
import { recordUsage } from '@/core/usage'
import { getAllExecTools, getExecTool, getToolContext } from './exec-tools/registry'
import {
  describeMcpToolDenial,
  isToolAllowedByPolicy,
  resolveMcpToolPolicy,
  type McpToolPolicy,
} from './mcp-tool-policy'

// Built-in exec tools — self-register on import (src/core/exec-tools/tools/).
// Must be imported AFTER registry.ts so the Map is initialized.
import './exec-tools/tools/log-progress'
import './exec-tools/tools/post-channel'
import './exec-tools/tools/get-paths'
import './exec-tools/tools/heartbeat'
import './exec-tools/tools/search-tools'
import './exec-tools/tools/pdf'

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

const startedAt = new Date().toISOString()

type SessionSummaryInput = Pick<McpSession, 'agentId' | 'createdAt'>

export function summarizeMcpSessions(
  streamable: Iterable<SessionSummaryInput>,
  upSince: string = startedAt,
): { activeSessions: Array<{ agent: string; sessions: number; connectedAt: string }>; upSince: string } {
  const agentMap = new Map<string, { sessions: number; latestAt: number }>()
  for (const session of streamable) {
    const existing = agentMap.get(session.agentId)
    if (existing) {
      existing.sessions++
      existing.latestAt = Math.max(existing.latestAt, session.createdAt)
    } else {
      agentMap.set(session.agentId, { sessions: 1, latestAt: session.createdAt })
    }
  }
  return {
    activeSessions: Array.from(agentMap.entries()).map(([agent, info]) => ({
      agent,
      sessions: info.sessions,
      connectedAt: new Date(info.latestAt).toISOString(),
    })),
    upSince,
  }
}

// Expose MCP session state to plugin-land without an HTTP hop. The health
// plugin reads this via globalThis to avoid coupling to mcp-server.ts
// directly — same pattern as __bakinBroadcast.
;(globalThis as unknown as { __bakinGetMcpSessions?: () => { activeSessions: Array<{ agent: string; sessions: number; connectedAt: string }>; upSince: string } }).__bakinGetMcpSessions = () => {
  return summarizeMcpSessions(sessions.values(), startedAt)
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
  if (cleaned > 0) {
    log.info('Cleaned up stale MCP sessions', { cleaned, remaining: sessions.size })
  }
}, 5 * 60 * 1000)

// ---------------------------------------------------------------------------
// Tool registration — all tools come from the exec tool registry
// ---------------------------------------------------------------------------

export function registerTools(server: McpServer, getAgent: () => string): void {
  const policy = resolveMcpToolPolicy(getAgent())
  for (const tool of getAllExecTools()) {
    const registered = server.tool(
      tool.name,
      tool.description,
      tool.parameters,
      async (params) => {
        const agent = getAgent()
        const activityClass = tool.activityClass ?? 'user'
        const taskId = (params as Record<string, unknown>).taskId as string | undefined
        log.info('Exec tool called', { tool: tool.name, agent, taskId })

        const start = Date.now()
        if (!isToolAllowedByPolicy(policy, tool.name)) {
          const durationMs = Date.now() - start
          log.warn('Exec tool denied by MCP policy', { tool: tool.name, agent, taskId })
          return buildDeniedToolResult(tool.name, agent, policy, tool.label, taskId, durationMs, activityClass)
        }

        try {
          const toolCtx = getToolContext(tool.name)
          const result = await tool.handler(params as Record<string, unknown>, agent, toolCtx)
          const durationMs = Date.now() - start

          recordUsage({
            kind: 'mcp',
            activityClass,
            name: tool.name,
            agent,
            durationMs,
            status: result.ok ? 'ok' : 'error',
            meta: {
              taskId,
              label: tool.label,
              ...(result.ok ? {} : { error: String(result.error || 'unknown') }),
            },
          })

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
          const durationMs = Date.now() - start
          const errMsg = err instanceof Error ? err.message : String(err)
          recordUsage({
            kind: 'mcp',
            activityClass,
            name: tool.name,
            agent,
            durationMs,
            status: 'error',
            meta: { taskId, label: tool.label, error: errMsg },
          })
          appendAudit(getContentDir(), `exec.${tool.name}.error`, agent, { taskId, label: tool.label, ...(tool.activityDuplicate ? { duplicate: true } : {}), error: errMsg }, 'mcp')
          return { content: [{ type: 'text' as const, text: `Exec tool error: ${errMsg}` }], isError: true }
        }
      },
    )
    if (!isToolAllowedByPolicy(policy, tool.name)) {
      registered?.disable?.()
    }
  }
  installPolicyCallGuard(server, getAgent, policy)
}

function buildDeniedToolResult(
  toolName: string,
  agent: string,
  policy: McpToolPolicy,
  label: string | undefined,
  taskId: string | undefined,
  durationMs: number,
  activityClass: ActivityClass,
): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  const reason = describeMcpToolDenial(policy)
  recordUsage({
    kind: 'mcp',
    activityClass,
    name: toolName,
    agent,
    durationMs,
    status: 'error',
    meta: {
      taskId,
      label,
      reason,
      denied: true,
    },
  })
  appendAudit(
    getContentDir(),
    `exec.${toolName}.denied`,
    agent,
    { taskId, label, reason, denied: true },
    'mcp',
  )
  return {
    content: [{
      type: 'text',
      text: `ERROR: MCP tool "${toolName}" is denied for agent "${agent}": ${reason}`,
    }],
    isError: true,
  }
}

type RawMcpRequestHandler = (request: unknown, extra: unknown) => unknown
type RawMcpServerWithHandlers = {
  _requestHandlers?: Map<string, RawMcpRequestHandler>
  setRequestHandler?: (schema: unknown, handler: RawMcpRequestHandler) => void
}

function installPolicyCallGuard(
  server: McpServer,
  getAgent: () => string,
  policy: McpToolPolicy,
): void {
  // The MCP SDK hides disabled tools from tools/list, but its default
  // tools/call handler returns "disabled" before reaching our tool callback.
  // Wrap that handler so forged direct calls to hidden Bakin tools are audited.
  const rawServer = (server.server as unknown as RawMcpServerWithHandlers | undefined)
  const original = rawServer?._requestHandlers?.get('tools/call')
  if (!rawServer?.setRequestHandler || !original) return

  rawServer.setRequestHandler(CallToolRequestSchema, async (request: unknown, extra: unknown) => {
    const params = (request as { params?: { name?: string; arguments?: Record<string, unknown> } }).params
    const toolName = params?.name
    if (toolName && !isToolAllowedByPolicy(policy, toolName)) {
      const tool = getExecTool(toolName)
      if (tool) {
        const agent = getAgent()
        const taskId = params?.arguments?.taskId as string | undefined
        log.warn('Exec tool denied by MCP policy', { tool: toolName, agent, taskId })
        return buildDeniedToolResult(
          toolName,
          agent,
          policy,
          tool.label,
          taskId,
          0,
          tool.activityClass ?? 'user',
        )
      }
    }
    return original(request, extra)
  })
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

  // /mcp/stats — lightweight observability endpoint. Call counts and error
  // rates now live in the unified usage recorder (see /api/plugins/health/*);
  // this endpoint only exposes raw MCP session state.
  if (url.pathname === '/mcp/stats' && method === 'GET') {
    const snapshot = (globalThis as unknown as { __bakinGetMcpSessions?: () => { activeSessions: unknown; upSince: string } }).__bakinGetMcpSessions?.()
      ?? { activeSessions: [], upSince: startedAt }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(snapshot, null, 2))
    return
  }

  const agentId = url.searchParams.get('agent')

  // ─── GET: streamable-http notification stream ───────────────────────
  // A GET with a live Mcp-Session-Id opens the session's server→client
  // notification stream. A GET WITHOUT one is 405 per the streamable-http
  // spec. (This endpoint previously auto-started a legacy SSE handshake for
  // sessionless GETs; the codex MCP client ignores that handshake and waits
  // a fixed 5s before falling back to streamable-http — a 5s tax on every
  // codex-runtime turn. 405 makes clients fall back immediately.)
  if (method === 'GET') {
    const existingSessionId = req.headers['mcp-session-id'] as string | undefined
    if (existingSessionId) {
      const session = sessions.get(existingSessionId)
      if (!session) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Session not found' }))
        return
      }
      await session.transport.handleRequest(req, res)
      return
    }

    res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST, DELETE' })
    res.end(JSON.stringify({
      error: 'Streamable HTTP only: POST a JSON-RPC initialize request to /mcp?agent=<id>. GET requires an Mcp-Session-Id header from an initialized session.',
    }))
    return
  }

  // ─── POST: route to correct transport ──────────────────────────────
  if (method === 'POST') {
    let body: unknown
    try {
      body = await parseBody(req)
    } catch (err) {
      if (isRequestBodyTooLargeError(err)) {
        res.writeHead(413, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: err.message }))
        return
      }
      if (isInvalidJsonBodyError(err)) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Invalid JSON body' }))
        return
      }
      throw err
    }

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

    // New Streamable HTTP session
    if (!agentId) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'agent query parameter required (e.g. /mcp?agent=chef)' }))
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
  return readJsonBody(req)
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
