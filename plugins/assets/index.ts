/**
 * Assets plugin — server entry point.
 * Registers API routes, MCP exec tools, and cross-plugin hooks for asset management.
 */
import { execSync } from 'child_process'
import { existsSync, readdirSync, statSync, readFileSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'
import type { BakinPlugin, PluginContext } from '@bakin/core/plugin-types'
import { definePlugin, defineRoute, searchRoute } from '@bakin/core/routing'
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
import { resolveAssetServe } from './lib/serve'
import {
  handleVersionedList, handleVersionedGet, handleVersionedPromote,
  handleVersionedDeleteVersion, handleVersionedDeleteAsset, handleVersionedExport,
  handleVersionedRelink,
} from './routes/versioned'
import { isValidAssetId } from './lib/asset-id'
import {
  getAsset, upsertFromSource, resolveFile as resolveVersionedFile,
  listAssets as listVersionedAssets, deleteAsset as deleteVersionedAsset,
  relink as relinkVersioned, retype as retypeVersioned,
  listTrashedAssets, emptyAssetTrash, permanentlyDeleteTrashed, restoreAsset as restoreVersionedAsset,
} from './lib/asset-service'
import { versionedAssetPath, buildVersionedAssetSearchDoc } from './lib/search-doc'
import { ASSET_TYPES, type AssetType } from './lib/constants'
import { listTrash, restoreAsset, emptyTrash, permanentDelete, softDelete, type TrashedAsset } from './lib/trash'
import { saveAsset } from './lib/save-asset'
import { ingestInboxFile, ingestInboxDir } from './lib/ingest-inbox'
import { getContentDir } from '../../src/core/content-dir'
import { createLogger } from '../../src/core/logger'
import { buildAssetFileUrl } from './lib/asset-url'
import { canExtractAssetContent, extractAssetContent } from './lib/content-extractor'
import { assetRepair, checkAssets } from './lib/health-checks'

/** Filename is the canonical identity under the filename-as-identity model. */
function filenameFromRel(relPath: string): string {
  return relPath.split('/').pop() || ''
}

function existingManagedAssetResult(filePath: string): { path: string; metadataPath: string; filename: string; alreadyManaged: true } | null {
  const contentDir = getContentDir()
  const normalizedInput = filePath.trim()
  if (!normalizedInput) return null
  const contentPrefix = `${contentDir}/`
  const relPath = normalizedInput.startsWith(contentPrefix)
    ? normalizedInput.slice(contentPrefix.length)
    : normalizedInput
  if (!relPath.startsWith('assets/store/')) return null
  const filename = filenameFromRel(relPath)
  if (!filename || !isSafeCanonicalFilename(filename)) return null
  if (pathForFilename(filename) !== relPath) return null
  if (!existsSync(join(contentDir, relPath))) return null
  return {
    path: relPath,
    metadataPath: `${relPath}.meta.json`,
    filename,
    alreadyManaged: true,
  }
}

const log = createLogger('assets')

// ─── Module-scope plugin ctx (set during activate) ──────────────────────
let pluginCtx: PluginContext | null = null

// ─── Module-scope helpers ────────────────────────────────────────────────

async function indexAsset(relPath: string): Promise<void> {
  if (!pluginCtx) return
  try {
    const contentDir = getContentDir()
    const metaPath = join(contentDir, relPath + '.meta.json')
    if (!existsSync(metaPath)) return
    const filename = filenameFromRel(relPath)
    if (!filename || detectVariant(filename)) return
    const raw = JSON.parse(readFileSync(metaPath, 'utf-8'))
    const parts = relPath.split('/')
    const assetType = parts[1] || 'other'
    const doc = await assetToSearchDocModule(raw, filename, assetType, relPath)
    await pluginCtx.search.index(filename, doc)
  } catch (err) {
    log.warn('Failed to index asset for search', { path: relPath, error: err instanceof Error ? err.message : String(err) })
  }
}

// ─── Versioned-asset (manifest-driven) search indexing ────────────────────
// One search row per asset, keyed by assetId, built from the CURRENT version.
// Coexists with the legacy filename path below until the cutover (B10).
// versionedAssetPath + buildVersionedAssetSearchDoc live in ./lib/search-doc.

async function indexVersionedAsset(assetId: string): Promise<void> {
  if (!pluginCtx) return
  try {
    const manifest = getAsset(assetId)
    if (!manifest) return
    await pluginCtx.search.index(assetId, await buildVersionedAssetSearchDoc(manifest, assetId))
  } catch (err) {
    log.warn('Failed to index versioned asset for search', { assetId, error: err instanceof Error ? err.message : String(err) })
  }
}

// Module-scope copy of assetToSearchDoc — same shape as the inner version
// inside activate(). Mirrors the inner reindex helper but doesn't close
// over activate-time variables.
async function assetToSearchDocModule(meta: Record<string, unknown>, filename: string, assetType: string, assetRelPath: string): Promise<Record<string, unknown>> {
  const metaType = typeof meta.type === 'string' && meta.type ? (meta.type as string) : assetType
  const absPath = join(getContentDir(), assetRelPath)
  const content = await extractAssetContent(absPath, filename).catch(() => '')
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
  }
}

// ─── Schemas ─────────────────────────────────────────────────────────────

const passthrough = z.object({}).passthrough()
const errorResponse = z.object({ error: z.string() }).passthrough()
const okPassthrough = z.object({ ok: z.boolean() }).passthrough()
const binaryResponse = { contentType: 'application/octet-stream' as const }

// ─── Routes (declarative) ────────────────────────────────────────────────

const routes = [
  defineRoute({
    path: '/',
    method: 'GET',
    summary: 'List assets',
    description: 'List assets with optional filter parameters.',
    responses: { 200: passthrough, 500: errorResponse },
    handler: async (req) => handleList(req),
  }),

  defineRoute({
    path: '/upload',
    method: 'POST',
    summary: 'Upload asset files',
    body: { contentType: 'multipart/form-data' },
    responses: { 200: passthrough, 400: errorResponse, 500: errorResponse },
    // createAsset writes a manifest, which the watcher picks up for reindex +
    // the asset.changed SSE event — no explicit indexing needed here.
    handler: async (req, ctx) => handleUpload(req, ctx as unknown as PluginContext),
  }),

  defineRoute({
    path: '/file',
    method: 'GET',
    summary: 'Serve asset file',
    description: 'Streams an asset file by canonical filename for rendering.',
    responses: {
      200: binaryResponse,
      404: errorResponse,
    },
    handler: async (req) => handleFile(req),
  }),

  defineRoute({
    path: '/',
    method: 'DELETE',
    summary: 'Soft-delete an asset',
    body: { contentType: 'none' },
    responses: { 200: okPassthrough, 404: errorResponse },
    handler: async (req, ctx) => {
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
  }),

  defineRoute({
    path: '/link',
    method: 'PATCH',
    summary: 'Relink or unlink an asset',
    body: passthrough,
    responses: { 200: okPassthrough, 400: errorResponse },
    handler: async (req, ctx) => {
      const res = await handleLink(req)
      const data = await res.clone().json()
      if (data.ok) {
        ctx.activity.audit('asset.relinked', 'user', { filename: data.filename, newTaskId: data.newTaskId })
        ctx.activity.log('user', `Relinked asset ${data.filename} to ${data.newTaskId ?? '(unlinked)'}`)
        if (data.path) indexAsset(data.path).catch(() => {})
      }
      return res
    },
  }),

  defineRoute({
    path: '/retype',
    method: 'PATCH',
    summary: 'Change asset type classification',
    body: passthrough,
    responses: { 200: okPassthrough, 400: errorResponse },
    handler: async (req, ctx) => {
      const res = await handleRetype(req)
      const data = await res.clone().json()
      if (data.ok) {
        ctx.activity.audit('asset.retyped', 'user', { filename: data.filename, newType: data.newType })
        ctx.activity.log('user', `Retyped asset ${data.filename} to ${data.newType}`)
        if (data.path) indexAsset(data.path).catch(() => {})
      }
      return res
    },
  }),

  defineRoute({
    path: '/content',
    method: 'PUT',
    summary: 'Update text content of an editable asset',
    body: passthrough,
    responses: { 200: okPassthrough, 400: errorResponse, 500: errorResponse },
    handler: async (req) => {
      const res = await handleContent(req)
      try {
        const data = await res.clone().json()
        if (data.ok && data.path) indexAsset(data.path as string).catch(() => {})
      } catch { /* best-effort reindex */ }
      return res
    },
  }),

  defineRoute({
    path: '/trash',
    method: 'GET',
    summary: 'List trashed assets',
    responses: { 200: passthrough },
    handler: async (req) => handleListTrash(req),
  }),

  defineRoute({
    path: '/trash/:file/restore',
    method: 'POST',
    summary: 'Restore a trashed asset',
    params: z.object({ file: z.string().min(1) }),
    body: { contentType: 'none' },
    responses: { 200: okPassthrough, 404: errorResponse },
    handler: async (req, ctx) => {
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
  }),

  defineRoute({
    path: '/trash',
    method: 'DELETE',
    summary: 'Empty entire trash',
    body: { contentType: 'none' },
    responses: { 200: okPassthrough },
    handler: async (req, ctx) => {
      const res = await handleEmptyTrash(req)
      if (res.ok) {
        ctx.activity.audit('trash-emptied', 'system')
        ctx.activity.log('system', 'Trash emptied')
      }
      return res
    },
  }),

  defineRoute({
    path: '/trash/:file',
    method: 'DELETE',
    summary: 'Permanently delete a trashed asset',
    params: z.object({ file: z.string().min(1) }),
    body: { contentType: 'none' },
    responses: { 200: okPassthrough, 404: errorResponse },
    handler: async (req, ctx) => {
      const res = await handlePermanentDelete(req)
      if (res.ok) {
        ctx.activity.audit('permanent-deleted', 'system')
        ctx.activity.log('system', 'Asset permanently deleted')
      }
      return res
    },
  }),

  // Versioned (asset-as-directory) routes — power the versioned grid + detail.
  defineRoute({
    path: '/versioned',
    method: 'GET',
    summary: 'List versioned assets',
    responses: { 200: passthrough, 500: errorResponse },
    handler: async (req) => handleVersionedList(req),
  }),
  defineRoute({
    path: '/versioned/:assetId',
    method: 'GET',
    summary: 'Get a versioned asset manifest',
    params: z.object({ assetId: z.string().min(1) }),
    responses: { 200: passthrough, 404: errorResponse },
    handler: async (req) => handleVersionedGet(req),
  }),
  defineRoute({
    path: '/versioned/:assetId/promote',
    method: 'POST',
    summary: 'Promote a version to current',
    params: z.object({ assetId: z.string().min(1) }),
    responses: { 200: okPassthrough, 400: errorResponse },
    handler: async (req) => handleVersionedPromote(req),
  }),
  defineRoute({
    path: '/versioned/:assetId/v/:version',
    method: 'DELETE',
    summary: 'Delete a version',
    params: z.object({ assetId: z.string().min(1), version: z.string().min(1) }),
    body: { contentType: 'none' },
    responses: { 200: okPassthrough, 400: errorResponse },
    handler: async (req) => handleVersionedDeleteVersion(req),
  }),
  defineRoute({
    path: '/versioned/:assetId/export',
    method: 'POST',
    summary: 'Attach a derived export',
    params: z.object({ assetId: z.string().min(1) }),
    responses: { 200: okPassthrough, 400: errorResponse },
    handler: async (req) => handleVersionedExport(req),
  }),
  defineRoute({
    path: '/versioned/:assetId/relink',
    method: 'POST',
    summary: 'Relink an asset to a task (or null)',
    params: z.object({ assetId: z.string().min(1) }),
    responses: { 200: okPassthrough, 400: errorResponse },
    handler: async (req) => handleVersionedRelink(req),
  }),
  defineRoute({
    path: '/versioned/:assetId',
    method: 'DELETE',
    summary: 'Trash a whole versioned asset',
    params: z.object({ assetId: z.string().min(1) }),
    body: { contentType: 'none' },
    responses: { 200: okPassthrough, 400: errorResponse },
    handler: async (req) => handleVersionedDeleteAsset(req),
  }),

  searchRoute({ table: 'assets' }),
]

// ---------------------------------------------------------------------------
// Thumbnail helper for audit tool
// ---------------------------------------------------------------------------

function generateThumbnail(inputPath: string, outputPath: string, widthPx = 400): string | null {
  try {
    execSync(`ffmpeg -i "${inputPath}" -vf "scale=${widthPx}:-1" -q:v 5 -y "${outputPath}"`, { stdio: 'pipe', timeout: 30_000 })
    return outputPath
  } catch { return null }
}

const assetsPlugin: BakinPlugin = definePlugin({
  id: 'assets',
  name: 'Assets',
  version: '2.0.0',
  routes,

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
    pluginCtx = ctx

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

        // Versioned asset: index on manifest write; ignore version/thumb/export
        // files (they ride with the manifest's assetId row).
        const versioned = versionedAssetPath(relativePath)
        if (versioned) {
          if (versioned.isManifest) {
            await indexVersionedAsset(versioned.assetId).catch(() => { /* non-blocking */ })
            // Live UI refresh: any mutation rewrites the manifest.
            ctx.events.emit('asset.changed', { assetId: versioned.assetId })
          }
          return
        }

        // Intercept inbox drops: canonicalize, move to store/, write a stub
        // sidecar. The subsequent onSync for the destination path does the
        // normal index/search upsert.
        if (relativePath.startsWith('assets/inbox/') && !relativePath.endsWith('.meta.json')) {
          const result = await ingestInboxFile(relativePath)
          if (result.ok) {
            ctx.activity.log('user', `Ingested "${result.assetId}" from inbox`)
            ctx.activity.audit('asset.ingested', 'user', { assetId: result.assetId })
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

        // Versioned asset: manifest unlink (dir trashed/removed) removes the row.
        const versioned = versionedAssetPath(relativePath)
        if (versioned) {
          if (versioned.isManifest) {
            await ctx.search.remove(versioned.assetId).catch(() => { /* non-blocking */ })
            ctx.events.emit('asset.removed', { assetId: versioned.assetId })
          }
          return
        }
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

          // Versioned assets: subdirs named by a valid assetId, indexed by their
          // manifest's current version.
          let dirEntries: string[]
          try { dirEntries = readdirSync(monthDir) } catch { dirEntries = [] }
          for (const entry of dirEntries) {
            if (!isValidAssetId(entry)) continue
            const manifest = getAsset(entry)
            if (!manifest) continue
            yield { key: entry, doc: await buildVersionedAssetSearchDoc(manifest, entry) }
          }
        }
      },
      verifyExists: async (key: string) => {
        if (isValidAssetId(key)) return getAsset(key) !== null
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

    // ─── Cross-Plugin Hooks ────────────────────────────────────────────

    ctx.hooks.register('assets.validateSidecar', (d: Record<string, unknown>) => validateSidecar(d.metaPath as string), { label: 'Validate sidecar metadata.', summary: 'Checks an asset sidecar JSON file and returns validation details. Use it before trusting metadata created by imports, repairs, or external tools.', hookKind: 'rpc' })
    ctx.hooks.register('assets.getSidecarPath', (d: Record<string, unknown>) => getSidecarPath(d.assetPath as string), { label: 'Get sidecar path.', summary: 'Resolves the metadata sidecar path for a managed asset file. Use it when another plugin has an asset path and needs to read or write the matching metadata.', hookKind: 'rpc' })
    ctx.hooks.register('assets.createStub', (d: Record<string, unknown>) => createStub(d.assetPath as string), { label: 'Create sidecar stub.', summary: 'Creates a starter sidecar for an asset file and returns the written metadata. Use it when adopting a file into Bakin-managed asset state.', hookKind: 'rpc' })
    ctx.hooks.register('assets.detectVariant', (d: Record<string, unknown>) => detectVariant(d.filename as string), { label: 'Detect asset variant.', summary: 'Infers the asset variant represented by a filename, such as before, after, or reference. Use it to keep imported assets grouped and labeled consistently.', hookKind: 'rpc' })
    ctx.hooks.register('assets.getAssetTypes', () => ASSET_TYPES, { label: 'List asset types.', summary: 'Returns the asset type definitions known to the assets plugin. Use it to build filters, upload forms, or validation messages that match Bakin asset categories.', hookKind: 'rpc' })
    ctx.hooks.register('assets.pathForFilename', (d: Record<string, unknown>) => pathForFilename(d.filename as string), { label: 'Resolve asset path.', summary: 'Calculates the managed asset path for a filename. Use it when a plugin needs to place or reference a file using Bakin asset storage conventions.', hookKind: 'rpc' })
    ctx.hooks.register('assets.resolveServe', (d: Record<string, unknown>) => resolveAssetServe((d.segments as string[]) ?? []), { label: 'Resolve versioned asset serve request.', summary: 'Resolves an /api/assets/<assetId> path (current, /v/<n>, /thumb, /export/<name>) to a file on disk for serving. Returns match:false for non-assetId (legacy filename) requests so the host can fall back.', hookKind: 'rpc' })

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

      // Versioned assets: trash whole assets whose source is clipboard.
      for (const summary of listVersionedAssets({ taskId })) {
        const manifest = getAsset(summary.assetId)
        if (manifest?.source?.kind !== 'clipboard') continue
        try {
          await deleteVersionedAsset(summary.assetId) // onUnlink removes from search + emits
          purged++
        } catch (err) {
          log.warn('Failed to purge clipboard asset', { assetId: summary.assetId, error: err instanceof Error ? err.message : String(err) })
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
    ingestInboxDir()
      .then(ingested => {
        const succeeded = ingested.filter(r => r.ok)
        if (succeeded.length > 0) log.info('Ingested inbox drops on startup', { count: succeeded.length })
      })
      .catch(err => log.warn('Inbox startup scan failed', err))

    // Build the in-memory tracker on startup. (Search index reconcile is
    // owned by registerFileBackedContentType above and runs separately.)
    buildIndex()

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
      description: 'List managed assets (one entry per asset, current-version view). Optional type filter.',
      parameters: { type: z.enum(ASSET_TYPES).optional().describe('Filter by asset type') },
      handler: async (params: Record<string, unknown>) => {
        const assets = listVersionedAssets(params.type ? { type: params.type as AssetType } : undefined)
        return { ok: true, count: assets.length, assets }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_assets_get',
      label: 'Read asset details',
      description: 'Retrieve an asset manifest (versions, current pointer, exports) by assetId.',
      parameters: { assetId: z.string().describe('Asset id, e.g. "20260401-hero-a1b2c3d4"') },
      handler: async (params: Record<string, unknown>) => {
        const assetId = params.assetId as string
        if (!isValidAssetId(assetId)) return { ok: false, error: 'Invalid assetId' }
        const asset = getAsset(assetId)
        return asset ? { ok: true, asset } : { ok: false, error: 'Asset not found' }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_assets_open',
      label: 'Opened an asset',
      description: 'Open an asset by assetId: returns its manifest plus the current version’s extracted text for text-like assets.',
      parameters: { assetId: z.string().describe('Asset id') },
      handler: async (params: Record<string, unknown>) => {
        const assetId = params.assetId as string
        if (!isValidAssetId(assetId)) return { ok: false, error: 'Invalid assetId' }
        const asset = getAsset(assetId)
        if (!asset) return { ok: false, error: 'Asset not found' }
        const ref = resolveVersionedFile(assetId)
        let content = ''
        if (ref) content = await extractAssetContent(ref.absPath, ref.absPath.split('/').pop() || '').catch(() => '')
        return { ok: true, asset, content }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_assets_save',
      label: 'Saved an asset',
      description: 'Save an agent-created file as a managed, versioned asset. Re-saving the SAME source file appends a new version to the existing asset (or no-ops if unchanged) instead of creating a duplicate — so an evolving doc stays one asset with a version history. Returns the asset id.',
      parameters: {
        filePath: z.string().describe('Absolute path to the source file to save. Re-saving the same path versions the existing asset.'),
        taskId: z.string().describe('Task ID to link the asset.'),
        type: z.enum(ASSET_TYPES).describe(TYPE_RUBRIC),
        description: z.string().optional().describe('One-sentence summary visible in the asset grid and search. Be specific.'),
        tags: z.array(z.string()).optional().describe('Lowercase hyphenated tags for filtering.'),
        tool: z.string().optional().describe('Tool used to generate or import the asset.'),
        slug: z.string().optional().describe('Custom slug for the asset id. Auto-derived from source filename if omitted.'),
      },
      handler: async (params: Record<string, unknown>, agent: string) => {
        const filePath = typeof params.filePath === 'string' ? params.filePath : ''
        if (!filePath) return { ok: false, error: 'filePath is required' }
        try {
          const r = await upsertFromSource(filePath, {
            sourceFilePath: filePath, type: params.type as AssetType, agent,
            taskId: (params.taskId as string) ?? null, slug: params.slug as string | undefined,
            op: 'upload', tool: (params.tool as string) ?? null,
            description: params.description as string | undefined, tags: params.tags as string[] | undefined,
          })
          ctx.activity.audit(r.changed ? 'asset.saved' : 'asset.unchanged', agent, { assetId: r.assetId, version: r.version })
          return { ok: true, assetId: r.assetId, version: r.version, changed: r.changed }
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) }
        }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_assets_delete',
      label: 'Deleted an asset',
      activityDuplicate: true,
      description: 'Soft-delete a whole asset (all versions) to trash, restorable until trash is emptied.',
      parameters: { assetId: z.string().describe('Asset id') },
      handler: async (params: Record<string, unknown>, agent: string) => {
        const assetId = params.assetId as string
        if (!isValidAssetId(assetId)) return { ok: false, error: 'Invalid assetId' }
        try {
          const { trashName } = await deleteVersionedAsset(assetId)
          ctx.activity.audit('asset.deleted', agent, { assetId })
          return { ok: true, assetId, trashName }
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) }
        }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_assets_link',
      label: 'Linked an asset',
      activityDuplicate: true,
      description: 'Link an asset to a different task, or unlink it (set taskId to null).',
      parameters: {
        assetId: z.string().describe('Asset id'),
        taskId: z.string().nullable().describe('Target task ID, or null to unlink'),
      },
      handler: async (params: Record<string, unknown>, agent: string) => {
        const assetId = params.assetId as string
        if (!isValidAssetId(assetId)) return { ok: false, error: 'Invalid assetId' }
        try {
          await relinkVersioned(assetId, (params.taskId as string | null) ?? null)
          ctx.activity.audit('asset.relinked', agent, { assetId, newTaskId: (params.taskId as string | null) ?? null })
          return { ok: true, assetId }
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) }
        }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_assets_retype',
      label: 'Retyped an asset',
      activityDuplicate: true,
      description: 'Change an asset type classification.',
      parameters: {
        assetId: z.string().describe('Asset id'),
        type: z.enum(ASSET_TYPES).describe(TYPE_RUBRIC),
      },
      handler: async (params: Record<string, unknown>, agent: string) => {
        const assetId = params.assetId as string
        if (!isValidAssetId(assetId)) return { ok: false, error: 'Invalid assetId' }
        try {
          await retypeVersioned(assetId, params.type as AssetType)
          ctx.activity.audit('asset.retyped', agent, { assetId, newType: params.type })
          return { ok: true, assetId }
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) }
        }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_assets_list_trash',
      label: 'Listed trashed assets',
      description: 'List trashed assets (whole-asset deletions) with deletion time and version count.',
      parameters: {},
      handler: async () => {
        const items = listTrashedAssets()
        return { ok: true, count: items.length, items }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_assets_restore',
      label: 'Restored an asset',
      description: 'Restore a trashed asset by its trash name (from bakin_exec_assets_list_trash).',
      parameters: { trashName: z.string().describe('Trash name (includes __deleted- suffix)') },
      handler: async (params: Record<string, unknown>, agent: string) => {
        try {
          const { assetId } = restoreVersionedAsset(params.trashName as string)
          ctx.activity.audit('asset.restored', agent, { assetId })
          return { ok: true, assetId }
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) }
        }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_assets_empty_trash',
      label: 'Emptied asset trash',
      activityDuplicate: true,
      description: 'Permanently delete all trashed assets. This cannot be undone.',
      parameters: {},
      handler: async (_params: Record<string, unknown>, agent: string) => {
        const deleted = emptyAssetTrash()
        ctx.activity.audit('assets.trash.emptied', agent, { deleted })
        return { ok: true, deleted }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_assets_permanent_delete',
      label: 'Permanently deleted an asset',
      activityDuplicate: true,
      description: 'Permanently delete a specific trashed asset. This cannot be undone.',
      parameters: { trashName: z.string().describe('Trash name (includes __deleted- suffix)') },
      handler: async (params: Record<string, unknown>, agent: string) => {
        const ok = permanentlyDeleteTrashed(params.trashName as string)
        if (!ok) return { ok: false, error: 'Not found in trash' }
        ctx.activity.audit('assets.trash.permanent_delete', agent, { trashName: params.trashName })
        return { ok: true }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_assets_audit',
      label: 'Audited assets',
      description: 'Audit versioned-asset health: manifest integrity, current-pointer resolution, and missing version files.',
      parameters: {},
      handler: async () => {
        const results = checkAssets(getContentDir())
        return { ok: true, count: results.length, results }
      },
    })

    // ─── Health check (migrated out of core/doctor.ts per #139 C3) ──────
    ctx.registerHealthCheck({
      id: 'assets',
      name: 'Asset directory + sidecar integrity',
      run: () => Promise.resolve(checkAssets(getContentDir())),
      repair: assetRepair(getContentDir()),
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
}) as unknown as BakinPlugin

export default assetsPlugin
