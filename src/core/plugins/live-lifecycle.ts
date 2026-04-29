import { pluginRegistry } from '@/lib/plugin-registry'
import { bumpVersion } from '@/core/plugin-host/version-stamp'
import { createLogger } from '@/core/logger'
import { broadcastPluginManifestChanged, broadcastPluginReload } from '@/core/sse'
import { ensurePluginSearchReady } from '@/core/search-registry'
import { broadcastDev } from '../../../packages/host/src/api/dev/events'

const log = createLogger('plugin-live-lifecycle')

export interface LiveActivationResult {
  id: string
  version: string
  runtimeVersion: number
}

export function isLiveActivationUnavailable(err: unknown): boolean {
  return err instanceof Error && err.message.includes('plugin registry is not initialized')
}

export async function activateUserPluginDir(pluginDir: string): Promise<LiveActivationResult> {
  const result = await pluginRegistry.activateUserPluginFromDir(pluginDir, {
    cacheBust: true,
    preferDist: true,
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
