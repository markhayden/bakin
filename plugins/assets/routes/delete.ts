/**
 * DELETE /api/plugins/assets/?filename=... — soft-delete an asset.
 * Moves asset + sidecar + any variants to .trash/ directory.
 */
import { join, dirname } from 'path'
import { existsSync, readdirSync } from 'fs'
import { getContentDir } from '../../../src/core/content-dir'
import { softDelete } from '../lib/trash'
import { removeAsset, detectVariant } from '../lib/asset-index'
import { isSafeCanonicalFilename, pathForFilename } from '../lib/path-for-filename'

export async function handleDelete(req: Request): Promise<Response> {
  const url = new URL(req.url, 'http://localhost')
  const filenameParam = url.searchParams.get('filename')

  if (!filenameParam) {
    return Response.json({ error: 'filename parameter required' }, { status: 400 })
  }

  if (!isSafeCanonicalFilename(filenameParam)) {
    return Response.json({ error: 'Invalid filename' }, { status: 400 })
  }

  const assetPath = pathForFilename(filenameParam)
  if (!assetPath) return Response.json({ error: 'Invalid filename' }, { status: 400 })

  const contentDir = getContentDir()
  const fullPath = join(contentDir, assetPath)
  const assetsRoot = join(contentDir, 'assets')

  if (!existsSync(fullPath)) {
    return Response.json({ error: 'Asset not found' }, { status: 404 })
  }

  const success = softDelete(fullPath, assetsRoot)
  if (!success) {
    return Response.json({ error: 'Failed to delete asset' }, { status: 500 })
  }

  removeAsset(assetPath)
  const trashed = [assetPath]

  // Cascade-delete variants (e.g., *.thumb.jpg for an image)
  const dir = dirname(fullPath)
  const filename = assetPath.split('/').pop() || ''
  const dotIdx = filename.lastIndexOf('.')
  const stem = dotIdx > 0 ? filename.substring(0, dotIdx) : filename

  try {
    const siblings = readdirSync(dir)
    for (const sibling of siblings) {
      if (sibling === filename) continue
      const v = detectVariant(sibling)
      if (v && v.baseStem === stem) {
        const variantFullPath = join(dir, sibling)
        const variantRelPath = assetPath.replace(filename, sibling)
        if (softDelete(variantFullPath, assetsRoot)) {
          removeAsset(variantRelPath)
          trashed.push(variantRelPath)
        }
      }
    }
  } catch { /* directory may not exist after primary delete */ }

  return Response.json({ ok: true, filename: filenameParam, trashed })
}
