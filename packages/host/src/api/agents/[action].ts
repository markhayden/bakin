/**
 * POST /api/agents/{action} — start/stop/restart an agent.
 *
 * Migrated from src/app/api/agents/[action]/route.ts for Phase B of #147.
 * The {action} segment is parsed from url.pathname (last segment).
 */
import { startAgent, stopAgent, restartAgent } from '@/lib/agents'
import { appendAudit } from '@/lib/audit'

export async function post(req: Request, url: URL): Promise<Response> {
  // Extract {action} from pathname: /api/agents/{action}
  const segments = url.pathname.split('/').filter(Boolean)
  const action = segments[segments.length - 1] || ''

  const body = await req.json()
  const { agent } = body

  if (!agent) {
    return Response.json({ error: 'agent required' }, { status: 400 })
  }

  let result
  switch (action) {
    case 'start':
      result = await startAgent(agent, body.message)
      break
    case 'stop':
      result = await stopAgent(agent)
      break
    case 'restart':
      result = await restartAgent(agent)
      break
    default:
      return Response.json({ error: 'invalid action' }, { status: 400 })
  }

  // Only audit successful actions
  if (result.ok) {
    appendAudit(`agent.${action}`, 'system', { agent })
  } else {
    appendAudit(`agent.${action}.failed`, 'system', { agent, error: 'error' in result ? result.error : 'note' in result ? result.note : 'unknown' })
  }

  return Response.json(result)
}
