/**
 * POST /api/plugins/upgrade — re-pull a user plugin from its recorded source
 * (github fast-forward or local re-cpSync), rebuild, and update its
 * lockfile entry. Refuses core plugins (defense in depth — `upgradePlugin`
 * also enforces this).
 *
 * Two-phase, like install (spec plugin-managed-binaries §2.5 / S17):
 *   preview  { pluginId }                                → widened permissions
 *            or binaries ⇒ { ok:false, awaitingConsent:true, newPermissions,
 *            newBins, consentToken } — the token binds the target manifest
 *            sha, its full permission list and its bins for this platform.
 *   commit   { pluginId, accepted:true, consentToken }   → the upgrade lands
 *            only while the target still matches the token; a changed target
 *            bounces to awaitingConsent + manifestChanged with a fresh token.
 *
 * Response shape:
 *   { ok: true, id, before, after, noop, awaitingConsent:false, newPermissions, newBins, pluginAssets?, droppedBins? }
 *   { ok: false, awaitingConsent: true, ..., consentToken, manifestChanged? }
 *   { ok: false, error: string, core?: boolean }    on refusal/4xx
 *
 * The upgraded plugin is activated immediately after a successful rebuild.
 */
import { createLogger } from '@/core/logger'
import { startInstallJob, type InstallProgressFn } from '@/core/agent-packages/install-progress'
import { upgradePlugin, UpgradeRefusedError, type UpgradeConsent } from '@/core/plugins/upgrade'
import { auditUpgradeRejected } from '@/core/plugins/upgrade-gate'
import { signConsentToken, verifyConsentToken } from '@/core/plugins/consent-token'
import { isCorePlugin } from '@/core/plugin-registry'
import { appendAudit } from '@/core/audit'
import { getContentDir } from '@/core/content-dir'
import { activateUserPluginDir } from '@/core/plugins/live-lifecycle'
import { join } from 'path'

const log = createLogger('plugin-upgrade')

interface UpgradeBody {
  pluginId: string
  accepted?: boolean
  consentToken?: string
}

/** Token identity for an upgrade: the plugin being upgraded (install binds source+ref). */
const upgradeConsentSource = (pluginId: string): string => `upgrade:${pluginId}`

export async function post(req: Request, url: URL): Promise<Response> {
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

  if (url.searchParams.get('async') === '1') {
    const job = startInstallJob({
      kind: 'plugin',
      title: pluginId,
      run: async (progress) => {
        const res = await runUpgrade(pluginId, body, progress)
        return { body: await res.json(), status: res.status }
      },
    })
    return Response.json({ ok: true, jobId: job.id }, { status: 202 })
  }
  return runUpgrade(pluginId, body, undefined)
}

async function runUpgrade(pluginId: string, body: UpgradeBody, progress: InstallProgressFn | undefined): Promise<Response> {
  let accepted: UpgradeConsent | undefined
  if (body.accepted === true) {
    if (!body.consentToken) {
      auditUpgradeRejected('consent_token_missing', pluginId)
      return Response.json({ ok: false, error: 'upgrade commit requires a consentToken from the preview (re-run upgrade)' }, { status: 400 })
    }
    const token = verifyConsentToken(body.consentToken)
    if (!token) {
      auditUpgradeRejected('consent_token_invalid', pluginId)
      return Response.json({ ok: false, error: 'consentToken is invalid or expired (re-run upgrade to re-prompt)' }, { status: 400 })
    }
    if (token.source !== upgradeConsentSource(pluginId)) {
      auditUpgradeRejected('consent_source_mismatch', pluginId, { tokenSource: token.source })
      return Response.json({ ok: false, error: 'consentToken was issued for a different operation — re-run upgrade' }, { status: 400 })
    }
    accepted = { manifestSha: token.manifestSha, permissions: token.permissions, bins: token.bins }
  }

  try {
    const result = await upgradePlugin(pluginId, { accepted, progress })
    if (result.awaitingConsent && result.consent) {
      const { consent, ...rest } = result
      const consentToken = signConsentToken({ source: upgradeConsentSource(pluginId), ...consent })
      return Response.json({ ok: false, ...rest, consentToken })
    }
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
