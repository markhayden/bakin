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
import { type InstallBody, validateInstallBody } from './install/body'
import { handleDevInstall } from './install/dev-install'
import { stageInstallSource } from './install/resolve-source'
import { validateStagedManifest } from './install/validate-manifest'
import { evaluateConsentGate } from './install/consent-gate'
import { commitInstall } from './install/commit'

const log = createLogger('plugin-install')

export async function post(req: Request, _url: URL): Promise<Response> {
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

      const consentResponse = evaluateConsentGate({
        body,
        requestedRef: staged.requestedRef,
        id: validated.id,
        manifest: validated.manifest,
        parsedPermissions: validated.parsedPermissions,
        stagedManifestSha: validated.stagedManifestSha,
      })
      if (consentResponse) {
        rmSync(stagingDir, { recursive: true, force: true })
        return consentResponse
      }

      return await commitInstall({ body, stagingDir, pluginsRoot, staged, validated })
    } catch (err) {
      rmSync(stagingDir, { recursive: true, force: true })
      throw err
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error('Plugin install failed', err as Error, { source: body.source })
    return Response.json({ ok: false, error: message }, { status: 500 })
  }
}
