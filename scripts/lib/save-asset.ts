/**
 * beacon_exec_save_asset — Standardized asset management.
 *
 * Encodes all asset conventions from SKILL.md:
 * - Directory structure: assets/{type}/{taskId}/
 * - Filename: YYYYMMDD-{slug}.{ext}
 * - Sidecar metadata: {filename}.meta.json
 */
import { mkdirSync, copyFileSync, writeFileSync, existsSync } from 'fs'
import { join, extname, basename } from 'path'
import { z } from 'zod'
import { getBeaconPaths } from '../../src/core/content-dir'
import { succeed, fail, slugify, datePrefixedFilename, getExtension } from './common'
import { addExecTool } from './registry'
import type { ExecToolResult } from '../../src/lib/plugin-types'

const ASSET_TYPES = ['text', 'images', 'video', 'audio', 'plans', 'data', 'other'] as const
type AssetType = typeof ASSET_TYPES[number]

export interface SaveAssetParams {
  filePath: string
  taskId: string
  type: AssetType
  agent: string
  description?: string
  tags?: string[]
  tool?: string
  slug?: string
}

export async function saveAsset(params: SaveAssetParams): Promise<ExecToolResult> {
  const { filePath, taskId, type, agent, description, tags, tool, slug } = params

  if (!existsSync(filePath)) {
    return fail(`Source file not found: ${filePath}`)
  }

  const paths = getBeaconPaths()
  const typeKey = `assets.${type}` as keyof typeof paths
  const assetDir = paths[typeKey]
  if (!assetDir || typeof assetDir !== 'string') {
    return fail(`Unknown asset type: ${type}`)
  }

  // Create task directory
  const taskDir = join(assetDir, taskId)
  mkdirSync(taskDir, { recursive: true })

  // Generate filename
  const ext = extname(filePath).slice(1) || getExtension(filePath)
  const fileSlug = slug || slugify(basename(filePath, `.${ext}`))
  const filename = datePrefixedFilename(fileSlug, ext)
  const destPath = join(taskDir, filename)

  // Copy source file
  copyFileSync(filePath, destPath)

  // Create sidecar metadata (EXACT SKILL.md fields, no extras)
  const sidecar = {
    agent,
    taskId,
    created: new Date().toISOString(),
    ...(tool ? { tool } : {}),
    ...(description ? { description } : {}),
    ...(tags && tags.length > 0 ? { tags } : {}),
  }

  const metadataPath = join(taskDir, `${filename}.meta.json`)
  writeFileSync(metadataPath, JSON.stringify(sidecar, null, 2))

  // Return paths relative to beacon home
  const beaconHome = assetDir.split('/assets/')[0]
  const relativePath = destPath.replace(beaconHome + '/', '')
  const relativeMetadataPath = metadataPath.replace(beaconHome + '/', '')

  return succeed({
    path: relativePath,
    metadataPath: relativeMetadataPath,
    filename,
  })
}

// ---------------------------------------------------------------------------
// MCP tool registration
// ---------------------------------------------------------------------------

addExecTool({
  name: 'beacon_exec_save_asset',
  description: 'Save an agent-created file to the assets directory with standardized naming (YYYYMMDD-slug.ext) and sidecar metadata. Handles directory creation, naming conventions, and .meta.json automatically.',
  source: 'core',
  parameters: {
    filePath: z.string().describe('Absolute path to the source file to save'),
    taskId: z.string().describe('Task ID — used for directory organization'),
    type: z.enum(ASSET_TYPES).describe('Asset type: text, images, video, audio, plans, data, or other'),
    description: z.string().optional().describe('Human-readable description of the asset'),
    tags: z.array(z.string()).optional().describe('Tags for filtering and search'),
    tool: z.string().optional().describe('Tool used to generate (e.g., "dall-e-3", "nano-banana-pro")'),
    slug: z.string().optional().describe('Custom filename slug. Auto-derived from source filename if omitted.'),
  },
  handler: async (params, agent) => {
    return saveAsset({ ...params, agent } as SaveAssetParams)
  },
})
