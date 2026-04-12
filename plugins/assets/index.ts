/**
 * Assets plugin — server entry point.
 * Registers API routes, MCP exec tools, and cross-plugin hooks for asset management.
 */
import { execSync } from 'child_process'
import { existsSync, readdirSync, statSync, readFileSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'
import type { BakinPlugin, PluginContext } from '../../src/lib/plugin-types'
import { handleList } from './routes/list'
import { handleFile } from './routes/file'
import { handleDelete } from './routes/delete'
import { handleUpload } from './routes/upload'
import { handleListTrash } from './routes/list-trash'
import { handleRestore } from './routes/restore'
import { handlePermanentDelete } from './routes/permanent-delete'
import { handleEmptyTrash } from './routes/empty-trash'
import { handleLink } from './routes/link'
import { relinkAsset } from './lib/relink'
import { buildIndex, upsertAsset, removeAsset, detectVariant, listAssets } from './lib/asset-index'
import { validateSidecar, getSidecarPath, createStub } from './lib/sidecar'
import { ASSET_TYPES } from './lib/constants'
import { listTrash, restoreAsset, emptyTrash, permanentDelete, softDelete, type TrashedAsset } from './lib/trash'
import { saveAsset } from './lib/save-asset'
import { registerSyncHook } from '../../src/core/watcher'
import { getContentDir } from '../../src/core/content-dir'
import { createLogger } from '../../src/core/logger'
import { buildAssetFileUrl } from './lib/asset-url'
import { extractAssetContent } from './lib/content-extractor'

const log = createLogger('assets')

// ---------------------------------------------------------------------------
// Thumbnail helper for audit tool
// ---------------------------------------------------------------------------

function generateThumbnail(inputPath: string, outputPath: string, widthPx = 400): string | null {
  try {
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
      { key: 'purgeClipboardOnComplete', type: 'boolean', label: 'Purge clipboard assets on task completion', description: 'Auto-delete clipboard-pasted assets when their linked task is marked done', default: false },
    ],
  },

  navItems: [],
  contentFiles: [],

  activate(ctx: PluginContext) {
    // ─── Search Content Type Registration ─────────────────────────────

    ctx.search.registerContentType({
      table: 'assets',
      schema: {
        description: { type: 'text' },
        tags: { type: 'text' },
        agent: { type: 'keyword' },
        task_id: { type: 'keyword' },
        asset_type: { type: 'keyword' },
        file_name: { type: 'text' },
        tool: { type: 'keyword' },
        updated_at: { type: 'datetime' },
        // `content` is populated server-side by extractAssetContent —
        // plain text for .md/.txt/.json/.csv/.yaml, pdf-parse output for
        // .pdf, empty for everything else. We extract in Bakin rather
        // than letting Antfly's {{remotePDF}}/{{remoteText}} helpers run
        // because Antfly's Go PDF library silently fails on any PDF with
        // complex font encoding (see Bakin issue #72).
        content: { type: 'text' },
        // `image_url` is a file:// URL for raster images that CLIP can
        // actually decode. Populated at index time by computeMediaUrls.
        // The visual index template dereferences it via {{remoteMedia}}
        // — that path works because `file://` skips Antfly's scraping
        // layer's hardcoded private-IP block.
        image_url: { type: 'keyword' },
      },
      searchableFields: ['description', 'tags', 'file_name', 'content'],
      rerankField: 'description',
      // Unused when `indexes` is set, but the type requires it. Kept as the
      // equivalent template to keep the legacy synthesis path readable.
      embeddingTemplate: '{{description}} {{tags}} {{file_name}} {{content}}',
      indexes: [
        {
          name: 'assets_text',
          embedderRef: 'default',
          embeddingTemplate: '{{description}} {{tags}} {{file_name}} {{content}}',
          chunker: { enabled: true, targetTokens: 200, overlapTokens: 25 },
        },
        {
          name: 'assets_visual',
          embedderRef: 'visual',
          embeddingTemplate: '{{#if image_url}}{{remoteMedia url=image_url}}{{/if}}',
        },
      ],
      facets: ['asset_type', 'agent', 'tool'],
      reindex: async function* () {
        const contentDir = getContentDir()
        const assetsRoot = join(contentDir, 'assets')
        if (!existsSync(assetsRoot)) return

        for (const typeName of ASSET_TYPES) {
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
            try { files = readdirSync(dirPath).filter(f => f.endsWith('.meta.json')) } catch { continue }

            for (const metaFile of files) {
              const metaPath = join(dirPath, metaFile)
              try {
                const raw = JSON.parse(readFileSync(metaPath, 'utf-8'))
                const assetFilename = metaFile.replace('.meta.json', '')
                const key = `assets/${typeName}/${subdir}/${assetFilename}`
                const doc = await assetToSearchDoc(raw, assetFilename, typeName, key)
                yield { key, doc }
              } catch { /* skip unreadable sidecars */ }
            }
          }
        }
      },
      verifyExists: async (key: string) => {
        const metaPath = join(getContentDir(), key + '.meta.json')
        return existsSync(metaPath)
      },
    })

    /**
     * Compute image_url for the visual index. Only raster image formats
     * that CLIP can actually decode get a URL — SVG and ICO are excluded
     * because Antfly's image processor (Go's standard image library)
     * cannot handle vector or indexed-palette formats, and CLIP needs
     * raster pixel data anyway. The {{#if image_url}} guard in the
     * visual index template skips the helper when the URL is empty.
     */
    function computeImageUrl(
      assetRelPath: string,
      filename: string,
      assetType: string,
    ): string {
      const lower = filename.toLowerCase()
      const isRasterImage =
        assetType === 'images' &&
        (lower.endsWith('.png') ||
          lower.endsWith('.jpg') ||
          lower.endsWith('.jpeg') ||
          lower.endsWith('.gif') ||
          lower.endsWith('.webp') ||
          lower.endsWith('.bmp'))
      return isRasterImage ? buildAssetFileUrl(assetRelPath) : ''
    }

    /** Convert sidecar metadata to a search document */
    async function assetToSearchDoc(
      meta: Record<string, unknown>,
      filename: string,
      assetType: string,
      assetRelPath: string,
    ): Promise<Record<string, unknown>> {
      // assetRelPath is `assets/{type}/{subdir}/{file}` (the registry key).
      // Strip the leading `assets/` to get the path relative to the assets
      // root, which is what buildAssetFileUrl expects.
      const rel = assetRelPath.replace(/^assets\//, '')
      const image_url = computeImageUrl(rel, filename, assetType)
      const absPath = join(getContentDir(), assetRelPath)
      const content = await extractAssetContent(absPath, filename)
      return {
        description: (meta.description as string) || '',
        tags: Array.isArray(meta.tags) ? (meta.tags as string[]).join(', ') : '',
        agent: (meta.agent as string) || '',
        task_id: (meta.taskId as string) || '',
        asset_type: assetType,
        file_name: filename,
        tool: (meta.tool as string) || '',
        updated_at: (meta.created as string) || new Date().toISOString(),
        content,
        image_url,
      }
    }

    /** Index an asset by reading its sidecar metadata */
    async function indexAsset(relPath: string): Promise<void> {
      try {
        const contentDir = getContentDir()
        const metaPath = join(contentDir, relPath + '.meta.json')
        if (!existsSync(metaPath)) return
        const raw = JSON.parse(readFileSync(metaPath, 'utf-8'))
        const filename = relPath.split('/').pop() || ''
        const parts = relPath.split('/')
        const assetType = parts[1] || 'other'
        const doc = await assetToSearchDoc(raw, filename, assetType, relPath)
        await ctx.search.index(relPath, doc)
      } catch (err) {
        log.warn('Failed to index asset for search', { path: relPath, error: err instanceof Error ? err.message : String(err) })
      }
    }

    // ─── Cross-Plugin Hooks ────────────────────────────────────────────

    ctx.hooks.register('assets.validateSidecar', (d: Record<string, unknown>) => validateSidecar(d.metaPath as string))
    ctx.hooks.register('assets.getSidecarPath', (d: Record<string, unknown>) => getSidecarPath(d.assetPath as string))
    ctx.hooks.register('assets.createStub', (d: Record<string, unknown>) => createStub(d.assetPath as string))
    ctx.hooks.register('assets.detectVariant', (d: Record<string, unknown>) => detectVariant(d.filename as string))
    ctx.hooks.register('assets.getAssetTypes', () => ASSET_TYPES)

    // Purge clipboard-source assets when a task completes (if enabled)
    ctx.hooks.register('assets.purgeClipboardForTask', async (d: Record<string, unknown>) => {
      const settings = ctx.getSettings<{ purgeClipboardOnComplete?: boolean }>()
      if (!settings.purgeClipboardOnComplete) return { purged: 0 }

      const taskId = d.taskId as string
      if (!taskId) return { purged: 0 }

      const contentDir = getContentDir()
      const assetsRoot = join(contentDir, 'assets')
      const assets = listAssets({ taskId })
      let purged = 0

      for (const asset of assets) {
        if (asset.metadata.source !== 'clipboard') continue
        const fullPath = join(contentDir, asset.path)
        if (softDelete(fullPath, assetsRoot)) {
          removeAsset(asset.path)
          ctx.search.remove(asset.path).catch(() => {})
          purged++
        }
      }

      if (purged > 0) {
        log.info(`Purged ${purged} clipboard asset(s) for completed task ${taskId}`)
        ctx.activity.log('system', `Purged ${purged} clipboard asset(s) for task ${taskId}`)
      }
      return { purged }
    })
    ctx.hooks.register('assets.listTrash', (d: Record<string, unknown>) => listTrash(d.assetsRoot as string))
    ctx.hooks.register('assets.restoreAsset', (d: Record<string, unknown>) => restoreAsset(d.trashFilename as string, d.assetsRoot as string))
    ctx.hooks.register('assets.emptyTrash', (d: Record<string, unknown>) => emptyTrash(d.assetsRoot as string))

    // Build the index on startup
    buildIndex()

    // Register a sync hook to keep both the local asset tracker and the
    // Antfly search index up-to-date for any asset that arrives via the
    // filesystem watcher rather than a REST route (manual drops, rsync,
    // another agent writing directly, restored backups, etc.).
    //
    // indexAsset() early-returns when the sidecar is missing, so if a
    // media file lands before its sidecar the first call is a no-op and
    // the second call (triggered by the sidecar write) re-runs with
    // full metadata. Deletions are not handled here — that requires a
    // separate watcher unlink hook and is tracked as follow-up work.
    registerSyncHook(async (relativePath: string, _content: string) => {
      if (!relativePath.startsWith('assets/')) return
      if (relativePath.includes('.trash/')) return

      if (relativePath.endsWith('.meta.json')) {
        const assetPath = relativePath.replace('.meta.json', '')
        upsertAsset(assetPath)
        indexAsset(assetPath).catch(() => { /* non-blocking */ })
      } else {
        upsertAsset(relativePath)
        indexAsset(relativePath).catch(() => { /* non-blocking */ })
      }
    })

    // ─── REST API Routes ───────────────────────────────────────────────

    // GET /search — search assets via Antfly
    ctx.registerRoute({
      path: '/search',
      method: 'GET',
      description: 'Search assets',
      handler: async (req: Request) => {
        const url = new URL(req.url, 'http://localhost')
        const q = url.searchParams.get('q')
        if (!q) return Response.json({ error: 'Missing ?q= parameter' }, { status: 400 })
        const result = await ctx.search.query({
          q,
          limit: Number(url.searchParams.get('limit')) || undefined,
          offset: Number(url.searchParams.get('offset')) || undefined,
          facets: url.searchParams.get('facets')?.split(',').filter(Boolean),
        })
        return Response.json(result)
      },
    })

    // GET / — list assets with filters
    ctx.registerRoute({ path: '/', method: 'GET', description: 'List assets with filters', handler: handleList })

    // POST /upload — multipart file upload
    ctx.registerRoute({
      path: '/upload',
      method: 'POST',
      description: 'Upload asset files',
      handler: async (req: Request) => {
        const res = await handleUpload(req, ctx)
        if (res.ok) {
          try {
            const clone = await res.clone().json()
            if (clone.saved && Array.isArray(clone.saved)) {
              for (const saved of clone.saved) {
                if (saved.path) indexAsset(saved.path).catch(() => {})
              }
            }
          } catch { /* index best-effort */ }
        }
        return res
      },
    })

    // GET /file — serve asset file for rendering
    ctx.registerRoute({ path: '/file', method: 'GET', description: 'Serve asset file', handler: handleFile })

    // DELETE / — soft-delete an asset (path passed as ?path= query param)
    ctx.registerRoute({
      path: '/',
      method: 'DELETE',
      description: 'Soft-delete an asset',
      handler: async (req: Request) => {
        const url = new URL(req.url, 'http://localhost')
        const assetPath = url.searchParams.get('path') || ''
        const res = await handleDelete(req)
        if (res.ok) {
          ctx.activity.audit('deleted', 'system')
          ctx.activity.log('system', 'Asset deleted')
          if (assetPath) ctx.search.remove(assetPath).catch(() => {})
        }
        return res
      },
    })

    // PATCH /link — relink or unlink an asset from a task
    ctx.registerRoute({
      path: '/link',
      method: 'PATCH',
      description: 'Relink or unlink an asset',
      handler: async (req: Request) => {
        const res = await handleLink(req)
        const data = await res.clone().json()
        if (data.ok) {
          ctx.activity.audit('asset.relinked', 'user', { oldPath: data.oldPath, newPath: data.newPath })
          ctx.activity.log('user', `Relinked asset to ${data.newPath || '_unlinked'}`)
          if (data.oldPath) ctx.search.remove(data.oldPath).catch(() => {})
          if (data.newPath) indexAsset(data.newPath).catch(() => {})
        }
        return res
      },
    })

    // GET /trash — list trashed assets
    ctx.registerRoute({ path: '/trash', method: 'GET', description: 'List trashed assets', handler: handleListTrash })

    // POST /trash/:file/restore — restore a trashed asset
    ctx.registerRoute({
      path: '/trash/:file/restore',
      method: 'POST',
      description: 'Restore a trashed asset',
      handler: async (req: Request) => {
        const res = await handleRestore(req)
        if (res.ok) {
          ctx.activity.audit('restored', 'system')
          ctx.activity.log('system', 'Asset restored from trash')
          try {
            const data = await res.clone().json()
            if (data.restoredPath) indexAsset(data.restoredPath).catch(() => {})
          } catch { /* index best-effort */ }
        }
        return res
      },
    })

    // DELETE /trash — empty entire trash
    ctx.registerRoute({
      path: '/trash',
      method: 'DELETE',
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

    // DELETE /trash/:file — permanently delete a trashed asset
    ctx.registerRoute({
      path: '/trash/:file',
      method: 'DELETE',
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
      label: 'Listed assets',
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
      name: 'bakin_exec_assets_get',
      label: 'Read asset details',
      description: 'Retrieve a single asset\'s sidecar metadata by path.',
      parameters: {
        path: z.string().describe('Asset path relative to content dir (e.g. "assets/images/task123/file.png")'),
      },
      handler: async (params: Record<string, unknown>) => {
        const assetPath = params.path as string
        if (!assetPath || assetPath.includes('..') || !assetPath.startsWith('assets/')) {
          return { ok: false, error: 'Invalid asset path' }
        }
        const contentDir = getContentDir()
        const fullPath = join(contentDir, assetPath)
        if (!existsSync(fullPath)) {
          return { ok: false, error: 'Asset not found' }
        }
        const sidecarPath = getSidecarPath(fullPath)
        if (!existsSync(sidecarPath)) {
          return { ok: true, asset: { path: assetPath, sidecar: null } }
        }
        try {
          const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf-8'))
          return { ok: true, asset: { path: assetPath, ...sidecar } }
        } catch (err) {
          return { ok: false, error: `Failed to read sidecar: ${(err as Error).message}` }
        }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_assets_save',
      label: 'Saved an asset',
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
        if (result.ok && result.path) indexAsset(result.path as string).catch(() => {})
        return result
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_assets_delete',
      label: 'Deleted an asset',
      activityDuplicate: true,
      description: 'Soft-delete an asset (moves to trash with 30-day expiry).',
      parameters: {
        path: z.string().describe('Asset path relative to content dir (e.g. "assets/images/task123/file.png")'),
      },
      handler: async (params: Record<string, unknown>, agent: string) => {
        const assetPath = params.path as string
        if (!assetPath || assetPath.includes('..') || !assetPath.startsWith('assets/')) {
          return { ok: false, error: 'Invalid asset path' }
        }
        const contentDir = getContentDir()
        const fullPath = join(contentDir, assetPath)
        const assetsRoot = join(contentDir, 'assets')
        const success = softDelete(fullPath, assetsRoot)
        if (!success) return { ok: false, error: 'Failed to delete asset' }
        removeAsset(assetPath)
        ctx.search.remove(assetPath).catch(() => {})
        ctx.activity.audit('asset.deleted', agent, { path: assetPath })
        return { ok: true, trashed: [assetPath] }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_assets_link',
      label: 'Linked an asset',
      activityDuplicate: true,
      description: 'Link an asset to a different task, or unlink it (set taskId to null). Physically moves the file between task directories and updates sidecar metadata.',
      parameters: {
        path: z.string().describe('Asset path relative to content dir (e.g. "assets/images/task123/file.png")'),
        taskId: z.string().nullable().describe('Target task ID, or null to unlink'),
      },
      handler: async (params: Record<string, unknown>, agent: string) => {
        const result = relinkAsset({
          assetPath: params.path as string,
          newTaskId: (params.taskId as string | null) ?? null,
        })
        if (result.ok) {
          ctx.activity.audit('asset.relinked', agent, { oldPath: result.oldPath, newPath: result.newPath })
          if (result.oldPath) ctx.search.remove(result.oldPath as string).catch(() => {})
          if (result.newPath) indexAsset(result.newPath as string).catch(() => {})
        }
        return result
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_assets_list_trash',
      label: 'Listed trashed assets',
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
      label: 'Restored an asset',
      description: 'Restore a trashed asset back to its original location. Use bakin_exec_assets_list_trash first to get the filename.',
      parameters: {
        filename: z.string().describe('The trash filename (includes __deleted- suffix)'),
      },
      handler: async (params: Record<string, unknown>, agent: string) => {
        const filename = params.filename as string
        const assetsRoot = join(getContentDir(), 'assets')
        const restoredPath = await restoreAsset(filename, assetsRoot)
        if (!restoredPath) return { ok: false, error: 'Failed to restore asset — file may not exist in trash' }
        indexAsset(restoredPath).catch(() => {})
        return { ok: true, restoredPath }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_assets_audit',
      label: 'Audited assets',
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

    ctx.registerExecTool({
      name: 'bakin_exec_assets_empty_trash',
      label: 'Emptied asset trash',
      activityDuplicate: true,
      description: 'Permanently delete all items from trash. This cannot be undone.',
      parameters: {},
      handler: async (_params: Record<string, unknown>, agent: string) => {
        const assetsRoot = join(getContentDir(), 'assets')
        const deleted = emptyTrash(assetsRoot)
        ctx.activity.audit('assets.trash.emptied', agent, { deleted })
        return { ok: true, deleted }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_assets_permanent_delete',
      label: 'Permanently deleted an asset',
      activityDuplicate: true,
      description: 'Permanently delete a specific trashed asset. This cannot be undone.',
      parameters: {
        filename: z.string().describe('The trash filename (includes __deleted- suffix)'),
      },
      handler: async (params: Record<string, unknown>, agent: string) => {
        const filename = params.filename as string
        if (!filename || filename.includes('/') || filename.includes('..')) {
          return { ok: false, error: 'Invalid filename' }
        }
        const assetsRoot = join(getContentDir(), 'assets')
        const success = permanentDelete(filename, assetsRoot)
        if (!success) return { ok: false, error: 'Failed to permanently delete — file may not exist in trash' }
        ctx.activity.audit('assets.trash.permanent_delete', agent, { filename })
        return { ok: true }
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
