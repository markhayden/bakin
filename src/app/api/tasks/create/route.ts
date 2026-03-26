import { NextResponse, type NextRequest } from 'next/server'
import { createTask } from '@mc/tasks/taskboard'
import { appendAudit } from '@/lib/audit'
import { getContentDir } from '@/core/content-dir'
import { dispatchSingleTask } from '@/core/dispatch'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { title, description, column, assignee, workflowId, parentId, kick } = body

  if (!title) {
    return NextResponse.json({ error: 'title required' }, { status: 400 })
  }

  try {
    const task = await createTask(title, column, assignee, description, workflowId, undefined, undefined, parentId)
    appendAudit('task.created', 'main-operator', { id: task.id, title, column: column || 'todo', assignee, workflowId, parentId })

    // Immediate dispatch: explicit kick or auto-kick for subtasks
    if (kick || parentId) {
      const contentDir = getContentDir()
      const port = Number(process.env.PORT || 3737)
      const source = parentId ? 'subtask' : 'kick'
      // Fire-and-forget — task is created regardless of dispatch outcome
      dispatchSingleTask(task.id, contentDir, port, source as 'kick' | 'subtask').catch(() => {
        // dispatch errors are logged internally
      })
    }

    return NextResponse.json({ ok: true, id: task.id })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
