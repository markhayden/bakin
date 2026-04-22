/**
 * GET /api/plugins/:pluginId/assets/:path* — serves a plugin's client bundle.
 *
 * Resolution order:
 *   1. ~/.bakin/plugins/<id>/dist/<path>   (user-installed)
 *   2. plugins/<id>/dist/<path>            (repo core plugins)
 *
 * Phase G embeds the core dist/ trees into the compiled binary via
 * `Bun.embeddedFiles`; until then we read from disk. User plugins always
 * live on disk under ~/.bakin/.
 */
import { readFileSync, existsSync, statSync } from 'fs'
import { join, extname } from 'path'
import { getContentDir } from '@/core/content-dir'

const MIME: Record<string, string> = {
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
}

function parsePath(url: URL): { pluginId: string; relPath: string } | null {
  const match = url.pathname.match(/^\/api\/plugins\/([^/]+)\/assets\/(.+)$/)
  if (!match) return null
  const [, pluginId, relPath] = match
  if (relPath.includes('..') || pluginId.includes('..')) return null
  if (!/^[a-z0-9][a-z0-9-_]{0,39}$/i.test(pluginId)) return null
  return { pluginId, relPath }
}

export async function get(_req: Request, url: URL): Promise<Response> {
  const parsed = parsePath(url)
  if (!parsed) {
    return Response.json({ error: 'Invalid plugin asset path' }, { status: 400 })
  }

  const { pluginId, relPath } = parsed

  const candidates = [
    join(getContentDir(), 'plugins', pluginId, 'dist', relPath),
    join(process.cwd(), 'plugins', pluginId, 'dist', relPath),
  ]

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    const stat = statSync(candidate)
    if (!stat.isFile()) continue

    const mime = MIME[extname(candidate).toLowerCase()] ?? 'application/octet-stream'
    const body = readFileSync(candidate)
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Content-Length': stat.size.toString(),
        'Cache-Control': 'public, max-age=300',
      },
    })
  }

  return Response.json(
    { error: `Plugin asset not found: ${pluginId}/${relPath}` },
    { status: 404 },
  )
}
