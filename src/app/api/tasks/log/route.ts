import { NextResponse, type NextRequest } from 'next/server'
import { addTaskLog } from '@mc/tasks/taskboard'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { title, id, author, message } = body
  const identifier = id || title

  if (!identifier || !message) {
    return NextResponse.json({ error: 'title/id and message required' }, { status: 400 })
  }

  const agent = author || 'system'

  // Broadcast activity event via SSE immediately (before persistence, so live feed is never blocked)
  const broadcastFn = (globalThis as any).__beaconBroadcast
  if (broadcastFn) {
    broadcastFn({ type: 'activity', agent, message, ts: new Date().toISOString(), taskId: identifier })
  }

  try {
    await addTaskLog(identifier, agent, message)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
