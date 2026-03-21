import { NextResponse, type NextRequest } from 'next/server'
import { updateTask } from '@mc/tasks/taskboard'
import { appendAudit } from '@/lib/audit'
import type { ColumnId } from '@mc/tasks/types'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { originalTitle, id, title, description, agent, column, workflowId } = body
  const identifier = id || originalTitle

  if (!identifier) {
    return NextResponse.json({ error: 'originalTitle or id required' }, { status: 400 })
  }

  try {
    await updateTask(identifier, { title, description, agent, column: column as ColumnId, workflowId })
    appendAudit('task.updated', 'dashboard', { id, originalTitle, title, agent, column })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
