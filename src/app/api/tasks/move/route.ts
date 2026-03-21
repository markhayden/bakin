import { NextResponse, type NextRequest } from 'next/server'
import { moveTask } from '@mc/tasks/taskboard'
import { appendAudit } from '@/lib/audit'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { title, id, from, to } = body
  const identifier = id || title

  if (!identifier || !to) {
    return NextResponse.json({ error: 'title/id and to required' }, { status: 400 })
  }

  try {
    await moveTask(identifier, to, from)
    appendAudit('task.moved', 'dashboard', { id, title, from, to })

    // Fire-and-forget: check for dependent tasks when moved to done
    if (to === 'done' && id) {
      const PORT = process.env.PORT || '3737'
      fetch(`http://localhost:${PORT}/api/internal/continuation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completedTaskId: id, completedTitle: title }),
      }).catch(() => {})
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
