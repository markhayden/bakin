/**
 * Sidecar metadata (.meta.json) management for assets.
 */
import { readFileSync, writeFileSync, existsSync, statSync } from 'fs'
import { createLogger } from '../../../src/core/logger'
import { ASSET_TYPES, type AssetType } from './constants'

const log = createLogger('assets:sidecar')

export type AssetSource = 'agent' | 'upload' | 'clipboard'

export interface SidecarMeta {
  agent: string
  taskId: string | null
  created: string
  /**
   * Asset type. Lives in the sidecar under filename-as-identity so retype
   * is a metadata edit rather than a file move. Legacy sidecars written
   * before the field existed are auto-populated from the directory layout
   * on read (see `readSidecar`); migration (C6) writes it persistently.
   */
  type?: AssetType
  tool?: string
  description?: string
  tags?: string[]
  originalFilename?: string
  source?: AssetSource
}

const REQUIRED_FIELDS = ['agent', 'taskId', 'created'] as const

/** Common field name mistakes agents make — maps wrong name to correct name. */
export const FIELD_ALIASES: Record<string, string> = {
  author: 'agent',
  createdAt: 'created',
  created_at: 'created',
  timestamp: 'created',
  task: 'taskId',
  task_id: 'taskId',
  name: 'agent',
}

/** All valid fields in a sidecar .meta.json file. */
export const KNOWN_FIELDS = new Set([
  'agent', 'taskId', 'created', 'type', 'tool', 'description', 'tags', 'originalFilename', 'source',
])

/**
 * Derive the asset type from a legacy path (`assets/{type}/{taskId}/...`).
 * Returns undefined when the path isn't in that shape or the second segment
 * isn't a known asset type. Used only as a read-side fallback for sidecars
 * written before the `type` field was added.
 */
export function typeFromAssetPath(assetPath: string): AssetType | undefined {
  const parts = assetPath.split('/')
  const assetsIdx = parts.indexOf('assets')
  if (assetsIdx < 0 || parts.length <= assetsIdx + 1) return undefined
  const maybe = parts[assetsIdx + 1]
  return (ASSET_TYPES as readonly string[]).includes(maybe) ? (maybe as AssetType) : undefined
}

export function getSidecarPath(assetPath: string): string {
  return assetPath + '.meta.json'
}

export function readSidecar(assetPath: string): SidecarMeta | null {
  const metaPath = getSidecarPath(assetPath)
  if (!existsSync(metaPath)) return null

  try {
    const raw = readFileSync(metaPath, 'utf-8')
    const meta = JSON.parse(raw)
    const normalized = validateAndNormalize(meta)
    if (!normalized.type) {
      const derived = typeFromAssetPath(assetPath)
      if (derived) normalized.type = derived
    }
    return normalized
  } catch (err) {
    log.warn('Failed to read sidecar', err, { path: metaPath })
    return null
  }
}

export function writeSidecar(assetPath: string, meta: SidecarMeta): void {
  const metaPath = getSidecarPath(assetPath)
  writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8')
}

/**
 * Create a stub sidecar for an asset that's missing one.
 * Infers taskId from directory structure and created from file mtime.
 */
export function createStub(assetPath: string): SidecarMeta {
  const parts = assetPath.split('/')
  const filename = parts[parts.length - 1]

  // Infer taskId from path: assets/{type}/{taskId}/{filename}
  let taskId: string | null = null
  const assetsIdx = parts.indexOf('assets')
  if (assetsIdx >= 0 && parts.length > assetsIdx + 3) {
    const possibleTaskId = parts[assetsIdx + 2]
    if (possibleTaskId !== '_unlinked' && possibleTaskId !== 'library') {
      taskId = possibleTaskId
    }
  }

  let created = new Date().toISOString()
  try {
    const stat = statSync(assetPath)
    created = stat.mtime.toISOString()
  } catch { /* use current time */ }

  const stub: SidecarMeta = {
    agent: 'unknown',
    taskId,
    created,
    type: typeFromAssetPath(assetPath),
    description: `Auto-generated sidecar for ${filename}`,
    tags: [],
  }

  writeSidecar(assetPath, stub)
  log.info('Created stub sidecar', { path: assetPath, taskId })
  return stub
}

function validateAndNormalize(meta: Record<string, unknown>): SidecarMeta {
  // Auto-correct common field name mistakes (in-memory only, does not rewrite file)
  for (const [alias, canonical] of Object.entries(FIELD_ALIASES)) {
    if (meta[alias] !== undefined && meta[canonical] === undefined) {
      log.warn(`Sidecar uses "${alias}" instead of "${canonical}" — auto-correcting`)
      meta[canonical] = meta[alias]
    }
  }

  const type = typeof meta.type === 'string' && (ASSET_TYPES as readonly string[]).includes(meta.type)
    ? (meta.type as AssetType)
    : undefined

  return {
    agent: typeof meta.agent === 'string' ? meta.agent : 'unknown',
    taskId: typeof meta.taskId === 'string' ? meta.taskId : null,
    created: typeof meta.created === 'string' ? meta.created : new Date().toISOString(),
    type,
    tool: typeof meta.tool === 'string' ? meta.tool : undefined,
    description: typeof meta.description === 'string' ? meta.description : undefined,
    tags: Array.isArray(meta.tags) ? meta.tags.filter((t): t is string => typeof t === 'string') : undefined,
    originalFilename: typeof meta.originalFilename === 'string' ? meta.originalFilename : undefined,
    source: typeof meta.source === 'string' && ['agent', 'upload', 'clipboard'].includes(meta.source) ? meta.source as AssetSource : undefined,
  }
}

/**
 * Validate a sidecar file for doctor checks.
 * Returns list of issues found.
 */
export function validateSidecar(metaPath: string): string[] {
  const issues: string[] = []

  if (!existsSync(metaPath)) {
    issues.push('File does not exist')
    return issues
  }

  try {
    const raw = readFileSync(metaPath, 'utf-8')
    const meta = JSON.parse(raw)

    for (const field of REQUIRED_FIELDS) {
      if (meta[field] === undefined) {
        issues.push(`Missing required field: ${field}`)
      }
    }

    // Detect common field name mistakes
    for (const key of Object.keys(meta)) {
      if (key in FIELD_ALIASES) {
        issues.push(`Wrong field name: "${key}" — use "${FIELD_ALIASES[key]}" instead`)
      }
    }

    // Detect unknown/extra fields
    const extraFields = Object.keys(meta).filter(k => !KNOWN_FIELDS.has(k) && !(k in FIELD_ALIASES))
    if (extraFields.length > 0) {
      issues.push(`Unknown fields: ${extraFields.join(', ')} — only use standard sidecar fields`)
    }
  } catch {
    issues.push('Invalid JSON')
  }

  return issues
}
