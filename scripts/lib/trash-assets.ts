/**
 * MCP exec tools for trash management.
 *
 * bakin_exec_list_trash — List trashed assets
 * bakin_exec_restore_trash — Restore a trashed asset
 * bakin_exec_empty_trash — Permanently delete all trash
 */
import { join } from 'path'
import { z } from 'zod'
import { getContentDir } from '../../src/core/content-dir'
import { succeed, fail } from './common'
import { addExecTool } from './registry'
import { listTrash, restoreAsset, emptyTrash } from '../../plugins/assets/lib/trash'

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleListTrash(): Promise<ReturnType<typeof succeed>> {
  const assetsRoot = join(getContentDir(), 'assets')
  const items = listTrash(assetsRoot)

  return succeed({
    count: items.length,
    items: items.map(i => ({
      filename: i.filename,
      originalFilename: i.originalFilename,
      type: i.type,
      size: i.size,
      deletedAt: i.deletedAt,
      expiresAt: i.expiresAt,
      agent: i.metadata?.agent ?? 'unknown',
    })),
  })
}

async function handleRestoreTrash(
  params: Record<string, unknown>,
): Promise<ReturnType<typeof succeed>> {
  const filename = params.filename
  if (typeof filename !== 'string' || !filename) {
    return fail('filename parameter is required')
  }

  const assetsRoot = join(getContentDir(), 'assets')
  const restoredPath = restoreAsset(filename, assetsRoot)

  if (!restoredPath) {
    return fail('Failed to restore asset — file may not exist in trash', { filename })
  }

  return succeed({ restoredPath })
}

async function handleEmptyTrash(): Promise<ReturnType<typeof succeed>> {
  const assetsRoot = join(getContentDir(), 'assets')
  const deleted = emptyTrash(assetsRoot)
  return succeed({ deleted })
}

// ---------------------------------------------------------------------------
// Register
// ---------------------------------------------------------------------------

addExecTool({
  name: 'bakin_exec_list_trash',
  description:
    'List trashed assets with name, size, deleted timestamp, and days remaining before auto-purge.',
  parameters: {},
  handler: handleListTrash,
})

addExecTool({
  name: 'bakin_exec_restore_trash',
  description:
    'Restore a trashed asset back to its original location. Use bakin_exec_list_trash first to get the filename.',
  parameters: {
    filename: z.string().describe('The trash filename (includes __deleted- suffix)'),
  },
  handler: handleRestoreTrash,
})

addExecTool({
  name: 'bakin_exec_empty_trash',
  description:
    'Permanently delete all items from trash. This cannot be undone.',
  parameters: {},
  handler: handleEmptyTrash,
})
