/**
 * GET /api/plugins/assets/file — serve an asset file for rendering.
 * Accepts either `?name={filename}` (resolved via the filename resolver)
 * or `?path={relativePath}` (legacy, retained until commit F).
 */
import { existsSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { getContentDir } from '../../../src/core/content-dir'
import { getMimeType } from '../lib/constants'
import { resolveFilename } from '../lib/resolver'
import { pathForFilename } from '../lib/path-for-filename'

export async function handleFile(req: Request): Promise<Response> {
  const url = new URL(req.url, 'http://localhost')
  const nameParam = url.searchParams.get('name')
  const pathParam = url.searchParams.get('path')

  let assetPath: string | null = null
  if (nameParam) {
    if (nameParam.includes('/') || nameParam.includes('..')) {
      return Response.json({ error: 'Invalid filename' }, { status: 400 })
    }
    // Canonical filenames resolve to store/ via the pure path function; the
    // resolver covers legacy fixtures and any pre-migration residue.
    const derived = pathForFilename(nameParam)
    assetPath = derived && existsSync(join(getContentDir(), derived))
      ? derived
      : resolveFilename(nameParam)
    if (!assetPath) {
      return Response.json({ error: 'Filename not found' }, { status: 404 })
    }
  } else if (pathParam) {
    if (pathParam.includes('..') || !pathParam.startsWith('assets/')) {
      return Response.json({ error: 'Invalid path' }, { status: 400 })
    }
    assetPath = pathParam
  } else {
    return Response.json({ error: 'name or path parameter required' }, { status: 400 })
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
        'Cache-Control': 'no-cache',
        'ETag': `"${stat.mtimeMs.toString(36)}-${stat.size.toString(36)}"`,
      },
    })
  } catch (err) {
    return Response.json({ error: `Failed to read file: ${err}` }, { status: 500 })
  }
}
