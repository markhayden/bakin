import { NextResponse, type NextRequest } from 'next/server'
import { setDependencyWithEffects } from '@/core/task-service'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { id, dependsOn } = body

  if (!id || !dependsOn) {
    return NextResponse.json({ error: 'id and dependsOn required' }, { status: 400 })
  }

  try {
    await setDependencyWithEffects(id, dependsOn, 'rest')
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
