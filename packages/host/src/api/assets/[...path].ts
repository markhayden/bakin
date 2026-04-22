/**
 * GET /api/assets/{...path} — serve user assets by filename (single
 * segment, filename-as-identity resolved via the assets plugin) or by
 * legacy multi-segment path. Supports HTTP range reads for video seeking.
 *
 * Migrated from src/app/api/assets/[...path]/route.ts for Phase B of
 * #147. `path[]` is derived from url.pathname (segments after /api/assets/).
 */
import { readFileSync, existsSync, statSync, openSync, readSync, closeSync } from 'fs'
import { join, extname } from 'path'
import { getContentDir } from '@/core/content-dir'
import { getHookRegistry } from '@/lib/plugin-registry'

const CONTENT_DIR = getContentDir()

const MIME_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

export async function get(req: Request, url: URL): Promise<Response> {
  // /api/assets/{...path} — parse the catch-all segments from the url.
  // Strip the leading "/api/assets/" prefix; everything after is the catch-all.
  const prefix = '/api/assets/'
  const tail = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : ''
  // Decode each segment to mirror Next.js's decoded params array.
  const path = tail.split('/').filter(Boolean).map((seg) => decodeURIComponent(seg))

  // Security: prevent path traversal
  if (path.some((seg) => seg.includes('..'))) {
    return Response.json({ error: 'Invalid path' }, { status: 400 })
  }

  // Filename-as-identity: single-segment paths derive their location from
  // the canonical filename. Multi-segment paths remain supported for
  // legacy URL forms embedded in historical task descriptions.
  let relPath: string
  if (path.length === 1 && !path[0].includes('/')) {
    const derived = await getHookRegistry().invoke<string | null>('assets.pathForFilename', { filename: path[0] })
    relPath = derived ?? join('assets', ...path)
  } else {
    relPath = path.join('/')
  }

  const fullPath = join(CONTENT_DIR, relPath)

  if (!existsSync(fullPath)) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const ext = extname(fullPath).toLowerCase()
  const mimeType = MIME_TYPES[ext] || 'application/octet-stream'
  const stat = statSync(fullPath)
  const fileSize = stat.size

  // Support range requests for video seeking
  const range = req.headers.get('range')
  if (range && mimeType.startsWith('video/')) {
    const parts = range.replace(/bytes=/, '').split('-')
    const start = parseInt(parts[0], 10)
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1
    const chunkSize = end - start + 1

    const buffer = Buffer.alloc(chunkSize)
    const fd = openSync(fullPath, 'r')
    readSync(fd, buffer, 0, chunkSize, start)
    closeSync(fd)

    return new Response(new Uint8Array(buffer), {
      status: 206,
      headers: {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize.toString(),
        'Content-Type': mimeType,
      },
    })
  }

  const file = readFileSync(fullPath)
  return new Response(new Uint8Array(file), {
    headers: {
      'Content-Type': mimeType,
      'Content-Length': fileSize.toString(),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
