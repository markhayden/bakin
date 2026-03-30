/**
 * bakin_exec_audit_assets — Audit asset health and integrity.
 *
 * Checks for missing thumbnails, invalid sidecars, orphaned files.
 * Optionally auto-fixes issues like missing thumbnails and stub sidecars.
 */
import { existsSync, readdirSync, statSync, readFileSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'
import { getContentDir } from '../../src/core/content-dir'
import { succeed, fail, generateThumbnail } from './common'
import { addExecTool } from './registry'
import { validateSidecar, getSidecarPath, createStub } from '../../plugins/assets/lib/sidecar'
import { detectVariant } from '../../plugins/assets/lib/asset-index'
import { ASSET_TYPES } from '../../plugins/assets/lib/constants'

interface AuditIssue {
  path: string
  issue: string
  fixed: boolean
}

function isAssetFile(filename: string): boolean {
  return !filename.endsWith('.meta.json') && !filename.startsWith('.')
}

async function auditAssets(
  params: Record<string, unknown>,
): Promise<ReturnType<typeof succeed>> {
  const fix = params.fix === true
  const typeFilter = typeof params.type === 'string' ? params.type : undefined

  const contentDir = getContentDir()
  const assetsRoot = join(contentDir, 'assets')

  if (!existsSync(assetsRoot)) {
    return fail('Assets directory not found', { path: assetsRoot })
  }

  const issues: AuditIssue[] = []
  let total = 0
  let fixed = 0

  const types = typeFilter ? [typeFilter] : [...ASSET_TYPES]

  for (const typeName of types) {
    const typeDir = join(assetsRoot, typeName)
    if (!existsSync(typeDir)) continue

    let subdirs: string[]
    try {
      subdirs = readdirSync(typeDir).filter(d => {
        if (d.startsWith('.')) return false
        try { return statSync(join(typeDir, d)).isDirectory() } catch { return false }
      })
    } catch { continue }

    for (const subdir of subdirs) {
      const dirPath = join(typeDir, subdir)
      let files: string[]
      try {
        files = readdirSync(dirPath).filter(isAssetFile)
      } catch { continue }

      // Build sets for cross-referencing
      const allFiles = new Set(files)
      const primaryFiles: string[] = []
      const variantFiles: string[] = []

      for (const file of files) {
        if (detectVariant(file)) {
          variantFiles.push(file)
        } else {
          primaryFiles.push(file)
        }
      }

      for (const file of primaryFiles) {
        total++
        const fullPath = join(dirPath, file)
        const relPath = `assets/${typeName}/${subdir}/${file}`

        // Check 1: Missing sidecar
        const sidecarPath = getSidecarPath(fullPath)
        if (!existsSync(sidecarPath)) {
          if (fix) {
            createStub(fullPath)
            issues.push({ path: relPath, issue: 'missing-sidecar', fixed: true })
            fixed++
          } else {
            issues.push({ path: relPath, issue: 'missing-sidecar', fixed: false })
          }
        } else {
          // Check 2: Invalid sidecar
          const sidecarIssues = validateSidecar(sidecarPath)
          if (sidecarIssues.length > 0) {
            issues.push({
              path: relPath,
              issue: `invalid-sidecar: ${sidecarIssues.join('; ')}`,
              fixed: false,
            })
          }

          // Check 3: Stub sidecar (agent: "unknown")
          try {
            const raw = JSON.parse(readFileSync(sidecarPath, 'utf-8'))
            if (raw.agent === 'unknown') {
              issues.push({ path: relPath, issue: 'stub-sidecar', fixed: false })
            }
          } catch { /* already caught by validateSidecar */ }
        }

        // Check 4: Missing thumbnail (images only)
        if (typeName === 'images') {
          const dotIdx = file.lastIndexOf('.')
          const stem = dotIdx > 0 ? file.substring(0, dotIdx) : file
          const hasThumb = allFiles.has(`${stem}.thumb.jpg`) || allFiles.has(`${stem}.thumb.jpeg`)
          if (!hasThumb) {
            if (fix) {
              const thumbPath = join(dirPath, `${stem}.thumb.jpg`)
              const result = generateThumbnail(fullPath, thumbPath)
              if (result) {
                issues.push({ path: relPath, issue: 'missing-thumbnail', fixed: true })
                fixed++
              } else {
                issues.push({ path: relPath, issue: 'missing-thumbnail (fix failed)', fixed: false })
              }
            } else {
              issues.push({ path: relPath, issue: 'missing-thumbnail', fixed: false })
            }
          }
        }
      }

      // Check 5: Orphaned variants (thumbnail whose primary doesn't exist)
      for (const file of variantFiles) {
        const relPath = `assets/${typeName}/${subdir}/${file}`
        const v = detectVariant(file)
        if (!v) continue

        // Check if any primary file starts with the base stem
        const hasPrimary = primaryFiles.some(p => {
          const pDot = p.lastIndexOf('.')
          const pStem = pDot > 0 ? p.substring(0, pDot) : p
          return pStem === v.baseStem
        })

        if (!hasPrimary) {
          issues.push({ path: relPath, issue: 'orphaned-variant', fixed: false })
        }
      }

      // Check 6: Orphaned sidecars
      try {
        const allDirFiles = readdirSync(dirPath)
        for (const f of allDirFiles) {
          if (!f.endsWith('.meta.json')) continue
          const assetName = f.replace('.meta.json', '')
          if (!allFiles.has(assetName)) {
            const relPath = `assets/${typeName}/${subdir}/${f}`
            issues.push({ path: relPath, issue: 'orphaned-sidecar', fixed: false })
          }
        }
      } catch { /* skip */ }
    }
  }

  const healthy = total - issues.filter(i => !i.issue.startsWith('orphaned') && !i.fixed).length

  return succeed({
    summary: { total, healthy, issues: issues.length, fixed },
    issues,
  })
}

// ---------------------------------------------------------------------------
// Register
// ---------------------------------------------------------------------------

addExecTool({
  name: 'bakin_exec_audit_assets',
  description:
    'Audit asset health: check for missing thumbnails, invalid sidecars, orphaned files. ' +
    'Set fix=true to auto-generate missing thumbnails and create stub sidecars.',
  parameters: {
    type: z.enum(['text', 'images', 'video', 'audio', 'plans', 'data', 'other'])
      .optional()
      .describe('Limit audit to a specific asset type'),
    fix: z.boolean().optional().default(false)
      .describe('Auto-fix issues where possible (generate thumbnails, create stubs)'),
  },
  handler: auditAssets,
})
