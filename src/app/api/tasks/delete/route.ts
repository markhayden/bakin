import { NextResponse, type NextRequest } from 'next/server'
import { deleteTask } from '@mc/tasks/taskboard'
import { appendAudit } from '@/lib/audit'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { title, id } = body
  const identifier = id || title

  if (!identifier) {
    return NextResponse.json({ error: 'title or id required' }, { status: 400 })
  }

  try {
    await deleteTask(identifier)
    appendAudit('task.deleted', 'main-operator', { id, title })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
