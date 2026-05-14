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
import { join, resolve } from 'node:path'

const CLIENT_EXTERNAL = [
  'react', 'react-dom', 'react-dom/client',
  'react/jsx-runtime', 'react/jsx-dev-runtime',
  '@tanstack/react-router',
  '@makinbakin/sdk', '@makinbakin/sdk/ui', '@makinbakin/sdk/hooks',
  '@makinbakin/sdk/components', '@makinbakin/sdk/slots',
  '@makinbakin/sdk/types', '@makinbakin/sdk/utils',
  '@makinbakin/sdk/metadata', '@makinbakin/sdk/routing',
]

const SERVER_EXTERNAL = [
  'react', 'react-dom', 'react-dom/client',
  'react/jsx-runtime', 'react/jsx-dev-runtime',
  '@tanstack/react-router',
]

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

interface RunResult {
  exitCode: number
  stderr: string
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
      if (skip.has(name)) continue
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

/**
 * Build a user plugin's dist/ from its sources.
 *
 * - If `package.json` is present and declares deps, runs `bun install` in
 *   the plugin directory first. Peer deps stay external via the bundler
 *   externals list, so this is mostly for dev deps / rare plugin-owned
 *   npm packages.
 * - Runs `bun build` on `index.ts` (server) and `client.tsx` (browser, if
 *   present). Both land in `dist/` with `index.js` / `client.js`. The server
 *   bundle is self-contained except for shared runtime singletons.
 * - Skips the build when the dist outputs are newer than every source file.
 */
export async function buildUserPlugin(pluginDir: string): Promise<void> {
  const serverEntry = join(pluginDir, 'index.ts')
  if (!existsSync(serverEntry)) {
    throw new Error(`buildUserPlugin: ${serverEntry} not found`)
  }

  const clientEntry = join(pluginDir, 'client.tsx')
  const hasClient = existsSync(clientEntry)

  const distDir = join(pluginDir, 'dist')
  const distServer = join(distDir, 'index.js')
  const distClient = join(distDir, 'client.js')

  // Freshness: dist is fresh iff every expected dist file exists AND the
  // oldest dist mtime is strictly newer than the newest source mtime.
  const expectedDist = [distServer, ...(hasClient ? [distClient] : [])]
  const allDistPresent = expectedDist.every(p => existsSync(p))
  if (allDistPresent) {
    const newestSource = newestMtimeMs(pluginDir, new Set(['dist', 'node_modules']))
    const oldestDist = oldestMtimeMs(expectedDist)
    if (oldestDist > 0 && newestSource > 0 && oldestDist >= newestSource) {
      return
    }
  }

  // Install deps if the plugin has its own package.json + declared deps.
  const pkgJsonPath = join(pluginDir, 'package.json')
  if (existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8')) as {
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
      }
      const hasDeps =
        (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) ||
        (pkg.devDependencies && Object.keys(pkg.devDependencies).length > 0)
      if (hasDeps) {
        const installResult = await runSubprocess('bun', ['install'], pluginDir)
        if (installResult.exitCode !== 0) {
          throw new Error(`bun install failed in ${pluginDir}:\n${installResult.stderr}`)
        }
      }
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw new Error(`Invalid package.json in ${pluginDir}: ${err.message}`)
      }
      throw err
    }
  }

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
  const serverResult = await Bun.build(serverBuildConfig)
  if (!serverResult.success) {
    throw new Error(`Failed to build server entry for ${pluginDir}:\n${serverResult.logs.join('\n')}`)
  }

  if (hasClient) {
    const clientResult = await runSubprocess('bun', [
      'build', clientEntry,
      '--outdir', distDir,
      '--target', 'browser',
      '--format', 'esm',
      '--entry-naming', 'client.[ext]',
      ...CLIENT_EXTERNAL.flatMap(e => ['--external', e]),
    ])
    if (clientResult.exitCode !== 0) {
      throw new Error(`Failed to build client entry for ${pluginDir}:\n${clientResult.stderr}`)
    }
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
export interface BuildLogger {
  info: (msg: string, meta?: Record<string, unknown>) => void
  error: (msg: string, err?: unknown, meta?: Record<string, unknown>) => void
}

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
    if (!entry.isDirectory()) continue
    const name = String(entry.name)
    if (name.startsWith('.')) continue
    const pluginDir = join(userPluginsDir, name)
    if (!existsSync(join(pluginDir, 'bakin-plugin.json'))) continue
    try {
      await buildUserPlugin(pluginDir)
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
