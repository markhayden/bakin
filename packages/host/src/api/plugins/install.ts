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
import { getContentDir } from '@/core/content-dir'
import { createLogger } from '@/core/logger'
import { startInstallJob } from '@/core/agent-packages/install-progress'
import { isInstallLockBusy } from '@/core/install-core/install-lock'
import { type InstallBody, validateInstallBody } from './install/body'
import { handleDevInstall } from './install/dev-install'
import { stageInstallSource } from './install/resolve-source'
import { validateStagedManifest } from './install/validate-manifest'
import { consentBinsOf, evaluateConsentGate } from './install/consent-gate'
import { binPreflightResponse, preflightPluginBins } from '@/core/plugins/bin-preflight'
import { commitInstall } from './install/commit'

const log = createLogger('plugin-install')

export async function post(req: Request, url: URL): Promise<Response> {
  let body: InstallBody
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const invalid = validateInstallBody(body)
  if (invalid) return invalid

  if (body.dev === true) {
    return handleDevInstall(body)
  }

  const pluginsRoot = join(getContentDir(), 'plugins')
  if (!existsSync(pluginsRoot)) mkdirSync(pluginsRoot, { recursive: true })

  try {
    const stagingDir = join(pluginsRoot, `.staging-${Date.now()}`)
    mkdirSync(stagingDir, { recursive: true })

    try {
      const stagedResult = await stageInstallSource(body, stagingDir)
      if (!stagedResult.ok) return stagedResult.response
      const { staged } = stagedResult

      const validatedResult = validateStagedManifest(body, stagingDir, staged.effectivePluginDir)
      if (!validatedResult.ok) return validatedResult.response
      const { validated } = validatedResult

      // Binaries: platform + conflict preflight BEFORE consent — never ask the
      // user to consent to an install that cannot succeed here.
      const preflight = binPreflightResponse(preflightPluginBins(validated.id, validated.bins))
      if (preflight) {
        rmSync(stagingDir, { recursive: true, force: true })
        return preflight
      }

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
        rmSync(stagingDir, { recursive: true, force: true })
        return consentResponse
      }

      // Consent satisfied. With ?async=1 the commit (files, binaries, ledger)
      // runs as an install job so the UI shows staged progress — the same
      // runner, events and status route packages use (#895).
      if (url.searchParams.get('async') === '1') {
        const job = startInstallJob({
          kind: 'plugin',
          title: validated.id,
          run: async (progress) => {
            try {
              const res = await commitInstall({ body, stagingDir, pluginsRoot, staged, validated, progress })
              return { body: await res.json(), status: res.status }
            } finally {
              rmSync(stagingDir, { recursive: true, force: true })
            }
          },
        })
        return Response.json({ ok: true, jobId: job.id }, { status: 202 })
      }

      return await commitInstall({ body, stagingDir, pluginsRoot, staged, validated })
    } catch (err) {
      rmSync(stagingDir, { recursive: true, force: true })
      throw err
    }
  } catch (err) {
    if (isInstallLockBusy(err)) {
      return Response.json({ ok: false, error: err.message }, { status: 409 })
    }
    const message = err instanceof Error ? err.message : String(err)
    log.error('Plugin install failed', err as Error, { source: body.source })
    return Response.json({ ok: false, error: message }, { status: 500 })
  }
}
