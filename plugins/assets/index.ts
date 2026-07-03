/**
 * Assets plugin — server entry point.
 * Registers API routes, MCP exec tools, and cross-plugin hooks for asset management.
 */
import { existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'
import type { BakinPlugin, PluginContext } from '@bakin/core/plugin-types'
import { definePlugin, defineRoute, searchRoute } from '@bakin/core/routing'
import { handleUpload } from './routes/upload'
import { resolveAssetServe } from './lib/serve'
import {
  handleVersionedList, handleVersionedGet, handleVersionedPromote,
  handleVersionedDeleteVersion, handleVersionedDeleteAsset, handleVersionedExport,
  handleVersionedRelink, handleVersionedAddVersion, handleVersionedUpdateMetadata,
  handleVersionedUpdateEnrichment,
  handleTrashList, handleTrashRestore, handleTrashPermanentDelete, handleTrashEmpty,
} from './routes/versioned'
import { onAssetWritten } from './lib/asset-events'
import {
  drainEnrichmentQueue,
  enqueueEnrichment,
  enqueueEnrichmentBackfill,
  enrichmentQueueStats,
  initEnrichmentQueue,
  stopEnrichmentQueue,
} from './lib/enrichment/queue'
import type { EnrichmentSettings } from './lib/enrichment/providers'
import { handleTagsRename, handleTagsRemove, handleTagsApply } from './routes/tags'
import { handleImportScan, handleImport } from './routes/import'
import { isValidAssetId } from './lib/asset-id'
import {
  getAsset, upsertFromSource, resolveFile as resolveVersionedFile,
  listAssets as listVersionedAssets,
  relink as relinkVersioned, retype as retypeVersioned,
} from './lib/asset-service'
import {
  deleteAsset as deleteVersionedAsset,
  listTrashedAssets, emptyAssetTrash, permanentlyDeleteTrashed, restoreAsset as restoreVersionedAsset,
} from './lib/asset-trash'
import { listAssetIdsByTask, taskAssetIndexRemove, taskAssetIndexUpsert } from './lib/task-asset-index'
import { versionedAssetPath, buildVersionedAssetSearchDoc } from './lib/search-doc'
import { ASSET_TYPES, type AssetType } from './lib/constants'
import { noteUnmanagedSync, noteUnmanagedUnlink, setUnmanagedEmitter } from './lib/unmanaged-tracker'
import { getContentDir } from '../../src/core/content-dir'
import { createLogger } from '../../src/core/logger'
import { extractAssetContent } from './lib/content-extractor'
import { assetRepair, checkAssets } from './lib/health-checks'

const log = createLogger('assets')

// ─── Module-scope plugin ctx (set during activate) ──────────────────────
let pluginCtx: PluginContext | null = null

// ─── Versioned-asset (manifest-driven) search indexing ────────────────────
// One search row per asset, keyed by assetId, built from the CURRENT version.
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

// ─── Schemas ─────────────────────────────────────────────────────────────

const passthrough = z.object({}).passthrough()
const errorResponse = z.object({ error: z.string() }).passthrough()
const okPassthrough = z.object({ ok: z.boolean() }).passthrough()

// ─── Routes (declarative) ────────────────────────────────────────────────

const routes = [
  defineRoute({
    path: '/import/scan',
    method: 'GET',
    summary: 'List unmanaged files awaiting explicit import',
    responses: { 200: passthrough, 500: errorResponse },
    handler: async () => handleImportScan(),
  }),
  defineRoute({
    path: '/import',
    method: 'POST',
    summary: 'Import unmanaged files into versioned assets',
    responses: { 200: okPassthrough, 400: errorResponse, 500: errorResponse },
    handler: async (req, ctx) => handleImport(req, ctx as unknown as { activity?: { audit: (event: string, agent: string, data: Record<string, unknown>) => void } }),
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
    path: '/versioned/:assetId/metadata',
    method: 'PATCH',
    summary: 'Edit asset description and/or tags',
    params: z.object({ assetId: z.string().min(1) }),
    responses: { 200: okPassthrough, 400: errorResponse, 404: errorResponse },
    handler: async (req, ctx) => {
      const res = await handleVersionedUpdateMetadata(req)
      if (res.ok) ctx.activity.audit('asset.metadata_updated', 'user')
      return res
    },
  }),
  defineRoute({
    path: '/enrich',
    method: 'POST',
    summary: 'Enqueue vision enrichment (one asset or backfill all); billed per asset version',
    responses: { 200: okPassthrough, 400: errorResponse },
    handler: async (req) => {
      const body = await req.json().catch(() => ({})) as { assetId?: unknown; all?: unknown; force?: unknown }
      const force = body.force === true
      if (typeof body.assetId === 'string' && body.assetId.length > 0) {
        const { getAsset } = await import('./lib/asset-core')
        if (!getAsset(body.assetId)) return Response.json({ error: 'Asset not found' }, { status: 404 })
        enqueueEnrichment(body.assetId, { force })
        void drainEnrichmentQueue()
        return Response.json({ ok: true, enqueued: 1 })
      }
      if (body.all === true) {
        const { listAssets } = await import('./lib/asset-core')
        const ids = listAssets().map((a) => a.assetId)
        enqueueEnrichmentBackfill(ids, { force })
        void drainEnrichmentQueue()
        return Response.json({ ok: true, enqueued: ids.length })
      }
      return Response.json({ error: 'assetId (string) or all:true required' }, { status: 400 })
    },
  }),
  defineRoute({
    path: '/versioned/:assetId/enrichment',
    method: 'PATCH',
    summary: 'Manually edit derived enrichment (locks fields against machine overwrites)',
    params: z.object({ assetId: z.string().min(1) }),
    responses: { 200: okPassthrough, 400: errorResponse, 404: errorResponse },
    handler: async (req, ctx) => {
      const res = await handleVersionedUpdateEnrichment(req)
      if (res.ok) ctx.activity.audit('asset.enrichment_edited', 'user')
      return res
    },
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
    path: '/versioned/:assetId/version',
    method: 'POST',
    summary: 'Append a new version from an uploaded file',
    params: z.object({ assetId: z.string().min(1) }),
    body: { contentType: 'multipart/form-data' },
    responses: { 200: okPassthrough, 400: errorResponse, 404: errorResponse },
    handler: async (req) => handleVersionedAddVersion(req),
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

  // Global tag operations — power the folders view + bulk-select tagging.
  defineRoute({
    path: '/tags/rename',
    method: 'POST',
    summary: 'Rename a tag across all assets',
    responses: { 200: okPassthrough, 400: errorResponse },
    handler: async (req, ctx) => {
      const res = await handleTagsRename(req)
      if (res.ok) ctx.activity.audit('assets.tag.renamed', 'user')
      return res
    },
  }),
  defineRoute({
    path: '/tags/remove',
    method: 'POST',
    summary: 'Remove a tag from all assets',
    responses: { 200: okPassthrough, 400: errorResponse },
    handler: async (req, ctx) => {
      const res = await handleTagsRemove(req)
      if (res.ok) ctx.activity.audit('assets.tag.removed', 'user')
      return res
    },
  }),
  defineRoute({
    path: '/tags/apply',
    method: 'POST',
    summary: 'Bulk add/remove tags on a set of assets',
    responses: { 200: okPassthrough, 400: errorResponse },
    handler: async (req, ctx) => {
      const res = await handleTagsApply(req)
      if (res.ok) ctx.activity.audit('assets.tags.applied', 'user')
      return res
    },
  }),

  // Trash (versioned whole-asset deletions) — restore/permanent-delete/empty.
  defineRoute({
    path: '/trash',
    method: 'GET',
    summary: 'List trashed assets',
    responses: { 200: passthrough },
    handler: async () => handleTrashList(),
  }),
  defineRoute({
    path: '/trash/:trashName/restore',
    method: 'POST',
    summary: 'Restore a trashed asset',
    params: z.object({ trashName: z.string().min(1) }),
    body: { contentType: 'none' },
    responses: { 200: okPassthrough, 400: errorResponse },
    handler: async (req, ctx) => {
      const res = await handleTrashRestore(req)
      if (res.ok) ctx.activity.audit('asset.restored', 'user')
      return res
    },
  }),
  defineRoute({
    path: '/trash/:trashName',
    method: 'DELETE',
    summary: 'Permanently delete a trashed asset',
    params: z.object({ trashName: z.string().min(1) }),
    body: { contentType: 'none' },
    responses: { 200: okPassthrough, 404: errorResponse },
    handler: async (req) => handleTrashPermanentDelete(req),
  }),
  defineRoute({
    path: '/trash',
    method: 'DELETE',
    summary: 'Empty the asset trash',
    body: { contentType: 'none' },
    responses: { 200: okPassthrough },
    handler: async (_req, ctx) => {
      const res = await handleTrashEmpty()
      if (res.ok) ctx.activity.audit('assets.trash.emptied', 'user')
      return res
    },
  }),

  searchRoute({ table: 'assets' }),
]

const assetsPlugin: BakinPlugin = definePlugin({
  id: 'assets',
  name: 'Assets',
  version: '2.2.0',
  routes,

  settingsSchema: {
    fields: [
      { key: 'thumbnails', type: 'boolean', label: 'Generate thumbnails', description: 'Auto-create optimized thumbnails on upload', default: true },
      { key: 'maxFileSize', type: 'number', label: 'Max file size (MB)', description: 'Reject uploads larger than this', default: 50 },
      { key: 'purgeClipboardOnComplete', type: 'boolean', label: 'Purge clipboard assets on task completion', description: 'Auto-delete clipboard-pasted assets when their linked task is marked done', default: false },
      { key: 'enrichmentEnabled', type: 'boolean', label: 'Vision enrichment', description: 'Derive caption/OCR/tags from asset content with a vision model (billed per asset version)', default: true },
      { key: 'enrichmentProvider', type: 'select', label: 'Enrichment provider', description: 'auto = cheapest configured API model, else the runtime agent when its model accepts images; runtime = agent turns only (subscription quota)', options: ['auto', 'anthropic', 'openai', 'google', 'runtime'], default: 'auto' },
      { key: 'enrichmentModel', type: 'string', label: 'Enrichment model override', description: 'Exact model id (catalog or provider-native); empty = auto', default: '' },
    ],
  },

  navItems: [],
  contentFiles: [],

  activate(ctx: PluginContext) {
    pluginCtx = ctx

    // ─── Enrichment queue (D8) ─────────────────────────────────────────
    // Every asset write enqueues; the queue never blocks creation; the
    // manifest's status/forVersion is the durable skip guard.
    initEnrichmentQueue(() => ctx.getSettings<EnrichmentSettings>(), { getRuntime: () => ctx.runtime ?? null })
    onAssetWritten(({ assetId }) => enqueueEnrichment(assetId))
    ctx.hooks.register('assets.enrichmentStats', () => enrichmentQueueStats(), {
      label: 'Enrichment queue stats.',
      summary: 'Returns the vision-enrichment queue depth and processed/failed/skipped counters for telemetry.',
      hookKind: 'rpc',
    })

    // ─── Search Content Type Registration ─────────────────────────────

    ctx.search.registerFileBackedContentType({
      table: 'assets',
      // v2: enrichment fields (caption/ocr_text/suggested_tags/transcript/
      // summary) + image_url → media_url incl. audio. Blue/green migrates.
      schemaVersion: 2,
      schema: {
        description: { type: 'text' },
        tags: { type: 'text' },
        // Keyword array mirror of `tags` for per-tag facet buckets (text
        // fields can't facet; arrays index per-element).
        tags_facet: { type: 'array' },
        agent: { type: 'keyword' },
        task_id: { type: 'keyword' },
        asset_type: { type: 'keyword' },
        file_name: { type: 'text' },
        tool: { type: 'keyword' },
        // Generation provenance (from the current version's `generation`).
        // surface is searchable text; provider/model are facet-only.
        surface: { type: 'text' },
        provider: { type: 'keyword' },
        model: { type: 'keyword' },
        updated_at: { type: 'datetime' },
        // `content` is populated server-side by extractAssetContent:
        // plain text for .md/.txt/.json/.csv/.yaml, pdf-parse output for
        // .pdf, empty for everything else. Bakin owns extraction so the
        // search adapter receives plain document text instead of reaching
        // back into local files during indexing.
        content: { type: 'text' },
        // Derived enrichment (D8) — searchable text a vision model produced
        // from the asset ITSELF, durable in the manifest.
        caption: { type: 'text' },
        ocr_text: { type: 'text' },
        suggested_tags: { type: 'text' },
        transcript: { type: 'text' },
        summary: { type: 'text' },
        // `media_url` is a file:// URL for raster images AND audio files —
        // both ride the media-embedding leg (CLIP + CLAP halves of the
        // multimodal embedder). The adapter owns media dereferencing.
        media_url: { type: 'keyword' },
      },
      searchableFields: ['description', 'tags', 'file_name', 'surface', 'content', 'caption', 'ocr_text', 'suggested_tags', 'transcript', 'summary'],
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
      embeddingTemplate: '{{description}} {{caption}} {{tags}} {{suggested_tags}} {{file_name}} {{surface}} {{content}} {{ocr_text}} {{transcript}} {{summary}}',
      indexes: [
        {
          name: 'assets_text',
          embedderRef: 'default',
          embeddingTemplate: '{{description}} {{caption}} {{tags}} {{suggested_tags}} {{file_name}} {{surface}} {{content}} {{ocr_text}} {{transcript}} {{summary}}',
          chunker: { enabled: true, targetTokens: 200, overlapTokens: 25 },
          // Balanced with the visual leg since the golden-set tuning pass
          // (.claude/knowledge/search-tuning.md): images now carry REAL
          // vision-LLM captions/OCR in this leg (not auto-noise), and
          // measured hit@1 nearly tripled at 1/1 vs the old 0.5/2.0 skew.
          weight: 1.0,
        },
        {
          name: 'assets_visual',
          embedderRef: 'visual',
          mediaUrlField: 'media_url',
          // Balanced (was 2.0): with enriched captions in the text leg, an
          // over-weighted visual leg let color-similar swatches outrank
          // exact caption matches. Measured in the tuning pass.
          weight: 1.0,
        },
      ],
      facets: ['asset_type', 'agent', 'tool', 'tags_facet', 'provider', 'model'],
      // An asset is a directory under assets/store/<ym>/<assetId>/ whose
      // manifest.json is the single indexed unit (keyed by assetId). Version,
      // thumbnail, and export files never get their own search doc. onSync /
      // onUnlink own indexing off the manifest, so no fileToDoc is declared.
      filePatterns: [
        {
          pattern: 'assets/**/*',
          fileToId: (rel) => {
            const v = versionedAssetPath(rel)
            return v?.isManifest ? v.assetId : null
          },
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
            // Self-heal backstop for the taskId index (covers externally
            // edited manifests; in-process mutations already updated it
            // synchronously at the manifest-write choke point).
            const manifest = getAsset(versioned.assetId)
            if (manifest) taskAssetIndexUpsert(manifest.assetId, manifest.taskId ?? null)
            // Live UI refresh: any mutation rewrites the manifest.
            ctx.events.emit('asset.changed', { assetId: versioned.assetId })
          }
          return
        }

        // ONE RULE (D7): a raw file on disk NEVER becomes an asset without
        // an explicit import action. Unmanaged appearances (inbox drops,
        // loose files) are only NOTED — the badge/Import view surface them;
        // the user (or CLI/MCP) imports.
        noteUnmanagedSync(relativePath)
      },
      onUnlink: async (relativePath: string) => {
        if (!relativePath.startsWith('assets/')) return
        if (relativePath.includes('.trash/')) return

        noteUnmanagedUnlink(relativePath)

        // Only a manifest unlink (asset dir trashed/removed) removes the row.
        const versioned = versionedAssetPath(relativePath)
        if (versioned?.isManifest) {
          await ctx.search.remove(versioned.assetId).catch(() => { /* non-blocking */ })
          taskAssetIndexRemove(versioned.assetId)
          ctx.events.emit('asset.removed', { assetId: versioned.assetId })
        }
      },
      reindex: async function* () {
        const storeRoot = join(getContentDir(), 'assets', 'store')
        if (!existsSync(storeRoot)) return

        let months: string[]
        try {
          months = readdirSync(storeRoot).filter(m => {
            if (m.startsWith('.')) return false
            try { return statSync(join(storeRoot, m)).isDirectory() } catch { return false }
          })
        } catch { return }

        // Each asset is a subdir named by a valid assetId, indexed from its
        // manifest's current version.
        for (const month of months) {
          let dirEntries: string[]
          try { dirEntries = readdirSync(join(storeRoot, month)) } catch { continue }
          for (const entry of dirEntries) {
            if (!isValidAssetId(entry)) continue
            const manifest = getAsset(entry)
            if (!manifest) continue
            yield { key: entry, doc: await buildVersionedAssetSearchDoc(manifest, entry) }
          }
        }
      },
      verifyExists: async (key: string) => isValidAssetId(key) && getAsset(key) !== null,
    })

    // ─── Cross-Plugin Hooks ────────────────────────────────────────────

    ctx.hooks.register('assets.listByTask', (d: Record<string, unknown>) => {
      const taskId = typeof d?.taskId === 'string' ? d.taskId : ''
      if (!taskId) return []
      return listAssetIdsByTask(taskId)
        .map((assetId) => getAsset(assetId))
        .filter((m): m is NonNullable<typeof m> => m !== null)
        .map((m) => ({ assetId: m.assetId, description: m.description ?? '', type: m.type }))
    }, { label: 'List assets linked to a task.', summary: 'Returns {assetId, description, type} for every versioned asset whose manifest taskId matches. Backed by an in-memory index — the sanctioned way for core (dispatch) to resolve a task’s attached assets without scanning plugin storage.', hookKind: 'rpc' })
    ctx.hooks.register('assets.getAssetTypes', () => ASSET_TYPES, { label: 'List asset types.', summary: 'Returns the asset type definitions known to the assets plugin. Use it to build filters, upload forms, or validation messages that match Bakin asset categories.', hookKind: 'rpc' })
    ctx.hooks.register('assets.resolveServe', (d: Record<string, unknown>) => resolveAssetServe((d.segments as string[]) ?? []), { label: 'Resolve versioned asset serve request.', summary: 'Resolves an /api/assets/<assetId> path (current, /v/<n>, /thumb, /export/<name>) to a file on disk for serving.', hookKind: 'rpc' })

    // Core's sanctioned save path (HookRegistry — core can't call exec
    // tools). Used by dispatch to persist salvaged session-death output as a
    // task-linked asset. Upsert-by-source-path keeps repeat salvage
    // idempotent: unchanged content no-ops, changed content bumps a version.
    ctx.hooks.register('assets.saveFromSource', async (d: Record<string, unknown>) => {
      const filePath = typeof d.filePath === 'string' ? d.filePath : ''
      if (!filePath) throw new Error('assets.saveFromSource requires filePath')
      const agent = typeof d.agent === 'string' && d.agent ? d.agent : 'system'
      const r = await upsertFromSource(filePath, {
        sourceFilePath: filePath,
        type: (typeof d.type === 'string' ? d.type : 'text') as AssetType,
        agent,
        taskId: typeof d.taskId === 'string' ? d.taskId : null,
        op: 'upload',
        tool: typeof d.tool === 'string' ? d.tool : null,
        description: typeof d.description === 'string' ? d.description : undefined,
        tags: Array.isArray(d.tags) ? d.tags.filter((t): t is string => typeof t === 'string') : undefined,
        slug: typeof d.slug === 'string' ? d.slug : undefined,
      })
      ctx.activity.audit(r.changed ? 'asset.saved' : 'asset.unchanged', agent, {
        assetId: r.assetId,
        version: r.version,
        ...(typeof d.taskId === 'string' ? { taskId: d.taskId } : {}),
        via: 'assets.saveFromSource',
      })
      await indexVersionedAsset(r.assetId)
      return r
    }, { label: 'Save a file as a managed asset.', summary: 'Upserts a file into the versioned asset store by source path (new asset, version bump, or no-op when unchanged). The sanctioned cross-plugin/core save path; mirrors bakin_exec_assets_save.', hookKind: 'rpc' })

    // Purge clipboard-source assets when a task completes (if enabled).
    ctx.hooks.register('assets.purgeClipboardForTask', async (d: Record<string, unknown>) => {
      const settings = ctx.getSettings<{ purgeClipboardOnComplete?: boolean }>()
      if (!settings.purgeClipboardOnComplete) return { purged: 0 }

      const taskId = d.taskId as string
      if (!taskId) return { purged: 0 }

      let purged = 0
      // Trash whole assets linked to the task whose source is clipboard.
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

    // No boot drain, no auto-ingest (D7): unmanaged files are surfaced by
    // the live tracker + on-demand scans and imported explicitly.
    setUnmanagedEmitter((count) => ctx.events.emit('asset.unmanaged', { count }))

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
      name: 'bakin_exec_assets_scan_unmanaged',
      label: 'Scanned for unmanaged files',
      description: 'List files under assets/ that are NOT managed assets (inbox drops, loose files). Nothing is imported automatically — use bakin_exec_assets_import to import.',
      parameters: {},
      handler: async () => {
        const { scanUnmanaged } = await import('./lib/import-unmanaged')
        const { reseedUnmanaged } = await import('./lib/unmanaged-tracker')
        const files = scanUnmanaged()
        reseedUnmanaged(files.map(f => f.relPath))
        return { ok: true, count: files.length, files }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_assets_import',
      label: 'Imported unmanaged files',
      description: 'Explicitly import unmanaged files into managed versioned assets. Pass path (content-dir relative, e.g. assets/inbox/pic.png) or all: true. Optional type override and taskId link.',
      parameters: {
        path: z.string().optional().describe('One unmanaged file to import (content-dir relative)'),
        all: z.boolean().optional().describe('Import every unmanaged file'),
        type: z.enum(ASSET_TYPES).optional().describe('Override the suggested asset type'),
        taskId: z.string().optional().describe('Link the imported asset(s) to this task'),
      },
      handler: async (params: Record<string, unknown>) => {
        const { scanUnmanaged, importUnmanagedFile } = await import('./lib/import-unmanaged')
        const { reseedUnmanaged } = await import('./lib/unmanaged-tracker')
        const type = typeof params.type === 'string' ? params.type as AssetType : undefined
        const taskId = typeof params.taskId === 'string' && params.taskId.length > 0 ? params.taskId : null
        const targets = params.all === true
          ? scanUnmanaged().map(f => f.relPath)
          : typeof params.path === 'string' && params.path.length > 0 ? [params.path] : []
        if (targets.length === 0) return { ok: false, error: 'Pass path or all: true' }
        const results = []
        for (const rel of targets) {
          const result = await importUnmanagedFile(rel, { ...(type ? { type } : {}), taskId })
          results.push(result)
          if (result.ok) ctx.activity.audit('asset.imported', 'user', { assetId: result.assetId, from: rel })
        }
        reseedUnmanaged(scanUnmanaged().map(f => f.relPath))
        const imported = results.filter(r => r.ok).length
        return { ok: imported === results.length, imported, failed: results.length - imported, results }
      },
    })

    ctx.registerExecTool({
      name: 'bakin_exec_assets_list',
      label: 'Listed assets',
      description: 'List managed assets (one entry per asset, current-version view). Optional type, task, and tag filters. Tags are the UI "folders" — pass tags to list a folder, e.g. ["brand"].',
      parameters: {
        type: z.enum(ASSET_TYPES).optional().describe('Filter by asset type'),
        taskId: z.string().optional().describe('Filter to assets linked to this task id'),
        tags: z.array(z.string()).optional().describe('Filter to assets carrying ALL of these tags (the UI "folders").'),
      },
      handler: async (params: Record<string, unknown>) => {
        const filter: { type?: AssetType; taskId?: string; tags?: string[] } = {}
        if (params.type) filter.type = params.type as AssetType
        if (typeof params.taskId === 'string' && params.taskId.length > 0) filter.taskId = params.taskId
        if (Array.isArray(params.tags) && params.tags.length > 0) filter.tags = params.tags as string[]
        const assets = listVersionedAssets(Object.keys(filter).length ? filter : undefined)
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
          const { assetId } = await restoreVersionedAsset(params.trashName as string)
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
      name: 'Asset store + manifest integrity',
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
    stopEnrichmentQueue()
    log.info('Shutting down assets plugin')
  },
}) as unknown as BakinPlugin

export default assetsPlugin
