/**
 * GET /api/plugins/assets/file?path=... — serve an asset file for rendering.
 * Streams the file with correct Content-Type headers.
 */
import { existsSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { getContentDir } from '../../../src/core/content-dir'
import { getMimeType } from '../lib/constants'

export async function handleFile(req: Request): Promise<Response> {
  const url = new URL(req.url, 'http://localhost')
  const assetPath = url.searchParams.get('path')

  if (!assetPath) {
    return Response.json({ error: 'path parameter required' }, { status: 400 })
  }

  // Prevent path traversal
  if (assetPath.includes('..') || !assetPath.startsWith('assets/')) {
    return Response.json({ error: 'Invalid path' }, { status: 400 })
  }

  const fullPath = join(getContentDir(), assetPath)

  if (!existsSync(fullPath)) {
    return Response.json({ error: 'File not found' }, { status: 404 })
  }

  try {
    const stat = statSync(fullPath)
    const mimeType = getMimeType(assetPath)
    const data = readFileSync(fullPath)

    return new Response(data, {
      headers: {
        'Content-Type': mimeType,
        'Content-Length': String(stat.size),
        'Cache-Control': 'public, max-age=3600',
      },
    })
  } catch (err) {
    return Response.json({ error: `Failed to read file: ${err}` }, { status: 500 })
  }
}
