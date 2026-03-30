import { NextResponse, type NextRequest } from 'next/server'
import { reorderTasks } from '@bakin/tasks/taskboard'
import { appendAudit } from '@/lib/audit'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { columnId, orderedIds } = body

  if (!columnId || !Array.isArray(orderedIds)) {
    return NextResponse.json({ error: 'columnId and orderedIds[] required' }, { status: 400 })
  }

  try {
    await reorderTasks(columnId, orderedIds)
    appendAudit('task.reordered', 'roscoe', { columnId, orderedIds })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
