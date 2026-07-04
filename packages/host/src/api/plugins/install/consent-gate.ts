/**
 * Install phase (c, security core) — the #142/C13 consent gate.
 *
 * Preflight: when the manifest declares permissions and the caller has not
 * accepted, return awaitingConsent + a signed token binding (source,
 * manifestSha, permissions). Commit: re-validate that token against the
 * freshly staged manifest — a manifest that changed between preflight and
 * commit bounces back to awaitingConsent with a fresh token instead of
 * installing under stale consent.
 *
 * Pure over its inputs (no filesystem access) so the token-binding logic
 * is directly unit-testable; the caller owns staging-dir teardown.
 */
import type { PluginLockEntry } from '@bakin/core/plugins/lockfile'
import { signConsentToken, verifyConsentToken } from '@/core/plugins/consent-token'
import { auditInstallRejected } from './audit'
import type { InstallBody } from './body'

/**
 * The source identity a consent token binds to — includes the requested
 * ref so consent for `github:u/r#main` can't be replayed for another ref.
 */
export function consentSourceIdentity(source: string, ref: string): string {
  return ref ? JSON.stringify({ source, ref }) : source
}

/**
 * Evaluate the consent gate for a validated staged install. Returns the
 * exact early-return Response the monolithic handler produced (preflight
 * prompt, token rejection, or re-consent on manifest drift), or null when
 * the install may proceed to the commit phase. The caller must remove the
 * staging dir before returning a non-null Response.
 */
export function evaluateConsentGate(args: {
  body: InstallBody
  requestedRef: string
  id: string
  manifest: Record<string, unknown>
  parsedPermissions: PluginLockEntry['permissions']
  stagedManifestSha: string
}): Response | null {
  const { body, requestedRef, id, manifest, parsedPermissions, stagedManifestSha } = args

  // #142 layer 2 — if the manifest declares permissions and the caller
  // hasn't accepted yet, return awaitingConsent with the diff. CLI
  // surfaces the prompt and re-invokes with accepted:true. We tear
  // down the staging dir here so the second attempt is clean —
  // re-cloning is cheap relative to the cost of staging cleanup bugs.
  if (parsedPermissions.length > 0 && body.accepted !== true) {
    const versionForPrompt = typeof manifest.version === 'string' ? manifest.version : '0.0.0'
    // C13 binding — the token captures (source, manifestSha,
    // permissions). Commit must echo it back; server re-validates
    // against the freshly cloned manifest. If the manifest changed
    // between preflight and commit, commit returns awaitingConsent
    // again with the new diff instead of installing.
    const consentSource = consentSourceIdentity(body.source, requestedRef)
    const consentToken = signConsentToken({
      source: consentSource,
      manifestSha: stagedManifestSha,
      permissions: parsedPermissions,
    })
    return Response.json({
      ok: false,
      awaitingConsent: true,
      id,
      version: versionForPrompt,
      permissions: parsedPermissions,
      consentToken,
    })
  }

  // Commit phase — when the caller passes accepted:true AND a permission
  // set was declared at preflight, validate the consent token. Without
  // a valid token, the server has no proof the user actually saw and
  // approved this exact manifest's permissions.
  if (parsedPermissions.length > 0 && body.accepted === true) {
    if (!body.consentToken) {
      auditInstallRejected('consent_token_missing', body.source, { id })
      return Response.json({
        ok: false,
        error: 'install commit requires a consentToken from preflight (re-run install)',
      }, { status: 400 })
    }
    const token = verifyConsentToken(body.consentToken)
    if (!token) {
      auditInstallRejected('consent_token_invalid', body.source, { id })
      return Response.json({
        ok: false,
        error: 'consentToken is invalid or expired (re-run install to re-prompt)',
      }, { status: 400 })
    }
    const consentSource = consentSourceIdentity(body.source, requestedRef)
    if (token.source !== consentSource) {
      auditInstallRejected('consent_source_mismatch', body.source, { id, tokenSource: token.source })
      return Response.json({
        ok: false,
        error: 'consentToken source does not match commit body source — re-run preflight',
      }, { status: 400 })
    }
    // The crux: the manifest may have changed between preflight and
    // commit. If so, the user's consent was for a different permission
    // set; bounce back to awaitingConsent with the NEW diff so they
    // can decide again.
    if (token.manifestSha !== stagedManifestSha) {
      const versionForPrompt = typeof manifest.version === 'string' ? manifest.version : '0.0.0'
      const freshToken = signConsentToken({
        source: consentSource,
        manifestSha: stagedManifestSha,
        permissions: parsedPermissions,
      })
      return Response.json({
        ok: false,
        awaitingConsent: true,
        manifestChanged: true,
        id,
        version: versionForPrompt,
        permissions: parsedPermissions,
        consentToken: freshToken,
      })
    }
  }

  return null
}
