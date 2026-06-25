/**
 * POST /api/exec-tools/:toolName
 *
 * Small HTTP bridge for CLI-dispatched plugin commands. Agents still use MCP;
 * this endpoint exists so installed plugins can contribute CLI commands
 * without Bakin hardcoding plugin-specific subcommands.
 */
import { z } from 'zod'
import { getExecTool, getToolContext } from '@/core/exec-tools/registry'

function parseToolName(url: URL): string | null {
  const match = url.pathname.match(/^\/api\/exec-tools\/([^/]+)$/)
  return match ? decodeURIComponent(match[1]) : null
}

export async function post(req: Request, url: URL): Promise<Response> {
  const toolName = parseToolName(url)
  if (!toolName) return Response.json({ error: 'Invalid exec tool path' }, { status: 400 })

  const tool = getExecTool(toolName)
  if (!tool) return Response.json({ error: `Unknown exec tool: ${toolName}` }, { status: 404 })

  let body: { params?: Record<string, unknown>; agent?: string }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Request body must be JSON' }, { status: 400 })
  }

  const parsed = z.object(tool.parameters).safeParse(body.params ?? {})
  if (!parsed.success) {
    return Response.json({
      ok: false,
      error: 'Invalid tool parameters',
      details: parsed.error.flatten(),
    }, { status: 400 })
  }

  const agent = body.agent || 'cli'
  const result = await tool.handler(parsed.data, agent, getToolContext(toolName))
  return Response.json(result, { status: result.ok ? 200 : 400 })
}
