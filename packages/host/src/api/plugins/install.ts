/**
 * POST /api/plugins/install — install a plugin from a local directory or
 * GitHub URL into ~/.bakin/plugins/<id>/.
 *
 * Migrated from src/app/api/plugins/install/route.ts for Phase B of #147.
 *
 * Notes:
 * - A Bakin restart is required for the plugin's UI (nav items, pages,
 *   slot registrations) to take effect. The server-side plugin loader will
 *   pick up the new manifest on next boot. This is an accepted constraint
 *   — the runtime client-side loader is deferred (tracked in the spec).
 * - Never run with a source path outside the user's home or the current
 *   working directory — prevents path-traversal write attempts.
 */
import { existsSync, readFileSync, mkdirSync, cpSync, rmSync } from 'fs'
import { join, basename, resolve, isAbsolute } from 'path'
import { execFileSync } from 'child_process'
import { createHash } from 'crypto'
import { getContentDir } from '@/core/content-dir'
import { createLogger } from '@/core/logger'
import { buildUserPlugin } from '../../plugin-host/user-plugin-builder'
import {
  addPlugin,
  readPluginLockfile,
  writePluginLockfile,
  type PluginLockEntry,
} from '@bakin/core/plugins/lockfile'
import { computeSourceTreeSha } from '@/core/plugins/upgrade'

const log = createLogger('plugin-install')

/**
 * Resolve git provenance for a freshly installed plugin dir. Returns empty
 * strings for either field if the corresponding git command fails — happens
 * for local installs (no .git/) and for github installs in detached-HEAD
 * state. Both failures are non-fatal; the lockfile records the honest
 * emptiness rather than fabricating a synthetic value.
 */
function resolveGitProvenance(targetDir: string, type: 'github' | 'local'): { ref: string; commitSha: string } {
  if (type === 'local') return { ref: '', commitSha: '' }
  let ref = ''
  let commitSha = ''
  try {
    commitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: targetDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  } catch {
    // commitSha stays ''
  }
  try {
    ref = execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: targetDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  } catch {
    // detached HEAD or other — ref stays ''
  }
  return { ref, commitSha }
}

/**
 * Write a `PluginLockEntry` for a freshly installed plugin. Failures are
 * logged but do not block install at C1 — C7 (uninstall teardown) will
 * require lockfile consistency for remove and tighten the contract.
 */
function recordInstall(args: {
  id: string
  targetDir: string
  manifestPath: string
  manifest: Record<string, unknown>
  source: string
  type: 'github' | 'local'
}): void {
  const { id, targetDir, manifestPath, manifest, source, type } = args
  try {
    const manifestSha = createHash('sha256').update(readFileSync(manifestPath)).digest('hex')
    const { ref, commitSha } = resolveGitProvenance(targetDir, type)

    let version: string
    if (typeof manifest.version === 'string' && manifest.version.length > 0) {
      version = manifest.version
    } else {
      log.warn('plugin manifest missing version; defaulting to 0.0.0', { id })
      version = '0.0.0'
    }

    // For local installs, capture the install-time source-tree sha so the
    // first `bakin plugins list --check` doesn't false-positive (the check
    // would compare against an undefined value otherwise).
    let sourceTreeSha: string | undefined
    if (type === 'local' && existsSync(source)) {
      try {
        sourceTreeSha = computeSourceTreeSha(source)
      } catch (err) {
        log.warn('failed to hash local source tree at install', { id, err: String(err) })
      }
    }

    const entry: PluginLockEntry = {
      source,
      type,
      ref,
      commitSha,
      installedAt: new Date().toISOString(),
      version,
      permissions: Array.isArray(manifest.permissions)
        ? manifest.permissions.filter((p): p is string => typeof p === 'string')
        : [],
      manifestSha,
      sourceTreeSha,
    }

    const lock = readPluginLockfile()
    writePluginLockfile(addPlugin(lock, id, entry))
  } catch (err) {
    log.error('failed to record plugin install in lockfile', err as Error, { id })
  }
}

interface InstallBody {
  source: string
  type: 'local' | 'github'
}

export async function post(req: Request, _url: URL): Promise<Response> {
  let body: InstallBody
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.source || typeof body.source !== 'string') {
    return Response.json({ ok: false, error: 'Missing source' }, { status: 400 })
  }
  if (body.type !== 'local' && body.type !== 'github') {
    return Response.json({ ok: false, error: 'Invalid type; must be "local" or "github"' }, { status: 400 })
  }

  const pluginsRoot = join(getContentDir(), 'plugins')
  if (!existsSync(pluginsRoot)) mkdirSync(pluginsRoot, { recursive: true })

  try {
    const stagingDir = join(pluginsRoot, `.staging-${Date.now()}`)
    mkdirSync(stagingDir, { recursive: true })

    try {
      if (body.type === 'local') {
        const src = isAbsolute(body.source) ? body.source : resolve(process.cwd(), body.source)
        if (!existsSync(src)) {
          rmSync(stagingDir, { recursive: true, force: true })
          return Response.json({ ok: false, error: `Source path does not exist: ${src}` }, { status: 400 })
        }
        cpSync(src, stagingDir, { recursive: true, dereference: false })
      } else {
        // github: accept user/repo or github:user/repo or full URL
        const cloneSource = body.source.startsWith('github:') ? body.source.slice(7) : body.source
        const url = cloneSource.startsWith('http') || cloneSource.startsWith('git@')
          ? cloneSource
          : `https://github.com/${cloneSource}.git`
        execFileSync('git', ['clone', '--depth', '1', url, stagingDir], { stdio: 'pipe' })
      }

      // Validate manifest
      const manifestPath = join(stagingDir, 'bakin-plugin.json')
      if (!existsSync(manifestPath)) {
        rmSync(stagingDir, { recursive: true, force: true })
        return Response.json({
          ok: false,
          error: 'Plugin source is missing bakin-plugin.json',
        }, { status: 400 })
      }

      let manifest: Record<string, unknown>
      try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
      } catch {
        rmSync(stagingDir, { recursive: true, force: true })
        return Response.json({ ok: false, error: 'Invalid bakin-plugin.json' }, { status: 400 })
      }

      const id = typeof manifest.id === 'string' && manifest.id.length > 0
        ? manifest.id
        : basename(body.source.replace(/\.git$/, ''))

      if (!/^[a-z0-9][a-z0-9-_]{0,39}$/i.test(id)) {
        rmSync(stagingDir, { recursive: true, force: true })
        return Response.json({
          ok: false,
          error: `Invalid plugin id "${id}" — must match /^[a-z0-9][a-z0-9-_]{0,39}$/i`,
        }, { status: 400 })
      }

      const targetDir = join(pluginsRoot, id)
      if (existsSync(targetDir)) {
        rmSync(targetDir, { recursive: true, force: true })
      }
      cpSync(stagingDir, targetDir, { recursive: true })
      rmSync(stagingDir, { recursive: true, force: true })

      // Compile the plugin to dist/ so the runtime loader (Phase F) and
      // the server-side dynamic import (plugin-registry) have built
      // artifacts ready on next boot. Failures here are fatal for the
      // install request — shipping an installed-but-unbuilt plugin would
      // crash startup instead of surfacing the error to the user now.
      try {
        await buildUserPlugin(targetDir)
      } catch (buildErr) {
        // Build failed — clean up the installed files so the install
        // appears atomic from the user's perspective.
        rmSync(targetDir, { recursive: true, force: true })
        const message = buildErr instanceof Error ? buildErr.message : String(buildErr)
        log.error('Plugin install build step failed', buildErr as Error, { id })
        return Response.json({
          ok: false,
          error: `Installed "${id}" but failed to build it: ${message}`,
        }, { status: 500 })
      }

      // For local installs, record the resolved absolute source path so the
      // upgrade flow can re-resolve it deterministically from any cwd.
      const recordedSource = body.type === 'local'
        ? (isAbsolute(body.source) ? body.source : resolve(process.cwd(), body.source))
        : body.source
      recordInstall({ id, targetDir, manifestPath, manifest, source: recordedSource, type: body.type })

      log.info(`Installed plugin "${id}"`, { source: body.source, type: body.type })

      return Response.json({
        ok: true,
        id,
        message: `Installed "${id}". Restart Bakin to load the plugin.`,
      })
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
