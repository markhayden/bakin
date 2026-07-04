/**
 * Install phase (a) — the dev-install/link branch (`dev: true`).
 *
 * Symlinks the local source as a linked plugin, live-activates it when the
 * registry is up, and optionally starts the hot-reload watcher. Never
 * touches the staging/copy/build pipeline the normal install path uses.
 */
import { createLogger } from '@/core/logger'
import { linkPlugin, LinkRefusedError } from '@/core/plugins/link'
import {
  activateUserPluginDir,
  isLiveActivationUnavailable,
  watchLinkedPluginIfEnabled,
} from '@/core/plugins/live-lifecycle'
import type { InstallBody } from './body'

const log = createLogger('plugin-install')

/** Handle a `dev: true` install request. Mirrors `bakin plugins link`. */
export async function handleDevInstall(body: InstallBody): Promise<Response> {
  if (body.type !== 'local') {
    return Response.json({
      ok: false,
      error: 'dev installs only support local plugin paths; clone the source locally and run `bakin plugins install --dev <path>`',
    }, { status: 400 })
  }
  try {
    const result = await linkPlugin(body.source, { force: body.force === true })
    let runtimeVersion: number | undefined
    let activated = false
    try {
      const activation = await activateUserPluginDir(result.pluginDir)
      runtimeVersion = activation.runtimeVersion
      activated = true
    } catch (activationErr) {
      if (!isLiveActivationUnavailable(activationErr)) throw activationErr
    }
    const watching = activated
      ? await watchLinkedPluginIfEnabled(result.id, result.linkedSource)
      : false
    log.info(`Dev-installed plugin "${result.id}"`, {
      source: result.linkedSource,
      version: result.version,
      activated,
      watching,
    })
    return Response.json({
      ok: true,
      id: result.id,
      pluginDir: result.pluginDir,
      linkedSource: result.linkedSource,
      version: result.version,
      ...(runtimeVersion !== undefined ? { runtimeVersion } : {}),
      activated,
      watching,
      message: activated
        ? `Dev-installed "${result.id}" and activated it${watching ? ' with hot reload' : ''}.`
        : `Dev-installed "${result.id}". It will activate on the next Bakin start.`,
    })
  } catch (err) {
    if (err instanceof LinkRefusedError) {
      return Response.json({ ok: false, error: err.message }, { status: 400 })
    }
    const message = err instanceof Error ? err.message : String(err)
    log.error('Plugin dev install failed', err as Error, { source: body.source })
    return Response.json({ ok: false, error: message }, { status: 500 })
  }
}
