/**
 * Boot-time recovery for interrupted plugin installs/upgrades, and the
 * loader's predicate for which user-plugin directories are real installs.
 *
 * Runs BEFORE user-plugin discovery: every `.bakin-backup-<id>` directory and
 * every sentinel-bearing `<id>/` under `~/.bakin/plugins/` is resolved through
 * {@link recoverPluginDir}, so the loader only ever sees committed
 * directories. The loader additionally skips dot-prefixed entries (backups,
 * staging clones) and any dir still carrying a sentinel — defence in depth
 * for the case where recovery itself failed.
 */
import { existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { createLogger } from '@/core/logger'
import { BACKUP_PREFIX, INSTALL_SENTINEL, recoverPluginDir } from './replace-transaction'

const log = createLogger('plugin-recovery')

export interface PluginRecoveryReport {
  /** Plugin ids whose interrupted operation was rolled back or whose backup was cleaned. */
  recovered: string[]
}

export function recoverInterruptedPluginOps(pluginsRoot: string): PluginRecoveryReport {
  const recovered: string[] = []
  if (!existsSync(pluginsRoot)) return { recovered }

  const ids = new Set<string>()
  for (const entry of readdirSync(pluginsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith(BACKUP_PREFIX)) ids.add(entry.name.slice(BACKUP_PREFIX.length))
    else if (!entry.name.startsWith('.') && existsSync(join(pluginsRoot, entry.name, INSTALL_SENTINEL))) ids.add(entry.name)
  }
  for (const id of ids) {
    try {
      if (recoverPluginDir(pluginsRoot, id)) recovered.push(id)
    } catch (err) {
      log.error('Plugin recovery failed — the directory stays hidden from the loader', err as Error, { id })
    }
  }
  return { recovered }
}

/** True for a committed user-plugin directory the loader may load. */
export function isLoadableUserPluginDir(pluginsRoot: string, name: string): boolean {
  if (name.startsWith('.')) return false
  const dir = join(pluginsRoot, name)
  try {
    if (!statSync(dir).isDirectory()) return false
  } catch {
    return false
  }
  return !existsSync(join(dir, INSTALL_SENTINEL))
}
