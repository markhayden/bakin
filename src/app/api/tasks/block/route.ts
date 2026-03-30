import { NextResponse, type NextRequest } from 'next/server'
import { blockTask } from '@bakin/tasks/taskboard'
import { appendAudit } from '@/lib/audit'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { title, id, reason, agent } = body
  const identifier = id || title

  if (!identifier || !reason) {
    return NextResponse.json({ error: 'title/id and reason required' }, { status: 400 })
  }

  try {
    await blockTask(identifier, reason, agent)
    appendAudit('task.blocked', agent || 'system', { id, title, reason })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
