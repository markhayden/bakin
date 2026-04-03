/**
 * DELETE /api/plugins/assets/:assetPath — soft-delete an asset.
 * Moves asset + sidecar + any variants to .trash/ directory.
 */
import { join, dirname } from 'path'
import { existsSync, readdirSync } from 'fs'
import { getContentDir } from '../../../src/core/content-dir'
import { softDelete } from '../lib/trash'
import { removeAsset, detectVariant } from '../lib/asset-index'

export async function handleDelete(req: Request): Promise<Response> {
  const url = new URL(req.url, 'http://localhost')
  const assetPath = url.searchParams.get('assetPath') || url.searchParams.get('path')

  if (!assetPath) {
    return Response.json({ error: 'path parameter required' }, { status: 400 })
  }

  // Prevent path traversal
  if (assetPath.includes('..') || !assetPath.startsWith('assets/')) {
    return Response.json({ error: 'Invalid path' }, { status: 400 })
  }

  const contentDir = getContentDir()
  const fullPath = join(contentDir, assetPath)
  const assetsRoot = join(contentDir, 'assets')

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

  return Response.json({ ok: true, trashed })
}
