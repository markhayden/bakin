/**
 * The ONE handler behind POST /api/plugins/disable and /api/plugins/enable
 * (self-healing PR1, row 98 containment). Body: `{ pluginId }`.
 *
 * Synchronous and bounded (#895 D23): takes install-state WITHOUT waiting —
 * busy answers 409 `install_busy` naming the holder. The ledger flag is the
 * durable change; the running server follows it live when it can: disable
 * deactivates the plugin in-process (routes, hooks, tools gone; the browser
 * reloads its manifest), enable activates the directory again. When the live
 * step cannot run (registry not initialized, the activation throws) the
 * response says `live: false` with the reason — the flag is set and the next
 * server restart applies it; never a silent no-op.
 */
import { join } from 'path'
import { ResourceBusyError, holdNow } from '@bakin/core/operations'
import { getContentDir } from '@/core/content-dir'
import { createLogger } from '@/core/logger'
import { pluginRegistry } from '@/core/plugin-registry'
import { PluginEnableRefusedError, setPluginEnabled } from '@/core/plugins/disable'
import { activateUserPluginDir, isLiveActivationUnavailable, notifyPluginRemoved, unwatchPluginIfEnabled } from '@/core/plugins/live-lifecycle'

const log = createLogger('plugin-enable-endpoint')

export interface EnableToggleResponse {
  ok: true
  id: string
  disabled: boolean
  changed: boolean
  /** The running server applied the change in-process. */
  live: boolean
  /** Why it did not, when `live` is false — the flag applies at the next restart. */
  liveError?: string
  message: string
}

export async function toggleEnabled(req: Request, enabled: boolean): Promise<Response> {
  let body: { pluginId?: unknown }
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!body.pluginId || typeof body.pluginId !== 'string') {
    return Response.json({ ok: false, error: 'Missing pluginId' }, { status: 400 })
  }
  const pluginId = body.pluginId
  const verb = enabled ? 'Enable' : 'Disable'
  try {
    const result = await holdNow(['install-state'], { title: `${verb} ${pluginId}` }, async () => {
      const change = setPluginEnabled(pluginId, enabled)
      let live = true
      let liveError: string | undefined
      try {
        if (!enabled) {
          await unwatchPluginIfEnabled(pluginId)
          const state = pluginRegistry.getPluginState(pluginId)
          if (state) await pluginRegistry.deactivatePlugin(pluginId, { callShutdown: true, removeState: true })
          pluginRegistry.markPluginDisabled({
            id: pluginId,
            name: state?.plugin.name ?? pluginId,
            version: state?.manifest?.version ?? state?.plugin.version ?? '0.0.0',
            description: state?.description ?? '',
          })
        } else {
          pluginRegistry.clearPluginDisabled(pluginId)
          if (!pluginRegistry.getPluginState(pluginId)) await activateUserPluginDir(join(getContentDir(), 'plugins', pluginId))
        }
      } catch (err) {
        live = false
        liveError = isLiveActivationUnavailable(err)
          ? 'The plugin registry is not running — the change applies at the next server start.'
          : `${err instanceof Error ? err.message : String(err)} — the change applies at the next server start.`
        log.warn(`${verb} ${pluginId}: ledger updated, live step did not run`, { err: liveError })
      }
      return { change, live, liveError }
    })
    if (!enabled && result.live) notifyPluginRemoved(pluginId)
    const message = result.change.changed
      ? `${enabled ? 'Enabled' : 'Disabled'} "${pluginId}"${result.live ? '' : ` (takes effect at the next restart: ${result.liveError})`}.`
      : `"${pluginId}" was already ${enabled ? 'enabled' : 'disabled'}.`
    const response: EnableToggleResponse = { ok: true, id: pluginId, disabled: result.change.disabled, changed: result.change.changed, live: result.live, ...(result.liveError ? { liveError: result.liveError } : {}), message }
    return Response.json(response)
  } catch (err) {
    if (err instanceof ResourceBusyError) {
      return Response.json({ ok: false, error: 'install_busy', message: err.message, holder: { title: err.holder.title, operationId: err.holder.operationId } }, { status: 409 })
    }
    if (err instanceof PluginEnableRefusedError) {
      return Response.json({ ok: false, error: err.kind, message: err.message, ...(err.kind === 'core_plugin' ? { core: true } : {}) }, { status: err.kind === 'core_plugin' ? 409 : 404 })
    }
    const message = err instanceof Error ? err.message : String(err)
    log.error(`Plugin ${verb.toLowerCase()} failed`, err as Error, { pluginId })
    return Response.json({ ok: false, error: message }, { status: 500 })
  }
}
