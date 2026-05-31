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

import { isValidAssetId } from './asset-id'
import { readManifest } from './manifest'

// ─── Result constructors (inlined; matches workflows precedent) ─────────────

function ok(check: string, message: string): HealthCheckResult {
  return { check, status: 'ok', message, autoFixable: false }
}
function warn(check: string, message: string, autoFixable = false): HealthCheckResult {
  return { check, status: 'warn', message, autoFixable }
}
function fixed(check: string, message: string): HealthCheckResult {
  return { check, status: 'fixed', message, autoFixable: true }
}

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
  return checkAssetsInternal(contentDir, false)
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
          const stat = statSync(join(trashDir, file))
          if (stat.mtimeMs < cutoff) {
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
