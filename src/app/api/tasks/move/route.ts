import { NextResponse, type NextRequest } from 'next/server'
import { moveTask, readTaskboard } from '@mc/tasks/taskboard'
import { appendAudit } from '@/lib/audit'

function resolveTitle(title: string | undefined, id: string | undefined): string {
  if (title) return title
  if (!id) return 'unknown'
  try {
    const { columns } = readTaskboard()
    for (const col of Object.values(columns)) {
      const found = (col as Array<{ id: string; title: string }>).find(t => t.id === id)
      if (found) return found.title
    }
  } catch { /* best effort */ }
  return id
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { title, id, from, to, agent } = body
  const identifier = id || title

  if (!identifier || !to) {
    return NextResponse.json({ error: 'title/id and to required' }, { status: 400 })
  }
  if (!agent) {
    return NextResponse.json({ error: 'agent field required — who is moving this task?' }, { status: 400 })
  }

  try {
    await moveTask(identifier, to, from)
    const resolvedTitle = resolveTitle(title, id)
    appendAudit('task.moved', agent, { id, title: resolvedTitle, from, to })

    // Check for dependent tasks when moved to done
    if (to === 'done' && id) {
      const PORT = process.env.PORT || '3737'
      try {
        await fetch(`http://localhost:${PORT}/api/internal/continuation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ completedTaskId: id, completedTitle: resolvedTitle }),
        })
      } catch (err) {
        console.error('Continuation trigger failed', err)
      }
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
