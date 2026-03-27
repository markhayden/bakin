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
import { listDefinitions } from '../../plugins/workflows/parser'
import { appendAudit } from './audit'
import { getAllExecTools, recordExecToolCall } from '../../scripts/lib/registry'

// Core execution tools — self-register via addExecTool() on import.
// Must be imported AFTER registry.ts so the Map is initialized.
import '../../scripts/lib/save-asset'
import '../../scripts/lib/log-progress'
import '../../scripts/lib/get-step'
import '../../scripts/lib/submit-step'
import '../../scripts/lib/check-gates'
import '../../scripts/lib/generate-image'
import '../../scripts/lib/post-discord'

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

// Clean up stale sessions every 5 minutes. mcporter creates a new session per
// request (doesn't reuse session IDs), so these accumulate quickly.
const SESSION_TTL_MS = 30 * 60 * 1000 // 30 minutes
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
    'Create a new task on the task board. For top-level tasks, you MUST provide either workflowId or skipWorkflowReason. Subtasks (with parentId) are exempt.',
    {
      title: z.string().describe('Task title'),
      assignee: z.string().optional().describe('Agent to assign (chef, pixel, rolo, patch, trainer, etc.)'),
      description: z.string().optional().describe('Task description and context'),
      parentId: z.string().optional().describe('Parent task ID if this is a subtask'),
      workflowId: z.string().optional().describe('Workflow to start (e.g. image-social-post, video-script). Use beacon_list_workflows to see options.'),
      skipWorkflowReason: z.string().optional().describe('Reason no workflow applies (required if workflowId is not set and this is not a subtask)'),
    },
    async ({ title, assignee, description, parentId, workflowId, skipWorkflowReason }) => {
      const agent = getAgent()
      recordToolCall('beacon_create_task', agent)

      // Enforce workflow decision for top-level tasks
      if (!parentId && !workflowId && !skipWorkflowReason) {
        return {
          content: [{ type: 'text' as const, text: 'Error: Top-level tasks require either workflowId or skipWorkflowReason. Use beacon_list_workflows to see available workflows.' }],
          isError: true,
        }
      }

      try {
        const result = await createTaskWithEffects({
          title,
          assignee,
          description,
          workflowId,
          skipWorkflowReason,
          createdBy: agent,
          parentId,
          channel: 'mcp',
        })
        // Auto-dispatch subtasks
        if (parentId || assignee) {
          triggerDispatch()
        }
        const parts = [`Task created: ${result.id}`]
        if (result.workflowId) parts.push(`(workflow: ${result.workflowId})`)
        if (result.suggestedWorkflow && !result.workflowId) parts.push(`(suggested workflow: ${result.suggestedWorkflow})`)
        return { content: [{ type: 'text' as const, text: parts.join(' ') }] }
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true }
      }
    },
  )

  // -- beacon_list_workflows --
  server.tool(
    'beacon_list_workflows',
    'List available workflow definitions. Use before creating a task to check if a workflow fits.',
    {},
    async () => {
      const agent = getAgent()
      recordToolCall('beacon_list_workflows', agent)
      try {
        const defs = listDefinitions()
        if (defs.length === 0) {
          return { content: [{ type: 'text' as const, text: 'No workflow definitions found.' }] }
        }
        const lines = defs.map(d => {
          const steps = d.definition.steps || []
          const agents = [...new Set(steps.filter((s) => 'agent' in s && (s as { agent?: string }).agent).map((s) => (s as { agent?: string }).agent))]
          return `- ${d.name}: ${d.definition.description || d.definition.name}${agents.length ? ` (agents: ${agents.join(', ')})` : ''}`
        })
        return { content: [{ type: 'text' as const, text: `Available workflows:\n${lines.join('\n')}` }] }
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

  // -- Execution tools (from scripts/lib/registry) --
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
          const result = await tool.handler(params as Record<string, unknown>, agent)

          // Audit log for exec tool calls (success and failure)
          appendAudit(
            getContentDir(),
            result.ok ? `exec.${tool.name}.ok` : `exec.${tool.name}.fail`,
            agent,
            { taskId, ...(result.ok ? {} : { error: result.error }) },
            'mcp',
          )

          const text = result.ok
            ? JSON.stringify(result, null, 2)
            : `ERROR: ${result.error}${result.details ? '\n' + JSON.stringify(result.details, null, 2) : ''}`
          return { content: [{ type: 'text' as const, text }], isError: !result.ok }
        } catch (err) {
          appendAudit(getContentDir(), `exec.${tool.name}.error`, agent, { taskId, error: String(err) }, 'mcp')
          return { content: [{ type: 'text' as const, text: `Exec tool error: ${String(err)}` }], isError: true }
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
    // Aggregate sessions by agent — mcporter creates a new session per request,
    // so showing every session individually is noisy. Group by agent and show
    // the latest connection time, total sessions, and total tool calls.
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
      res.end(JSON.stringify({ error: 'agent query parameter required (e.g. /mcp?agent=chef)' }))
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
