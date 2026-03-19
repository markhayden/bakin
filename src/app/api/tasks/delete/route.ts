import { NextResponse, type NextRequest } from 'next/server'
import { deleteTask } from '@/lib/taskboard'
import { appendAudit } from '@/lib/audit'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { title } = body

  if (!title) {
    return NextResponse.json({ error: 'title required' }, { status: 400 })
  }

  try {
    deleteTask(title)
    appendAudit('task.deleted', 'dashboard', { title })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
