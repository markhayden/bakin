import { NextResponse, type NextRequest } from 'next/server'
import { readTaskboard, writeTaskboard } from '@/lib/taskboard'
import { appendAudit } from '@/lib/audit'
import type { ColumnId } from '@/types'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { originalTitle, title, description, agent, column } = body

  if (!originalTitle) {
    return NextResponse.json({ error: 'originalTitle required' }, { status: 400 })
  }

  try {
    const { columns } = readTaskboard()

    for (const colId of Object.keys(columns) as ColumnId[]) {
      const idx = columns[colId].findIndex(t => t.title === originalTitle)
      if (idx !== -1) {
        const task = columns[colId][idx]

        if (title !== undefined) task.title = title
        if (description !== undefined) task.description = description || undefined
        if (agent !== undefined) task.agent = agent || undefined

        // Move to different column if requested
        if (column !== undefined && column !== colId) {
          const [moved] = columns[colId].splice(idx, 1)
          moved.checked = column === 'done'
          if (column === 'inProgress' || column === 'done') {
            moved.date = new Date().toISOString().split('T')[0]
          }
          columns[column as ColumnId].push(moved)
        }

        writeTaskboard(columns)
        appendAudit('task.updated', 'dashboard', { originalTitle, title, agent, column })
        return NextResponse.json({ ok: true })
      }
    }

    return NextResponse.json({ error: 'task not found' }, { status: 404 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
