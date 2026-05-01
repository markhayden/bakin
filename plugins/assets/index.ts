/**
 * Assets plugin — server entry point.
 * Registers API routes, MCP exec tools, and cross-plugin hooks for asset management.
 */
import { execSync } from 'child_process'
import { existsSync, readdirSync, statSync, readFileSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'
import type { BakinPlugin, PluginContext } from '@bakin/core/plugin-types'
import { handleList } from './routes/list'
import { handleFile } from './routes/file'
import { handleDelete } from './routes/delete'
import { handleUpload } from './routes/upload'
import { handleListTrash } from './routes/list-trash'
import { handleRestore } from './routes/restore'
import { handlePermanentDelete } from './routes/permanent-delete'
import { handleEmptyTrash } from './routes/empty-trash'
import { handleLink } from './routes/link'
import { handleRetype } from './routes/retype'
import { handleContent } from './routes/content'
import { relinkAsset } from './lib/relink'
import { retypeAsset } from './lib/retype'
import { buildIndex, upsertAsset, removeAsset, detectVariant, listAssets } from './lib/asset-index'
import { validateSidecar, getSidecarPath, createStub } from './lib/sidecar'
import { isSafeCanonicalFilename, pathForFilename } from './lib/path-for-filename'
import { ASSET_TYPES } from './lib/constants'
import { listTrash, restoreAsset, emptyTrash, permanentDelete, softDelete, type TrashedAsset } from './lib/trash'
import { saveAsset } from './lib/save-asset'
import { ingestInboxFile, ingestInboxDir } from './lib/ingest-inbox'
import { getContentDir } from '../../src/core/content-dir'
import { createLogger } from '../../src/core/logger'
import { buildAssetFileUrl } from './lib/asset-url'
import { canExtractAssetContent, extractAssetContent } from './lib/content-extractor'
import { checkAssets } from './lib/health-checks'

/** Filename is the canonical identity under the filename-as-identity model. */
function filenameFromRel(relPath: string): string {
  return relPath.split('/').pop() || ''
}

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

    ctx.search.registerFileBackedContentType({
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
        // `content` is populated server-side by extractAssetContent:
        // plain text for .md/.txt/.json/.csv/.yaml, pdf-parse output for
        // .pdf, empty for everything else. Bakin owns extraction so the
        // search adapter receives plain document text instead of reaching
        // back into local files during indexing.
        content: { type: 'text' },
        // `image_url` is a file:// URL for raster images that CLIP can
        // actually decode. Populated at index time by computeMediaUrls.
        // The search adapter owns provider-specific media dereferencing.
        image_url: { type: 'keyword' },
      },
      searchableFields: ['description', 'tags', 'file_name', 'content'],
      // Intentionally no `rerankField`. bakin_assets is a multimodal table
      // (PDF body text in `content`, image pixels in the visual index,
      // metadata in description/tags/file_name) and the cross-encoder
      // reranker only scores against ONE field at a time. Every choice
      // creates inversions on some content category. Raw RRF fusion of
      // Bleve + text embeddings + visual embeddings gives the right order
      // without the reranker. See .claude/knowledge/search-system.md for
      // the full rationale and the queries that surfaced the problem.
      // Unused when `indexes` is set, but the type requires it. Kept as the
      // equivalent template for the default-index synthesis path.
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
          mediaUrlField: 'image_url',
        },
      ],
      facets: ['asset_type', 'agent', 'tool'],
      // Sidecar/binary pairing means the default file→doc flow doesn't fit
      // cleanly: a sync may be triggered by either the binary or its
      // .meta.json sibling, and we need to keep an in-memory tracker
      // (asset-index) in lockstep with the search index. Escape hatches
      // (onSync / onUnlink) take full ownership of the watcher events.
      filePatterns: [
        {
          pattern: 'assets/**/*',
          // Under filename-as-identity, the search key IS the filename. The
          // on-disk path is a view and changes under retype/relink, but the
          // filename is stable. Variants (.thumb, .opt) never get their own
          // search doc — they ride with their primary.
          fileToId: (rel) => {
            const bare = rel.endsWith('.meta.json') ? rel.replace(/\.meta\.json$/, '') : rel
            const filename = bare.split('/').pop() || ''
            if (!filename) return null
            if (detectVariant(filename)) return null
            return filename
          },
          fileToDoc: async () => null, // unused — onSync handles indexing
        },
      ],
      excludePatterns: ['assets/**/.trash/**'],
      onSync: async (relativePath: string) => {
        if (!relativePath.startsWith('assets/')) return
        if (relativePath.includes('.trash/')) return

        // Intercept inbox drops: canonicalize, move to store/, write a stub
        // sidecar. The subsequent onSync for the destination path does the
        // normal index/search upsert.
        if (relativePath.startsWith('assets/inbox/') && !relativePath.endsWith('.meta.json')) {
          const result = ingestInboxFile(relativePath)
          if (result.ok) {
            ctx.activity.log('user', `Ingested "${result.filename}" from inbox`)
            ctx.activity.audit('asset.ingested', 'user', { filename: result.filename, path: result.path })
          } else if (result.error) {
            log.warn('Inbox ingestion failed', { path: relativePath, error: result.error })
          }
          return
        }

        const assetPath = relativePath.endsWith('.meta.json')
          ? relativePath.replace(/\.meta\.json$/, '')
          : relativePath
        upsertAsset(assetPath)
        await indexAsset(assetPath).catch(() => { /* non-blocking */ })
      },
      onUnlink: async (relativePath: string) => {
        if (!relativePath.startsWith('assets/')) return
        if (relativePath.includes('.trash/')) return
        // Sidecar deletion alone doesn't remove the asset — the binary
        // may still exist on disk and remain searchable with stub
        // metadata. Only treat binary deletion as removal.
        if (relativePath.endsWith('.meta.json')) return

        const filename = filenameFromRel(relativePath)
        if (!filename || detectVariant(filename)) {
          removeAsset(relativePath)
          return
        }

        removeAsset(relativePath)
        // Under filename-as-identity, the path is a pure function of the
        // filename — retype/relink never move files, so an unlink on the
        // binary means the asset is truly gone. No filename-existence
        // check needed.
        await ctx.search.remove(filename).catch(() => { /* non-blocking */ })
      },
      reindex: async function* () {
        const contentDir = getContentDir()
        const assetsRoot = join(contentDir, 'assets')
        const storeRoot = join(assetsRoot, 'store')
        if (!existsSync(storeRoot)) return

        let months: string[]
        try {
          months = readdirSync(storeRoot).filter(m => {
            if (m.startsWith('.')) return false
            try { return statSync(join(storeRoot, m)).isDirectory() } catch { return false }
          })
        } catch { return }

        for (const month of months) {
          const monthDir = join(storeRoot, month)
          let files: string[]
          try { files = readdirSync(monthDir).filter(f => f.endsWith('.meta.json')) } catch { continue }
          for (const metaFile of files) {
            const metaPath = join(monthDir, metaFile)
            try {
              const raw = JSON.parse(readFileSync(metaPath, 'utf-8'))
              const assetFilename = metaFile.replace('.meta.json', '')
              const key = `assets/store/${month}/${assetFilename}`
              // Type in the sidecar is authoritative; the fallback only
              // covers corrupt sidecars that predate strict validation.
              const doc = await assetToSearchDoc(raw, assetFilename, 'other', key)
              yield { key, doc }
            } catch { /* skip unreadable sidecars */ }
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
     * that CLIP can actually decode get a URL. SVG and ICO are excluded
     * because the visual embedder needs raster pixel data.
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
      // assetRelPath is `assets/store/{YYYY-MM}/{file}` (the registry key).
      // Strip the leading `assets/` to get the path relative to the assets
      // root, which is what buildAssetFileUrl expects.
      const rel = assetRelPath.replace(/^assets\//, '')
      // Sidecar `type` is authoritative; `assetType` is the filename-extension
      // fallback supplied by the store scanner.
      const metaType = typeof meta.type === 'string' && meta.type
        ? (meta.type as string)
        : assetType
      const image_url = computeImageUrl(rel, filename, metaType)
      const absPath = join(getContentDir(), assetRelPath)
      const content = await extractAssetContent(absPath, filename)
      return {
        description: (meta.description as string) || '',
        tags: Array.isArray(meta.tags) ? (meta.tags as string[]).join(', ') : '',
        agent: (meta.agent as string) || '',
        task_id: (meta.taskId as string) || '',
        asset_type: metaType,
        file_name: filename,
        tool: (meta.tool as string) || '',
        updated_at: (meta.created as string) || new Date().toISOString(),
        content,
        image_url,
      }
    }

    /** Index an asset by reading its sidecar metadata. Keyed by filename. */
    async function indexAsset(relPath: string): Promise<void> {
      try {
        const contentDir = getContentDir()
        const metaPath = join(contentDir, relPath + '.meta.json')
        if (!existsSync(metaPath)) return
        const filename = filenameFromRel(relPath)
        if (!filename || detectVariant(filename)) return
        const raw = JSON.parse(readFileSync(metaPath, 'utf-8'))
        const parts = relPath.split('/')
        const assetType = parts[1] || 'other'
        const doc = await assetToSearchDoc(raw, filename, assetType, relPath)
        // Upsert by filename — retype/relink update doc contents while the
        // key stays stable, so no remove-then-reindex churn is needed.
        await ctx.search.index(filename, doc)
      } catch (err) {
        log.warn('Failed to index asset for search', { path: relPath, error: err instanceof Error ? err.message : String(err) })
      }
    }

    // ─── Cross-Plugin Hooks ────────────────────────────────────────────

    ctx.hooks.register('assets.validateSidecar', (d: Record<string, unknown>) => validateSidecar(d.metaPath as string), { label: 'Validate sidecar metadata.', summary: 'Checks an asset sidecar JSON file and returns validation details. Use it before trusting metadata created by imports, repairs, or external tools.', hookKind: 'rpc' })
    ctx.hooks.register('assets.getSidecarPath', (d: Record<string, unknown>) => getSidecarPath(d.assetPath as string), { label: 'Get sidecar path.', summary: 'Resolves the metadata sidecar path for a managed asset file. Use it when another plugin has an asset path and needs to read or write the matching metadata.', hookKind: 'rpc' })
    ctx.hooks.register('assets.createStub', (d: Record<string, unknown>) => createStub(d.assetPath as string), { label: 'Create sidecar stub.', summary: 'Creates a starter sidecar for an asset file and returns the written metadata. Use it when adopting a file into Bakin-managed asset state.', hookKind: 'rpc' })
    ctx.hooks.register('assets.detectVariant', (d: Record<string, unknown>) => detectVariant(d.filename as string), { label: 'Detect asset variant.', summary: 'Infers the asset variant represented by a filename, such as before, after, or reference. Use it to keep imported assets grouped and labeled consistently.', hookKind: 'rpc' })
    ctx.hooks.register('assets.getAssetTypes', () => ASSET_TYPES, { label: 'List asset types.', summary: 'Returns the asset type definitions known to the assets plugin. Use it to build filters, upload forms, or validation messages that match Bakin asset categories.', hookKind: 'rpc' })
    ctx.hooks.register('assets.pathForFilename', (d: Record<string, unknown>) => pathForFilename(d.filename as string), { label: 'Resolve asset path.', summary: 'Calculates the managed asset path for a filename. Use it when a plugin needs to place or reference a file using Bakin asset storage conventions.', hookKind: 'rpc' })

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
          ctx.search.remove(asset.filename).catch(() => {})
          purged++
        }
      }

      if (purged > 0) {
        log.info(`Purged ${purged} clipboard asset(s) for completed task ${taskId}`)
        ctx.activity.log('system', `Purged ${purged} clipboard asset(s) for task ${taskId}`)
      }
      return { purged }
    }, { label: 'Purge task clipboard assets.', summary: 'Deletes clipboard-sourced assets associated with a completed task when that cleanup setting is enabled. Use it from task completion flows that want asset cleanup to stay centralized.', hookKind: 'rpc' })
    ctx.hooks.register('assets.trash.list', (d: Record<string, unknown>) => listTrash(d.assetsRoot as string), { label: 'List trashed assets.', summary: 'Returns soft-deleted assets currently available for restore or permanent removal. Use it to power trash views without duplicating filesystem conventions.', hookKind: 'rpc' })
    ctx.hooks.register('assets.restoreAsset', (d: Record<string, unknown>) => restoreAsset(d.trashFilename as string, d.assetsRoot as string), { label: 'Restore trashed asset.', summary: 'Restores one soft-deleted asset from the trash back into managed asset storage. Use it when a plugin needs undo behavior for asset deletion.', hookKind: 'rpc' })
    ctx.hooks.register('assets.emptyTrash', (d: Record<string, unknown>) => emptyTrash(d.assetsRoot as string), { label: 'Empty asset trash.', summary: 'Permanently removes every asset currently in trash for the provided asset root. Use it for explicit cleanup actions where restore is no longer expected.', hookKind: 'rpc' })

    // Drain the inbox first — anything a user dropped while the watcher
    // wasn't running gets canonicalized into store/ before the index is
    // built, so those assets appear in the first listing.
    try {
      const ingested = ingestInboxDir()
      const succeeded = ingested.filter(r => r.ok)
      if (succeeded.length > 0) {
        log.info('Ingested inbox drops on startup', { count: succeeded.length })
      }
    } catch (err) {
      log.warn('Inbox startup scan failed', err)
    }

    // Build the in-memory tracker on startup. (Search index reconcile is
    // owned by registerFileBackedContentType above and runs separately.)
    buildIndex()

    // ─── REST API Routes ───────────────────────────────────────────────

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

    // DELETE / — soft-delete an asset by canonical filename
    ctx.registerRoute({
      path: '/',
      method: 'DELETE',
      description: 'Soft-delete an asset',
      handler: async (req: Request) => {
        const url = new URL(req.url, 'http://localhost')
        const filename = url.searchParams.get('filename') || ''
        const res = await handleDelete(req)
        if (res.ok) {
          ctx.activity.audit('deleted', 'system')
          ctx.activity.log('system', 'Asset deleted')
          if (filename) ctx.search.remove(filename).catch(() => {})
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
          ctx.activity.audit('asset.relinked', 'user', { filename: data.filename, newTaskId: data.newTaskId })
          ctx.activity.log('user', `Relinked asset ${data.filename} to ${data.newTaskId ?? '(unlinked)'}`)
          // Metadata-only — file stays put; just reindex the search doc to
          // pick up the new taskId under the same filename key.
          if (data.path) indexAsset(data.path).catch(() => {})
        }
        return res
      },
    })

    // PATCH /retype — change asset type
    ctx.registerRoute({
      path: '/retype',
      method: 'PATCH',
      description: 'Change asset type classification',
      handler: async (req: Request) => {
        const res = await handleRetype(req)
        const data = await res.clone().json()
        if (data.ok) {
          ctx.activity.audit('asset.retyped', 'user', { filename: data.filename, newType: data.newType })
          ctx.activity.log('user', `Retyped asset ${data.filename} to ${data.newType}`)
          // Metadata-only — see /link for rationale.
          if (data.path) indexAsset(data.path).catch(() => {})
        }
        return res
      },
    })

    // PUT /content — update text content of an editable asset
    ctx.registerRoute({
      path: '/content',
      method: 'PUT',
      description: 'Update text content of an editable asset',
      handler: async (req: Request) => {
        const res = await handleContent(req)
        try {
          const data = await res.clone().json()
          if (data.ok && data.path) indexAsset(data.path as string).catch(() => {})
        } catch { /* best-effort reindex */ }
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

    const TYPE_RUBRIC = [
      'Asset type — determines how the asset is organized and displayed:',
      '- text: Written content — articles, summaries, copy, notes',
      '- research: Research materials, analysis, reference docs, competitive intel',
      '- plans: Strategic plans, roadmaps, workflows, project specs',
      '- images: Visual assets — photos, illustrations, graphics',
      '- video: Video files — walkthroughs, demos, reels',
      '- audio: Audio files — podcasts, recordings, music',
      '- pdf: PDF documents — reports, whitepapers, manuals',
      '- data: Structured data — JSON, CSV, XML exports',
      '- other: Anything that doesn\'t fit above',
      '',
      'When unsure: if it informs future decisions, use research. If it\'s a deliverable, use text. If it describes what to do, use plans.',
    ].join('\n')

    ctx.registerExecTool({
      name: 'bakin_exec_assets_list',
      label: 'Listed assets',
      description: 'List assets with optional type filter. Returns asset count, canonical filenames, and metadata.',
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
      description: 'Retrieve a single asset\'s sidecar metadata by canonical filename.',
      parameters: {
        filename: z.string().describe('Canonical asset filename (e.g. "20260401-hero-a1b2c3d4.png")'),
      },
      handler: async (params: Record<string, unknown>) => {
        const filename = typeof params.filename === 'string' ? params.filename : ''
        if (!isSafeCanonicalFilename(filename)) return { ok: false, error: 'Invalid filename' }
        const assetPath = pathForFilename(filename)
        if (!assetPath) return { ok: false, error: 'Invalid filename' }
        const contentDir = getContentDir()
        const fullPath = join(contentDir, assetPath)
        if (!existsSync(fullPath)) {
          return { ok: false, error: 'Asset not found' }
        }
        const sidecarPath = getSidecarPath(fullPath)
        if (!existsSync(sidecarPath)) {
          return { ok: true, asset: { filename, path: assetPath, sidecar: null } }
        }
        try {
          const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf-8'))
          return { ok: true, asset: { filename, path: assetPath, ...sidecar } }
        } catch (err) {
          return { ok: false, error: `Failed to read sidecar: ${(err as Error).message}` }
        }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_assets_open',
      label: 'Opened an asset',
      description: 'Open an attached asset by canonical filename. Returns sidecar metadata plus extracted text for text-like assets; non-extractable assets return metadata-only status.',
      parameters: {
        filename: z.string().describe('Canonical asset filename (e.g. "20260401-hero-a1b2c3d4.png")'),
      },
      handler: async (params: Record<string, unknown>) => {
        const filename = typeof params.filename === 'string' ? params.filename : ''
        if (!isSafeCanonicalFilename(filename)) return { ok: false, error: 'Invalid filename' }
        const assetPath = pathForFilename(filename)
        if (!assetPath) return { ok: false, error: 'Invalid filename' }

        const contentDir = getContentDir()
        const fullPath = join(contentDir, assetPath)
        if (!existsSync(fullPath)) return { ok: false, error: 'Asset not found' }

        const sidecarPath = getSidecarPath(fullPath)
        let sidecar: Record<string, unknown> | null = null
        if (existsSync(sidecarPath)) {
          try {
            sidecar = JSON.parse(readFileSync(sidecarPath, 'utf-8'))
          } catch (err) {
            return { ok: false, error: `Failed to read sidecar: ${(err as Error).message}` }
          }
        }

        if (!canExtractAssetContent(filename)) {
          return {
            ok: true,
            asset: {
              filename,
              path: assetPath,
              sidecar,
              content: {
                mode: 'metadata-only',
                available: false,
                text: '',
                note: 'This asset type has no extractable text content; use the metadata or asset preview UI for binary inspection.',
              },
            },
          }
        }

        const text = await extractAssetContent(fullPath, filename)
        return {
          ok: true,
          asset: {
            filename,
            path: assetPath,
            sidecar,
            content: {
              mode: 'text',
              available: text.length > 0,
              text,
            },
          },
        }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_assets_save',
      label: 'Saved an asset',
      description: 'Save an agent-created file to the assets directory with standardized naming (YYYYMMDD-slug.ext) and sidecar metadata. Handles directory creation, naming conventions, and .meta.json automatically.',
      parameters: {
        filePath: z.string().describe('Absolute path to the source file to save'),
        taskId: z.string().describe('Task ID to record in sidecar metadata'),
        type: z.enum(ASSET_TYPES).describe(TYPE_RUBRIC),
        description: z.string().optional().describe('One-sentence summary visible in the asset grid and search. Be specific — "Q2 blog hero image" not "an image".'),
        tags: z.array(z.string()).optional().describe('Lowercase hyphenated tags for filtering. Use domain tags (social, blog), format tags (draft, final), and project tags.'),
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
      description: 'Soft-delete an asset (moves to trash, restorable until trash is emptied).',
      parameters: {
        filename: z.string().describe('Canonical asset filename (e.g. "20260401-hero-a1b2c3d4.png")'),
      },
      handler: async (params: Record<string, unknown>, agent: string) => {
        const filename = params.filename as string
        if (!isSafeCanonicalFilename(filename)) return { ok: false, error: 'Invalid filename' }
        const assetPath = pathForFilename(filename)
        if (!assetPath) return { ok: false, error: 'Invalid filename' }
        const contentDir = getContentDir()
        const fullPath = join(contentDir, assetPath)
        const assetsRoot = join(contentDir, 'assets')
        if (!existsSync(fullPath)) return { ok: false, error: 'Asset not found' }
        const success = softDelete(fullPath, assetsRoot)
        if (!success) return { ok: false, error: 'Failed to delete asset' }
        removeAsset(assetPath)
        ctx.search.remove(filename).catch(() => {})
        ctx.activity.audit('asset.deleted', agent, { filename, path: assetPath })
        return { ok: true, filename, trashed: [assetPath] }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_assets_link',
      label: 'Linked an asset',
      activityDuplicate: true,
      description: 'Link an asset to a different task, or unlink it (set taskId to null). Sidecar-only edit — no file move.',
      parameters: {
        filename: z.string().describe('Canonical asset filename (e.g. "20260401-hero-a1b2c3d4.png")'),
        taskId: z.string().nullable().describe('Target task ID, or null to unlink'),
      },
      handler: async (params: Record<string, unknown>, agent: string) => {
        const result = relinkAsset({
          filename: params.filename as string,
          newTaskId: (params.taskId as string | null) ?? null,
        })
        if (result.ok) {
          ctx.activity.audit('asset.relinked', agent, { filename: result.filename, newTaskId: result.newTaskId })
          if (result.path) indexAsset(result.path as string).catch(() => {})
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
      handler: async (params: Record<string, unknown>) => {
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

        const storeRoot = join(assetsRoot, 'store')
        if (!existsSync(storeRoot)) {
          return { ok: true, summary: { total: 0, healthy: 0, issues: 0, fixed: 0 }, issues: [] }
        }

        const isAssetFile = (filename: string) => !filename.endsWith('.meta.json') && !filename.startsWith('.')

        let months: string[]
        try {
          months = readdirSync(storeRoot).filter(m => {
            if (m.startsWith('.')) return false
            try { return statSync(join(storeRoot, m)).isDirectory() } catch { return false }
          })
        } catch { months = [] }

        for (const month of months) {
          const monthDir = join(storeRoot, month)
          let files: string[]
          try { files = readdirSync(monthDir).filter(isAssetFile) } catch { continue }

          const allFiles = new Set(files)
          const primaryFiles: string[] = []
          const variantFiles: string[] = []
          for (const file of files) {
            if (detectVariant(file)) variantFiles.push(file)
            else primaryFiles.push(file)
          }

          for (const file of primaryFiles) {
            const fullPath = join(monthDir, file)
            const relPath = `assets/store/${month}/${file}`

            let sidecarType = 'other'
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
                if (typeof raw.type === 'string') sidecarType = raw.type
                if (raw.agent === 'unknown') {
                  issues.push({ path: relPath, issue: 'stub-sidecar', fixed: false })
                }
              } catch { /* already caught by validateSidecar */ }
            }

            if (typeFilter && sidecarType !== typeFilter) continue
            total++

            if (sidecarType === 'images') {
              const dotIdx = file.lastIndexOf('.')
              const stem = dotIdx > 0 ? file.substring(0, dotIdx) : file
              const hasThumb = allFiles.has(`${stem}.thumb.jpg`) || allFiles.has(`${stem}.thumb.jpeg`)
              if (!hasThumb) {
                if (fix) {
                  const thumbPath = join(monthDir, `${stem}.thumb.jpg`)
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
            const relPath = `assets/store/${month}/${file}`
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
            for (const f of readdirSync(monthDir)) {
              if (!f.endsWith('.meta.json')) continue
              const assetName = f.replace('.meta.json', '')
              if (!allFiles.has(assetName)) {
                issues.push({ path: `assets/store/${month}/${f}`, issue: 'orphaned-sidecar', fixed: false })
              }
            }
          } catch { /* skip */ }
        }

        const healthy = total - issues.filter(i => !i.issue.startsWith('orphaned') && !i.fixed).length
        return { ok: true, summary: { total, healthy, issues: issues.length, fixed }, issues }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_assets_retype',
      label: 'Retyped an asset',
      activityDuplicate: true,
      description: 'Change an asset\'s type classification. Sidecar-only edit — no file move.',
      parameters: {
        filename: z.string().describe('Canonical asset filename (e.g. "20260401-hero-a1b2c3d4.png")'),
        type: z.enum(ASSET_TYPES).describe(TYPE_RUBRIC),
      },
      handler: async (params: Record<string, unknown>, agent: string) => {
        const result = retypeAsset({
          filename: params.filename as string,
          newType: params.type as typeof ASSET_TYPES[number],
        })
        if (result.ok) {
          ctx.activity.audit('asset.retyped', agent, { filename: result.filename, newType: result.newType })
          if (result.path) indexAsset(result.path).catch(() => {})
        }
        return result
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_assets_update_content',
      label: 'Updated asset content',
      description: 'Update the text content of an editable asset. Only works for text-based MIME types (markdown, plain text, YAML, JSON, CSV, XML). Rewrites the entire file.',
      parameters: {
        filename: z.string().describe('Canonical asset filename (e.g. "20260401-doc-a1b2c3d4.md")'),
        content: z.string().describe('New file content (replaces entire file)'),
      },
      handler: async (params: Record<string, unknown>, agent: string) => {
        const req = new Request('http://localhost/api/plugins/assets/content', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: params.filename, content: params.content }),
        })
        const res = await handleContent(req)
        const data = await res.json()
        if (data.ok) {
          ctx.activity.audit('asset.content_updated', agent, { filename: params.filename, path: data.path })
          if (data.path) indexAsset(data.path as string).catch(() => {})
        }
        return data
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

    // ─── Health check (migrated out of core/doctor.ts per #139 C3) ──────
    ctx.registerHealthCheck({
      id: 'assets',
      name: 'Asset directory + sidecar integrity',
      autoFix: true,
      run: () => Promise.resolve(checkAssets(getContentDir())),
    })
  },

  async onReady() {
    const contentDir = getContentDir()
    const storeRoot = join(contentDir, 'assets', 'store')
    if (existsSync(storeRoot)) {
      let count = 0
      try {
        for (const month of readdirSync(storeRoot)) {
          if (month.startsWith('.')) continue
          const monthDir = join(storeRoot, month)
          try { if (!statSync(monthDir).isDirectory()) continue } catch { continue }
          count++
        }
      } catch { /* skip */ }
      log.info(`Ready — ${count} month shards under assets/store/`)
    }
  },

  onShutdown() {
    log.info('Shutting down assets plugin')
  },
}

export default assetsPlugin
