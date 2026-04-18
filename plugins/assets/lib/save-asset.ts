/**
 * Asset save utility — shared by plugin exec tools and other script tools.
 *
 * Under filename-as-identity, every asset lives at
 * `assets/store/{YYYY-MM}/{filename}` where the YYYY-MM shard is derived
 * from the `YYYYMMDD-` prefix of the canonical filename. Type and taskId
 * live in the sidecar — directory layout carries no semantic information.
 */
import { mkdirSync, copyFileSync, writeFileSync, existsSync } from 'fs'
import { join, extname, basename } from 'path'
import { execSync } from 'child_process'
import { getContentDir } from '../../../src/core/content-dir'
import type { AssetSource } from './sidecar'
import type { AssetType } from './constants'
import { generateConventionalFilename, slugify as filenameSlugify } from './filename-id'
import { filenameExists } from './resolver'
import { relPathForFilename, yearMonthFromFilename } from './path-for-filename'

export interface SaveAssetParams {
  filePath: string
  taskId: string | null
  type: AssetType
  agent: string
  description?: string
  tags?: string[]
  tool?: string
  slug?: string
  source?: AssetSource
  originalFilename?: string
}

export interface SaveAssetResult {
  ok: boolean
  path?: string
  metadataPath?: string
  filename?: string
  error?: string
  [key: string]: unknown
}

function getExtension(filePath: string): string {
  const dot = filePath.lastIndexOf('.')
  if (dot === -1 || dot === filePath.length - 1) return ''
  return filePath.slice(dot + 1).toLowerCase()
}

function generateUniqueFilename(slug: string, ext: string): string {
  for (let i = 0; i < 8; i++) {
    const candidate = generateConventionalFilename(slug, ext)
    if (!filenameExists(candidate)) return candidate
  }
  throw new Error('Failed to generate unique filename after 8 retries')
}

function generateThumbnail(inputPath: string, outputPath: string, widthPx = 400): string | null {
  try {
    execSync(`ffmpeg -i "${inputPath}" -vf "scale=${widthPx}:-1" -q:v 5 -y "${outputPath}"`, { stdio: 'pipe', timeout: 30_000 })
    return outputPath
  } catch { return null }
}

export async function saveAsset(params: SaveAssetParams): Promise<SaveAssetResult> {
  const { filePath, taskId, type, agent, description, tags, tool, slug, source, originalFilename } = params

  if (!existsSync(filePath)) {
    return { ok: false, error: `Source file not found: ${filePath}` }
  }

  const ext = extname(filePath).slice(1) || getExtension(filePath)
  const fileSlug = slug || filenameSlugify(basename(filePath, `.${ext}`))
  const filename = generateUniqueFilename(fileSlug, ext)

  const relPath = relPathForFilename(filename)
  const yearMonth = yearMonthFromFilename(filename)
  if (!relPath || !yearMonth) {
    // generateConventionalFilename always produces a canonical name, so this
    // should be unreachable — but the type system can't prove it.
    return { ok: false, error: `Generated filename is not canonical: ${filename}` }
  }

  const contentDir = getContentDir()
  const storeDir = join(contentDir, 'assets', 'store', yearMonth)
  mkdirSync(storeDir, { recursive: true })

  const destPath = join(storeDir, filename)
  copyFileSync(filePath, destPath)

  const normalizedTaskId = taskId ?? null
  const sidecar = {
    agent,
    taskId: normalizedTaskId,
    created: new Date().toISOString(),
    type,
    ...(tool ? { tool } : {}),
    ...(description ? { description } : {}),
    ...(tags && tags.length > 0 ? { tags } : {}),
    ...(source ? { source } : {}),
    ...(originalFilename ? { originalFilename } : {}),
  }
  const metadataPath = `${destPath}.meta.json`
  writeFileSync(metadataPath, JSON.stringify(sidecar, null, 2))

  if (type === 'images') {
    try {
      const dotIdx = filename.lastIndexOf('.')
      const stem = dotIdx > 0 ? filename.substring(0, dotIdx) : filename
      const thumbPath = join(storeDir, `${stem}.thumb.jpg`)
      generateThumbnail(destPath, thumbPath)
    } catch { /* thumbnail generation is non-critical */ }
  }

  const relativePath = `assets/${relPath}`
  const relativeMetadataPath = `${relativePath}.meta.json`

  return { ok: true, path: relativePath, metadataPath: relativeMetadataPath, filename }
}
