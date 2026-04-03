import { NextRequest, NextResponse } from 'next/server'
import { join } from 'path'
import { existsSync, readFileSync } from 'fs'
import { getBakinPaths } from '@bakin/core/content-dir'

/**
 * GET /api/agents/avatar?id={agentId}
 * Serves agent avatar thumbnail from ~/.bakin/agents/{id}/avatar.jpg
 */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  if (!id) {
    return NextResponse.json({ error: 'Missing id param' }, { status: 400 })
  }

  const { agents } = getBakinPaths()
  const avatarPath = join(agents, id, 'avatar.jpg')

  if (!existsSync(avatarPath)) {
    return new NextResponse(null, { status: 404 })
  }

  const data = readFileSync(avatarPath)
  return new NextResponse(data, {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
    },
  })
}
