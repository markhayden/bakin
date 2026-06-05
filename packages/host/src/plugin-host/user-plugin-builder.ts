/**
 * In-binary user-plugin builder (#147 TE13).
 *
 * Installed user plugins live in `~/.bakin/plugins/<id>/` and may ship
 * with their own dependencies declared in their package.json. Before the
 * plugin is dynamic-imported by the registry (for the server half) or
 * surfaced to the runtime client loader (Phase F, for the client half),
 * each entry needs to be bundled to `dist/` with the shared externals.
 *
 * Shape matches `scripts/build-plugins.ts` (the core-plugin pipeline) so
 * the disk layout is identical for core vs user plugins — the runtime
 * loader doesn't care which bucket a plugin came from.
 *
 * Client externals hold React, @tanstack/react-router, and SDK package aliases
 * so the host shell and plugin share the browser singletons wired by the
 * import map. Server builds bundle the SDK so activation of dist/index.js does
 * not depend on a workspace symlink or a locally installed SDK package.
 *
 * Rebuild skip: if every dist output is newer than every source entry,
 * the build is a no-op. This keeps server boot fast when nothing changed.
 */
import { existsSync, statSync, readdirSync, readFileSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { spawn } from 'node:child_process'
import { basename, join, resolve } from 'node:path'
import { readPluginLockfile, type PluginLockEntry } from '@bakin/core/plugins/lockfile'
import { startStartupSpan, type StartupDiagnosticLogger } from '@/core/startup-diagnostics'
import { PLUGIN_CLIENT_EXTERNALS, PLUGIN_SERVER_EXTERNALS } from '@/core/whiskin/externals'
import { validatePluginImports, NON_RUNTIME_DIRS, type PluginPackageJson } from '@/core/whiskin/import-scan'

// Single source for the externals contract — see src/core/whiskin/externals.ts.
const CLIENT_EXTERNAL = PLUGIN_CLIENT_EXTERNALS
const SERVER_EXTERNAL = PLUGIN_SERVER_EXTERNALS

const REPO_ROOT = resolve(import.meta.dir, '../../../..')
const SDK_ENTRYPOINTS: Record<string, string> = {
  '@makinbakin/sdk': join(REPO_ROOT, 'packages/sdk/src/index.ts'),
  '@makinbakin/sdk/ui': join(REPO_ROOT, 'packages/sdk/src/ui/index.ts'),
  '@makinbakin/sdk/hooks': join(REPO_ROOT, 'packages/sdk/src/hooks/index.ts'),
  '@makinbakin/sdk/components': join(REPO_ROOT, 'packages/sdk/src/components/index.ts'),
  '@makinbakin/sdk/slots': join(REPO_ROOT, 'packages/sdk/src/slots/index.tsx'),
  '@makinbakin/sdk/types': join(REPO_ROOT, 'packages/sdk/src/types/index.ts'),
  '@makinbakin/sdk/utils': join(REPO_ROOT, 'packages/sdk/src/utils/index.ts'),
  '@makinbakin/sdk/metadata': join(REPO_ROOT, 'packages/sdk/src/metadata/index.ts'),
  '@makinbakin/sdk/routing': join(REPO_ROOT, 'packages/sdk/src/routing/index.ts'),
}

const JSX_DEV_RUNTIME_RE = /(?:react\/jsx-dev-runtime|\bjsxDEV\b)/

interface RunResult {
  exitCode: number
  stderr: string
}

export interface BuildLogger {
  debug?: (msg: string, meta?: Record<string, unknown>) => void
  warn?: (msg: string, errorOrData?: unknown, meta?: Record<string, unknown>) => void
  info: (msg: string, meta?: Record<string, unknown>) => void
  error: (msg: string, err?: unknown, meta?: Record<string, unknown>) => void
}

export interface BuildUserPluginOptions {
  /**
   * GitHub-installed plugins may ship prebuilt dist artifacts. Release
   * binaries should use those artifacts when complete instead of trying to
   * rebuild against repo-local SDK source paths that do not exist on a
   * normal user's machine.
   */
  trustExistingDist?: boolean
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
 * Portable subprocess runner. Passing the binary through `spawn` with an
 * argv array avoids shell interpolation and path-traversal tricks.
 */
function runSubprocess(cmd: string, args: string[], cwd?: string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stderrChunks: Buffer[] = []
    proc.stdout?.on('data', () => { /* discard */ })
    proc.stderr?.on('data', (chunk: Buffer) => { stderrChunks.push(chunk) })
    proc.once('error', reject)
    proc.once('close', (code: number | null) => {
      resolve({
        exitCode: code ?? 0,
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
      })
    })
  })
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

/**
 * Build a user plugin's dist/ from its sources.
 *
 * - If `package.json` is present and declares deps, runs `bun install` in
 *   the plugin directory first. Peer deps stay external via the bundler
 *   externals list, so this is mostly for dev deps / rare plugin-owned
 *   npm packages.
 * - When `trustExistingDist` is set and every expected dist output is
 *   present, skips the rebuild. This is used for GitHub-installed plugins
 *   that ship their own build artifacts.
 * - Runs `bun build` on `index.ts` (server) and `client.tsx` (browser, if
 *   present). Both land in `dist/` with `index.js` / `client.js`. The server
 *   bundle is self-contained except for shared runtime singletons.
 * - Skips the build when the dist outputs are newer than every source file.
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
    const trustCompleteDist = options.trustExistingDist && allDistPresent
    let buildServer = true
    if (allDistPresent) {
      if (trustCompleteDist && clientDistFresh) {
        totalSpan?.end({ status: 'skipped', reason: 'trusted-dist', hasClient })
        return
      }
      if (trustCompleteDist && hasClient) {
        buildServer = false
      }

      errorStage = 'freshness check failed'
      const newestSource = newestMtimeMs(pluginDir, new Set(['dist', 'node_modules']))
      const oldestDist = oldestMtimeMs(expectedDist)
      if (clientDistFresh && oldestDist > 0 && newestSource > 0 && oldestDist >= newestSource) {
        totalSpan?.end({ status: 'skipped', reason: 'fresh-dist', hasClient })
        return
      }
    }

    // Install deps if the plugin has its own package.json + declared deps.
    if (existsSync(join(pluginDir, 'package.json'))) {
      const hasDeps =
        (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) ||
        (pkg.devDependencies && Object.keys(pkg.devDependencies).length > 0)
      if (hasDeps) {
        errorStage = 'dependency install failed'
        const installSpan = diag ? startStartupSpan(diag, 'userPlugin.dependencies', {
          phase: 'user-plugin-build',
          pluginId,
          pluginSource: 'user',
          thresholdMs: 1_000,
        }) : null
        let installResult: RunResult
        try {
          installResult = await runSubprocess('bun', ['install'], pluginDir)
        } catch (err) {
          installSpan?.end({ status: 'error', error: 'bun install failed' })
          throw err
        }
        if (installResult.exitCode !== 0) {
          installSpan?.end({ status: 'error', error: 'bun install failed' })
          throw new Error(`bun install failed in ${pluginDir}:\n${installResult.stderr}`)
        }
        installSpan?.end({ status: 'ok' })
      }
    }

    if (buildServer) {
      const serverBuildConfig = {
        entrypoints: [serverEntry],
        outdir: distDir,
        target: 'bun',
        format: 'esm',
        naming: 'index.[ext]',
        external: SERVER_EXTERNAL,
        plugins: [{
          name: 'bakin-sdk-server-resolver',
          setup(build: any) {
            build.onResolve({ filter: /^@makinbakin\/sdk(\/.*)?$/ }, (args: { path: string }) => {
              const path = SDK_ENTRYPOINTS[args.path]
              if (!path) return
              return { path }
            })
          },
        }],
      } as Parameters<typeof Bun.build>[0] & { plugins: Array<unknown> }
      const serverSpan = diag ? startStartupSpan(diag, 'userPlugin.serverBuild', {
        phase: 'user-plugin-build',
        pluginId,
        pluginSource: 'user',
        thresholdMs: 1_000,
      }) : null
      errorStage = 'server build failed'
      let serverResult: Awaited<ReturnType<typeof Bun.build>>
      try {
        serverResult = await Bun.build(serverBuildConfig)
      } catch (err) {
        serverSpan?.end({ status: 'error', error: 'server build failed' })
        throw err
      }
      if (!serverResult.success) {
        serverSpan?.end({ status: 'error', error: 'server build failed' })
        throw new Error(`Failed to build server entry for ${pluginDir}:\n${serverResult.logs.join('\n')}`)
      }
      serverSpan?.end({ status: 'ok' })
    }

    if (hasClient) {
      const clientSpan = diag ? startStartupSpan(diag, 'userPlugin.clientBuild', {
        phase: 'user-plugin-build',
        pluginId,
        pluginSource: 'user',
        thresholdMs: 1_000,
      }) : null
      errorStage = 'client build failed'
      let clientResult: RunResult
      try {
        clientResult = await runSubprocess('bun', [
          'build', clientEntry,
          '--outdir', distDir,
          '--target', 'browser',
          '--format', 'esm',
          '--entry-naming', 'client.[ext]',
          ...(isProductionBuild() ? ['--production'] : []),
          ...CLIENT_EXTERNAL.flatMap(e => ['--external', e]),
        ])
      } catch (err) {
        clientSpan?.end({ status: 'error', error: 'client build failed' })
        throw err
      }
      if (clientResult.exitCode !== 0) {
        clientSpan?.end({ status: 'error', error: 'client build failed' })
        throw new Error(`Failed to build client entry for ${pluginDir}:\n${clientResult.stderr}`)
      }
      clientSpan?.end({ status: 'ok' })
    }
    totalSpan?.end({ status: 'ok', rebuilt: true, hasClient })
  } catch (err) {
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
  let lockedPlugins: Record<string, PluginLockEntry> = {}
  try {
    lockedPlugins = readPluginLockfile().plugins
  } catch (err) {
    log.error('Failed to read plugin lockfile before building user plugins', err)
  }
  let entries: Dirent[]
  try {
    entries = readdirSync(userPluginsDir, { withFileTypes: true }) as Dirent[]
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const name = String(entry.name)
    if (name.startsWith('.')) continue
    const pluginDir = join(userPluginsDir, name)
    if (!existsSync(join(pluginDir, 'bakin-plugin.json'))) continue
    try {
      const trustExistingDist = lockedPlugins[name]?.type === 'github' && lockedPlugins[name]?.linked !== true
      await buildUserPlugin(pluginDir, { trustExistingDist, diagnosticsLog: log, pluginId: name })
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
