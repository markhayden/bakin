import { NextResponse, type NextRequest } from 'next/server'
import { addTaskLog } from '@/lib/taskboard'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { title, author, message } = body

  if (!title || !message) {
    return NextResponse.json({ error: 'title and message required' }, { status: 400 })
  }

  try {
    addTaskLog(title, author || 'system', message)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
