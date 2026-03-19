import { NextResponse, type NextRequest } from 'next/server'
import { readContentFile, writeContentFile } from '@/lib/content'
import { parseTaskboard, serializeTaskboard } from '@/lib/taskboard'
import { appendAudit } from '@/lib/audit'
import type { ColumnId } from '@/types'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { title, reason, agent } = body

  if (!title || !reason) {
    return NextResponse.json({ error: 'title and reason required' }, { status: 400 })
  }

  try {
    const content = readContentFile('TASKBOARD.md')
    if (!content) return NextResponse.json({ error: 'no taskboard' }, { status: 404 })

    const { columns } = parseTaskboard(content)

    // Find and move to blocked
    for (const colId of Object.keys(columns) as ColumnId[]) {
      const idx = columns[colId].findIndex(t => t.title === title)
      if (idx !== -1) {
        const [task] = columns[colId].splice(idx, 1)
        task.checked = false
        task.blockedReason = reason
        task.date = undefined
        columns.blocked.push(task)
        writeContentFile('TASKBOARD.md', serializeTaskboard(columns))
        appendAudit('task.blocked', agent || 'system', { title, reason })
        return NextResponse.json({ ok: true })
      }
    }

    return NextResponse.json({ error: 'task not found' }, { status: 404 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
