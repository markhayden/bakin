import { existsSync, readFileSync } from 'fs'
import { basename, join } from 'path'
import { isPluginDisabled, readPluginLockfile } from '@bakin/core/plugins/lockfile'
import { PluginRegistryNotInitializedError, pluginRegistry } from '@/core/plugin-registry'
import { bumpVersion, getVersion } from '@/core/plugin-host/version-stamp'
import { createLogger } from '@/core/logger'
import { broadcastPluginManifestChanged, broadcastPluginReload } from '@/core/sse'
import { ensurePluginSearchReady } from '@/core/search-registry'
import { broadcastDev } from '../../../packages/host/src/api/dev/events'

const log = createLogger('plugin-live-lifecycle')

export interface LiveActivationResult {
  id: string
  version: string
  runtimeVersion: number
  /** The directory was NOT activated: the ledger marks the plugin disabled (row 98); only Enable clears that. */
  skipped?: 'disabled'
}

export function isLiveActivationUnavailable(err: unknown): boolean {
  return err instanceof PluginRegistryNotInitializedError
}

/** The directory's manifest identity, read without the registry (null when unreadable — the registry then reports the real error). */
function manifestIdentity(pluginDir: string): { id: string; name: string; version: string; description: string } | null {
  try {
    const manifestPath = join(pluginDir, 'bakin-plugin.json')
    if (!existsSync(manifestPath)) return null
    const raw = JSON.parse(readFileSync(manifestPath, 'utf-8')) as { id?: unknown; name?: unknown; version?: unknown; description?: unknown }
    const id = typeof raw.id === 'string' && raw.id ? raw.id : basename(pluginDir)
    return {
      id,
      name: typeof raw.name === 'string' && raw.name ? raw.name : id,
      version: typeof raw.version === 'string' && raw.version ? raw.version : '0.0.0',
      description: typeof raw.description === 'string' ? raw.description : '',
    }
  } catch {
    return null
  }
}

/** The ledger's `disabled` mark for this directory's plugin; an unreadable ledger disables nothing. */
function ledgerDisables(pluginId: string, dirName: string): boolean {
  try {
    const lock = readPluginLockfile()
    return isPluginDisabled(lock.plugins[pluginId]) || isPluginDisabled(lock.plugins[dirName])
  } catch (err) {
    log.warn('Plugin lockfile unreadable during live activation — treating the plugin as enabled', { pluginId, err: err instanceof Error ? err.message : String(err) })
    return false
  }
}

/**
 * The ONE live activation boundary (install commit, upgrade, restore, link,
 * enable, Health's plugin repairs). A plugin the ledger marks disabled is
 * NEVER activated here (Codex r2 N7): the directory is left in place, the
 * registry keeps listing it `disabled`, and the caller is told so — only the
 * enable route clears the mark (it does, before calling this).
 */
export async function activateUserPluginDir(pluginDir: string): Promise<LiveActivationResult> {
  const identity = manifestIdentity(pluginDir)
  if (identity && ledgerDisables(identity.id, basename(pluginDir))) {
    pluginRegistry.markPluginDisabled(identity)
    broadcastPluginManifestChanged(identity.id, 'changed')
    log.info(`Plugin "${identity.id}" stays disabled — not activated`, { pluginDir })
    return { id: identity.id, version: identity.version, runtimeVersion: getVersion(identity.id), skipped: 'disabled' }
  }
  const result = await pluginRegistry.activateUserPluginFromDir(pluginDir, {
    cacheBust: true,
  })
  try {
    await ensurePluginSearchReady(result.id)
  } catch (err) {
    // Search readiness is best-effort during live install/link. The plugin
    // stays activated; health/reindex surfaces backend failures separately.
    log.warn('live activation search readiness failed', { pluginId: result.id, err: String(err) })
  }
  const runtimeVersion = bumpVersion(result.id)
  broadcastPluginReload(result.id, runtimeVersion)
  broadcastPluginManifestChanged(result.id, 'changed')
  return { ...result, runtimeVersion }
}

export async function watchLinkedPluginIfEnabled(pluginId: string, linkedSource: string): Promise<boolean> {
  if (process.env.BAKIN_DEV !== '1' && process.env.BAKIN_DEV_HOTRELOAD !== '1') return false
  const { startHotReloadCoordinator, watchLinkedPlugin } = await import('@/core/plugin-host/hot-reload-coordinator')
  startHotReloadCoordinator()
  return watchLinkedPlugin(pluginId, linkedSource)
}

export async function unwatchPluginIfEnabled(pluginId: string): Promise<boolean> {
  if (process.env.BAKIN_DEV !== '1' && process.env.BAKIN_DEV_HOTRELOAD !== '1') return false
  const { unwatchPlugin } = await import('@/core/plugin-host/hot-reload-coordinator')
  return unwatchPlugin(pluginId)
}

export function notifyPluginRemoved(pluginId: string): void {
  broadcastPluginManifestChanged(pluginId, 'removed')
  // Removal changes the route tree and nav registry. A full browser reload
  // is simpler and less fragile than inventing a client-side "unmount this
  // plugin if present" event for a dev-only transition.
  broadcastDev({ type: 'dev:reload', scope: 'plugin' })
}
