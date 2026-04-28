/**
 * GET /api/plugins/assets/file — serve an asset file for rendering.
 * Accepts `?name={filename}` resolved via the filename resolver.
 */
import { existsSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { getContentDir } from '../../../src/core/content-dir'
import { getMimeType } from '../lib/constants'
import { isSafeCanonicalFilename, pathForFilename } from '../lib/path-for-filename'

export async function handleFile(req: Request): Promise<Response> {
  const url = new URL(req.url, 'http://localhost')
  const nameParam = url.searchParams.get('name')

  let assetPath: string | null
  if (nameParam) {
    if (!isSafeCanonicalFilename(nameParam)) {
      return Response.json({ error: 'Invalid filename' }, { status: 400 })
    }
    const derived = pathForFilename(nameParam)
    assetPath = derived && existsSync(join(getContentDir(), derived)) ? derived : null
    if (!assetPath) {
      return Response.json({ error: 'Filename not found' }, { status: 404 })
    }
  } else {
    return Response.json({ error: 'name parameter required' }, { status: 400 })
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
