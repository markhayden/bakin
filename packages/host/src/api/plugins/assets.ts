/**
 * GET /api/plugins/:pluginId/assets/:path* — serves a plugin's client bundle.
 *
 * Resolution order:
 *   1. ~/.bakin/plugins/<id>/dist/<path>   (user-installed; always on disk)
 *   2. EMBEDDED_ASSETS map                 (core plugins embedded at build time)
 *   3. plugins/<id>/dist/<path>            (repo core plugins, dev fallback)
 *
 * In the compiled binary the EMBEDDED_ASSETS lookup wins for every core
 * plugin. User plugins still live on disk under ~/.bakin/ because they're
 * installed post-launch.
 */
import { readFileSync, existsSync, statSync } from 'fs'
import { join, extname } from 'path'
import { getContentDir } from '@/core/content-dir'
import { EMBEDDED_ASSETS } from '../_embedded-assets'
import { stampPluginResponse } from '@/core/plugin-host/version-stamp'

const MIME: Record<string, string> = {
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
}

function mimeFor(path: string): string {
  return MIME[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * Dev-mode forces no-store so location.reload() picks up rebuilt plugin
 * bundles that overwrite the same URL path. v2 hot-swap uses ?v=<mtime>
 * cache-bust, so this only matters for the initial load after a reload
 * — but it matters a lot when a shell reload follows a plugin rebuild.
 */
function cacheControl(): string {
  return process.env.BAKIN_DEV === '1' ? 'no-store' : 'public, max-age=300'
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

  // 1) User-installed plugin — always on disk.
  const userPath = join(getContentDir(), 'plugins', pluginId, 'dist', relPath)
  if (existsSync(userPath) && statSync(userPath).isFile()) {
    const body = readFileSync(userPath)
    return stampPluginResponse(pluginId, new Response(body, {
      status: 200,
      headers: {
        'Content-Type': mimeFor(userPath),
        'Content-Length': statSync(userPath).size.toString(),
        'Cache-Control': cacheControl(),
      },
    }))
  }

  // 2) Embedded core plugin (compiled binary wins here; dev mode lands on
  //    the same absolute on-disk path and works identically).
  const embeddedPath = EMBEDDED_ASSETS.get(url.pathname)
  if (embeddedPath) {
    const file = Bun.file(embeddedPath)
    if (await file.exists()) {
      const bytes = new Uint8Array(await file.arrayBuffer())
      return stampPluginResponse(pluginId, new Response(bytes, {
        status: 200,
        headers: {
          'Content-Type': mimeFor(relPath),
          'Content-Length': String(bytes.length),
          'Cache-Control': cacheControl(),
        },
      }))
    }
  }

  // 3) Dev fallback — repo core plugin that wasn't in the embed map yet
  //    (e.g. generator hasn't re-run since last dist rebuild).
  const repoPath = join(process.cwd(), 'plugins', pluginId, 'dist', relPath)
  if (existsSync(repoPath) && statSync(repoPath).isFile()) {
    const body = readFileSync(repoPath)
    return stampPluginResponse(pluginId, new Response(body, {
      status: 200,
      headers: {
        'Content-Type': mimeFor(repoPath),
        'Content-Length': statSync(repoPath).size.toString(),
        'Cache-Control': cacheControl(),
      },
    }))
  }

  return Response.json(
    { error: `Plugin asset not found: ${pluginId}/${relPath}` },
    { status: 404 },
  )
}
