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
import { buildIndex, upsertAsset, removeAsset } from './lib/asset-index'
import { registerSyncHook } from '../../src/core/watcher'

const assetsPlugin: BakinPlugin = {
  id: 'assets',
  name: 'Assets',
  version: '1.0.0',

  navItems: [],
  contentFiles: [],

  activate(ctx: PluginContext) {
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
      handler: async (req) => handleDelete(req),
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
      handler: async (req) => handleRestore(req),
    })

    // Permanently delete a trashed asset
    ctx.registerRoute({
      path: '/permanent-delete',
      method: 'POST',
      handler: async (req) => handlePermanentDelete(req),
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
