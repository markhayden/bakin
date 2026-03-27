import { NextResponse, type NextRequest } from 'next/server'
import { createTaskWithEffects } from '@/core/task-service'
import { getContentDir } from '@/core/content-dir'
import { dispatchSingleTask } from '@/core/dispatch'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { title, description, column, assignee, workflowId, skipWorkflowReason, parentId, kick } = body

  if (!title) {
    return NextResponse.json({ error: 'title required' }, { status: 400 })
  }

  try {
    const result = await createTaskWithEffects({
      title,
      column,
      assignee,
      description,
      workflowId,
      skipWorkflowReason,
      parentId,
      createdBy: 'main-operator',
      channel: 'rest',
    })

    // Immediate dispatch: explicit kick or auto-kick for subtasks
    if (kick || parentId) {
      const contentDir = getContentDir()
      const port = Number(process.env.PORT || 3737)
      const source = parentId ? 'subtask' : 'kick'
      // Fire-and-forget — task is created regardless of dispatch outcome
      dispatchSingleTask(result.id, contentDir, port, source as 'kick' | 'subtask').catch(() => {
        // dispatch errors are logged internally
      })
    }

    return NextResponse.json({ ok: true, id: result.id, workflowId: result.workflowId, suggestedWorkflow: result.suggestedWorkflow })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
