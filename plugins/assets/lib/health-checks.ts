/**
 * Assets-plugin-owned doctor check.
 *
 * Verifies the assets/ store shape (directory structure, canonical month
 * shards), disk usage, trash retention, and — the heart of it — versioned
 * asset integrity: every asset is a directory under
 * assets/store/<YYYY-MM>/<assetId>/ with a valid manifest.json whose
 * currentVersion resolves and whose version + thumbnail files exist on disk.
 *
 * Registered in plugins/assets/index.ts activate() via
 * ctx.registerHealthCheck. runDiagnostics() picks it up through the
 * plugin-check loop in src/core/doctor.ts's runPluginHealthChecks().
 */
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'fs'
import { join } from 'path'

import type { HealthCheckResult, HealthRepairHandler } from '../../../packages/core/src/plugin-types'
import { healthOk as ok, healthWarn as warn, healthFixed as fixed } from '@makinbakin/sdk/utils'

import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'

import { isValidAssetId } from './asset-id'
import { scanUnmanaged } from './import-unmanaged'
import { getAsset, listAssets } from './asset-core'
import { reseedUnmanaged } from './unmanaged-tracker'
import { readManifest } from './manifest'
import { resolveEnrichmentEngine } from './enrichment/engine'
import type { EnrichmentSettings } from './enrichment/providers'

// ─── Result constructors (inlined; matches workflows precedent) ─────────────


// ─── Asset health: store shape, disk usage, trash, manifest integrity ──────

const REQUIRED_ASSET_DIRS = ['store', 'inbox', '.trash'] as const
const STORE_SHARD_RE = /^\d{4}-\d{2}$/

/**
 * Verify directory structure, month-shard naming, disk usage, trash
 * retention, and versioned-asset manifest integrity for the assets tree
 * under {contentDir}/assets/.
 *
 * Explicit repair paths:
 *   - create missing assets/, store/, inbox/, and .trash/
 *   - purge .trash/ items older than 7 days
 */
export function checkAssets(contentDir: string): HealthCheckResult[] {
  return [...checkAssetsInternal(contentDir, false), ...checkUnimported(), ...checkEnrichment()]
}

/**
 * Unimported-files check (D7): the doctor's scheduled sweep is one of the
 * two on-demand scan triggers (the Import view is the other). NOT
 * auto-fixable by design — turning a file into an asset is an explicit
 * user decision; the check names the count and points at the verbs.
 */
export function checkUnimported(): HealthCheckResult[] {
  const files = scanUnmanaged()
  reseedUnmanaged(files.map(f => f.relPath))
  if (files.length === 0) {
    return [ok('assets.unimported', 'No unmanaged files awaiting import')]
  }
  return [warn(
    'assets.unimported',
    `${files.length} unmanaged file(s) under assets/ awaiting explicit import — Assets → Import, or \`bakin assets import --all\``,
    false,
  )]
}

/**
 * Enrichment coverage (D8/T12): counts come straight from manifests — the
 * durable record. Failed rows carry the last error; missing/stale rows are
 * repairable via the billed backfill (`bakin assets enrich --all`), which
 * is deliberately NOT auto-fix (it costs money).
 */
export interface EnrichmentCoverage {
  total: number
  enriched: number
  missing: number
  stale: number
  failed: number
  skipped: number
}

/**
 * Coverage counts for the health tile's "X/Y enriched" — computed straight
 * from summaries (the summary's `enrichment` field already folds in the
 * stale-version distinction; no per-asset manifest re-read on the poll path).
 */
export function enrichmentCoverage(): EnrichmentCoverage {
  const summaries = listAssets()
  const coverage: EnrichmentCoverage = { total: summaries.length, enriched: 0, missing: 0, stale: 0, failed: 0, skipped: 0 }
  for (const summary of summaries) {
    switch (summary.enrichment) {
      case 'done': coverage.enriched++; break
      case 'stale': coverage.stale++; break
      case 'failed': coverage.failed++; break
      case 'skipped': coverage.skipped++; break
      default: coverage.missing++ // 'none' + pending that never completed
    }
  }
  return coverage
}

export function checkEnrichment(): HealthCheckResult[] {
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
  const results: HealthCheckResult[] = []
  if (failed > 0) {
    results.push(warn('assets.enrichment', `${failed} asset(s) failed vision enrichment — retry with 'bakin assets enrich --all --force' after checking provider keys`, false))
  }
  if (missing + stale > 0) {
    results.push(warn('assets.enrichment', `${missing + stale} asset(s) without current enrichment (${missing} never enriched, ${stale} stale) — 'bakin assets enrich --all' (billed)`, false))
  }
  if (results.length === 0) {
    results.push(ok('assets.enrichment', 'All assets carry current enrichment (or recorded skips)'))
  }
  return results
}

/**
 * Which engine would serve an image-enrichment job RIGHT NOW (spec §5) —
 * direct API model, runtime agent turns (subscription quota), or neither.
 * Async (capability probe) and settings/runtime-dependent, so it's wired
 * from the plugin's registerHealthCheck rather than checkAssets().
 */
export async function checkEnrichmentEngine(
  settings: EnrichmentSettings,
  runtime: AgentRuntimeAdapter | null,
): Promise<HealthCheckResult> {
  if (settings.enrichmentEnabled === false) {
    return ok('assets.enrichment-engine', 'Vision enrichment disabled in settings')
  }
  const resolution = await resolveEnrichmentEngine(settings, { kind: 'image' }, { runtime })
  if (!resolution.ok) {
    return warn('assets.enrichment-engine', `No enrichment engine available — new assets will record skips: ${resolution.reason}`, false)
  }
  const engine = resolution.engine
  return engine.name === 'runtime'
    ? ok('assets.enrichment-engine', `Enrichment engine: runtime agent '${engine.modelId.slice('runtime:'.length)}' (image-capable; agent turns spend subscription quota, ~35s/asset)`)
    : ok('assets.enrichment-engine', `Enrichment engine: direct API (${engine.modelId})`)
}

function checkAssetsInternal(contentDir: string, autoFix: boolean): HealthCheckResult[] {
  const results: HealthCheckResult[] = []
  const assetsRoot = join(contentDir, 'assets')

  if (!existsSync(assetsRoot)) {
    if (autoFix) {
      mkdirSync(assetsRoot, { recursive: true })
      results.push(fixed('assets', 'Created assets/ directory'))
    } else {
      results.push(warn('assets', 'assets/ directory not found', true))
      return results
    }
  }

  for (const dirName of REQUIRED_ASSET_DIRS) {
    const dirPath = join(assetsRoot, dirName)
    if (!existsSync(dirPath)) {
      if (autoFix) {
        mkdirSync(dirPath, { recursive: true })
        results.push(fixed('assets', `Created assets/${dirName}/ directory`))
      } else {
        results.push(warn('assets', `Missing assets/${dirName}/ directory`, true))
      }
    } else {
      try {
        if (!statSync(dirPath).isDirectory()) {
          results.push(warn('assets', `assets/${dirName} exists but is not a directory`))
        }
      } catch { /* skip unreadable entry */ }
    }
  }

  const trashDir = join(assetsRoot, '.trash')
  const storeRoot = join(assetsRoot, 'store')

  // Flag unexpected top-level entries — the store only knows store/inbox/.trash.
  try {
    const knownRootEntries = new Set<string>(REQUIRED_ASSET_DIRS)
    for (const entry of readdirSync(assetsRoot)) {
      if (knownRootEntries.has(entry)) continue
      const fullPath = join(assetsRoot, entry)
      try {
        if (statSync(fullPath).isDirectory()) {
          results.push(warn('assets', `Unexpected assets/${entry}/ directory is ignored by the asset store`))
        }
      } catch { /* skip unreadable entries */ }
    }
  } catch { /* skip unreadable root */ }

  // Versioned assets (asset-as-directory): month shards + manifest integrity.
  let versionedCount = 0
  let brokenCount = 0
  if (existsSync(storeRoot)) {
    let shards: string[]
    try {
      shards = readdirSync(storeRoot).filter(d => {
        if (d.startsWith('.')) return false
        try { return statSync(join(storeRoot, d)).isDirectory() } catch { return false }
      })
    } catch { shards = [] }

    for (const shard of shards) {
      const shardDir = join(storeRoot, shard)
      if (!STORE_SHARD_RE.test(shard)) {
        results.push(warn('assets', `Unexpected assets/store/${shard}/ shard; canonical shards must be YYYY-MM`))
        continue
      }

      let entries: string[]
      try { entries = readdirSync(shardDir) } catch { continue }
      for (const entry of entries) {
        if (!isValidAssetId(entry)) {
          results.push(warn('assets', `Unexpected assets/store/${shard}/${entry}; store entries must be assetId directories`))
          continue
        }
        versionedCount++
        const dirAbs = join(shardDir, entry)
        const manifest = readManifest(dirAbs)
        if (!manifest) {
          results.push(warn('assets', `Versioned asset ${entry} has a missing or invalid manifest.json`))
          brokenCount++
          continue
        }
        if (!manifest.versions.some(v => v.version === manifest.currentVersion)) {
          results.push(warn('assets', `Versioned asset ${entry}: currentVersion ${manifest.currentVersion} is not in versions[]`))
          brokenCount++
        }
        for (const v of manifest.versions) {
          if (!existsSync(join(dirAbs, v.file))) {
            results.push(warn('assets', `Versioned asset ${entry}: missing version file ${v.file}`))
            brokenCount++
          }
          if (v.thumb && !existsSync(join(dirAbs, v.thumb))) {
            results.push(warn('assets', `Versioned asset ${entry}: missing thumbnail ${v.thumb}`))
            brokenCount++
          }
        }
      }
    }
  }

  // Disk usage check
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
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }
    walkSize(assetsRoot)

    const sizeGB = totalSize / (1024 * 1024 * 1024)
    if (sizeGB > 5) {
      results.push(warn('assets', `Assets directory is ${sizeGB.toFixed(1)} GB — consider cleanup`))
    }
  } catch { /* skip size check */ }

  // Trash cleanup
  try {
    if (existsSync(trashDir)) {
      const trashFiles = readdirSync(trashDir)
      const cutoff = Date.now() - (7 * 24 * 60 * 60 * 1000) // 7 days
      let purged = 0
      let expired = 0
      for (const file of trashFiles) {
        try {
          // Retention is measured from DELETION time (the `__deleted-<ms>`
          // suffix), not file mtime — renameSync preserves the original mtime,
          // so an old asset deleted today must not be purged immediately.
          const m = /__deleted-(\d+)$/.exec(file)
          const deletedAt = m ? Number(m[1]) : statSync(join(trashDir, file)).mtimeMs
          if (deletedAt < cutoff) {
            if (autoFix) {
              rmSync(join(trashDir, file), { recursive: true, force: true })
              purged++
            } else {
              expired++
            }
          }
        } catch { /* skip */ }
      }
      if (purged > 0) {
        results.push(fixed('assets', `Purged ${purged} expired item(s) from .trash/ (>7 days old)`))
      }
      if (expired > 0) {
        results.push(warn('assets', `${expired} expired item(s) in .trash/ older than 7 days`, true))
      }
    }
  } catch { /* skip */ }

  if (versionedCount > 0 && brokenCount === 0) {
    results.push(ok('assets', `${versionedCount} versioned asset(s), all manifests valid`))
  }

  if (results.length === 0) {
    results.push(ok('assets', 'Asset store is empty and healthy'))
  }

  return results
}

export function assetRepair(contentDir: string): HealthRepairHandler {
  return {
    async plan(rows) {
      const matching = rows.filter(row => row.check === 'assets' && row.autoFixable)
      if (matching.length === 0) return []
      return [{
        id: 'assets.repair-store',
        checkId: 'assets',
        title: 'Repair asset store structure',
        reason: matching.map(row => row.message).join('; '),
        safety: 'safe',
        requiresConfirmation: true,
        changes: [{
          kind: 'file',
          target: join(contentDir, 'assets'),
          action: 'update',
          description: 'Create missing asset directories and purge expired trash.',
        }],
      }]
    },
    async apply(items) {
      if (items.length === 0) return []
      const rows = checkAssetsInternal(contentDir, true)
      const failures = rows.filter(row => row.status === 'error')
      return [{
        id: 'assets.repair-store',
        checkId: 'assets',
        status: failures.length > 0 ? 'failed' : 'applied',
        message: rows.map(row => row.message).join('; '),
        changes: rows
          .filter(row => row.status === 'fixed')
          .map(row => ({
            kind: 'file' as const,
            target: join(contentDir, 'assets'),
            action: 'update' as const,
            description: row.message,
          })),
      }]
    },
  }
}
