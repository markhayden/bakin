import { NextResponse, type NextRequest } from 'next/server'
import { logProgress } from '@/core/task-service'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { title, id, author, message } = body
  const identifier = id || title

  if (!identifier || !message) {
    return NextResponse.json({ error: 'title/id and message required' }, { status: 400 })
  }

  try {
    await logProgress(identifier, author || 'system', message, 'rest')
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
