/**
 * Install phase (a) — request-body shape + validation.
 *
 * `validateInstallBody` returns the exact early-return `Response` the
 * monolithic handler produced for each invalid field, or `null` when the
 * body is well-formed and the handler may proceed.
 */
import { assertGitRefValid, InvalidGithubSourceError } from '@bakin/core/plugins/source'

export interface InstallBody {
  source: string
  type: 'local' | 'github'
  /** Optional git ref to install for github sources. */
  ref?: string
  /** Developer-mode local install: symlink source and watch/reload it. */
  dev?: boolean
  /** Used with dev=true to replace an existing install/link for the same id. */
  force?: boolean
  /**
   * #142 layer 2 — set true after the user accepts the consent prompt. When
   * the manifest declares permissions and this is false, the endpoint
   * stages, validates, and returns awaitingConsent: true with the diff
   * before doing any irreversible work.
   */
  accepted?: boolean
  /** Required when accepted=true and the prior preflight returned a token (C13 binding). */
  consentToken?: string
  /** Allow installing a user plugin whose id matches a core plugin id (rare; opt-in). */
  overrideCore?: boolean
}

/** Validate the parsed request body. Returns a 400 Response or null to proceed. */
export function validateInstallBody(body: InstallBody): Response | null {
  if (!body.source || typeof body.source !== 'string') {
    return Response.json({ ok: false, error: 'Missing source' }, { status: 400 })
  }
  if (body.type !== 'local' && body.type !== 'github') {
    return Response.json({ ok: false, error: 'Invalid type; must be "local" or "github"' }, { status: 400 })
  }
  if (body.ref !== undefined) {
    if (typeof body.ref !== 'string') {
      return Response.json({ ok: false, error: 'ref must be a string' }, { status: 400 })
    }
    try {
      assertGitRefValid(body.ref)
    } catch (err) {
      return Response.json({
        ok: false,
        error: err instanceof InvalidGithubSourceError ? err.message : String(err),
      }, { status: 400 })
    }
    if (body.type !== 'github') {
      return Response.json({ ok: false, error: '--ref only applies to github plugin installs' }, { status: 400 })
    }
  }
  if (body.dev !== undefined && typeof body.dev !== 'boolean') {
    return Response.json({ ok: false, error: 'dev must be a boolean' }, { status: 400 })
  }
  if (body.force !== undefined && typeof body.force !== 'boolean') {
    return Response.json({ ok: false, error: 'force must be a boolean' }, { status: 400 })
  }
  return null
}
