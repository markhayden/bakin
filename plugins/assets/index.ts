/**
 * Assets plugin — server entry point.
 * Registers API routes for asset listing, serving, and deletion.
 * Builds the in-memory asset index on activation.
 */
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
import { listTrash, restoreAsset, emptyTrash } from './lib/trash'
import { registerSyncHook } from '../../src/core/watcher'

const assetsPlugin: BakinPlugin = {
  id: 'assets',
  name: 'Assets',
  version: '1.0.0',

  navItems: [],
  contentFiles: [],

  activate(ctx: PluginContext) {
    // Register cross-plugin hooks
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
        // Sidecar changed — update the asset it belongs to
        const assetPath = relativePath.replace('.meta.json', '')
        upsertAsset(assetPath)
      } else {
        // Asset file changed — update index
        upsertAsset(relativePath)
      }
    })

    // List assets with filters
    ctx.registerRoute({
      path: '/list',
      method: 'GET',
      handler: handleList,
    })

    // Serve asset files for rendering
    ctx.registerRoute({
      path: '/file',
      method: 'GET',
      handler: handleFile,
    })

    // Soft-delete an asset
    ctx.registerRoute({
      path: '/delete',
      method: 'POST',
      handler: async (req: Request) => handleDelete(req),
    })

    // List trashed assets
    ctx.registerRoute({
      path: '/list-trash',
      method: 'GET',
      handler: handleListTrash,
    })

    // Restore a trashed asset
    ctx.registerRoute({
      path: '/restore',
      method: 'POST',
      handler: async (req: Request) => handleRestore(req),
    })

    // Permanently delete a trashed asset
    ctx.registerRoute({
      path: '/permanent-delete',
      method: 'POST',
      handler: async (req: Request) => handlePermanentDelete(req),
    })

    // Empty entire trash
    ctx.registerRoute({
      path: '/empty-trash',
      method: 'POST',
      handler: handleEmptyTrash,
    })
  },
}

export default assetsPlugin
