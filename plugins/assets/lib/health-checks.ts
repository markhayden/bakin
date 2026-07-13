/** Canonical Assets health observations and explicit repair action. */
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'fs'
import { join } from 'path'

import type {
  HealthCheckRunInput,
  HealthObservationInput,
  HealthRepairActionDefinition,
  HealthRepairChange,
} from '../../../packages/core/src/plugin-types'
import {
  healthHealthy,
  healthObserved,
  healthWarning,
} from '@makinbakin/sdk/utils'
import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'

import { isValidAssetId } from './asset-id'
import { scanUnmanaged } from './import-unmanaged'
import { getAsset, listAssets } from './asset-core'
import { reseedUnmanaged } from './unmanaged-tracker'
import { readManifest } from './manifest'
import { resolveEnrichmentEngine } from './enrichment/engine'
import type { EnrichmentSettings } from './enrichment/providers'

const REQUIRED_ASSET_DIRS = ['store', 'inbox', '.trash'] as const
const STORE_SHARD_RE = /^\d{4}-\d{2}$/
const TRASH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

function stablePart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'unknown'
}

function bounded(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

function assetWarning(input: {
  key: string
  summary: string
  impact: string
  resourceId?: string
  repair?: boolean
  disposition?: 'advisory' | 'watch' | 'action_required'
  evidence?: Record<string, string | number | boolean | null>
}): HealthObservationInput {
  const disposition = input.disposition ?? (input.repair ? 'action_required' : 'advisory')
  const summary = bounded(input.summary, 500)
  return healthWarning({
    key: input.key,
    summary,
    evidence: input.evidence,
    incident: {
      key: input.key,
      title: bounded(input.summary, 120),
      impact: input.impact,
      disposition,
      resources: input.resourceId
        ? [{ kind: 'asset', id: stablePart(input.resourceId), label: bounded(input.resourceId, 120) }]
        : [{ kind: 'directory', id: 'assets', label: 'Assets store' }],
      resolution: input.repair
        ? { key: 'repair-store', type: 'repair', label: 'Repair asset store', actionId: 'repair-store' }
        : { key: 'review-assets', type: 'navigate', label: 'Review Assets', href: '/assets' },
    },
  })
}

/** Store shape, manifest integrity, unmanaged files, and enrichment coverage. */
export function checkAssets(contentDir: string): HealthCheckRunInput {
  return healthObserved([
    ...checkAssetStore(contentDir),
    ...checkUnimported(),
    ...checkEnrichment(),
  ] as [HealthObservationInput, ...HealthObservationInput[]])
}

/** Unmanaged files require an explicit import decision and are never repaired automatically. */
export function checkUnimported(): HealthObservationInput[] {
  const files = scanUnmanaged()
  reseedUnmanaged(files.map(file => file.relPath))
  if (files.length === 0) {
    return [healthHealthy({ key: 'unimported', summary: 'No unmanaged files are awaiting import.' })]
  }
  return [assetWarning({
    key: 'unimported',
    summary: `${files.length} unmanaged file(s) are awaiting explicit import.`,
    impact: 'Files outside the managed asset store are unavailable to asset search and versioning.',
    disposition: 'advisory',
    evidence: { count: files.length },
  })]
}

export interface EnrichmentCoverage {
  total: number
  enriched: number
  missing: number
  stale: number
  failed: number
  skipped: number
}

export function enrichmentCoverage(): EnrichmentCoverage {
  const summaries = listAssets()
  const coverage: EnrichmentCoverage = { total: summaries.length, enriched: 0, missing: 0, stale: 0, failed: 0, skipped: 0 }
  for (const summary of summaries) {
    switch (summary.enrichment) {
      case 'done': coverage.enriched++; break
      case 'stale': coverage.stale++; break
      case 'failed': coverage.failed++; break
      case 'skipped': coverage.skipped++; break
      default: coverage.missing++
    }
  }
  return coverage
}

export function checkEnrichment(): HealthObservationInput[] {
  const summaries = listAssets()
  let missing = 0
  let stale = 0
  let failed = 0
  for (const summary of summaries) {
    const manifest = getAsset(summary.assetId)
    if (!manifest) continue
    const enrichment = manifest.enrichment
    if (!enrichment) { missing++; continue }
    if (enrichment.status === 'failed') { failed++; continue }
    if (enrichment.status === 'done' && (enrichment.forVersion ?? 0) < manifest.currentVersion) stale++
  }

  const observations: HealthObservationInput[] = []
  if (failed > 0) {
    observations.push(assetWarning({
      key: 'enrichment-failed',
      summary: `${failed} asset(s) failed vision enrichment.`,
      impact: 'Those assets may be harder to discover and reuse through semantic search.',
      disposition: 'advisory',
      evidence: { failed },
    }))
  }
  if (missing + stale > 0) {
    observations.push(assetWarning({
      key: 'enrichment-incomplete',
      summary: `${missing + stale} asset(s) lack current enrichment (${missing} missing, ${stale} stale).`,
      impact: 'Asset descriptions and semantic search metadata may be incomplete.',
      disposition: 'advisory',
      evidence: { missing, stale },
    }))
  }
  if (observations.length === 0) {
    observations.push(healthHealthy({
      key: 'enrichment',
      summary: 'All assets carry current enrichment or a recorded skip.',
      evidence: { total: summaries.length },
    }))
  }
  return observations
}

/** Which engine would serve an image-enrichment job right now. */
export async function checkEnrichmentEngine(
  settings: EnrichmentSettings,
  runtime: AgentRuntimeAdapter | null,
): Promise<HealthObservationInput> {
  if (settings.enrichmentEnabled === false) {
    return healthHealthy({ key: 'enrichment-engine', summary: 'Vision enrichment is disabled in settings.' })
  }
  const resolution = await resolveEnrichmentEngine(settings, { kind: 'image' }, { runtime })
  if (!resolution.ok) {
    return assetWarning({
      key: 'enrichment-engine',
      summary: `No enrichment engine is available: ${resolution.reason}`,
      impact: 'New assets will record enrichment skips until a compatible engine is configured.',
      disposition: 'advisory',
    })
  }
  const engine = resolution.engine
  return healthHealthy({
    key: 'enrichment-engine',
    summary: engine.name === 'runtime'
      ? `Runtime agent enrichment is ready with ${engine.modelId.slice('runtime:'.length)}.`
      : `Direct API enrichment is ready with ${engine.modelId}.`,
    evidence: { engine: engine.name, model: engine.modelId },
  })
}

function checkAssetStore(contentDir: string): HealthObservationInput[] {
  const observations: HealthObservationInput[] = []
  const assetsRoot = join(contentDir, 'assets')

  if (!existsSync(assetsRoot)) {
    return [assetWarning({
      key: 'store-missing',
      summary: 'The assets directory is missing.',
      impact: 'Assets cannot be imported, generated, or retrieved until the store exists.',
      repair: true,
    })]
  }

  for (const dirName of REQUIRED_ASSET_DIRS) {
    const dirPath = join(assetsRoot, dirName)
    if (!existsSync(dirPath)) {
      observations.push(assetWarning({
        key: `directory-missing-${stablePart(dirName)}`,
        summary: `The assets/${dirName} directory is missing.`,
        impact: 'The asset store cannot reliably complete all import, storage, and retention operations.',
        repair: true,
      }))
    } else {
      try {
        if (!statSync(dirPath).isDirectory()) {
          observations.push(assetWarning({
            key: `directory-invalid-${stablePart(dirName)}`,
            summary: `assets/${dirName} exists but is not a directory.`,
            impact: 'Operations that depend on this asset-store location will fail.',
            disposition: 'action_required',
          }))
        }
      } catch {
        observations.push(assetWarning({
          key: `directory-unreadable-${stablePart(dirName)}`,
          summary: `assets/${dirName} could not be inspected.`,
          impact: 'Bakin cannot verify that this asset-store location is usable.',
          disposition: 'watch',
        }))
      }
    }
  }

  const trashDir = join(assetsRoot, '.trash')
  const storeRoot = join(assetsRoot, 'store')

  try {
    const knownRootEntries = new Set<string>(REQUIRED_ASSET_DIRS)
    for (const entry of readdirSync(assetsRoot)) {
      if (knownRootEntries.has(entry)) continue
      try {
        if (statSync(join(assetsRoot, entry)).isDirectory()) {
          observations.push(assetWarning({
            key: `unexpected-root-${stablePart(entry)}`,
            summary: `Unexpected assets/${entry} directory is ignored by the asset store.`,
            impact: 'Files in this directory are not managed, indexed, or versioned as assets.',
          }))
        }
      } catch { /* another observation already provides the useful operator path */ }
    }
  } catch {
    observations.push(assetWarning({
      key: 'store-unreadable',
      summary: 'The assets directory could not be read.',
      impact: 'Bakin cannot verify or enumerate the managed asset store.',
      disposition: 'watch',
    }))
  }

  let versionedCount = 0
  let brokenCount = 0
  if (existsSync(storeRoot)) {
    let shards: string[]
    try {
      shards = readdirSync(storeRoot).filter(dir => {
        if (dir.startsWith('.')) return false
        try { return statSync(join(storeRoot, dir)).isDirectory() } catch { return false }
      })
    } catch { shards = [] }

    for (const shard of shards) {
      const shardDir = join(storeRoot, shard)
      if (!STORE_SHARD_RE.test(shard)) {
        observations.push(assetWarning({
          key: `invalid-shard-${stablePart(shard)}`,
          summary: `assets/store/${shard} is not a canonical YYYY-MM shard.`,
          impact: 'Assets in this shard may not be discoverable through normal store traversal.',
        }))
        continue
      }
      let entries: string[]
      try { entries = readdirSync(shardDir) } catch { continue }
      for (const entry of entries) {
        if (!isValidAssetId(entry)) {
          observations.push(assetWarning({
            key: `invalid-entry-${stablePart(shard)}-${stablePart(entry)}`,
            summary: `Unexpected store entry ${shard}/${entry}; entries must be asset directories.`,
            impact: 'This entry is ignored by asset lookup and integrity tooling.',
          }))
          continue
        }
        versionedCount++
        const dirAbs = join(shardDir, entry)
        const manifest = readManifest(dirAbs)
        if (!manifest) {
          observations.push(assetWarning({
            key: `manifest-missing-${stablePart(entry)}`,
            summary: `Asset ${entry} has a missing or invalid manifest.json.`,
            impact: 'The asset cannot be read or versioned reliably.',
            resourceId: entry,
            disposition: 'action_required',
          }))
          brokenCount++
          continue
        }
        if (!manifest.versions.some(version => version.version === manifest.currentVersion)) {
          observations.push(assetWarning({
            key: `current-version-${stablePart(entry)}`,
            summary: `Asset ${entry} currentVersion ${manifest.currentVersion} is absent from versions[].`,
            impact: 'The asset points at a version that cannot be resolved.',
            resourceId: entry,
            disposition: 'action_required',
          }))
          brokenCount++
        }
        for (const version of manifest.versions) {
          if (!existsSync(join(dirAbs, version.file))) {
            observations.push(assetWarning({
              key: `version-file-${stablePart(entry)}-${version.version}`,
              summary: `Asset ${entry} is missing version file ${version.file}.`,
              impact: 'That asset version cannot be opened or exported.',
              resourceId: entry,
              disposition: 'action_required',
            }))
            brokenCount++
          }
          if (version.thumb && !existsSync(join(dirAbs, version.thumb))) {
            observations.push(assetWarning({
              key: `thumbnail-${stablePart(entry)}-${version.version}`,
              summary: `Asset ${entry} is missing thumbnail ${version.thumb}.`,
              impact: 'Previews for that asset version may fail to render.',
              resourceId: entry,
            }))
            brokenCount++
          }
        }
      }
    }
  }

  try {
    let totalSize = 0
    function walkSize(dir: string): void {
      try {
        for (const entry of readdirSync(dir)) {
          const fullPath = join(dir, entry)
          try {
            const stat = statSync(fullPath)
            if (stat.isFile()) totalSize += stat.size
            else if (stat.isDirectory() && !entry.startsWith('.')) walkSize(fullPath)
          } catch { /* ignore entries that vanish during a scan */ }
        }
      } catch { /* an unreadable subtree is not a disk-usage claim */ }
    }
    walkSize(assetsRoot)
    const sizeGB = totalSize / (1024 * 1024 * 1024)
    if (sizeGB > 5) {
      observations.push(assetWarning({
        key: 'disk-usage',
        summary: `The assets directory uses ${sizeGB.toFixed(1)} GB.`,
        impact: 'Continued growth may consume the available disk space.',
        evidence: { bytes: totalSize },
      }))
    }
  } catch { /* disk usage is advisory only */ }

  const expired = expiredTrashEntries(trashDir)
  if (expired.length > 0) {
    observations.push(assetWarning({
      key: 'expired-trash',
      summary: `${expired.length} expired item(s) remain in asset trash beyond seven days.`,
      impact: 'Expired trash continues consuming disk space.',
      repair: true,
      evidence: { count: expired.length },
    }))
  }

  if (versionedCount > 0 && brokenCount === 0) {
    observations.push(healthHealthy({
      key: 'manifest-integrity',
      summary: `${versionedCount} versioned asset(s) have valid manifests.`,
      evidence: { count: versionedCount },
    }))
  }
  if (observations.length === 0) {
    observations.push(healthHealthy({ key: 'store', summary: 'The asset store is empty and healthy.' }))
  }
  return observations
}

function expiredTrashEntries(trashDir: string): string[] {
  if (!existsSync(trashDir)) return []
  const cutoff = Date.now() - TRASH_RETENTION_MS
  try {
    return readdirSync(trashDir).filter(file => {
      try {
        const match = /__deleted-(\d+)$/.exec(file)
        const deletedAt = match ? Number(match[1]) : statSync(join(trashDir, file)).mtimeMs
        return deletedAt < cutoff
      } catch { return false }
    })
  } catch { return [] }
}

function pendingAssetRepairChanges(contentDir: string): HealthRepairChange[] {
  const assetsRoot = join(contentDir, 'assets')
  const changes: HealthRepairChange[] = []
  if (!existsSync(assetsRoot)) {
    changes.push({ kind: 'file', target: assetsRoot, action: 'create', description: 'Create the asset store root and required directories.' })
  } else {
    for (const dirName of REQUIRED_ASSET_DIRS) {
      const target = join(assetsRoot, dirName)
      if (!existsSync(target)) changes.push({ kind: 'file', target, action: 'create', description: `Create assets/${dirName}.` })
    }
  }
  for (const file of expiredTrashEntries(join(assetsRoot, '.trash'))) {
    changes.push({ kind: 'file', target: join(assetsRoot, '.trash', file), action: 'delete', description: `Purge expired trash item ${file}.` })
  }
  return changes
}

/** Create missing store directories and purge only trash beyond retention. */
export function assetRepair(contentDir: string): HealthRepairActionDefinition {
  return {
    id: 'repair-store',
    name: 'Repair asset store',
    async plan() {
      const changes = pendingAssetRepairChanges(contentDir)
      if (changes.length === 0) return []
      const deletesFiles = changes.some(change => change.action === 'delete')
      return [{
        id: 'repair-store',
        actionId: 'repair-store',
        title: 'Repair asset store structure and retention',
        reason: deletesFiles
          ? 'Required asset directories are missing or expired trash is consuming disk space.'
          : 'Required asset-store directories are missing.',
        safety: deletesFiles ? 'destructive' : 'safe',
        incidentIds: [],
        observationIds: [],
        preconditions: [],
        changes,
      }]
    },
    async apply(items) {
      if (items.length === 0) return []
      try {
        const assetsRoot = join(contentDir, 'assets')
        mkdirSync(assetsRoot, { recursive: true })
        for (const dirName of REQUIRED_ASSET_DIRS) mkdirSync(join(assetsRoot, dirName), { recursive: true })
        const purged = expiredTrashEntries(join(assetsRoot, '.trash'))
        for (const file of purged) rmSync(join(assetsRoot, '.trash', file), { recursive: true, force: true })
        const changes = items.flatMap(item => item.changes)
        return items.map(item => ({
          itemId: item.id,
          actionId: item.actionId,
          status: 'applied' as const,
          message: `Repaired the asset store${purged.length > 0 ? ` and purged ${purged.length} expired trash item(s)` : ''}.`,
          affectedCheckIds: ['assets.assets'],
          changes,
        }))
      } catch (error) {
        return items.map(item => ({
          itemId: item.id,
          actionId: item.actionId,
          status: 'failed' as const,
          message: error instanceof Error ? error.message : String(error),
          affectedCheckIds: ['assets.assets'],
          changes: [],
        }))
      }
    },
  }
}
