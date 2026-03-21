import { NextResponse, type NextRequest } from 'next/server'
import { setDependency } from '@mc/tasks/taskboard'
import { appendAudit } from '@/lib/audit'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { id, dependsOn } = body

  if (!id || !dependsOn) {
    return NextResponse.json({ error: 'id and dependsOn required' }, { status: 400 })
  }

  try {
    await setDependency(id, dependsOn)
    appendAudit('task.dependency_set', 'api', { id, dependsOn })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
