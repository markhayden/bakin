import { NextResponse, type NextRequest } from 'next/server'
import { addTaskLog } from '@mc/tasks/taskboard'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { title, id, author, message } = body
  const identifier = id || title

  if (!identifier || !message) {
    return NextResponse.json({ error: 'title/id and message required' }, { status: 400 })
  }

  try {
    const agent = author || 'system'
    await addTaskLog(identifier, agent, message)

    // Fire-and-forget: emit activity event via SSE
    const port = process.env.PORT || 3737
    fetch(`http://localhost:${port}/api/activity/emit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent, message, ts: new Date().toISOString() }),
    }).catch(() => { /* best effort */ })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
