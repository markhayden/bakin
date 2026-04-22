import { NextResponse, type NextRequest } from 'next/server'
import { existsSync, rmSync } from 'fs'
import { join } from 'path'
import { getContentDir } from '@/core/content-dir'
import { createLogger } from '@/core/logger'

const log = createLogger('plugin-remove')

interface RemoveBody {
  pluginId: string
}

/**
 * POST /api/plugins/remove — remove an installed user plugin from
 * ~/.bakin/plugins/<id>/. Built-in core plugins (those shipped with Bakin)
 * cannot be removed via this endpoint — they live in the repo's plugins/
 * directory and are part of the Bakin install.
 *
 * A Bakin restart is required for the plugin's UI contributions to stop
 * appearing. Server-side hooks / routes are cleared on next boot.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: RemoveBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const pluginId = body.pluginId
  if (!pluginId || typeof pluginId !== 'string') {
    return NextResponse.json({ ok: false, error: 'Missing pluginId' }, { status: 400 })
  }
  if (!/^[a-z0-9][a-z0-9-_]{0,39}$/i.test(pluginId)) {
    return NextResponse.json({ ok: false, error: `Invalid pluginId "${pluginId}"` }, { status: 400 })
  }

  const pluginDir = join(getContentDir(), 'plugins', pluginId)
  if (!existsSync(pluginDir)) {
    return NextResponse.json({
      ok: false,
      error: `Plugin "${pluginId}" is not installed at ~/.bakin/plugins/`,
    }, { status: 404 })
  }

  try {
    rmSync(pluginDir, { recursive: true, force: true })
    log.info(`Removed plugin "${pluginId}"`)
    return NextResponse.json({
      ok: true,
      message: `Removed "${pluginId}". Restart Bakin for it to stop appearing.`,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error('Plugin remove failed', err as Error, { pluginId })
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
