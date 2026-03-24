/**
 * Assets plugin — server entry point.
 * Registers API routes for asset listing, serving, and deletion.
 * Builds the in-memory asset index on activation.
 */
import type { MCPlugin, PluginContext } from '../../src/lib/plugin-types'
import { handleList } from './routes/list'
import { handleFile } from './routes/file'
import { handleDelete } from './routes/delete'
import { buildIndex, upsertAsset, removeAsset } from './lib/asset-index'
import { registerSyncHook } from '../../src/core/watcher'

const assetsPlugin: MCPlugin = {
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
  },
}

export default assetsPlugin
