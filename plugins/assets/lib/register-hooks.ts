/**
 * Assets plugin cross-plugin hooks.
 *
 * Extracted from index.ts. `registerAssetsHooks` registers the assets.*
 * hooks against the plugin context: enrichment queue stats, task-linked
 * asset listing, asset-type metadata, versioned serve resolution, the
 * sanctioned core save path (assets.saveFromSource — used by dispatch to
 * persist salvaged session-death output), and clipboard purge on task
 * completion. Hook names and payload shapes are cross-plugin contracts
 * invoked by name via getHookRegistry().invoke — bodies moved verbatim.
 */
import type { PluginContext } from '@bakin/core/plugin-types'

import { resolveAssetServe } from './serve'
import { enrichmentQueueStats } from './enrichment/queue'
import {
  getAsset, upsertFromSource,
  listAssets as listVersionedAssets,
} from './asset-service'
import { deleteAsset as deleteVersionedAsset } from './asset-trash'
import { listAssetIdsByTask } from './task-asset-index'
import { ASSET_TYPES, type AssetType } from './constants'
import { enrichmentCoverage } from './health-checks'
import { indexVersionedAsset } from './register-search'
import { createLogger } from '../../../src/core/logger'

const log = createLogger('assets')

export function registerAssetsHooks(ctx: PluginContext): void {
  ctx.hooks.register('assets.enrichmentStats', () => ({ ...enrichmentQueueStats(), coverage: enrichmentCoverage() }), {
    label: 'Enrichment queue stats.',
    summary: 'Returns the vision-enrichment queue depth and processed/failed/skipped counters for telemetry.',
    hookKind: 'rpc',
  })

  ctx.hooks.register('assets.listByTask', (d: Record<string, unknown>) => {
    const taskId = typeof d?.taskId === 'string' ? d.taskId : ''
    if (!taskId) return []
    return listAssetIdsByTask(taskId)
      .map((assetId) => getAsset(assetId))
      .filter((m): m is NonNullable<typeof m> => m !== null)
      .map((m) => ({ assetId: m.assetId, description: m.description ?? '', type: m.type }))
  }, { label: 'List assets linked to a task.', summary: 'Returns {assetId, description, type} for every versioned asset whose manifest taskId matches. Backed by an in-memory index — the sanctioned way for core (dispatch) to resolve a task’s attached assets without scanning plugin storage.', hookKind: 'rpc' })
  ctx.hooks.register('assets.getAssetTypes', () => ASSET_TYPES, { label: 'List asset types.', summary: 'Returns the asset type definitions known to the assets plugin. Use it to build filters, upload forms, or validation messages that match Bakin asset categories.', hookKind: 'rpc' })

  // Batch describe (#419 S7): description + enrichment caption per assetId so
  // consumers (brands' asset groups) can show WHICH screenshot is which
  // without re-billing enrichment or scanning plugin storage.
  ctx.hooks.register('assets.describe', (d: Record<string, unknown>) => {
    const assetIds = Array.isArray(d?.assetIds) ? d.assetIds.filter((x): x is string => typeof x === 'string') : []
    const byId: Record<string, { description: string; caption?: string; type: string; exists: boolean }> = {}
    for (const assetId of assetIds.slice(0, 200)) {
      const manifest = getAsset(assetId)
      if (!manifest) {
        byId[assetId] = { description: '', type: 'other', exists: false }
        continue
      }
      byId[assetId] = {
        description: manifest.description ?? '',
        ...(manifest.enrichment?.caption ? { caption: manifest.enrichment.caption } : {}),
        type: manifest.type,
        exists: true,
      }
    }
    return byId
  }, { label: 'Describe assets by id.', summary: 'Batch {description, enrichment caption, type, exists} per assetId — lets brand asset groups (and any consumer) label members without direct imports.', hookKind: 'rpc' })
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
}
