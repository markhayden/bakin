/**
 * Asset save utility — shared by plugin exec tools and other script tools.
 * Encodes all asset conventions: directory structure, naming, sidecar metadata.
 */
import { mkdirSync, copyFileSync, writeFileSync, existsSync } from 'fs'
import { join, extname, basename } from 'path'
import { execSync } from 'child_process'
import { randomBytes } from 'crypto'
import { getBakinPaths } from '../../../src/core/content-dir'
import type { AssetSource } from './sidecar'
import type { AssetType } from './constants'

export interface SaveAssetParams {
  filePath: string
  taskId: string
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

function slugify(text: string, maxLength = 60): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLength)
    .replace(/-$/, '')
}

function datePrefixedFilename(slug: string, ext: string): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const cleanExt = ext.startsWith('.') ? ext.slice(1) : ext
  return `${date}-${slug}.${cleanExt}`
}

function getExtension(filePath: string): string {
  const dot = filePath.lastIndexOf('.')
  if (dot === -1 || dot === filePath.length - 1) return ''
  return filePath.slice(dot + 1).toLowerCase()
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

  const paths = getBakinPaths()
  const typeKey = `assets.${type}` as keyof typeof paths
  const assetDir = paths[typeKey]
  if (!assetDir || typeof assetDir !== 'string') {
    return { ok: false, error: `Unknown asset type: ${type}` }
  }

  const taskDir = join(assetDir, taskId)
  mkdirSync(taskDir, { recursive: true })

  const ext = extname(filePath).slice(1) || getExtension(filePath)
  const fileSlug = slug || slugify(basename(filePath, `.${ext}`))
  let filename = datePrefixedFilename(fileSlug, ext)
  let destPath = join(taskDir, filename)

  // Handle duplicate filenames by appending a short random suffix
  if (existsSync(destPath)) {
    const suffix = randomBytes(2).toString('hex')
    const dotIdx = filename.lastIndexOf('.')
    const stem = dotIdx > 0 ? filename.substring(0, dotIdx) : filename
    const extPart = dotIdx > 0 ? filename.substring(dotIdx) : ''
    filename = `${stem}-${suffix}${extPart}`
    destPath = join(taskDir, filename)
  }

  copyFileSync(filePath, destPath)

  const sidecar = {
    agent, taskId, created: new Date().toISOString(),
    ...(tool ? { tool } : {}),
    ...(description ? { description } : {}),
    ...(tags && tags.length > 0 ? { tags } : {}),
    ...(source ? { source } : {}),
    ...(originalFilename ? { originalFilename } : {}),
  }
  const metadataPath = join(taskDir, `${filename}.meta.json`)
  writeFileSync(metadataPath, JSON.stringify(sidecar, null, 2))

  if (type === 'images') {
    try {
      const dotIdx = filename.lastIndexOf('.')
      const stem = dotIdx > 0 ? filename.substring(0, dotIdx) : filename
      const thumbPath = join(taskDir, `${stem}.thumb.jpg`)
      generateThumbnail(destPath, thumbPath)
    } catch { /* thumbnail generation is non-critical */ }
  }

  const bakinHome = assetDir.split('/assets/')[0]
  const relativePath = destPath.replace(bakinHome + '/', '')
  const relativeMetadataPath = metadataPath.replace(bakinHome + '/', '')

  return { ok: true, path: relativePath, metadataPath: relativeMetadataPath, filename }
}
