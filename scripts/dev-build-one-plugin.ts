/**
 * Per-plugin build helper.
 *
 * Extracted from scripts/build-plugins.ts so the HMR dev loop can rebuild
 * a single plugin on file change without duplicating the subprocess-spawn
 * logic. The batch builder still owns CORE_PLUGINS and the EXTERNAL list
 * (passed in) — this helper is only the "build one id" primitive.
 *
 * Returns a result object instead of process.exit-ing so the dev watcher
 * can surface the stderr in a browser overlay rather than killing itself.
 */
import { rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

import { processBuiltPluginCss } from '../src/core/whiskit/plugin-css'

export interface BuildOnePluginOptions {
  /** Directory containing the plugin. Defaults to 'plugins' (core plugins). */
  pluginsDir?: string
  /** Specifiers to externalize from the plugin bundles. */
  external: readonly string[]
  /** Minify browser client assets for release/static builds. */
  production?: boolean
  /**
   * Build the server bundle (dist/index.js). Defaults to true — user plugins
   * activate from dist/index.js and must keep it. Core plugin callers pass
   * false (#421): core server code is statically imported from source, so
   * their dist holds browser assets only.
   */
  serverEntry?: boolean
}

export type BuildOnePluginResult =
  /** clientBuilt=false: server-only plugin (no client.tsx) — no dist produced. */
  | { ok: true; clientBuilt: boolean }
  | { ok: false; stderr: string }

interface RunResult {
  exitCode: number
  stderr: string
}

function run(cmd: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const stderrChunks: Buffer[] = []
    proc.stdout?.on('data', () => { /* discard */ })
    proc.stderr?.on('data', (c: Buffer) => { stderrChunks.push(c) })
    proc.once('error', reject)
    proc.once('close', (code: number | null) => {
      resolve({
        exitCode: code ?? 0,
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
      })
    })
  })
}

export async function buildOnePlugin(
  id: string,
  opts: BuildOnePluginOptions,
): Promise<BuildOnePluginResult> {
  const pluginsDir = opts.pluginsDir ?? 'plugins'
  const pluginDir = join(pluginsDir, id)
  const distDir = join(pluginDir, 'dist')
  rmSync(distDir, { recursive: true, force: true })

  const externalArgs = opts.external.flatMap((e) => ['--external', e])

  if (opts.serverEntry ?? true) {
    const serverRes = await run('bun', [
      'build', join(pluginDir, 'index.ts'),
      '--outdir', distDir,
      '--target', 'bun',
      '--format', 'esm',
      '--entry-naming', 'index.[ext]',
      '--packages', 'external',
      ...externalArgs,
    ])
    if (serverRes.exitCode !== 0) {
      return { ok: false, stderr: `server entry for ${id}:\n${serverRes.stderr}` }
    }
  }

  const clientEntry = join(pluginDir, 'client.tsx')
  if (!existsSync(clientEntry)) {
    // Server-only plugin (e.g. git, images): nothing to bundle, no dist.
    // Callers must not log "built <dist>" — that phantom cost real debugging.
    return { ok: true, clientBuilt: false }
  }
  const clientRes = await run('bun', [
    'build', clientEntry,
    '--outdir', distDir,
    '--target', 'browser',
    '--format', 'esm',
    '--entry-naming', 'client.[ext]',
    '--sourcemap=external',
    ...(opts.production ? ['--production'] : []),
    ...externalArgs,
  ])
  if (clientRes.exitCode !== 0) {
    return { ok: false, stderr: `client entry for ${id}:\n${clientRes.stderr}` }
  }
  try {
    await processBuiltPluginCss({ pluginId: id, distDir, sourceRoot: pluginDir })
  } catch (error) {
    rmSync(join(distDir, 'client.js'), { force: true })
    return {
      ok: false,
      stderr: `client CSS for ${id}:\n${error instanceof Error ? error.message : String(error)}`,
    }
  }

  return { ok: true, clientBuilt: true }
}
