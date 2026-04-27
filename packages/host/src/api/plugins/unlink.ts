/**
 * POST /api/plugins/unlink — remove a linked plugin's symlink + lockfile
 * entry (Phase 2 P2.C3).
 *
 * Body: `{ pluginId: string }`. Only acts on entries where `linked ===
 * true`; refuses installed (non-linked) plugins (use /api/plugins/remove
 * for those, which runs the snapshot + teardown sweep). LinkRefusedError
 * → 400; everything else → 500.
 *
 * As with link, restart is still required for the registry teardown to
 * complete in the running process. The hot-reload coordinator (P2.C8)
 * adds in-process teardown for live unlink without a restart.
 */
import { createLogger } from '@/core/logger'
import { unlinkPlugin, LinkRefusedError } from '@/core/plugins/link'

const log = createLogger('plugin-unlink-endpoint')

interface UnlinkBody {
  pluginId: string
}

export async function post(req: Request, _url: URL): Promise<Response> {
  let body: UnlinkBody
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.pluginId || typeof body.pluginId !== 'string') {
    return Response.json({ ok: false, error: 'Missing pluginId' }, { status: 400 })
  }

  try {
    const result = await unlinkPlugin(body.pluginId)
    log.info(`Unlinked plugin "${result.id}"`, { source: result.linkedSource })
    return Response.json({
      ok: true,
      id: result.id,
      message: `Unlinked "${result.id}". Restart Bakin to release the plugin.`,
    })
  } catch (err) {
    if (err instanceof LinkRefusedError) {
      return Response.json({ ok: false, error: err.message }, { status: 400 })
    }
    const message = err instanceof Error ? err.message : String(err)
    log.error('Plugin unlink failed', err as Error, { pluginId: body.pluginId })
    return Response.json({ ok: false, error: message }, { status: 500 })
  }
}
