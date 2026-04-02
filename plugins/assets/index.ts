/**
 * Assets plugin — server entry point.
 * Registers API routes, MCP exec tools, and cross-plugin hooks for asset management.
 */
import { existsSync, readdirSync, statSync, readFileSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'
import type { BakinPlugin, PluginContext } from '../../src/lib/plugin-types'
import { handleList } from './routes/list'
import { handleFile } from './routes/file'
import { handleDelete } from './routes/delete'
import { handleListTrash } from './routes/list-trash'
import { handleRestore } from './routes/restore'
import { handlePermanentDelete } from './routes/permanent-delete'
import { handleEmptyTrash } from './routes/empty-trash'
import { buildIndex, upsertAsset, removeAsset, detectVariant } from './lib/asset-index'
import { validateSidecar, getSidecarPath, createStub } from './lib/sidecar'
import { ASSET_TYPES } from './lib/constants'
import { listTrash, restoreAsset, emptyTrash, type TrashedAsset } from './lib/trash'
import { saveAsset } from './lib/save-asset'
import { registerSyncHook } from '../../src/core/watcher'
import { getContentDir } from '../../src/core/content-dir'
import { createLogger } from '../../src/core/logger'

const log = createLogger('assets')

// ---------------------------------------------------------------------------
// Thumbnail helper for audit tool
// ---------------------------------------------------------------------------

function generateThumbnail(inputPath: string, outputPath: string, widthPx = 400): string | null {
  try {
    const { execSync } = require('child_process')
    execSync(`ffmpeg -i "${inputPath}" -vf "scale=${widthPx}:-1" -q:v 5 -y "${outputPath}"`, { stdio: 'pipe', timeout: 30_000 })
    return outputPath
  } catch { return null }
}

const assetsPlugin: BakinPlugin = {
  id: 'assets',
  name: 'Assets',
  version: '2.0.0',

  settingsSchema: {
    fields: [
      { key: 'thumbnails', type: 'boolean', label: 'Generate thumbnails', description: 'Auto-create optimized thumbnails on upload', default: true },
      { key: 'maxFileSize', type: 'number', label: 'Max file size (MB)', description: 'Reject uploads larger than this', default: 50 },
    ],
  },

  navItems: [],
  contentFiles: [],

  activate(ctx: PluginContext) {
    // ─── Cross-Plugin Hooks ────────────────────────────────────────────

    ctx.hooks.register('assets.validateSidecar', (d: Record<string, unknown>) => validateSidecar(d.metaPath as string))
    ctx.hooks.register('assets.getSidecarPath', (d: Record<string, unknown>) => getSidecarPath(d.assetPath as string))
    ctx.hooks.register('assets.createStub', (d: Record<string, unknown>) => createStub(d.assetPath as string))
    ctx.hooks.register('assets.detectVariant', (d: Record<string, unknown>) => detectVariant(d.filename as string))
    ctx.hooks.register('assets.getAssetTypes', () => ASSET_TYPES)
    ctx.hooks.register('assets.listTrash', (d: Record<string, unknown>) => listTrash(d.assetsRoot as string))
    ctx.hooks.register('assets.restoreAsset', (d: Record<string, unknown>) => restoreAsset(d.trashFilename as string, d.assetsRoot as string))
    ctx.hooks.register('assets.emptyTrash', (d: Record<string, unknown>) => emptyTrash(d.assetsRoot as string))

    // Build the index on startup
    buildIndex()

    // Register a sync hook to keep the index up-to-date
    registerSyncHook(async (relativePath: string, _content: string) => {
      if (!relativePath.startsWith('assets/')) return
      if (relativePath.includes('.trash/')) return

      if (relativePath.endsWith('.meta.json')) {
        const assetPath = relativePath.replace('.meta.json', '')
        upsertAsset(assetPath)
      } else {
        upsertAsset(relativePath)
      }
    })

    // ─── REST API Routes ───────────────────────────────────────────────

    // GET / — list assets with filters
    ctx.registerRoute({ path: '/', method: 'GET', description: 'List assets with filters', handler: handleList })

    // GET /file — serve asset file for rendering
    ctx.registerRoute({ path: '/file', method: 'GET', description: 'Serve asset file', handler: handleFile })

    // DELETE /:assetPath — soft-delete an asset
    ctx.registerRoute({
      path: '/delete',
      method: 'POST',
      description: 'Soft-delete an asset',
      handler: async (req: Request) => {
        const res = await handleDelete(req)
        if (res.ok) {
          ctx.activity.audit('deleted', 'system')
          ctx.activity.log('system', 'Asset deleted')
        }
        return res
      },
    })

    // GET /trash — list trashed assets
    ctx.registerRoute({ path: '/trash', method: 'GET', description: 'List trashed assets', handler: handleListTrash })

    // POST /trash/:file/restore — restore a trashed asset
    ctx.registerRoute({
      path: '/restore',
      method: 'POST',
      description: 'Restore a trashed asset',
      handler: async (req: Request) => {
        const res = await handleRestore(req)
        if (res.ok) {
          ctx.activity.audit('restored', 'system')
          ctx.activity.log('system', 'Asset restored from trash')
        }
        return res
      },
    })

    // DELETE /trash — empty entire trash
    ctx.registerRoute({
      path: '/empty-trash',
      method: 'POST',
      description: 'Empty entire trash',
      handler: async (req: Request) => {
        const res = await handleEmptyTrash(req)
        if (res.ok) {
          ctx.activity.audit('trash-emptied', 'system')
          ctx.activity.log('system', 'Trash emptied')
        }
        return res
      },
    })

    // Permanent delete (kept for compatibility)
    ctx.registerRoute({
      path: '/permanent-delete',
      method: 'POST',
      description: 'Permanently delete a trashed asset',
      handler: async (req: Request) => {
        const res = await handlePermanentDelete(req)
        if (res.ok) {
          ctx.activity.audit('permanent-deleted', 'system')
          ctx.activity.log('system', 'Asset permanently deleted')
        }
        return res
      },
    })

    // ─── MCP Exec Tools ────────────────────────────────────────────────

    ctx.registerExecTool({
      name: 'bakin_exec_assets_list',
      description: 'List assets with optional type filter. Returns asset count and paths.',
      parameters: {
        type: z.enum(ASSET_TYPES).optional().describe('Filter by asset type'),
      },
      handler: async (params: Record<string, unknown>) => {
        // Delegate to the existing list handler via a synthetic request
        const typeFilter = params.type ? `?type=${params.type}` : ''
        const req = new Request(`http://localhost/api/plugins/assets/list${typeFilter}`)
        const res = await handleList(req)
        const data = await res.json()
        return { ok: true, ...data }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_assets_save',
      description: 'Save an agent-created file to the assets directory with standardized naming (YYYYMMDD-slug.ext) and sidecar metadata. Handles directory creation, naming conventions, and .meta.json automatically.',
      parameters: {
        filePath: z.string().describe('Absolute path to the source file to save'),
        taskId: z.string().describe('Task ID — used for directory organization'),
        type: z.enum(ASSET_TYPES).describe('Asset type: text, images, video, audio, plans, data, or other'),
        description: z.string().optional().describe('Human-readable description of the asset'),
        tags: z.array(z.string()).optional().describe('Tags for filtering and search'),
        tool: z.string().optional().describe('Tool used to generate (e.g., "dall-e-3", "nano-banana-pro")'),
        slug: z.string().optional().describe('Custom filename slug. Auto-derived from source filename if omitted.'),
      },
      handler: async (params: Record<string, unknown>, agent: string) => {
        const result = await saveAsset({ ...params, agent } as Parameters<typeof saveAsset>[0])
        if (result.ok) {
          ctx.activity.log(agent, `Saved asset "${result.filename}"`, { taskId: params.taskId as string })
        }
        return result
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_assets_delete',
      description: 'Soft-delete an asset (moves to trash with 30-day expiry).',
      parameters: {
        path: z.string().describe('Asset path relative to content dir (e.g. "assets/images/task123/file.png")'),
      },
      handler: async (params: Record<string, unknown>, agent: string) => {
        const req = new Request('http://localhost/api/plugins/assets/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: params.path }),
        })
        const res = await handleDelete(req)
        const data = await res.json()
        if (res.ok) ctx.activity.log(agent, `Deleted asset "${params.path}"`)
        return { ok: res.ok, ...data }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_assets_list_trash',
      description: 'List trashed assets with name, size, deleted timestamp, and days remaining before auto-purge.',
      parameters: {},
      handler: async () => {
        const assetsRoot = join(getContentDir(), 'assets')
        const items = await listTrash(assetsRoot)
        return {
          ok: true,
          count: items.length,
          items: items.map((i: TrashedAsset) => ({
            filename: i.filename, originalFilename: i.originalFilename,
            type: i.type, size: i.size, deletedAt: i.deletedAt, expiresAt: i.expiresAt,
            agent: i.metadata?.agent ?? 'unknown',
          })),
        }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_assets_restore',
      description: 'Restore a trashed asset back to its original location. Use bakin_exec_assets_list_trash first to get the filename.',
      parameters: {
        filename: z.string().describe('The trash filename (includes __deleted- suffix)'),
      },
      handler: async (params: Record<string, unknown>, agent: string) => {
        const filename = params.filename as string
        const assetsRoot = join(getContentDir(), 'assets')
        const restoredPath = await restoreAsset(filename, assetsRoot)
        if (!restoredPath) return { ok: false, error: 'Failed to restore asset — file may not exist in trash' }
        ctx.activity.log(agent, `Restored asset "${filename}"`)
        return { ok: true, restoredPath }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_assets_audit',
      description: 'Audit asset health: check for missing thumbnails, invalid sidecars, orphaned files. Set fix=true to auto-generate missing thumbnails and create stub sidecars.',
      parameters: {
        type: z.enum(ASSET_TYPES).optional().describe('Limit audit to a specific asset type'),
        fix: z.boolean().optional().default(false).describe('Auto-fix issues where possible'),
      },
      handler: async (params: Record<string, unknown>) => {
        const fix = params.fix === true
        const typeFilter = typeof params.type === 'string' ? params.type : undefined
        const contentDir = getContentDir()
        const assetsRoot = join(contentDir, 'assets')

        if (!existsSync(assetsRoot)) {
          return { ok: false, error: 'Assets directory not found' }
        }

        interface AuditIssue { path: string; issue: string; fixed: boolean }
        const issues: AuditIssue[] = []
        let total = 0
        let fixed = 0

        const types = typeFilter ? [typeFilter] : [...ASSET_TYPES]
        const isAssetFile = (filename: string) => !filename.endsWith('.meta.json') && !filename.startsWith('.')

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
            try { files = readdirSync(dirPath).filter(isAssetFile) } catch { continue }

            const allFiles = new Set(files)
            const primaryFiles: string[] = []
            const variantFiles: string[] = []

            for (const file of files) {
              if (detectVariant(file)) { variantFiles.push(file) } else { primaryFiles.push(file) }
            }

            for (const file of primaryFiles) {
              total++
              const fullPath = join(dirPath, file)
              const relPath = `assets/${typeName}/${subdir}/${file}`

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
                const sidecarIssues = validateSidecar(sidecarPath)
                if (sidecarIssues.length > 0) {
                  issues.push({ path: relPath, issue: `invalid-sidecar: ${sidecarIssues.join('; ')}`, fixed: false })
                }
                try {
                  const raw = JSON.parse(readFileSync(sidecarPath, 'utf-8'))
                  if (raw.agent === 'unknown') {
                    issues.push({ path: relPath, issue: 'stub-sidecar', fixed: false })
                  }
                } catch { /* already caught by validateSidecar */ }
              }

              if (typeName === 'images') {
                const dotIdx = file.lastIndexOf('.')
                const stem = dotIdx > 0 ? file.substring(0, dotIdx) : file
                const hasThumb = allFiles.has(`${stem}.thumb.jpg`) || allFiles.has(`${stem}.thumb.jpeg`)
                if (!hasThumb) {
                  if (fix) {
                    const thumbPath = join(dirPath, `${stem}.thumb.jpg`)
                    if (generateThumbnail(fullPath, thumbPath)) {
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

            for (const file of variantFiles) {
              const relPath = `assets/${typeName}/${subdir}/${file}`
              const v = detectVariant(file)
              if (!v) continue
              const hasPrimary = primaryFiles.some(p => {
                const pDot = p.lastIndexOf('.')
                const pStem = pDot > 0 ? p.substring(0, pDot) : p
                return pStem === v.baseStem
              })
              if (!hasPrimary) issues.push({ path: relPath, issue: 'orphaned-variant', fixed: false })
            }

            try {
              const allDirFiles = readdirSync(dirPath)
              for (const f of allDirFiles) {
                if (!f.endsWith('.meta.json')) continue
                const assetName = f.replace('.meta.json', '')
                if (!allFiles.has(assetName)) {
                  issues.push({ path: `assets/${typeName}/${subdir}/${f}`, issue: 'orphaned-sidecar', fixed: false })
                }
              }
            } catch { /* skip */ }
          }
        }

        const healthy = total - issues.filter(i => !i.issue.startsWith('orphaned') && !i.fixed).length
        return { ok: true, summary: { total, healthy, issues: issues.length, fixed }, issues }
      },
    })
  },

  async onReady() {
    const contentDir = getContentDir()
    const assetsRoot = join(contentDir, 'assets')
    if (existsSync(assetsRoot)) {
      let count = 0
      for (const type of ASSET_TYPES) {
        const typeDir = join(assetsRoot, type)
        if (!existsSync(typeDir)) continue
        try {
          const subdirs = readdirSync(typeDir).filter(d => {
            try { return statSync(join(typeDir, d)).isDirectory() } catch { return false }
          })
          count += subdirs.length
        } catch { /* skip */ }
      }
      log.info(`Ready — ${count} asset directories across ${ASSET_TYPES.length} types`)
    }
  },

  onShutdown() {
    log.info('Shutting down assets plugin')
  },
}

export default assetsPlugin
