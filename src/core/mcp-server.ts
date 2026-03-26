/**
 * Beacon MCP Server.
 *
 * Exposes agent-facing operations as MCP tools over Streamable HTTP.
 * Agents connect to /mcp?agent=<name> and get tools for task management,
 * progress logging, workflow step submission, etc.
 *
 * Each agent session gets its own McpServer + transport pair.
 * Agent identity is bound at session initialization from the query param.
 */
import { randomUUID } from 'crypto'
import type { IncomingMessage, ServerResponse } from 'http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { createLogger } from './logger'
import { getContentDir, getBeaconPaths } from './content-dir'
import {
  logProgress,
  moveTaskWithEffects,
  blockTaskWithEffects,
  createTaskWithEffects,
  reportComplete,
  setDependencyWithEffects,
  getTaskDetails,
  triggerDispatch,
} from './task-service'
import { getCurrentStep, completeStep } from '../../plugins/workflows/runtime'
import { appendAudit } from './audit'

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

// ---------------------------------------------------------------------------
// In-memory stats (reset on server restart)
// ---------------------------------------------------------------------------

interface McpStats {
  toolCalls: Record<string, number>
  totalRequests: number
  sessionsByAgent: Record<string, number> // tool calls per agent
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

// Clean up stale sessions every 30 minutes
const SESSION_TTL_MS = 4 * 60 * 60 * 1000 // 4 hours
setInterval(() => {
  const now = Date.now()
  for (const [id, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      log.info('Cleaning up stale MCP session', { sessionId: id, agent: session.agentId })
      session.transport.close?.()
      sessions.delete(id)
    }
  }
}, 30 * 60 * 1000)

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

function registerTools(server: McpServer, getAgent: () => string): void {
  // -- beacon_log_progress --
  server.tool(
    'beacon_log_progress',
    'Log a human-readable progress update to the live activity feed. Call this at every significant step.',
    {
      taskId: z.string().describe('Task ID (e.g. "fe84ac51")'),
      message: z.string().describe('Human-readable status update'),
    },
    async ({ taskId, message }) => {
      const agent = getAgent()
      recordToolCall('beacon_log_progress', agent)
      await logProgress(taskId, agent, message, 'mcp')
      return { content: [{ type: 'text' as const, text: 'Logged.' }] }
    },
  )

  // -- beacon_move_task --
  server.tool(
    'beacon_move_task',
    'Move a task to a different column on the task board.',
    {
      taskId: z.string().describe('Task ID'),
      to: z.enum(['todo', 'inProgress', 'done', 'blocked', 'confirmed']).describe('Target column'),
      reason: z.string().optional().describe('Required when moving to "blocked"'),
    },
    async ({ taskId, to, reason }) => {
      const agent = getAgent()
      recordToolCall('beacon_move_task', agent)
      if (to === 'blocked' && !reason) {
        return { content: [{ type: 'text' as const, text: 'Error: reason is required when moving to blocked.' }], isError: true }
      }
      try {
        await moveTaskWithEffects(taskId, to, agent, { channel: 'mcp' })
        return { content: [{ type: 'text' as const, text: `Task moved to ${to}.` }] }
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true }
      }
    },
  )

  // -- beacon_create_task --
  server.tool(
    'beacon_create_task',
    'Create a new task on the task board. Use for subtasks when your work requires another agent.',
    {
      title: z.string().describe('Task title'),
      assignee: z.string().optional().describe('Agent to assign (basil, pixel, rolo, patch, nemo, etc.)'),
      description: z.string().optional().describe('Task description and context'),
      parentId: z.string().optional().describe('Parent task ID if this is a subtask'),
    },
    async ({ title, assignee, description, parentId }) => {
      const agent = getAgent()
      recordToolCall('beacon_create_task', agent)
      try {
        const { id } = await createTaskWithEffects({
          title,
          assignee,
          description,
          createdBy: agent,
          parentId,
          channel: 'mcp',
        })
        // Auto-dispatch subtasks
        if (parentId || assignee) {
          triggerDispatch()
        }
        return { content: [{ type: 'text' as const, text: `Task created: ${id}` }] }
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true }
      }
    },
  )

  // -- beacon_block_task --
  server.tool(
    'beacon_block_task',
    'Mark a task as blocked with a reason. Use when you cannot proceed.',
    {
      taskId: z.string().describe('Task ID'),
      reason: z.string().describe('Why the task is blocked'),
    },
    async ({ taskId, reason }) => {
      const agent = getAgent()
      recordToolCall('beacon_block_task', agent)
      try {
        await blockTaskWithEffects(taskId, reason, agent, 'mcp')
        return { content: [{ type: 'text' as const, text: 'Task blocked.' }] }
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true }
      }
    },
  )

  // -- beacon_report_complete --
  server.tool(
    'beacon_report_complete',
    'Report that your task is complete. Moves the task to Done and notifies the orchestrator.',
    {
      taskId: z.string().describe('Task ID'),
      summary: z.string().describe('Summary of what you accomplished'),
    },
    async ({ taskId, summary }) => {
      const agent = getAgent()
      recordToolCall('beacon_report_complete', agent)
      try {
        await reportComplete(taskId, agent, summary, 'mcp')
        return { content: [{ type: 'text' as const, text: 'Task complete. Orchestrator notified.' }] }
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true }
      }
    },
  )

  // -- beacon_get_step --
  server.tool(
    'beacon_get_step',
    'Get your current workflow step details — instructions, output schema, prior step context.',
    {
      taskId: z.string().describe('Task ID'),
    },
    async ({ taskId }) => {
      const agent = getAgent()
      recordToolCall('beacon_get_step', agent)
      const step = getCurrentStep(taskId, agent, getContentDir())
      if (!step) {
        return { content: [{ type: 'text' as const, text: 'No active workflow step found for this task.' }], isError: true }
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(step, null, 2) }] }
    },
  )

  // -- beacon_submit_step --
  server.tool(
    'beacon_submit_step',
    'Submit your workflow step output. The output must match the step\'s required JSON schema. After successful submission, your work is done — do not continue.',
    {
      taskId: z.string().describe('Task ID'),
      stepId: z.string().describe('Step ID'),
      output: z.record(z.string(), z.unknown()).describe('Step output matching the required schema'),
    },
    async ({ taskId, stepId, output }) => {
      const agent = getAgent()
      recordToolCall('beacon_submit_step', agent)
      const result = completeStep(taskId, stepId, output as Record<string, unknown>, agent, getContentDir())

      if (!result.success) {
        return {
          content: [{ type: 'text' as const, text: `Step submission failed: ${result.errors?.join('; ')}` }],
          isError: true,
        }
      }

      appendAudit(getContentDir(), 'workflow.step_complete', agent, { taskId, stepId }, 'mcp')

      // Kick dispatch so the next step's agent starts immediately
      if (!result.workflowComplete) {
        triggerDispatch()
      }

      const msg = result.workflowComplete
        ? 'Step submitted. Workflow complete — your work is done.'
        : 'Step submitted. Next step dispatched.'
      return { content: [{ type: 'text' as const, text: msg }] }
    },
  )

  // -- beacon_get_paths --
  server.tool(
    'beacon_get_paths',
    'Get Beacon content directory paths — where to find assets, team info, docs, etc.',
    {},
    async () => {
      recordToolCall('beacon_get_paths', getAgent())
      const paths = getBeaconPaths()
      return { content: [{ type: 'text' as const, text: JSON.stringify(paths, null, 2) }] }
    },
  )

  // -- beacon_register_dependency --
  server.tool(
    'beacon_register_dependency',
    'Register a dependency between tasks. Your task will be auto-re-dispatched when the dependency completes. After registering, exit — do not wait.',
    {
      taskId: z.string().describe('Your task ID (the one that depends)'),
      dependsOn: z.string().describe('Task ID you depend on'),
    },
    async ({ taskId, dependsOn }) => {
      recordToolCall('beacon_register_dependency', getAgent())
      try {
        await setDependencyWithEffects(taskId, dependsOn, 'mcp')
        return { content: [{ type: 'text' as const, text: `Dependency registered. You will be re-dispatched when ${dependsOn} completes. Stop now.` }] }
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true }
      }
    },
  )

  // -- beacon_get_task --
  server.tool(
    'beacon_get_task',
    'Get details about a task — title, description, current column, logs, dependencies.',
    {
      taskId: z.string().describe('Task ID'),
    },
    async ({ taskId }) => {
      recordToolCall('beacon_get_task', getAgent())
      const result = getTaskDetails(taskId)
      if (!result) {
        return { content: [{ type: 'text' as const, text: `Task ${taskId} not found on the board.` }], isError: true }
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    },
  )
}

// ---------------------------------------------------------------------------
// Session factory
// ---------------------------------------------------------------------------

function createSession(agentId: string): McpSession {
  const server = new McpServer(
    { name: 'beacon', version: '1.0.0' },
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
    const activeSessions = Array.from(sessions.entries()).map(([id, s]) => ({
      sessionId: id,
      agent: s.agentId,
      connectedAt: new Date(s.createdAt).toISOString(),
      toolCalls: stats.sessionsByAgent[s.agentId] || 0,
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

  // Extract agent identity from query param
  const agentId = url.searchParams.get('agent')

  // Check for existing session
  const existingSessionId = req.headers['mcp-session-id'] as string | undefined

  if (existingSessionId) {
    // Route to existing session
    const session = sessions.get(existingSessionId)
    if (!session) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Session not found' }))
      return
    }

    // Handle DELETE (session termination)
    if (method === 'DELETE') {
      await session.transport.handleRequest(req, res)
      sessions.delete(existingSessionId)
      log.info('MCP session closed', { sessionId: existingSessionId, agent: session.agentId })
      return
    }

    await session.transport.handleRequest(req, res)
    return
  }

  // New session — initialization request (POST without session ID)
  if (method === 'POST') {
    if (!agentId) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'agent query parameter required (e.g. /mcp?agent=basil)' }))
      return
    }

    const session = createSession(agentId)

    // Connect server to transport before handling the request
    await session.server.connect(session.transport)

    // Parse request body for the transport
    const body = await parseBody(req)
    await session.transport.handleRequest(req, res, body)

    // Store session after successful initialization
    const sid = session.transport.sessionId
    if (sid) {
      sessions.set(sid, session)
      log.info('MCP session created', { sessionId: sid, agent: agentId })
    }
    return
  }

  // GET without session ID — not valid for initialization
  res.writeHead(400, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'POST required for session initialization' }))
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
