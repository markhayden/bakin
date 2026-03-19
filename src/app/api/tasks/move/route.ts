import { NextResponse, type NextRequest } from 'next/server'
import { moveTask } from '@/lib/taskboard'
import { appendAudit } from '@/lib/audit'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { title, from, to } = body

  if (!title || !to) {
    return NextResponse.json({ error: 'title and to required' }, { status: 400 })
  }

  try {
    moveTask(title, to, from)
    appendAudit('task.moved', 'dashboard', { title, from, to })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
