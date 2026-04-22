import { NextResponse, type NextRequest } from 'next/server'
import { readFileSync, existsSync, statSync } from 'fs'
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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params

  // Security: prevent path traversal
  if (path.some(seg => seg.includes('..'))) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
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
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
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
    const fd = require('fs').openSync(fullPath, 'r')
    require('fs').readSync(fd, buffer, 0, chunkSize, start)
    require('fs').closeSync(fd)

    return new Response(buffer, {
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
  return new Response(file, {
    headers: {
      'Content-Type': mimeType,
      'Content-Length': fileSize.toString(),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
