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
 *
 * Runs as an operation (#895, PLUGIN_LINK_PLAN) owning install-state; only
 * validation is cancellable. `startLinkOperation` is shared with
 * `install --dev`, the same core path.
 */
import { OperationCancelledError, operationOriginFromRequest, responseOutcome, type OperationContext, type OperationOutcome } from '@bakin/core/operations'
import { createLogger } from '@/core/logger'
import { linkPlugin, LinkRefusedError } from '@/core/plugins/link'
import {
  activateUserPluginDir,
  isLiveActivationUnavailable,
  watchLinkedPluginIfEnabled,
} from '@/core/plugins/live-lifecycle'
import { LINK_STAGES, PLUGIN_LINK_PLAN } from '@/core/plugins/operation-plans'
import { startOperationResponse } from '../operations'

const log = createLogger('plugin-link-endpoint')

interface LinkBody {
  localPath: string
  force?: boolean
}

export async function post(req: Request): Promise<Response> {
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
  return startLinkOperation(req, body.localPath, body.force === true, 'link')
}

/** Link `localPath` as a dev plugin — `bakin plugins link` and `install --dev`. */
export function startLinkOperation(req: Request, localPath: string, force: boolean, flavor: 'link' | 'dev-install'): Promise<Response> {
  return startOperationResponse<Record<string, unknown>>({
    kind: 'link',
    owner: 'core',
    origin: operationOriginFromRequest(req),
    title: `Link ${localPath}`,
    href: '/health',
    fingerprint: `plugins:link:${localPath}|${force ? 'force' : ''}`,
    resources: ['install-state'],
    plan: PLUGIN_LINK_PLAN,
    run: (op) => runLink(localPath, force, flavor, op),
  })
}

async function runLink(localPath: string, force: boolean, flavor: 'link' | 'dev-install', op: OperationContext): Promise<OperationOutcome<Record<string, unknown>>> {
  try {
    const result = await linkPlugin(localPath, { force, op })
    op.stage(LINK_STAGES.activate)
    let runtimeVersion: number | undefined
    let activated = false
    try {
      const activation = await activateUserPluginDir(result.pluginDir)
      runtimeVersion = activation.runtimeVersion
      activated = true
    } catch (activationErr) {
      // A dev install outside a running registry activates on the next start;
      // an explicit link expects a live registry.
      if (flavor === 'link' || !isLiveActivationUnavailable(activationErr)) throw activationErr
    }
    const watching = activated ? await watchLinkedPluginIfEnabled(result.id, result.linkedSource) : false
    log.info(`${flavor === 'link' ? 'Linked' : 'Dev-installed'} plugin "${result.id}"`, {
      source: result.linkedSource,
      version: result.version,
      activated,
      watching,
    })
    const message = flavor === 'link'
      ? `Linked "${result.id}" and activated it${watching ? ' with dev hot reload' : ''}.`
      : activated
        ? `Dev-installed "${result.id}" and activated it${watching ? ' with hot reload' : ''}.`
        : `Dev-installed "${result.id}". It will activate on the next Bakin start.`
    return responseOutcome(200, {
      ok: true,
      id: result.id,
      pluginDir: result.pluginDir,
      linkedSource: result.linkedSource,
      version: result.version,
      ...(runtimeVersion !== undefined ? { runtimeVersion } : {}),
      ...(flavor === 'dev-install' ? { activated } : {}),
      watching,
      message,
    })
  } catch (err) {
    if (err instanceof OperationCancelledError) throw err
    if (err instanceof LinkRefusedError) return responseOutcome(400, { ok: false, error: err.message })
    const message = err instanceof Error ? err.message : String(err)
    log.error('Plugin link failed', err as Error, { localPath })
    return responseOutcome(500, { ok: false, error: message })
  }
}
