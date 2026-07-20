/**
 * Assets plugin MCP exec tools.
 *
 * Extracted from index.ts. `registerAssetsExecTools` registers all 15 asset
 * exec tools (scan_unmanaged/import/list/get/open/save/delete/consolidate/
 * link/retype/list_trash/restore/empty_trash/permanent_delete/audit) against
 * the plugin context. bakin_exec_assets_save upserts by source path — the OUTPUT
 * DISCIPLINE deliverable path every dispatch prompt points agents at.
 * Tool names, parameter schemas, and result shapes are agent-facing
 * contracts — bodies moved verbatim.
 */
import { z } from 'zod'

import { translateAgentPath } from '@bakin/core/agent-path-map'
import type { PluginContext } from '@bakin/core/plugin-types'

import { isValidAssetId } from './asset-id'
import {
  getAsset, upsertFromSource, resolveFile as resolveVersionedFile,
  listAssets as listVersionedAssets,
  relink as relinkVersioned, retype as retypeVersioned,
  consolidateAssets,
} from './asset-service'
import {
  deleteAsset as deleteVersionedAsset,
  listTrashedAssets, emptyAssetTrash, permanentlyDeleteTrashed, restoreAsset as restoreVersionedAsset,
} from './asset-trash'
import { ASSET_TYPES, type AssetType } from './constants'
import { extractAssetContent } from './content-extractor'
import { checkAssets } from './health-checks'
import { getContentDir } from '../../../src/core/content-dir'

export function registerAssetsExecTools(ctx: PluginContext): void {
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
      const { scanUnmanaged } = await import('./import-unmanaged')
      const { reseedUnmanaged } = await import('./unmanaged-tracker')
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
      const { scanUnmanaged, importUnmanagedFile } = await import('./import-unmanaged')
      const { reseedUnmanaged } = await import('./unmanaged-tracker')
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
      // Dev-rig seam: agents may report container paths for bind-mounted
      // workspaces (BAKIN_AGENT_PATH_MAP); production is a pass-through.
      const filePath = typeof params.filePath === 'string' ? translateAgentPath(params.filePath) : ''
      if (!filePath) return { ok: false, error: 'filePath is required' }
      try {
        const r = await upsertFromSource(filePath, {
          sourceFilePath: filePath, type: params.type as AssetType, agent,
          taskId: (params.taskId as string) ?? null, slug: params.slug as string | undefined,
          op: 'upload', tool: (params.tool as string) ?? null,
          description: params.description as string | undefined, tags: params.tags as string[] | undefined,
        })
        if (r.staleSuppressed) {
          // The origin run is no longer live (superseded/lost/settled) — the
          // bytes were recorded but currentVersion did NOT move. Loud trail.
          ctx.activity.audit('asset.stale_run_write_suppressed', agent, { assetId: r.assetId, version: r.version })
        } else {
          ctx.activity.audit(r.changed ? 'asset.saved' : 'asset.unchanged', agent, { assetId: r.assetId, version: r.version })
        }
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
    name: 'bakin_exec_assets_consolidate',
    label: 'Consolidated variant assets',
    activityDuplicate: true,
    description: 'Absorb variant assets as versions of a winner asset (select-best flows): each loser\'s current file becomes a new version of the winner with consolidatedFrom provenance, the winner\'s pre-call current version stays promoted, and the losers move to trash. End state: ONE asset, every variant preserved as version history. Safe to re-call — already-absorbed losers are skipped and the version pointer is never moved by a retry.',
    parameters: {
      winnerAssetId: z.string().describe('The selected (winning) asset id — absorbs the others'),
      loserAssetIds: z.array(z.string()).min(1).describe('The variant asset ids to absorb, in display order'),
      taskId: z.string().describe('Task ID this consolidation belongs to'),
    },
    handler: async (params: Record<string, unknown>, agent: string) => {
      const winnerAssetId = params.winnerAssetId as string
      const loserAssetIds = params.loserAssetIds as string[]
      if (!isValidAssetId(winnerAssetId)) return { ok: false, error: 'Invalid winnerAssetId' }
      try {
        const result = await consolidateAssets({
          winnerAssetId,
          loserAssetIds,
          taskId: params.taskId as string,
        })
        // Only a winner-side failure is fatal — per-loser failures (a stale
        // id, or the winner mistakenly listed among the losers) are reported
        // in failed[] while the consolidation of the remaining variants
        // stands, so retries don't loop forever. Match on the CODE: a
        // self_reference failure also carries the winner's assetId.
        const ok = !result.failed.some((f) => f.code === 'winner_not_found')
        ctx.activity.audit('asset.consolidated', agent, {
          winnerAssetId,
          absorbed: result.absorbed,
          skipped: result.skipped,
          failed: result.failed,
        })
        return { ok, ...result }
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
      const health = checkAssets(getContentDir())
      const results = health.outcome === 'observed' ? health.observations : []
      return { ok: true, count: results.length, results }
    },
  })
}
