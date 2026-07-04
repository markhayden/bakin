/**
 * `bakin trash {list,restore,empty}` — asset trash management.
 * Speaks the versioned-asset trash API: GET /trash returns
 * `{ items: TrashedAssetInfo[] }` (trashName/assetId/type/agent/deletedAt/
 * versionCount/description), restore returns `{ ok, assetId }`.
 */
import { apiGet, apiPost, apiDelete } from '../http'
import { printTable } from '../output'
import { exitUsage, exitUnknownSubcommand } from '../help'
import { renderInkReport } from '../../core/cli/ui/render-report'
import type { TrashActionData } from '../../core/cli/ui/readonly'

interface TrashedItem {
  trashName: string
  assetId: string
  type: string
  agent: string
  deletedAt: number
  versionCount: number
  description: string
}

async function fetchTrashItems(): Promise<TrashedItem[]> {
  const data = await apiGet('/api/plugins/assets/trash') as { items?: TrashedItem[]; assets?: unknown[] }
  if (!data.items && Array.isArray(data.assets)) {
    // Pre-versioned-trash server (mixed-version install): fail loudly rather
    // than silently reporting an empty trash — `trash empty` would otherwise
    // no-op while the user believes it ran.
    console.error('This server speaks the old flat-file trash API — upgrade the Bakin server or use a matching CLI.')
    process.exit(1)
  }
  return data.items ?? []
}

async function printTrashListTui(items: TrashedItem[]): Promise<void> {
  // Map versioned-trash fields onto the TUI's TrashAssetData shape.
  const assets = items.map(i => ({
    filename: i.trashName,
    originalFilename: i.assetId,
    type: i.type,
    // timestampText parses strings, not epoch numbers — pass ISO.
    deletedAt: new Date(i.deletedAt).toISOString(),
    metadata: { agent: i.agent },
  }))
  return renderInkReport(() => import('../../core/cli/ui/readonly'), (m) => m.TrashListReport, { assets })
}

async function printTrashActionTui(action: TrashActionData): Promise<void> {
  return renderInkReport(() => import('../../core/cli/ui/readonly'), (m) => m.TrashActionReport, { action })
}

async function cmdTrashList(): Promise<void> {
  const items = await fetchTrashItems()
  if (process.stdout.isTTY) {
    await printTrashListTui(items)
    return
  }
  if (items.length === 0) {
    console.log('Trash is empty.')
    return
  }
  console.log(`${items.length} item${items.length !== 1 ? 's' : ''} in trash:\n`)
  const rows = items.map(i => ({
    asset: i.assetId,
    type: i.type,
    versions: String(i.versionCount),
    deleted: new Date(i.deletedAt).toLocaleString(),
    agent: i.agent,
    trashName: i.trashName,
  }))
  printTable(rows, ['asset', 'type', 'versions', 'deleted', 'agent', 'trashName'])
  console.log(`\nTo restore: bakin trash restore <trashName>`)
}

async function cmdTrashRestore(trashName: string): Promise<void> {
  const data = await apiPost(`/api/plugins/assets/trash/${encodeURIComponent(trashName)}/restore`) as { ok: boolean; assetId?: string }
  if (process.stdout.isTTY) {
    await printTrashActionTui({
      action: 'restored',
      target: trashName,
      count: 1,
      message: `Restored ${data.assetId ?? trashName}.`,
    })
    return
  }
  console.log(`Restored → ${data.assetId ?? trashName}`)
}

async function cmdTrashEmpty(): Promise<void> {
  const items = await fetchTrashItems()
  if (items.length === 0) {
    if (process.stdout.isTTY) {
      await printTrashActionTui({
        action: 'empty',
        count: 0,
        message: 'Trash is already empty.',
      })
      return
    }
    console.log('Trash is already empty.')
    return
  }
  const data = await apiDelete('/api/plugins/assets/trash') as { ok: boolean; deleted: number }
  if (process.stdout.isTTY) {
    await printTrashActionTui({
      action: 'emptied',
      count: data.deleted,
      message: `Permanently deleted ${data.deleted} item${data.deleted !== 1 ? 's' : ''}.`,
    })
    return
  }
  console.log(`Permanently deleted ${data.deleted} item${data.deleted !== 1 ? 's' : ''}.`)
}

export async function run(args: string[]): Promise<void> {
  const sub = args[1]
  if (!sub || sub === 'list') {
    await cmdTrashList()
  } else if (sub === 'restore') {
    if (!args[2]) await exitUsage('bakin trash restore <trashName>')
    await cmdTrashRestore(args[2])
  } else if (sub === 'empty') {
    await cmdTrashEmpty()
  } else {
    await exitUnknownSubcommand('trash', sub, ['list', 'restore', 'empty'])
  }
}
