/**
 * Whiskit shared build backend (Phase 2) — one code path that turns a plugin
 * source dir into `dist/{index.js, client.js}` identically on producer
 * machines (`bakin plugins publish --build`), consumer machines (install-time
 * builds under the compiled binary), and CI.
 *
 * Externals strategy (must match the proven bits-official build or server
 * output diverges):
 *   - CLIENT externalizes React + router + the full SDK surface — the host's
 *     browser import map provides the singletons.
 *   - SERVER externalizes React/router only and INLINES the SDK. The plugin's
 *     runtime import path on a user's machine is `<binary>/dist/index.js`,
 *     where Node's resolver can't find @makinbakin/sdk. Other deps are also
 *     bundled (Bun's default) — published artifacts ship dist/ without
 *     node_modules.
 *
 * Two backends, one contract:
 *   - `buildPluginWithSystemBun` shells out to the system `bun`. The server
 *     build needs an SDK resolver plugin, which the `bun build` CLI cannot
 *     express, so it runs a generated script (Bun.build + onResolve) under
 *     the system bun. Works from a compiled binary.
 *   - `buildPluginInProcess` calls `Bun.build()` directly — the dev hot-loop
 *     fast path (no subprocess per save). Only available from a source run.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { PLUGIN_CLIENT_EXTERNALS, PLUGIN_SERVER_EXTERNALS } from './externals'
import { validatePluginImports, type PluginPackageJson } from './import-scan'
import { commandFailure, runSystemBun, DEFAULT_BUILD_TIMEOUT_MS } from './command'
import { processBuiltPluginCss } from './plugin-css'
import { WhiskitBuildError, type WhiskitBuildRequest, type WhiskitBuildResult } from './types'

const REPO_ROOT = resolve(import.meta.dir, '../../..')

/** SDK sub-path names ('' is the package root). Mirrors the package exports. */
export const SDK_SUBPATHS = [
  '',
  'ui',
  'layout',
  'patterns',
  'charts',
  'conversation',
  'content',
  'hooks',
  'slots',
  'types',
  'utils',
  'metadata',
  'routing',
  'navigation',
] as const

export interface SdkResolution {
  /** Where the SDK came from — recorded in diagnostics. */
  source: 'env' | 'repo-source' | 'plugin-node-modules'
  /** Specifier → absolute entry file, fed to the resolver plugin. */
  entrypoints: Record<string, string>
}

function specifier(subpath: string): string {
  return subpath ? `@makinbakin/sdk/${subpath}` : '@makinbakin/sdk'
}

/**
 * Build the specifier → file map for an SDK root, probing each sub-path for
 * the styles we ship: compiled npm package (`index.js`) and repo source
 * (`index.ts` / `index.tsx`). Returns null when any sub-path is missing —
 * a partial SDK would produce a bundle that explodes at activation.
 */
function sdkEntrypointMap(root: string): Record<string, string> | null {
  const map: Record<string, string> = {}
  for (const subpath of SDK_SUBPATHS) {
    const base = subpath ? join(root, subpath) : root
    const candidate = ['index.js', 'index.ts', 'index.tsx']
      .map((name) => join(base, name))
      .find((path) => existsSync(path))
    if (!candidate) return null
    map[specifier(subpath)] = candidate
  }
  return map
}

/**
 * Locate SDK sources for server-bundle inlining. Resolution ladder:
 *   1. `BAKIN_SDK_PATH` — explicit root (CI / hermetic builds)
 *   2. repo source (`packages/sdk/src`) — source runs
 *   3. the plugin's own `node_modules/@makinbakin/sdk` — consumer machines,
 *      installed by the plugin's declared devDependency
 */
export function resolveSdkEntrypoints(pluginDir: string): SdkResolution {
  const envRoot = process.env.BAKIN_SDK_PATH
  if (envRoot && envRoot.trim().length > 0) {
    const entrypoints = sdkEntrypointMap(envRoot)
    if (!entrypoints) {
      throw new WhiskitBuildError(
        'resolve-sdk',
        `BAKIN_SDK_PATH (${envRoot}) does not contain a complete @makinbakin/sdk package`,
      )
    }
    return { source: 'env', entrypoints }
  }

  const repoSdkSrc = join(REPO_ROOT, 'packages', 'sdk', 'src')
  if (existsSync(join(repoSdkSrc, 'index.ts'))) {
    const entrypoints = sdkEntrypointMap(repoSdkSrc)
    if (entrypoints) return { source: 'repo-source', entrypoints }
  }

  const pluginSdk = join(pluginDir, 'node_modules', '@makinbakin', 'sdk')
  if (existsSync(join(pluginSdk, 'package.json'))) {
    const entrypoints = sdkEntrypointMap(pluginSdk)
    if (entrypoints) return { source: 'plugin-node-modules', entrypoints }
  }

  throw new WhiskitBuildError(
    'resolve-sdk',
    `Cannot locate @makinbakin/sdk sources to inline into the server bundle for ${pluginDir}. ` +
    `Add "@makinbakin/sdk" to the plugin's devDependencies (and build with deps installed), ` +
    `or set BAKIN_SDK_PATH to an installed copy of the package.`,
  )
}

export function readPluginPackageJson(pluginDir: string): PluginPackageJson {
  const pkgJsonPath = join(pluginDir, 'package.json')
  if (!existsSync(pkgJsonPath)) return {}
  try {
    return JSON.parse(readFileSync(pkgJsonPath, 'utf-8')) as PluginPackageJson
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new WhiskitBuildError('validate', `Invalid package.json in ${pluginDir}: ${err.message}`)
    }
    throw err
  }
}

function hasDeclaredDeps(pkg: PluginPackageJson): boolean {
  return (
    Object.keys(pkg.dependencies ?? {}).length > 0 ||
    Object.keys(pkg.devDependencies ?? {}).length > 0
  )
}

interface ValidatedPlugin {
  pluginId: string
  serverEntry: string
  clientEntry: string | null
  distDir: string
  pkg: PluginPackageJson
}

function validateRequest(req: WhiskitBuildRequest): ValidatedPlugin {
  const pluginId = req.pluginId ?? basename(req.pluginDir)
  const serverEntry = join(req.pluginDir, 'index.ts')
  if (!existsSync(serverEntry)) {
    throw new WhiskitBuildError('validate', `${serverEntry} not found — every plugin needs a server entry`)
  }
  const clientPath = join(req.pluginDir, 'client.tsx')
  const pkg = readPluginPackageJson(req.pluginDir)
  try {
    validatePluginImports(req.pluginDir, pkg)
  } catch (err) {
    throw new WhiskitBuildError('validate', err instanceof Error ? err.message : String(err))
  }
  return {
    pluginId,
    serverEntry,
    clientEntry: existsSync(clientPath) ? clientPath : null,
    distDir: join(req.pluginDir, 'dist'),
    pkg,
  }
}

/**
 * `bun install --ignore-scripts` in the plugin dir. Pure-JS installs only —
 * lifecycle scripts are withheld until the elevated path lands (Phase 7).
 */
async function installDeps(req: WhiskitBuildRequest, plugin: ValidatedPlugin): Promise<boolean> {
  if (!req.installDeps || !hasDeclaredDeps(plugin.pkg)) return false
  const result = await runSystemBun(['install', '--ignore-scripts'], {
    cwd: req.pluginDir,
    timeoutMs: req.timeoutMs ?? DEFAULT_BUILD_TIMEOUT_MS,
  })
  req.onStage?.({
    stage: 'install',
    status: result.exitCode === 0 ? 'ok' : 'error',
    durationMs: result.durationMs,
  })
  if (result.exitCode !== 0) {
    throw commandFailure('install', `Dependency install for "${plugin.pluginId}"`, result)
  }
  return true
}

/**
 * The script run under the system bun for server builds. `bun build` (CLI)
 * has no plugin support, so SDK inlining needs an in-script `Bun.build()`
 * with an onResolve hook. Config arrives as a JSON file path in argv[2] —
 * nothing is string-interpolated into code.
 */
const SERVER_BUILD_SCRIPT = `
const config = JSON.parse(await Bun.file(process.argv[2]).text())
const result = await Bun.build({
  entrypoints: [config.entry],
  outdir: config.outdir,
  target: 'bun',
  format: 'esm',
  naming: 'index.[ext]',
  external: config.externals,
  plugins: [{
    name: 'whiskit-sdk-resolver',
    setup(build) {
      build.onResolve({ filter: /^@makinbakin\\/sdk(\\/.*)?$/ }, (args) => {
        const path = config.sdkEntrypoints[args.path]
        if (!path) return
        return { path }
      })
    },
  }],
})
if (!result.success) {
  console.error(result.logs.map(String).join('\\n'))
  process.exit(1)
}
`

interface ServerBuildConfig {
  entry: string
  outdir: string
  externals: string[]
  sdkEntrypoints: Record<string, string>
}

async function buildServerWithSystemBun(
  req: WhiskitBuildRequest,
  plugin: ValidatedPlugin,
  sdk: SdkResolution,
): Promise<void> {
  const scratch = mkdtempSync(join(tmpdir(), 'whiskit-server-build-'))
  try {
    const scriptPath = join(scratch, 'build.ts')
    const configPath = join(scratch, 'config.json')
    const config: ServerBuildConfig = {
      entry: plugin.serverEntry,
      outdir: plugin.distDir,
      externals: [...PLUGIN_SERVER_EXTERNALS],
      sdkEntrypoints: sdk.entrypoints,
    }
    writeFileSync(scriptPath, SERVER_BUILD_SCRIPT)
    writeFileSync(configPath, JSON.stringify(config))
    const result = await runSystemBun([scriptPath, configPath], {
      cwd: req.pluginDir,
      timeoutMs: req.timeoutMs ?? DEFAULT_BUILD_TIMEOUT_MS,
    })
    req.onStage?.({
      stage: 'server-build',
      status: result.exitCode === 0 ? 'ok' : 'error',
      durationMs: result.durationMs,
    })
    if (result.exitCode !== 0) {
      throw commandFailure('server-build', `Server build for "${plugin.pluginId}"`, result)
    }
    assertServerBundleExternalsClean(plugin)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

/**
 * Server bundles externalize React/router for the host to provide — but the
 * host only provides them to the BROWSER (import map). A server bundle that
 * retains a runtime import of one of these resolves only inside a repo
 * checkout; on a binary install, activation dies with "Cannot find package
 * 'react'" (#267 residual). Type-only imports are erased by the build and
 * never trip this. Fail at build time, name the specifier, and remove the
 * poisoned artifact so activation can't trip on it later.
 */
function assertServerBundleExternalsClean(plugin: ValidatedPlugin): void {
  const bundlePath = join(plugin.distDir, 'index.js')
  if (!existsSync(bundlePath)) return
  const bundle = readFileSync(bundlePath, 'utf-8')
  const retained = PLUGIN_SERVER_EXTERNALS.filter((spec) => {
    const escaped = spec.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
    return new RegExp(`(?:\\bfrom\\s*|\\bimport\\s*\\(\\s*|\\brequire\\s*\\(\\s*)["']${escaped}["']`).test(bundle)
  })
  if (retained.length === 0) return
  rmSync(bundlePath, { force: true })
  throw new WhiskitBuildError(
    'server-build',
    `server bundle for "${plugin.pluginId}" retains host-provided browser externals: ` +
    retained.map((spec) => `"${spec}"`).join(', ') +
    `. These resolve only in the browser via the host import map — a binary install fails at activation. ` +
    `Server entries must not import client-only SDK subpaths (ui/layout/patterns/charts/conversation/slots/hooks); ` +
    `the SDK root, routing, types, utils, and metadata are server-safe.`,
  )
}

async function buildClientWithSystemBun(req: WhiskitBuildRequest, plugin: ValidatedPlugin): Promise<void> {
  if (!plugin.clientEntry) return
  // A rebuild after the plugin removes its final CSS import must not leave the
  // previous client.css active in the host.
  rmSync(join(plugin.distDir, 'client.css'), { force: true })
  rmSync(join(plugin.distDir, 'client.css.map'), { force: true })
  rmSync(join(plugin.distDir, 'client.js.map'), { force: true })
  const result = await runSystemBun(
    [
      'build', plugin.clientEntry,
      '--outdir', plugin.distDir,
      '--target', 'browser',
      '--format', 'esm',
      '--entry-naming', 'client.[ext]',
      '--sourcemap=external',
      ...(req.production ? ['--production'] : []),
      ...PLUGIN_CLIENT_EXTERNALS.flatMap((e) => ['--external', e]),
    ],
    { cwd: req.pluginDir, timeoutMs: req.timeoutMs ?? DEFAULT_BUILD_TIMEOUT_MS },
  )
  req.onStage?.({
    stage: 'client-build',
    status: result.exitCode === 0 ? 'ok' : 'error',
    durationMs: result.durationMs,
  })
  if (result.exitCode !== 0) {
    throw commandFailure('client-build', `Client build for "${plugin.pluginId}"`, result)
  }

  const cssStartedAt = Date.now()
  try {
    await processBuiltPluginCss({
      pluginId: plugin.pluginId,
      distDir: plugin.distDir,
      sourceRoot: req.pluginDir,
    })
    req.onStage?.({ stage: 'css-validate', status: 'ok', durationMs: Date.now() - cssStartedAt })
  } catch (error) {
    rmSync(join(plugin.distDir, 'client.js'), { force: true })
    req.onStage?.({ stage: 'css-validate', status: 'error', durationMs: Date.now() - cssStartedAt })
    throw new WhiskitBuildError(
      'css-validate',
      error instanceof Error ? error.message : String(error),
    )
  }
}

/**
 * Publish/install-path build: every compile step is a system-`bun`
 * subprocess, so the same code works from a source run and the compiled
 * binary.
 */
export async function buildPluginWithSystemBun(req: WhiskitBuildRequest): Promise<WhiskitBuildResult> {
  const startedAt = Date.now()
  const plugin = validateRequest(req)
  const installedDeps = await installDeps(req, plugin)
  const buildServer = req.serverBuild !== false
  if (buildServer) {
    const sdk = resolveSdkEntrypoints(req.pluginDir)
    await buildServerWithSystemBun(req, plugin, sdk)
  }
  await buildClientWithSystemBun(req, plugin)
  return {
    pluginId: plugin.pluginId,
    builtServer: buildServer,
    builtClient: plugin.clientEntry !== null,
    installedDeps,
    backend: 'system-bun',
    durationMs: Date.now() - startedAt,
  }
}

/**
 * True when the in-process fast path can work: running from a source tree
 * (repo SDK sources on disk, not the compiled binary's /$bunfs/ layout).
 */
export function canBuildInProcess(): boolean {
  return existsSync(join(REPO_ROOT, 'packages', 'sdk', 'src', 'index.ts'))
}

/**
 * Dev-hot-loop fast path: server compile via in-process `Bun.build()` (no
 * subprocess per save), client compile via the system bun (the CLI path the
 * dev loop has always used — browser bundles can't be produced in-process
 * under `bun --hot` anyway). Source runs only; see `canBuildInProcess`.
 */
export async function buildPluginInProcess(req: WhiskitBuildRequest): Promise<WhiskitBuildResult> {
  const startedAt = Date.now()
  const plugin = validateRequest(req)
  const installedDeps = await installDeps(req, plugin)
  if (req.serverBuild === false) {
    await buildClientWithSystemBun(req, plugin)
    return {
      pluginId: plugin.pluginId,
      builtServer: false,
      builtClient: plugin.clientEntry !== null,
      installedDeps,
      backend: 'in-process',
      durationMs: Date.now() - startedAt,
    }
  }
  const sdk = resolveSdkEntrypoints(req.pluginDir)

  // The bun-types snapshot predates BuildConfig.plugins — same cast as the
  // legacy user-plugin-builder used.
  const serverBuildConfig = {
    entrypoints: [plugin.serverEntry],
    outdir: plugin.distDir,
    target: 'bun',
    format: 'esm',
    naming: 'index.[ext]',
    external: [...PLUGIN_SERVER_EXTERNALS],
    plugins: [{
      name: 'whiskit-sdk-resolver',
      setup(build: { onResolve: (filter: { filter: RegExp }, cb: (args: { path: string }) => { path: string } | undefined) => void }) {
        build.onResolve({ filter: /^@makinbakin\/sdk(\/.*)?$/ }, (args) => {
          const path = sdk.entrypoints[args.path]
          if (!path) return
          return { path }
        })
      },
    }],
  } as Parameters<typeof Bun.build>[0] & { plugins: Array<unknown> }
  const serverStartedAt = Date.now()
  let serverResult: Awaited<ReturnType<typeof Bun.build>>
  try {
    serverResult = await Bun.build(serverBuildConfig)
  } catch (err) {
    req.onStage?.({ stage: 'server-build', status: 'error', durationMs: Date.now() - serverStartedAt })
    throw err
  }
  req.onStage?.({
    stage: 'server-build',
    status: serverResult.success ? 'ok' : 'error',
    durationMs: Date.now() - serverStartedAt,
  })
  if (!serverResult.success) {
    throw new WhiskitBuildError(
      'server-build',
      `Server build for "${plugin.pluginId}" failed:\n${serverResult.logs.join('\n')}`,
    )
  }
  assertServerBundleExternalsClean(plugin)

  await buildClientWithSystemBun(req, plugin)
  return {
    pluginId: plugin.pluginId,
    builtServer: true,
    builtClient: plugin.clientEntry !== null,
    installedDeps,
    backend: 'in-process',
    durationMs: Date.now() - startedAt,
  }
}
