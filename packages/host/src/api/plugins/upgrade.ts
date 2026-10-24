/**
 * POST /api/plugins/upgrade — re-pull a user plugin from its recorded source
 * (github fast-forward or local re-cpSync), rebuild, and update its
 * lockfile entry. Refuses core plugins (defense in depth — `upgradePlugin`
 * also enforces this).
 *
 * Two-phase, like install (spec plugin-managed-binaries §2.5 / S17):
 *   preview  { pluginId }                                → any declared
 *            permission or binary ⇒ { ok:false, awaitingConsent:true,
 *            declaredPermissions, declaredBins, consentToken } — the FULL
 *            declaration, never a lockfile diff; the token binds the target manifest
 *            sha, its full permission list and its bins for this platform.
 *   commit   { pluginId, accepted:true, consentToken }   → the upgrade lands
 *            only while the target still matches the token; a changed target
 *            bounces to awaitingConsent + manifestChanged with a fresh token.
 *
 * Response shape:
 *   { ok: true, id, before, after, noop, awaitingConsent:false, declaredPermissions, declaredBins, pluginAssets?, droppedBins? }
 *   { ok: false, awaitingConsent: true, ..., consentToken, manifestChanged? }
 *   { ok: false, error: string, core?: boolean }    on refusal/4xx
 *
 * The upgraded plugin is activated immediately after a successful rebuild.
 *
 * Both phases are operations (#895): the preview holds nothing and never
 * writes outside staging — with nothing new to consent to it ends `ready`
 * with a token instead of upgrading; the commit holds install-state and its
 * point of no return is the replace transaction's journal-first rename.
 */
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { OperationCancelledError, operationOriginFromRequest, type OperationContext, type OperationOrigin, type OperationOutcome, type StartOperationInput } from '@bakin/core/operations'
import { createLogger } from '@/core/logger'
import { upgradePlugin, UpgradeRefusedError, type UpgradeConsent } from '@/core/plugins/upgrade'
import { PLUGIN_COMMIT_PLAN, PLUGIN_PREVIEW_PLAN, PLUGIN_STAGES, PREVIEW_CODES } from '@/core/plugins/operation-plans'
import { auditUpgradeRejected } from '@/core/plugins/upgrade-gate'
import { signConsentToken, verifyConsentToken } from '@/core/plugins/consent-token'
import { isCorePlugin } from '@/core/plugin-registry'
import { appendAudit } from '@/core/audit'
import { getContentDir } from '@/core/content-dir'
import { activateUserPluginDir } from '@/core/plugins/live-lifecycle'
import { outcomeFromResponse, startOperationResponse } from '../operations'

const log = createLogger('plugin-upgrade')

export interface UpgradeBody {
  pluginId: string
  accepted?: boolean
  consentToken?: string
  /** The identity the caller reviewed (version/sha/digest); the lane refuses anything else. */
  expected?: { version?: string; sha?: string; digest?: string }
}

/** Token identity for an upgrade: the plugin being upgraded (install binds source+ref). */
const upgradeConsentSource = (pluginId: string): string => `upgrade:${pluginId}`

/** What distinguishes one upgrade request from another: the full consent token and the reviewed identity, hashed. */
export function upgradeRequestKey(body: Pick<UpgradeBody, 'consentToken' | 'expected'>): string {
  const expected = body.expected ?? {}
  const canonical = { token: body.consentToken ?? '', version: expected.version ?? '', sha: expected.sha ?? '', digest: expected.digest ?? '' }
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, 32)
}

export async function post(req: Request): Promise<Response> {
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

  return startOperationResponse<Record<string, unknown>>(pluginUpgradeOperation(pluginId, body, operationOriginFromRequest(req)))
}

/**
 * The upgrade as an operation — preview (nothing held, ends with a consent
 * token) or commit (install-state, the replace transaction). Shared with
 * the Updates apply service (#1007 D7.4), which runs the SAME flow.
 */
export function pluginUpgradeOperation(pluginId: string, body: UpgradeBody, origin: OperationOrigin): StartOperationInput<Record<string, unknown>> {
  const commit = body.accepted === true
  return {
    kind: commit ? 'upgrade' : 'fetch',
    owner: 'core',
    origin,
    title: `${commit ? 'Upgrade' : 'Check for an upgrade to'} ${pluginId}`,
    href: '/health',
    // Identical requests attach; a request for ANOTHER reviewed identity or
    // consent never joins a live operation whose guard it did not run
    // (review r4 #3): the whole token and the canonical identity are hashed in.
    fingerprint: `plugins:${commit ? 'upgrade' : 'upgrade-preview'}:${pluginId}|${upgradeRequestKey(body)}`,
    resources: commit ? ['install-state'] : [],
    plan: commit ? PLUGIN_COMMIT_PLAN : PLUGIN_PREVIEW_PLAN,
    run: (op) => runUpgrade(pluginId, body, op),
  }
}

async function runUpgrade(pluginId: string, body: UpgradeBody, op: OperationContext): Promise<OperationOutcome<Record<string, unknown>>> {
  let accepted: UpgradeConsent | undefined
  if (body.accepted === true) {
    if (!body.consentToken) {
      auditUpgradeRejected('consent_token_missing', pluginId)
      return outcomeFromResponse(Response.json({ ok: false, error: 'upgrade commit requires a consentToken from the preview (re-run upgrade)' }, { status: 400 }))
    }
    const token = verifyConsentToken(body.consentToken)
    if (!token) {
      auditUpgradeRejected('consent_token_invalid', pluginId)
      return outcomeFromResponse(Response.json({ ok: false, error: 'consentToken is invalid or expired (re-run upgrade to re-prompt)' }, { status: 400 }))
    }
    if (token.source !== upgradeConsentSource(pluginId)) {
      auditUpgradeRejected('consent_source_mismatch', pluginId, { tokenSource: token.source })
      return outcomeFromResponse(Response.json({ ok: false, error: 'consentToken was issued for a different operation — re-run upgrade' }, { status: 400 }))
    }
    accepted = { manifestSha: token.manifestSha, permissions: token.permissions, bins: token.bins }
  }

  try {
    const result = await upgradePlugin(pluginId, { accepted, previewOnly: body.accepted !== true, op, ...(body.expected ? { expected: body.expected } : {}) })
    if ((result.awaitingConsent || result.ready) && result.consent) {
      // A token binds what was previewed; the commit echoes it back. `ready`
      // (nothing new to consent to) carries one too, so every commit is bound.
      const { consent, ...rest } = result
      const consentToken = signConsentToken({ source: upgradeConsentSource(pluginId), ...consent })
      return {
        status: 'succeeded',
        code: result.awaitingConsent ? PREVIEW_CODES.awaitingConsent : PREVIEW_CODES.ready,
        httpStatus: 200,
        body: { ok: !result.awaitingConsent, ...rest, consentToken },
      }
    }
    let runtimeVersion: number | undefined
    let stillDisabled = false
    if (!result.noop && !result.awaitingConsent) {
      op.stage(PLUGIN_STAGES.activate)
      try {
        const activation = await activateUserPluginDir(join(getContentDir(), 'plugins', pluginId))
        runtimeVersion = activation.runtimeVersion
        // Row 98 / Codex r2 N7: a disabled plugin is upgraded on disk but stays disabled — only Enable activates it.
        stillDisabled = activation.skipped === 'disabled'
      } catch (activationErr) {
        const message = activationErr instanceof Error ? activationErr.message : String(activationErr)
        log.error('Plugin upgrade activation failed', activationErr as Error, { pluginId })
        return outcomeFromResponse(Response.json({
          ok: false,
          error: `Upgraded "${pluginId}" but failed to activate it: ${message}`,
        }, { status: 500 }))
      }
    }
    return outcomeFromResponse(Response.json({ ok: true, ...result, ...(runtimeVersion !== undefined ? { runtimeVersion } : {}), ...(stillDisabled ? { stillDisabled: true } : {}) }))
  } catch (err) {
    if (err instanceof OperationCancelledError) throw err
    if (err instanceof UpgradeRefusedError) {
      return outcomeFromResponse(Response.json({ ok: false, error: err.message }, { status: 400 }))
    }
    const message = err instanceof Error ? err.message : String(err)
    log.error('Plugin upgrade failed', err as Error, { pluginId })
    return outcomeFromResponse(Response.json({ ok: false, error: message }, { status: 500 }))
  }
}
