/**
 * GET /api/plugins/:pluginId/assets/:path* — serves a plugin's client bundle.
 *
 * Resolution (shared with the manifest's versions — `asset-version.ts`):
 *   1. ~/.bakin/plugins/<id>/dist/<path>   (user-installed; always on disk)
 *   2. EMBEDDED_ASSETS map                 (core plugins embedded at build time)
 *   3. plugins/<id>/dist/<path>            (repo core plugins, dev fallback)
 *
 * User plugins always win over embedded/core assets so installed plugins can
 * override their own rebuilt bundles after startup.
 */
import { readFileSync } from 'fs'
import { extname } from 'path'
import { stampPluginResponse } from '@/core/plugin-host/version-stamp'
import { assetVersion, resolvePluginAsset } from './asset-version'

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
 * Only the asset's CURRENT version is cached immutably. An old tab asking for
 * `?v=<old>` after an upgrade gets today's bytes, which must never be pinned
 * under the old version's URL (a rollback would then load them against the
 * old SDK). Dev serves everything else no-store so rebuilt bundles show up.
 */
function cacheControl(url: URL, currentVersion: string | null): string {
  const v = url.searchParams.get('v')
  if (v !== null && currentVersion !== null && v === currentVersion) return 'public, max-age=31536000, immutable'
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

  // Server bundles are never browser assets (#421). Core plugins activate
  // via static imports, user plugins are imported from disk — nothing
  // legitimately fetches index.js over HTTP, and serving it would only
  // disclose server code. Guard sits before every resolution step.
  if (relPath === 'index.js' || relPath.endsWith('/index.js')) {
    return Response.json(
      { error: 'Plugin server bundles are not served as assets' },
      { status: 404 },
    )
  }

  const asset = await resolvePluginAsset(pluginId, relPath)
  if (asset) {
    const bytes = asset.kind === 'embedded'
      ? new Uint8Array(await Bun.file(asset.path).arrayBuffer())
      : new Uint8Array(readFileSync(asset.path))
    return stampPluginResponse(pluginId, new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': mimeFor(relPath),
        'Content-Length': String(bytes.length),
        'Cache-Control': cacheControl(url, await assetVersion(asset)),
      },
    }))
  }

  return Response.json(
    { error: `Plugin asset not found: ${pluginId}/${relPath}` },
    { status: 404 },
  )
}
