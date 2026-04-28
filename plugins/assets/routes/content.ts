import { existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getContentDir } from '../../../src/core/content-dir'
import { getMimeType, isEditableMimeType } from '../lib/constants'
import { isSafeCanonicalFilename, pathForFilename } from '../lib/path-for-filename'
import { createLogger } from '../../../src/core/logger'

const log = createLogger('assets:content')

export async function handleContent(req: Request): Promise<Response> {
  let body: { filename?: string; content?: string }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.filename || typeof body.filename !== 'string') {
    return Response.json({ error: 'Missing required field: filename' }, { status: 400 })
  }
  if (typeof body.content !== 'string') {
    return Response.json({ error: 'Missing required field: content' }, { status: 400 })
  }

  const filename = body.filename
  if (!isSafeCanonicalFilename(filename)) {
    return Response.json({ error: 'Invalid filename' }, { status: 400 })
  }

  const assetPath = pathForFilename(filename)
  if (!assetPath) return Response.json({ error: 'Invalid filename' }, { status: 400 })

  const contentDir = getContentDir()
  const fullPath = join(contentDir, assetPath)
  if (!existsSync(fullPath)) {
    return Response.json({ error: 'Asset not found' }, { status: 404 })
  }

  const mime = getMimeType(filename)
  if (!isEditableMimeType(mime)) {
    return Response.json({ error: `File type ${mime} is not editable` }, { status: 400 })
  }

  try {
    writeFileSync(fullPath, body.content, 'utf-8')
    const size = Buffer.byteLength(body.content, 'utf-8')
    log.info('Asset content updated', { filename, path: assetPath, size })
    return Response.json({ ok: true, size, filename, path: assetPath })
  } catch (err) {
    log.error('Failed to write asset content', err, { filename, path: assetPath })
    return Response.json({ error: 'Failed to write content' }, { status: 500 })
  }
}
