/**
 * POST /api/plugins/install — install a plugin from a local directory or
 * GitHub URL into ~/.bakin/plugins/<id>/.
 *
 * Migrated from src/app/api/plugins/install/route.ts for Phase B of #147.
 *
 * Security boundaries enforced here:
 * - Local source paths are realpath-resolved and contained to one of:
 *   ~/.bakin/, $HOME, or the current working directory. Anything else is
 *   rejected as a path-traversal attempt.
 * - The github URL is parsed and validated against a strict shape before
 *   it reaches `git clone`; refs that look like options (leading `-`) are
 *   refused. `git clone` is invoked with `--` to end-of-options.
 * - manifest.id is regex-validated; collisions with core plugin ids are
 *   refused unless --override-core was passed (file an issue first).
 * - Plugin source size is bounded to keep a hostile manifest from
 *   exhausting memory in JSON.parse / Levenshtein.
 *
 * The handler sequences four phases, each in its own module under
 * `./install/` so the security-sensitive logic is unit-testable in
 * isolation:
 *   (a) body validation + the dev-install/link branch
 *       (`install/body.ts`, `install/dev-install.ts`)
 *   (b) source resolution into staging — local containment, github
 *       parsing, Whiskit artifact preference (`install/resolve-source.ts`)
 *   (c) manifest validation + the C13 consent-token gate
 *       (`install/validate-manifest.ts`, `install/consent-gate.ts`)
 *   (d) commit — copy, compile, lockfile record, live-activate
 *       (`install/commit.ts`)
 *
 * In a running Bakin server the installed plugin is activated immediately.
 * If this endpoint is exercised before the plugin registry has booted,
 * activation is deferred until the next server start.
 */
import { existsSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { OperationCancelledError, operationOriginFromRequest, type OperationContext, type OperationOutcome } from '@bakin/core/operations'
import { getContentDir } from '@/core/content-dir'
import { createLogger } from '@/core/logger'
import { isInstallLockBusy } from '@/core/install-core/install-lock'
import { PLUGIN_COMMIT_PLAN, PLUGIN_PREVIEW_PLAN, PLUGIN_STAGES, PREVIEW_CODES } from '@/core/plugins/operation-plans'
import { type InstallBody, validateInstallBody } from './install/body'
import { handleDevInstall } from './install/dev-install'
import { stageInstallSource } from './install/resolve-source'
import { validateStagedManifest } from './install/validate-manifest'
import { consentBinsOf, evaluateConsentGate } from './install/consent-gate'
import { binPreflightResponse, preflightPluginBins } from '@/core/plugins/bin-preflight'
import { commitInstall } from './install/commit'
import { outcomeFromResponse, startOperationResponse } from '../operations'

const log = createLogger('plugin-install')

type InstallOutcome = OperationOutcome<Record<string, unknown>>

/**
 * Every install is preview → commit (#895). Without `accepted` this is a
 * PREVIEW: fetch + check only, holding nothing — it ends with the consent
 * prompt (`awaiting_consent`) or, when nothing needs consent, `ready`; it
 * never installs. With `accepted: true` it is the COMMIT: re-staged under
 * install-state (the re-clone is deliberate — staging never outlives a
 * request), consent re-validated, then the replace transaction.
 */
export async function post(req: Request): Promise<Response> {
  let body: InstallBody
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const invalid = validateInstallBody(body)
  if (invalid) return invalid

  if (body.dev === true) {
    return handleDevInstall(req, body)
  }

  const commit = body.accepted === true
  const identity = `${body.source}|${body.ref ?? ''}`
  return startOperationResponse<Record<string, unknown>>({
    kind: commit ? 'install' : 'fetch',
    owner: 'core',
    origin: operationOriginFromRequest(req),
    title: `${commit ? 'Install' : 'Preview'} ${body.source}`,
    href: '/explore',
    fingerprint: commit
      ? `plugins:install:${identity}|${(body.consentToken ?? '').slice(0, 24)}`
      : `plugins:preview:${identity}`,
    resources: commit ? ['install-state'] : [],
    plan: commit ? PLUGIN_COMMIT_PLAN : PLUGIN_PREVIEW_PLAN,
    run: (op) => runInstall(body, commit, op),
  })
}

async function runInstall(body: InstallBody, commit: boolean, op: OperationContext): Promise<InstallOutcome> {
  const pluginsRoot = join(getContentDir(), 'plugins')
  if (!existsSync(pluginsRoot)) mkdirSync(pluginsRoot, { recursive: true })
  const stagingDir = join(pluginsRoot, `.staging-${Date.now()}-${op.id}`)
  mkdirSync(stagingDir, { recursive: true })

  try {
    op.stage(PLUGIN_STAGES.fetch, body.source)
    const stagedResult = await stageInstallSource(body, stagingDir)
    if (!stagedResult.ok) return outcomeFromResponse(stagedResult.response)
    const { staged } = stagedResult
    op.throwIfCancelled()

    op.stage(PLUGIN_STAGES.check)
    const validatedResult = validateStagedManifest(body, stagingDir, staged.effectivePluginDir)
    if (!validatedResult.ok) return outcomeFromResponse(validatedResult.response)
    const { validated } = validatedResult

    // Binaries: platform + conflict preflight BEFORE consent — never ask the
    // user to consent to an install that cannot succeed here.
    const preflight = binPreflightResponse(preflightPluginBins(validated.id, validated.bins))
    if (preflight) return outcomeFromResponse(preflight)

    const consentResponse = evaluateConsentGate({
      body,
      requestedRef: staged.requestedRef,
      id: validated.id,
      manifest: validated.manifest,
      parsedPermissions: validated.parsedPermissions,
      bins: consentBinsOf(validated.bins),
      stagedManifestSha: validated.stagedManifestSha,
    })
    if (consentResponse) {
      const outcome = await outcomeFromResponse(consentResponse)
      return outcome.body.awaitingConsent === true ? { ...outcome, code: PREVIEW_CODES.awaitingConsent } : outcome
    }

    if (!commit) {
      const version = typeof validated.manifest.version === 'string' ? validated.manifest.version : '0.0.0'
      return {
        status: 'succeeded',
        code: PREVIEW_CODES.ready,
        httpStatus: 200,
        body: { ok: true, awaitingConsent: false, ready: true, id: validated.id, version, permissions: [], bins: [] },
      }
    }

    op.throwIfCancelled()
    return outcomeFromResponse(await commitInstall({ body, stagingDir, pluginsRoot, staged, validated, operation: op }))
  } catch (err) {
    if (err instanceof OperationCancelledError) throw err
    if (isInstallLockBusy(err)) return outcomeFromResponse(Response.json({ ok: false, error: err.message }, { status: 409 }))
    log.error('Plugin install failed', err as Error, { source: body.source })
    return outcomeFromResponse(Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 }))
  } finally {
    rmSync(stagingDir, { recursive: true, force: true })
  }
}
