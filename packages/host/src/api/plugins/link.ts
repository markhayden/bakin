/**
 * POST /api/plugins/link — register a developer-owned source tree as a
 * symlinked plugin (Phase 2 P2.C3).
 *
 * Body: `{ localPath: string, force?: boolean }`. The path is resolved
 * relative to the server's `process.cwd()` if not absolute — same shape
 * as the install endpoint's local-path handling.
 *
 * Validation, symlink creation, initial build, and lockfile write all
 * happen in `src/core/plugins/link.ts` — this endpoint is the thin HTTP
 * adapter so the CLI can drive the same code path. LinkRefusedError →
 * 400; everything else → 500.
 *
 * The endpoint activates the plugin immediately when the registry is
 * initialized, and attaches the linked-source watcher in dev mode.
 */
import { createLogger } from '@/core/logger'
import { linkPlugin, LinkRefusedError } from '@/core/plugins/link'
import {
  activateUserPluginDir,
  watchLinkedPluginIfEnabled,
} from '@/core/plugins/live-lifecycle'

const log = createLogger('plugin-link-endpoint')

interface LinkBody {
  localPath: string
  force?: boolean
}

export async function post(req: Request, _url: URL): Promise<Response> {
  let body: LinkBody
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.localPath || typeof body.localPath !== 'string') {
    return Response.json({ ok: false, error: 'Missing localPath' }, { status: 400 })
  }
  if (body.force !== undefined && typeof body.force !== 'boolean') {
    return Response.json({ ok: false, error: 'force must be a boolean' }, { status: 400 })
  }

  try {
    const result = await linkPlugin(body.localPath, { force: body.force })
    const activation = await activateUserPluginDir(result.pluginDir)
    const watching = await watchLinkedPluginIfEnabled(result.id, result.linkedSource)
    log.info(`Linked plugin "${result.id}"`, {
      source: result.linkedSource,
      version: result.version,
      activated: true,
      watching,
    })
    return Response.json({
      ok: true,
      id: result.id,
      pluginDir: result.pluginDir,
      linkedSource: result.linkedSource,
      version: result.version,
      runtimeVersion: activation.runtimeVersion,
      watching,
      message: `Linked "${result.id}" and activated it${watching ? ' with dev hot reload' : ''}.`,
    })
  } catch (err) {
    if (err instanceof LinkRefusedError) {
      return Response.json({ ok: false, error: err.message }, { status: 400 })
    }
    const message = err instanceof Error ? err.message : String(err)
    log.error('Plugin link failed', err as Error, { localPath: body.localPath })
    return Response.json({ ok: false, error: message }, { status: 500 })
  }
}
