/**
 * POST /api/plugins/unlink — remove a linked plugin's symlink + lockfile
 * entry (Phase 2 P2.C3).
 *
 * Body: `{ pluginId: string }`. Only acts on entries where `linked ===
 * true`; refuses installed (non-linked) plugins (use /api/plugins/remove
 * for those, which runs the snapshot + teardown sweep). LinkRefusedError
 * → 400; everything else → 500.
 *
 * The endpoint also tears down the in-memory plugin registrations and
 * stops the linked-source watcher in dev mode.
 *
 * Synchronous and bounded (#895 D23): it takes install-state WITHOUT waiting
 * — busy answers 409 `install_busy` naming the holder.
 */
import { ResourceBusyError, holdNow } from '@bakin/core/operations'
import { createLogger } from '@/core/logger'
import { unlinkPlugin, LinkRefusedError } from '@/core/plugins/link'
import { pluginRegistry } from '@/core/plugin-registry'
import {
  notifyPluginRemoved,
  unwatchPluginIfEnabled,
} from '@/core/plugins/live-lifecycle'

const log = createLogger('plugin-unlink-endpoint')

interface UnlinkBody {
  pluginId: string
}

export async function post(req: Request): Promise<Response> {
  let body: UnlinkBody
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.pluginId || typeof body.pluginId !== 'string') {
    return Response.json({ ok: false, error: 'Missing pluginId' }, { status: 400 })
  }

  const pluginId = body.pluginId
  try {
    const result = await holdNow(['install-state'], { title: `Unlink ${pluginId}` }, async () => {
      await unwatchPluginIfEnabled(pluginId)
      const unlinked = await unlinkPlugin(pluginId)
      await pluginRegistry.deactivatePlugin(unlinked.id, { callShutdown: true, removeState: true })
      return unlinked
    })
    notifyPluginRemoved(result.id)
    log.info(`Unlinked plugin "${result.id}"`, { source: result.linkedSource })
    return Response.json({
      ok: true,
      id: result.id,
      message: `Unlinked "${result.id}" and deactivated it.`,
    })
  } catch (err) {
    if (err instanceof ResourceBusyError) {
      return Response.json({
        ok: false,
        error: 'install_busy',
        message: err.message,
        holder: { title: err.holder.title, operationId: err.holder.operationId },
      }, { status: 409 })
    }
    if (err instanceof LinkRefusedError) {
      return Response.json({ ok: false, error: err.message }, { status: 400 })
    }
    const message = err instanceof Error ? err.message : String(err)
    log.error('Plugin unlink failed', err as Error, { pluginId: body.pluginId })
    return Response.json({ ok: false, error: message }, { status: 500 })
  }
}
