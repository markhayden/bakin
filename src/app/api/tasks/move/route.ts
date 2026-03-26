import { NextResponse, type NextRequest } from 'next/server'
import { moveTaskWithEffects } from '@/core/task-service'

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
    await moveTaskWithEffects(identifier, to, agent, { from, channel: 'rest' })
    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = (err as Error).message
    if (msg.includes('Workflow tasks cannot be moved')) {
      return NextResponse.json({ error: msg }, { status: 403 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
