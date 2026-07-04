/**
 * Startup-context diagnostics (#357).
 *
 *   GET /api/context-report            per-agent summary rows (all agents)
 *   GET /api/context-report/{agentId}  full per-source breakdown
 *
 * Source names and byte/token numbers ONLY — never prompt or file content.
 * Top-level (not under /api/agents/...) because that path family is the
 * runtime-ops surface; this one is a Bakin-owned read-only diagnostic.
 */
import { buildAgentContextReport } from '@/core/context-report'
import { getAppServices } from '@/core/app-services'
import { getRuntimeMainAgentId } from '@bakin/core/adapters/runtime'
import { createLogger } from '@/core/logger'

const log = createLogger('api:context-report')

export async function handler(req: Request, url: URL): Promise<Response> {
  if (req.method !== 'GET') {
    return Response.json({ ok: false, error: 'Method not allowed' }, { status: 405 })
  }
  const segments = url.pathname.split('/').filter(Boolean) // ['api','context-report',...]
  if (segments[0] !== 'api' || segments[1] !== 'context-report' || segments.length > 3) {
    return Response.json({ ok: false, error: 'Not found' }, { status: 404 })
  }

  try {
    const { runtime } = getAppServices()
    const mainAgentId = await getRuntimeMainAgentId(runtime)

    if (segments.length === 3) {
      const agentId = segments[2]
      const agent = await runtime.agents.get(agentId)
      if (!agent) {
        return Response.json({ ok: false, error: `Unknown agent "${agentId}"` }, { status: 404 })
      }
      const report = await buildAgentContextReport(agentId, { runtime, mainAgentId })
      return Response.json({ ok: true, report })
    }

    const agents = await runtime.agents.list()
    const summaries = []
    for (const agent of agents) {
      const report = await buildAgentContextReport(agent.id, { runtime, mainAgentId })
      const latest = report.observed.runs[0] ?? null
      summaries.push({
        agentId: agent.id,
        staticTaskBytes: report.dispatch.task.totalBytes,
        staticWorkflowBytes: report.dispatch.workflow.totalBytes,
        estimatedMaxTaskBytes: report.dispatch.estimatedMaxTaskBytes,
        workspaceAvailable: report.workspace.available,
        workspaceTotalBytes: report.workspace.totalBytes,
        lastObserved: latest
          ? {
              inputTokens: latest.inputTokens,
              cacheReadTokens: latest.cacheReadTokens,
              cacheWriteTokens: latest.cacheWriteTokens,
              occurredAt: latest.occurredAt,
            }
          : null,
      })
    }
    return Response.json({ ok: true, tokenEstimateNote: 'byte-derived estimates are approximate', agents: summaries })
  } catch (err) {
    log.error('context-report failed', err, { path: url.pathname })
    return Response.json({ ok: false, error: 'Context report failed' }, { status: 500 })
  }
}
