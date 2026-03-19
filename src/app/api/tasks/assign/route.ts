import { NextResponse, type NextRequest } from 'next/server'
import { assignTask } from '@/lib/taskboard'
import { appendAudit } from '@/lib/audit'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { title, agent } = body

  if (!title) {
    return NextResponse.json({ error: 'title required' }, { status: 400 })
  }

  try {
    assignTask(title, agent || '')
    appendAudit('task.assigned', 'dashboard', { title, agent })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
