/**
 * Assets-plugin-owned doctor check.
 *
 * Migrated out of src/core/doctor.ts (#139 C3) — verifies the assets/
 * store shape, sidecar pairing, disk usage, and trash retention.
 *
 * Registered in plugins/assets/index.ts activate() via
 * ctx.registerHealthCheck. runDiagnostics() picks it up through the
 * plugin-check loop in src/core/doctor.ts's runPluginHealthChecks().
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'

import { createLogger } from '../../../src/core/logger'
import { getSettings } from '../../../src/core/settings'
import type { HealthCheckResult } from '../../../packages/core/src/plugin-types'

import { createStub } from './sidecar'
import { yearMonthFromFilename } from './path-for-filename'

const log = createLogger('assets:health')

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

// ─── Asset health: store shape, sidecars, disk usage, trash ───────────────

const REQUIRED_ASSET_DIRS = ['store', 'inbox', '.trash'] as const
const STORE_SHARD_RE = /^\d{4}-\d{2}$/

const SIDECAR_FIELD_ALIASES: Record<string, string> = {
  author: 'agent',
  createdAt: 'created',
  created_at: 'created',
  timestamp: 'created',
  task: 'taskId',
  task_id: 'taskId',
  name: 'agent',
}

/**
 * Verify directory structure, sidecar pairing, disk usage, and trash
 * retention for the assets tree under {contentDir}/assets/.
 *
 * Auto-fix paths (gated by settings.doctor.autoFixSkill):
 *   - create missing assets/, store/, inbox/, and .trash/
 *   - write stub sidecars for canonical store assets missing .meta.json
 *   - merge misnamed sidecars into the correctly-named ones (normalizing
 *     legacy field names) and remove the source
 *   - purge .trash/ items older than 7 days
 */
export function checkAssets(contentDir: string): HealthCheckResult[] {
  const results: HealthCheckResult[] = []
  const autoFix = getSettings().doctor.autoFixSkill
  const assetsRoot = join(contentDir, 'assets')

  // Check assets/ directory exists with filename-as-identity roots.
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

  // Scan for missing sidecars, orphaned meta files, and mismatched sidecars
  let missingMetaCount = 0
  let orphanedMetaCount = 0
  let mismatchedMetaCount = 0
  let totalAssets = 0

  try {
    const knownRootEntries = new Set<string>(REQUIRED_ASSET_DIRS)
    const rootEntries = readdirSync(assetsRoot)
    for (const entry of rootEntries) {
      if (knownRootEntries.has(entry)) continue
      const fullPath = join(assetsRoot, entry)
      try {
        if (statSync(fullPath).isDirectory()) {
          results.push(warn('assets', `Unexpected assets/${entry}/ directory is ignored by the filename-as-identity store`))
        }
      } catch { /* skip unreadable entries */ }
    }
  } catch { /* skip unreadable root */ }

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

      try {
        const files = readdirSync(shardDir)
        const assetFiles = files.filter(f => {
          if (f.endsWith('.meta.json') || f.startsWith('.')) return false
          try { return statSync(join(shardDir, f)).isFile() } catch { return false }
        })
        const metaFiles = files.filter(f => {
          if (!f.endsWith('.meta.json')) return false
          try { return statSync(join(shardDir, f)).isFile() } catch { return false }
        })

        totalAssets += assetFiles.length

        // Check for assets missing sidecar
        for (const assetFile of assetFiles) {
          const expectedShard = yearMonthFromFilename(assetFile)
          if (!expectedShard) {
            results.push(warn('assets', `Non-canonical asset filename assets/store/${shard}/${assetFile}`))
            continue
          }
          if (expectedShard !== shard) {
            results.push(warn('assets', `Asset assets/store/${shard}/${assetFile} belongs in assets/store/${expectedShard}/`))
            continue
          }

          const expectedMeta = assetFile + '.meta.json'
          if (!metaFiles.includes(expectedMeta)) {
            missingMetaCount++
            if (autoFix) {
              createStub(join(shardDir, assetFile))
            }
          }
        }

        // Check for orphaned or mismatched meta files
        for (const metaFile of metaFiles) {
          const assetName = metaFile.replace('.meta.json', '')
          if (!assetFiles.includes(assetName)) {
            // Check if this is a near-miss: meta basename matches part of an asset filename
            const nearMatch = assetFiles.find(af => {
              // Case 1: asset filename contains the meta base (e.g., "20250727-pop-tart.png" contains "pop-tart")
              if (af.includes(assetName)) return true
              // Case 2: meta base matches asset without extension (e.g., "hero-image" matches "hero-image.png")
              const afBase = af.substring(0, af.lastIndexOf('.'))
              if (afBase === assetName) return true
              return false
            })

            if (nearMatch) {
              mismatchedMetaCount++
              const expectedMeta = nearMatch + '.meta.json'
              log.warn('Mismatched sidecar', { metaFile, likelyAsset: nearMatch, expectedMeta, dir: shardDir })

              if (autoFix) {
                // Check if the correctly-named sidecar is a stub (agent: "unknown")
                const correctMetaPath = join(shardDir, expectedMeta)
                const mismatchedMetaPath = join(shardDir, metaFile)
                try {
                  let isStub = false
                  if (existsSync(correctMetaPath)) {
                    const correctContent = JSON.parse(readFileSync(correctMetaPath, 'utf-8'))
                    isStub = correctContent.agent === 'unknown'
                  }

                  if (isStub || !existsSync(correctMetaPath)) {
                    // Merge: read mismatched sidecar, normalize field names, write to correct path
                    const richMeta = JSON.parse(readFileSync(mismatchedMetaPath, 'utf-8'))

                    // Normalize common field name mistakes
                    for (const [alias, canonical] of Object.entries(SIDECAR_FIELD_ALIASES)) {
                      if (richMeta[alias] !== undefined && richMeta[canonical] === undefined) {
                        richMeta[canonical] = richMeta[alias]
                        delete richMeta[alias]
                      }
                    }

                    writeFileSync(correctMetaPath, JSON.stringify(richMeta, null, 2), 'utf-8')
                    unlinkSync(mismatchedMetaPath)
                    log.info('Merged mismatched sidecar', { from: metaFile, to: expectedMeta })
                  } else {
                    // Correct sidecar has real content — just remove the orphan
                    unlinkSync(mismatchedMetaPath)
                    log.info('Removed orphaned mismatched sidecar', { metaFile })
                  }
                } catch (err) {
                  log.warn('Failed to auto-fix mismatched sidecar', err, { metaFile })
                }
              }
            } else {
              orphanedMetaCount++
            }
          }
        }
      } catch { /* skip unreadable shard dirs */ }
    }
  }

  if (missingMetaCount > 0) {
    if (autoFix) {
      results.push(fixed('assets', `Created ${missingMetaCount} stub sidecar(s) for assets missing .meta.json`))
    } else {
      results.push(warn('assets', `${missingMetaCount} asset(s) missing .meta.json sidecar`, true))
    }
  }

  if (orphanedMetaCount > 0) {
    results.push(warn('assets', `${orphanedMetaCount} orphaned .meta.json file(s) with no matching asset`))
  }

  if (mismatchedMetaCount > 0) {
    if (autoFix) {
      results.push(fixed('assets', `Merged ${mismatchedMetaCount} misnamed .meta.json file(s) into correctly-named sidecars`))
    } else {
      results.push(warn('assets', `${mismatchedMetaCount} misnamed .meta.json file(s) — sidecar name doesn't match {filename}.meta.json pattern`, true))
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
      for (const file of trashFiles) {
        try {
          const stat = statSync(join(trashDir, file))
          if (stat.mtimeMs < cutoff) {
            if (autoFix) {
              rmSync(join(trashDir, file))
              purged++
            }
          }
        } catch { /* skip */ }
      }
      if (purged > 0) {
        results.push(fixed('assets', `Purged ${purged} expired item(s) from .trash/ (>7 days old)`))
      }
    }
  } catch { /* skip */ }

  if (results.length === 0) {
    results.push(ok('assets', `${totalAssets} asset(s), all sidecars present`))
  }

  return results
}
