import { NextResponse, type NextRequest } from 'next/server'
import { deleteTask } from '@bakin/tasks/taskboard'
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
    appendAudit('task.deleted', 'roscoe', { id, title })

    // Auto-unlink from any project checklist items
    if (id) {
      import('@bakin/projects/lib/project-service')
        .then(m => m.autoUnlinkTask(id))
        .catch(() => {}) // projects plugin may not be loaded
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
