import { NextResponse, type NextRequest } from 'next/server'
import { createTask } from '@/lib/taskboard'
import { appendAudit } from '@/lib/audit'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { title, description, column, assignee } = body

  if (!title) {
    return NextResponse.json({ error: 'title required' }, { status: 400 })
  }

  try {
    createTask(title, column, assignee, description)
    appendAudit('task.created', 'dashboard', { title, column: column || 'todo', assignee })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
