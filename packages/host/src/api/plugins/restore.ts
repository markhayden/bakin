/**
 * POST /api/plugins/restore — restore a user plugin from a pre-uninstall
 * snapshot under ~/.bakin/.uninstalled/.
 *
 * `listOnly` answers synchronously. A restore runs as an operation (#895,
 * PLUGIN_RESTORE_PLAN) that owns install-state: unpacking and conflict checks
 * are cancellable; the first delete (--force) or copy is the point of no
 * return. 202 `{ operationId, bootId }`; the old body is the result.
 */
import { OperationCancelledError, operationOriginFromRequest, responseOutcome, type OperationContext, type OperationOutcome } from '@bakin/core/operations'
import { getContentDir } from '@/core/content-dir'
import { appendAudit } from '@/core/audit'
import { createLogger } from '@/core/logger'
import { isCorePlugin, pluginRegistry } from '@/core/plugin-registry'
import {
  listUninstallSnapshots,
  PluginRestoreError,
  restoreUninstallSnapshot,
} from '@/core/plugins/uninstall-snapshot'
import {
  activateUserPluginDir,
  isLiveActivationUnavailable,
} from '@/core/plugins/live-lifecycle'
import { PLUGIN_RESTORE_PLAN, RESTORE_STAGES } from '@/core/plugins/operation-plans'
import { startOperationResponse } from '../operations'

const log = createLogger('plugin-restore')
const PLUGIN_ID_RE = /^[a-z][a-z0-9-]{0,39}$/

interface RestoreBody {
  pluginId?: unknown
  snapshot?: unknown
  force?: unknown
  listOnly?: unknown
}

export async function post(req: Request): Promise<Response> {
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

  const snapshot = body.snapshot as string | undefined
  const force = body.force === true
  return startOperationResponse<Record<string, unknown>>({
    kind: 'restore',
    owner: 'core',
    origin: operationOriginFromRequest(req),
    title: `Restore ${pluginId}`,
    href: '/health',
    fingerprint: `plugins:restore:${pluginId}|${snapshot ?? 'latest'}|${force ? 'force' : ''}`,
    resources: ['install-state'],
    plan: PLUGIN_RESTORE_PLAN,
    run: (op) => runRestore(pluginId, snapshot, force, op),
  })
}

async function runRestore(pluginId: string, snapshot: string | undefined, force: boolean, op: OperationContext): Promise<OperationOutcome<Record<string, unknown>>> {
  try {
    const restored = await restoreUninstallSnapshot({ pluginId, snapshot, force, op })

    op.stage(RESTORE_STAGES.activate)
    const sweep = force
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

    return responseOutcome(200, {
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
    if (err instanceof OperationCancelledError) throw err
    if (err instanceof PluginRestoreError) {
      return responseOutcome(err.status, {
        ok: false,
        error: err.message,
        code: err.code,
        snapshots: err.snapshots,
      })
    }
    log.error('plugin restore failed', err as Error, { pluginId })
    return responseOutcome(500, { ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
