/**
 * POST /api/plugins/upgrade — re-pull a user plugin from its recorded source
 * (github fast-forward or local re-cpSync), rebuild, and update its
 * lockfile entry. Refuses core plugins (defense in depth — `upgradePlugin`
 * also enforces this).
 *
 * Body: { pluginId: string, yes?: boolean }
 *
 * Response shape:
 *   { ok: true, id, before, after, noop, awaitingConsent, newPermissions, pluginAssets? }
 *   { ok: false, error: string, core?: boolean }    on refusal/4xx
 *
 * The upgraded plugin is activated immediately after a successful rebuild.
 */
import { createLogger } from '@/core/logger'
import { upgradePlugin, UpgradeRefusedError } from '@/core/plugins/upgrade'
import { isCorePlugin } from '@/core/plugin-registry'
import { appendAudit } from '@/core/audit'
import { getContentDir } from '@/core/content-dir'
import { activateUserPluginDir } from '@/core/plugins/live-lifecycle'
import { join } from 'path'

const log = createLogger('plugin-upgrade')

interface UpgradeBody {
  pluginId: string
  yes?: boolean
}

export async function post(req: Request, _url: URL): Promise<Response> {
  let body: UpgradeBody
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const pluginId = body.pluginId
  if (!pluginId || typeof pluginId !== 'string') {
    return Response.json({ ok: false, error: 'Missing pluginId' }, { status: 400 })
  }
  // Match install.ts:311 — lowercase letters, digits, hyphen only; must
  // start with a letter. C12 tightened install but missed this endpoint.
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(pluginId)) {
    return Response.json({ ok: false, error: `Invalid pluginId "${pluginId}"` }, { status: 400 })
  }

  if (isCorePlugin(pluginId)) {
    // Audit at the API layer too — the inner upgradePlugin guard also
    // audits, but the API-layer check returns 400 before reaching it,
    // so the forensic trail would otherwise be missing for this path.
    try {
      appendAudit(getContentDir(), 'plugin.upgrade.rejected', 'system', {
        kind: 'security',
        reason: 'core_plugin',
        pluginId,
      }, 'system')
    } catch {
      // best-effort
    }
    return Response.json({
      ok: false,
      core: true,
      error: `cannot upgrade core plugin: ${pluginId}. Core plugins ship with Bakin and are managed via the binary itself.`,
    }, { status: 400 })
  }

  try {
    const result = await upgradePlugin(pluginId, { yes: body.yes === true })
    let runtimeVersion: number | undefined
    if (!result.noop && !result.awaitingConsent) {
      try {
        const activation = await activateUserPluginDir(join(getContentDir(), 'plugins', pluginId))
        runtimeVersion = activation.runtimeVersion
      } catch (activationErr) {
        const message = activationErr instanceof Error ? activationErr.message : String(activationErr)
        log.error('Plugin upgrade activation failed', activationErr as Error, { pluginId })
        return Response.json({
          ok: false,
          error: `Upgraded "${pluginId}" but failed to activate it: ${message}`,
        }, { status: 500 })
      }
    }
    return Response.json({ ok: true, ...result, ...(runtimeVersion !== undefined ? { runtimeVersion } : {}) })
  } catch (err) {
    if (err instanceof UpgradeRefusedError) {
      return Response.json({ ok: false, error: err.message }, { status: 400 })
    }
    const message = err instanceof Error ? err.message : String(err)
    log.error('Plugin upgrade failed', err as Error, { pluginId })
    return Response.json({ ok: false, error: message }, { status: 500 })
  }
}
