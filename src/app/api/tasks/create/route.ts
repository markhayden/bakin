import { NextResponse, type NextRequest } from 'next/server'
import { createTask } from '@mc/tasks/taskboard'
import { appendAudit } from '@/lib/audit'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { title, description, column, assignee, workflowId } = body

  if (!title) {
    return NextResponse.json({ error: 'title required' }, { status: 400 })
  }

  try {
    const task = await createTask(title, column, assignee, description, workflowId)
    appendAudit('task.created', 'dashboard', { id: task.id, title, column: column || 'todo', assignee, workflowId })
    return NextResponse.json({ ok: true, id: task.id })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
