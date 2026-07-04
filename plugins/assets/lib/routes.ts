/**
 * Assets plugin REST routes (declarative).
 *
 * Extracted from index.ts. Import scan/import, upload, the versioned
 * (asset-as-directory) CRUD + promote/export/metadata/enrichment/relink
 * surface, global tag operations, trash, the enrichment enqueue route, and
 * the declarative search route — assembled into one array the plugin shell
 * registers via `routes: assetsRoutes`. Handlers stay thin: most delegate to
 * the request handlers under ../routes/ (upload/versioned/tags/import);
 * the /enrich handler drives the enrichment queue directly.
 */
import { z } from 'zod'
import type { PluginContext } from '@bakin/core/plugin-types'
import { defineRoute, searchRoute } from '@bakin/core/routing'

import { handleUpload } from '../routes/upload'
import {
  handleVersionedList, handleVersionedGet, handleVersionedPromote,
  handleVersionedDeleteVersion, handleVersionedDeleteAsset, handleVersionedExport,
  handleVersionedRelink, handleVersionedAddVersion, handleVersionedUpdateMetadata,
  handleVersionedUpdateEnrichment,
  handleTrashList, handleTrashRestore, handleTrashPermanentDelete, handleTrashEmpty,
} from '../routes/versioned'
import { handleTagsRename, handleTagsRemove, handleTagsApply } from '../routes/tags'
import { handleImportScan, handleImport } from '../routes/import'
import {
  drainEnrichmentQueue,
  enqueueEnrichment,
  enqueueEnrichmentBackfill,
} from './enrichment/queue'
import type { EnrichmentSettings } from './enrichment/providers'
import { resolveEnrichmentEngine } from './enrichment/engine'
import { RUNTIME_TURN_ESTIMATED_SECONDS } from './enrichment/runtime'

// ─── Schemas ─────────────────────────────────────────────────────────────

const passthrough = z.object({}).passthrough()
const errorResponse = z.object({ error: z.string() }).passthrough()
const okPassthrough = z.object({ ok: z.boolean() }).passthrough()

// ─── Routes (declarative) ────────────────────────────────────────────────

export const assetsRoutes = [
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
    responses: { 200: okPassthrough, 400: errorResponse, 404: errorResponse },
    handler: async (req, ctx) => {
      const body = await req.json().catch(() => ({})) as { assetId?: unknown; assetIds?: unknown; all?: unknown; force?: unknown }
      const force = body.force === true
      // Which engine will serve the batch — surfaced so callers can warn
      // BEFORE a runtime backfill silently spends subscription quota (§5).
      const engineInfo = async () => {
        const resolution = await resolveEnrichmentEngine(
          ctx.getSettings<EnrichmentSettings>(), { kind: 'image' }, { runtime: ctx.runtime ?? null },
        )
        if (!resolution.ok) return {}
        return {
          engine: resolution.engine.name,
          ...(resolution.engine.name === 'runtime' ? {
            agent: resolution.engine.modelId.slice('runtime:'.length),
            estimatedSecondsPerAsset: RUNTIME_TURN_ESTIMATED_SECONDS,
          } : {}),
        }
      }
      if (typeof body.assetId === 'string' && body.assetId.length > 0) {
        const { getAsset } = await import('./asset-core')
        if (!getAsset(body.assetId)) return Response.json({ error: 'Asset not found' }, { status: 404 })
        const info = await engineInfo()
        enqueueEnrichment(body.assetId, { force })
        void drainEnrichmentQueue()
        return Response.json({ ok: true, enqueued: 1, count: 1, ...info })
      }
      if (Array.isArray(body.assetIds) && body.assetIds.length > 0) {
        const ids = body.assetIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
        if (ids.length === 0) return Response.json({ error: 'assetIds must contain asset id strings' }, { status: 400 })
        const info = await engineInfo()
        enqueueEnrichmentBackfill(ids, { force })
        void drainEnrichmentQueue()
        return Response.json({ ok: true, enqueued: ids.length, count: ids.length, ...info })
      }
      if (body.all === true) {
        const { listAssets } = await import('./asset-core')
        const ids = listAssets().map((a) => a.assetId)
        const info = await engineInfo()
        enqueueEnrichmentBackfill(ids, { force })
        void drainEnrichmentQueue()
        return Response.json({ ok: true, enqueued: ids.length, count: ids.length, ...info })
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
