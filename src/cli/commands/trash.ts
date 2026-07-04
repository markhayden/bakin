/**
 * `bakin trash {list,restore,empty}` — asset trash management.
 * Relocated verbatim from cli/bakin.ts (B5.3 command-module split).
 */
import { apiGet, apiPost, apiDelete } from '../http'
import { printTable, formatBytes, daysUntil } from '../output'
import { exitUsage, exitUnknownSubcommand } from '../help'
import { renderInkReport } from '../../core/cli/ui/render-report'
import type { TrashActionData } from '../../core/cli/ui/readonly'

async function printTrashListTui(assets: Array<Record<string, unknown>>): Promise<void> {
  return renderInkReport(() => import('../../core/cli/ui/readonly'), (m) => m.TrashListReport, { assets })
}

async function printTrashActionTui(action: TrashActionData): Promise<void> {
  return renderInkReport(() => import('../../core/cli/ui/readonly'), (m) => m.TrashActionReport, { action })
}

async function cmdTrashList(): Promise<void> {
  const data = await apiGet('/api/plugins/assets/trash') as { assets: Array<{ filename: string; originalFilename: string; type: string; size: number; deletedAt: string; expiresAt: string; metadata: { agent?: string } | null }>; count: number }
  if (process.stdout.isTTY) {
    await printTrashListTui(data.assets as Array<Record<string, unknown>>)
    return
  }
  if (data.count === 0) {
    console.log('Trash is empty.')
    return
  }
  console.log(`${data.count} item${data.count !== 1 ? 's' : ''} in trash:\n`)
  const rows = data.assets.map(a => ({
    filename: a.originalFilename,
    type: a.type,
    size: formatBytes(a.size),
    deleted: new Date(a.deletedAt).toLocaleString(),
    expires: daysUntil(a.expiresAt),
    agent: a.metadata?.agent ?? 'unknown',
    trashName: a.filename,
  }))
  printTable(rows, ['filename', 'type', 'size', 'deleted', 'expires', 'agent'])
  console.log(`\nTo restore: bakin trash restore <trashName>`)
  console.log('Use the full trash filename (with __deleted- suffix) from the list above.')
}

async function cmdTrashRestore(filename: string): Promise<void> {
  const data = await apiPost(`/api/plugins/assets/trash/${encodeURIComponent(filename)}/restore`) as { ok: boolean; restoredPath: string }
  if (process.stdout.isTTY) {
    await printTrashActionTui({
      action: 'restored',
      target: filename,
      count: 1,
      message: `Restored ${filename}.`,
      detail: data.restoredPath,
    })
    return
  }
  console.log(`Restored → ${data.restoredPath}`)
}

async function cmdTrashEmpty(): Promise<void> {
  const check = await apiGet('/api/plugins/assets/trash') as { count: number }
  if (check.count === 0) {
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
    if (!args[2]) await exitUsage('bakin trash restore <filename>')
    await cmdTrashRestore(args[2])
  } else if (sub === 'empty') {
    await cmdTrashEmpty()
  } else {
    await exitUnknownSubcommand('trash', sub, ['list', 'restore', 'empty'])
  }
}
