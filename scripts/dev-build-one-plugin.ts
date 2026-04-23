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

export interface BuildOnePluginOptions {
  /** Directory containing the plugin. Defaults to 'plugins' (core plugins). */
  pluginsDir?: string
  /** Specifiers to externalize from the plugin bundles. */
  external: readonly string[]
}

export type BuildOnePluginResult =
  | { ok: true }
  | { ok: false; stderr: string }

export async function buildOnePlugin(
  id: string,
  opts: BuildOnePluginOptions,
): Promise<BuildOnePluginResult> {
  const pluginsDir = opts.pluginsDir ?? 'plugins'
  const pluginDir = join(pluginsDir, id)
  const distDir = join(pluginDir, 'dist')
  rmSync(distDir, { recursive: true, force: true })

  const externalArgs = opts.external.flatMap((e) => ['--external', e])

  const serverProc = Bun.spawn([
    'bun', 'build', join(pluginDir, 'index.ts'),
    '--outdir', distDir,
    '--target', 'bun',
    '--format', 'esm',
    '--entry-naming', 'index.[ext]',
    '--packages', 'external',
    ...externalArgs,
  ], { stdout: 'pipe', stderr: 'pipe' })
  const serverExit = await serverProc.exited
  if (serverExit !== 0) {
    const stderr = await new Response(serverProc.stderr).text()
    return { ok: false, stderr: `server entry for ${id}:\n${stderr}` }
  }

  const clientEntry = join(pluginDir, 'client.tsx')
  if (existsSync(clientEntry)) {
    const clientProc = Bun.spawn([
      'bun', 'build', clientEntry,
      '--outdir', distDir,
      '--target', 'browser',
      '--format', 'esm',
      '--entry-naming', 'client.[ext]',
      ...externalArgs,
    ], { stdout: 'pipe', stderr: 'pipe' })
    const clientExit = await clientProc.exited
    if (clientExit !== 0) {
      const stderr = await new Response(clientProc.stderr).text()
      return { ok: false, stderr: `client entry for ${id}:\n${stderr}` }
    }
  }

  return { ok: true }
}
