/**
 * GET /api/assets/... — serve user assets.
 *
 * The versioned `assetId` scheme
 *   /api/assets/<assetId>[/v/<n>|/thumb|/export/<name>]
 * is resolved by the `assets.resolveServe` hook to a file on disk.
 *
 * Supports HTTP range reads for video and ETag/If-None-Match (keyed on
 * assetId:version so a promote/edit busts the browser cache).
 */
import { readFileSync, existsSync, statSync, openSync, readSync, closeSync } from 'fs'
import { getHookRegistry } from '@/lib/plugin-registry'

type AssetServeResult =
  | { match: false }
  | { match: true; found: false }
  | { match: true; found: true; absPath: string; mimeType: string; cacheKey: string }

interface Resolved { absPath: string; mimeType: string; cacheKey: string }

export async function get(req: Request, url: URL): Promise<Response> {
  const prefix = '/api/assets/'
  const tail = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : ''
  const path = tail.split('/').filter(Boolean).map((seg) => decodeURIComponent(seg))

  // Security: prevent path traversal in any segment.
  if (path.some((seg) => seg.includes('..'))) {
    return Response.json({ error: 'Invalid path' }, { status: 400 })
  }

  // Guard on object shape — a non-object result (e.g. a string from a hook
  // that doesn't implement this) is treated as no match.
  const served = await getHookRegistry().invoke<AssetServeResult>('assets.resolveServe', { segments: path })
  if (!served || typeof served !== 'object' || !served.match || !served.found) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }
  const resolved: Resolved = { absPath: served.absPath, mimeType: served.mimeType, cacheKey: served.cacheKey }

  if (!existsSync(resolved.absPath)) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const etag = `"${resolved.cacheKey}"`
  if (req.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } })
  }

  const stat = statSync(resolved.absPath)
  const fileSize = stat.size
  const { mimeType } = resolved

  // Range requests for video seeking.
  const range = req.headers.get('range')
  if (range && mimeType.startsWith('video/')) {
    const parts = range.replace(/bytes=/, '').split('-')
    const start = parseInt(parts[0], 10)
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1
    const chunkSize = end - start + 1

    const buffer = Buffer.alloc(chunkSize)
    const fd = openSync(resolved.absPath, 'r')
    readSync(fd, buffer, 0, chunkSize, start)
    closeSync(fd)

    return new Response(new Uint8Array(buffer), {
      status: 206,
      headers: {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize.toString(),
        'Content-Type': mimeType,
        ETag: etag,
      },
    })
  }

  const file = readFileSync(resolved.absPath)
  return new Response(new Uint8Array(file), {
    headers: {
      'Content-Type': mimeType,
      'Content-Length': fileSize.toString(),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600',
      ETag: etag,
    },
  })
}
