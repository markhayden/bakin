/**
 * POST /api/plugins/restore — restore a user plugin from a pre-uninstall
 * snapshot under ~/.bakin/.uninstalled/.
 */
import { getContentDir } from '@/core/content-dir'
import { appendAudit } from '@/core/audit'
import { createLogger } from '@/core/logger'
import { isCorePlugin, pluginRegistry } from '@/lib/plugin-registry'
import {
  listUninstallSnapshots,
  PluginRestoreError,
  restoreUninstallSnapshot,
} from '@/core/plugins/uninstall-snapshot'
import {
  activateUserPluginDir,
  isLiveActivationUnavailable,
} from '@/core/plugins/live-lifecycle'

const log = createLogger('plugin-restore')
const PLUGIN_ID_RE = /^[a-z][a-z0-9-]{0,39}$/

interface RestoreBody {
  pluginId?: unknown
  snapshot?: unknown
  force?: unknown
  listOnly?: unknown
}

export async function post(req: Request, _url: URL): Promise<Response> {
  void _url
  let body: RestoreBody
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const pluginId = body.pluginId
  if (typeof pluginId !== 'string' || pluginId.length === 0) {
    return Response.json({ ok: false, error: 'Missing pluginId' }, { status: 400 })
  }
  if (!PLUGIN_ID_RE.test(pluginId)) {
    return Response.json({ ok: false, error: `Invalid pluginId "${pluginId}"` }, { status: 400 })
  }
  if (body.snapshot !== undefined && typeof body.snapshot !== 'string') {
    return Response.json({ ok: false, error: 'snapshot must be a string' }, { status: 400 })
  }
  if (body.force !== undefined && typeof body.force !== 'boolean') {
    return Response.json({ ok: false, error: 'force must be a boolean' }, { status: 400 })
  }
  if (body.listOnly !== undefined && typeof body.listOnly !== 'boolean') {
    return Response.json({ ok: false, error: 'listOnly must be a boolean' }, { status: 400 })
  }

  if (isCorePlugin(pluginId)) {
    return Response.json({
      ok: false,
      core: true,
      error: `cannot restore core plugin: ${pluginId}. Core plugins ship with Bakin and are managed via the binary itself.`,
    }, { status: 400 })
  }

  if (body.listOnly === true) {
    return Response.json({
      ok: true,
      id: pluginId,
      restored: false,
      snapshots: listUninstallSnapshots(pluginId),
    })
  }

  try {
    const restored = await restoreUninstallSnapshot({
      pluginId,
      snapshot: body.snapshot,
      force: body.force === true,
    })

    const sweep = body.force === true
      ? await pluginRegistry.deactivatePlugin(pluginId, { callShutdown: true, removeState: true })
      : undefined
    let activated = false
    let runtimeVersion: number | undefined
    try {
      const activation = await activateUserPluginDir(restored.pluginDir)
      activated = true
      runtimeVersion = activation.runtimeVersion
    } catch (activationErr) {
      if (!isLiveActivationUnavailable(activationErr)) throw activationErr
    }

    appendAudit(getContentDir(), 'plugin.restore', 'system', {
      pluginId,
      snapshot: restored.snapshot.path,
      skills: restored.restoredSkills,
      activated,
      sweep,
    }, 'system')

    return Response.json({
      ok: true,
      restored: true,
      id: pluginId,
      pluginDir: restored.pluginDir,
      settingsFile: restored.settingsFile,
      snapshot: restored.snapshot.path,
      snapshotInfo: restored.snapshot,
      skills: { restored: restored.restoredSkills.length, names: restored.restoredSkills },
      sweep,
      activated,
      ...(runtimeVersion !== undefined ? { runtimeVersion } : {}),
      message: `Restored "${pluginId}" from ${restored.snapshot.filename}.`,
    })
  } catch (err) {
    if (err instanceof PluginRestoreError) {
      return Response.json({
        ok: false,
        error: err.message,
        code: err.code,
        snapshots: err.snapshots,
      }, { status: err.status })
    }
    log.error('plugin restore failed', err as Error, { pluginId })
    return Response.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 })
  }
}
