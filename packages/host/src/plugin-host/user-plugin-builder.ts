/**
 * In-binary user-plugin builder (#147 TE13) — thin adapter over the Whiskit
 * shared build backend (Phase 2).
 *
 * Installed user plugins live in `~/.bakin/plugins/<id>/` and may ship
 * with their own dependencies declared in their package.json. Before the
 * plugin is dynamic-imported by the registry (for the server half) or
 * surfaced to the runtime client loader (Phase F, for the client half),
 * each entry needs to be bundled to `dist/` with the shared externals.
 *
 * The compile steps live in `src/core/whiskit/build.ts`: the in-process
 * `Bun.build()` fast path when running from source (dev hot loop — no
 * subprocess per save), the system-`bun` backend under the compiled binary.
 * What stays here is the caller-side policy: freshness/rebuild skip,
 * provenance verification at startup, and the startup-diagnostics spans.
 *
 * Rebuild skip: if every dist output is newer than every source entry,
 * the build is a no-op. This keeps server boot fast when nothing changed.
 */
import { existsSync, statSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { basename, join } from 'node:path'
import { startStartupSpan, type StartupDiagnosticLogger } from '@/core/startup-diagnostics'
import { validatePluginImports, NON_RUNTIME_DIRS, type PluginPackageJson } from '@/core/whiskit/import-scan'
import {
  buildPluginInProcess,
  buildPluginWithSystemBun,
  canBuildInProcess,
} from '@/core/whiskit/build'
import { processBuiltPluginCss } from '@/core/whiskit/plugin-css'
import { WhiskitBuildError, type WhiskitStageEvent } from '@/core/whiskit/types'
import { verifyInstalledArtifact } from '@/core/whiskit/verify'

const JSX_DEV_RUNTIME_RE = /(?:react\/jsx-dev-runtime|\bjsxDEV\b)/

export interface BuildLogger {
  debug?: (msg: string, meta?: Record<string, unknown>) => void
  warn?: (msg: string, errorOrData?: unknown, meta?: Record<string, unknown>) => void
  info: (msg: string, meta?: Record<string, unknown>) => void
  error: (msg: string, err?: unknown, meta?: Record<string, unknown>) => void
}

export interface BuildUserPluginOptions {
  diagnosticsLog?: BuildLogger
  pluginId?: string
}

function diagnosticsLogger(log?: BuildLogger): StartupDiagnosticLogger | null {
  if (!log?.debug && !log?.warn) return null
  return {
    debug: (message, data) => log.debug?.(message, data),
    warn: (message, data) => log.warn?.(message, data),
  }
}

/**
 * Walk `dir` and return the newest mtime (in ms) of any file found.
 * Used as a coarse staleness check against dist/. Skips node_modules
 * and dist itself so a previous build + the plugin's installed deps
 * don't invalidate themselves on every rebuild.
 */
function newestMtimeMs(dir: string, skip: Set<string>): number {
  let newest = 0
  const walk = (current: string): void => {
    let entries: Dirent[]
    try {
      entries = readdirSync(current, { withFileTypes: true }) as Dirent[]
    } catch {
      return
    }
    for (const entry of entries) {
      const name = String(entry.name)
      if (skip.has(name) || NON_RUNTIME_DIRS.has(name)) continue
      const full = join(current, name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.isFile()) {
        try {
          const m = statSync(full).mtimeMs
          if (m > newest) newest = m
        } catch {
          // broken symlink or race — ignore
        }
      }
    }
  }
  walk(dir)
  return newest
}

function oldestMtimeMs(paths: string[]): number {
  let oldest = Number.POSITIVE_INFINITY
  for (const p of paths) {
    try {
      const m = statSync(p).mtimeMs
      if (m < oldest) oldest = m
    } catch {
      return 0
    }
  }
  return oldest === Number.POSITIVE_INFINITY ? 0 : oldest
}

function isProductionBuild(): boolean {
  return process.env.BAKIN_DEV !== '1'
}

function isFreshClientDist(path: string): boolean {
  if (!isProductionBuild()) return true
  try {
    return !JSX_DEV_RUNTIME_RE.test(readFileSync(path, 'utf-8'))
  } catch {
    return false
  }
}

function readPackageJson(pluginDir: string): PluginPackageJson {
  const pkgJsonPath = join(pluginDir, 'package.json')
  if (!existsSync(pkgJsonPath)) return {}
  try {
    return JSON.parse(readFileSync(pkgJsonPath, 'utf-8')) as PluginPackageJson
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(`Invalid package.json in ${pluginDir}: ${err.message}`)
    }
    throw err
  }
}

const STAGE_SPANS: Record<WhiskitStageEvent['stage'], { span: string; errorLabel: string }> = {
  'install': { span: 'userPlugin.dependencies', errorLabel: 'bun install failed' },
  'server-build': { span: 'userPlugin.serverBuild', errorLabel: 'server build failed' },
  'client-build': { span: 'userPlugin.clientBuild', errorLabel: 'client build failed' },
  'css-validate': { span: 'userPlugin.cssValidate', errorLabel: 'CSS containment failed' },
}

const STAGE_ERROR_LABELS: Record<WhiskitBuildError['stage'], string> = {
  'resolve-bun': 'system bun not found',
  'validate': 'import validation failed',
  'resolve-sdk': 'sdk resolution failed',
  'install': 'dependency install failed',
  'server-build': 'server build failed',
  'client-build': 'client build failed',
  'css-validate': 'CSS containment failed',
}

/**
 * Replay a backend stage event as a startup span with an accurate duration.
 * The backend reports after the fact, so the span's clock is replayed via
 * the `now` override: first read 0, second read the stage's durationMs.
 */
function emitStageSpan(
  diag: StartupDiagnosticLogger,
  pluginId: string,
  event: WhiskitStageEvent,
): void {
  const { span, errorLabel } = STAGE_SPANS[event.stage]
  let reads = 0
  const handle = startStartupSpan(diag, span, {
    phase: 'user-plugin-build',
    pluginId,
    pluginSource: 'user',
    thresholdMs: 1_000,
    now: () => (reads++ === 0 ? 0 : event.durationMs),
  })
  handle.end(event.status === 'ok' ? { status: 'ok' } : { status: 'error', error: errorLabel })
}

/**
 * Build a user plugin's dist/ from its sources via the Whiskit backend.
 *
 * - Declared deps install with `bun install --ignore-scripts` (pure-JS
 *   installs; lifecycle scripts are withheld until the elevated path lands).
 * - Skips the build when the dist outputs are newer than every source file
 *   (pure freshness cache). A shipped dist/ is never trusted on its own:
 *   github/local installs always build from the import-validated source —
 *   only Whiskit artifact installs (provenance-verified upstream) skip the
 *   build step entirely, before this function is called.
 */
export async function buildUserPlugin(
  pluginDir: string,
  options: BuildUserPluginOptions = {},
): Promise<void> {
  const pluginId = options.pluginId ?? basename(pluginDir)
  const diag = diagnosticsLogger(options.diagnosticsLog)
  const totalSpan = diag ? startStartupSpan(diag, 'userPlugin.build', {
    phase: 'user-plugin-build',
    pluginId,
    pluginSource: 'user',
    thresholdMs: 1_000,
  }) : null
  const serverEntry = join(pluginDir, 'index.ts')
  let errorStage = 'build failed'
  try {
    if (!existsSync(serverEntry)) {
      errorStage = 'missing server entry'
      throw new Error(`buildUserPlugin: ${serverEntry} not found`)
    }

    const clientEntry = join(pluginDir, 'client.tsx')
    const hasClient = existsSync(clientEntry)
    errorStage = 'invalid package.json'
    const pkg = readPackageJson(pluginDir)
    // Import contract is enforced every boot — even when dist is fresh and
    // the compile would be skipped.
    errorStage = 'import validation failed'
    validatePluginImports(pluginDir, pkg)

    const distDir = join(pluginDir, 'dist')
    const distServer = join(distDir, 'index.js')
    const distClient = join(distDir, 'client.js')

    // Freshness: dist is fresh iff every expected dist file exists AND the
    // oldest dist mtime is strictly newer than the newest source mtime.
    const expectedDist = [distServer, ...(hasClient ? [distClient] : [])]
    const allDistPresent = expectedDist.every(p => existsSync(p))
    const clientDistFresh = !hasClient || isFreshClientDist(distClient)
    if (allDistPresent) {
      errorStage = 'freshness check failed'
      const newestSource = newestMtimeMs(pluginDir, new Set(['dist', 'node_modules']))
      const oldestDist = oldestMtimeMs(expectedDist)
      // Strictly newer, as documented above: an mtime TIE rebuilds. A
      // same-millisecond tie is exactly what a cpSync'd source install
      // produces, and treating it as fresh would execute shipped dist
      // bytes that were never rebuilt from validated source.
      if (clientDistFresh && oldestDist > 0 && newestSource > 0 && oldestDist > newestSource) {
        try {
          await processBuiltPluginCss({ pluginId, distDir, sourceRoot: pluginDir })
        } catch (error) {
          rmSync(distClient, { force: true })
          throw new WhiskitBuildError(
            'css-validate',
            error instanceof Error ? error.message : String(error),
          )
        }
        totalSpan?.end({ status: 'skipped', reason: 'fresh-dist', hasClient })
        return
      }
    }

    errorStage = 'build failed'
    const build = canBuildInProcess() ? buildPluginInProcess : buildPluginWithSystemBun
    await build({
      pluginDir,
      pluginId,
      production: isProductionBuild(),
      installDeps: true,
      serverBuild: true,
      onStage: diag ? (event) => emitStageSpan(diag, pluginId, event) : undefined,
    })
    totalSpan?.end({ status: 'ok', rebuilt: true, hasClient })
  } catch (err) {
    if (err instanceof WhiskitBuildError) {
      errorStage = STAGE_ERROR_LABELS[err.stage] ?? errorStage
    }
    totalSpan?.end({ status: 'error', error: errorStage })
    throw err
  }
}

/**
 * Walk `~/.bakin/plugins/` and build any user plugin whose dist is stale
 * or missing. Invoked from server.ts BEFORE pluginRegistry.initialize(),
 * so the registry's dynamic import of `<pluginDir>/dist/index.js` sees a
 * fresh build on disk. Failures are logged but never fatal — a plugin that
 * fails to build is skipped, and the registry will surface a more specific
 * error when it tries to import.
 */
export async function buildAllUserPlugins(
  userPluginsDir: string,
  log: BuildLogger,
): Promise<void> {
  if (!existsSync(userPluginsDir)) return
  let entries: Dirent[]
  try {
    entries = readdirSync(userPluginsDir, { withFileTypes: true }) as Dirent[]
  } catch {
    return
  }
  for (const entry of entries) {
    const name = String(entry.name)
    if (name.startsWith('.')) continue
    const pluginDir = join(userPluginsDir, name)
    // Linked plugins (`bakin plugins link`) are symlinks to a source tree —
    // a symlink Dirent is not isDirectory(), so resolve through it.
    if (!entry.isDirectory()) {
      if (!entry.isSymbolicLink()) continue
      try {
        if (!statSync(pluginDir).isDirectory()) continue
      } catch {
        continue // broken symlink
      }
    }
    if (!existsSync(join(pluginDir, 'bakin-plugin.json'))) continue

    // Whiskit artifact installs carry provenance; verify host compatibility
    // before activating. An incompatible artifact (host moved past the externals
    // contract it was built for) is needs-update, not a silent activation.
    // Plugins without provenance (legacy/local/dev) take the unchanged path.
    const verification = verifyInstalledArtifact(pluginDir)
    if (verification.status === 'needs-update') {
      log.warn?.(
        `Plugin "${name}" needs update — ${verification.reason}. Skipping activation; reinstall to fetch a compatible artifact.`,
      )
      continue
    }
    if (verification.status === 'invalid') {
      log.warn?.(
        `Plugin "${name}" has invalid Whiskit provenance — ${verification.reason}. Skipping activation.`,
      )
      continue
    }

    // Published-artifact installs ship dist/ only — there is no source entry
    // to rebuild from, and that's a valid installed state, not a build
    // failure. Gate on verified Whiskit provenance: a provenance-less dir
    // missing index.ts is a CORRUPTED source install (interrupted copy,
    // deleted entry), and silently activating its stale dist would hide that
    // — let the build fail loudly instead.
    if (
      verification.status === 'compatible' &&
      !existsSync(join(pluginDir, 'index.ts')) &&
      existsSync(join(pluginDir, 'dist', 'index.js'))
    ) {
      continue
    }

    try {
      await buildUserPlugin(pluginDir, { diagnosticsLog: log, pluginId: name })
      log.info(`Built user plugin "${name}"`)
    } catch (err) {
      log.error(
        `Failed to build user plugin "${name}"`,
        err,
        { pluginDir },
      )
    }
  }
}
