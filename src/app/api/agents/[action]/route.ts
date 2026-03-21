import { NextResponse, type NextRequest } from 'next/server'
import { startAgent, stopAgent, restartAgent } from '@/lib/agents'
import { appendAudit } from '@/lib/audit'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ action: string }> }
) {
  const { action } = await params
  const body = await request.json()
  const { agent } = body

  if (!agent) {
    return NextResponse.json({ error: 'agent required' }, { status: 400 })
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
      return NextResponse.json({ error: 'invalid action' }, { status: 400 })
  }

  // Only audit successful actions
  if (result.ok) {
    appendAudit(`agent.${action}`, 'dashboard', { agent })
  } else {
    appendAudit(`agent.${action}.failed`, 'dashboard', { agent, error: 'error' in result ? result.error : 'note' in result ? result.note : 'unknown' })
  }

  return NextResponse.json(result)
}
