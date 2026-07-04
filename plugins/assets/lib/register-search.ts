/**
 * Assets search content-type registration.
 *
 * Extracted from index.ts. `registerAssetsSearch` wires the file-backed
 * `assets` content type (schema v2 with enrichment fields, the balanced
 * text + visual index legs, manifest-keyed sync/unlink, and the store-walk
 * reindex generator). Doc building itself lives in ./search-doc; this module
 * owns the registration + the manifest-driven row lifecycle.
 *
 * Also owns the module-scope plugin ctx cell that `indexVersionedAsset`
 * reads — the hook module (register-hooks.ts) calls indexVersionedAsset with
 * no incoming ctx, so the cell MUST live in exactly this one module
 * (mirroring plugins/schedule/lib/plugin-context.ts).
 */
import { existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import type { PluginContext } from '@bakin/core/plugin-types'

import { getAsset } from './asset-service'
import { taskAssetIndexRemove, taskAssetIndexUpsert } from './task-asset-index'
import { versionedAssetPath, buildVersionedAssetSearchDoc } from './search-doc'
import { isValidAssetId } from './asset-id'
import { noteUnmanagedSync, noteUnmanagedUnlink } from './unmanaged-tracker'
import { getContentDir } from '../../../src/core/content-dir'
import { createLogger } from '../../../src/core/logger'

const log = createLogger('assets')

// ─── Module-scope plugin ctx (set during activate) ──────────────────────
let pluginCtx: PluginContext | null = null

export function setPluginCtx(ctx: PluginContext | null): void {
  pluginCtx = ctx
}

// ─── Versioned-asset (manifest-driven) search indexing ────────────────────
// One search row per asset, keyed by assetId, built from the CURRENT version.
// versionedAssetPath + buildVersionedAssetSearchDoc live in ./search-doc.

export async function indexVersionedAsset(assetId: string): Promise<void> {
  if (!pluginCtx) return
  try {
    const manifest = getAsset(assetId)
    if (!manifest) return
    await pluginCtx.search.index(assetId, await buildVersionedAssetSearchDoc(manifest, assetId))
  } catch (err) {
    log.warn('Failed to index versioned asset for search', { assetId, error: err instanceof Error ? err.message : String(err) })
  }
}

export function registerAssetsSearch(ctx: PluginContext): void {
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
}
