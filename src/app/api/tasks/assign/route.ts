import { NextResponse, type NextRequest } from 'next/server'
import { assignTask } from '@mc/tasks/taskboard'
import { appendAudit } from '@/lib/audit'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { title, id, agent } = body
  const identifier = id || title

  if (!identifier) {
    return NextResponse.json({ error: 'title or id required' }, { status: 400 })
  }

  try {
    await assignTask(identifier, agent || '')
    appendAudit('task.assigned', 'main-operator', { id, title, agent })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
