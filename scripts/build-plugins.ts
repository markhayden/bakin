/**
 * Build core plugins — each plugin's server entry (index.ts) + client
 * entry (client.tsx) compiled to plugins/<id>/dist/ with externals for
 * react + @bakin/sdk/*. Phase F's runtime loader reads from these dist
 * directories; Phase G embeds them in the binary.
 *
 * Server entries use --target=bun and --packages=external so node_modules
 * deps (better-sqlite3, chokidar, zod, js-yaml, @antfly/sdk, etc.) stay
 * out of the plugin bundle. The host process already has them installed.
 *
 * Client entries use --target=browser. Only react + @bakin/sdk/* are
 * externalized — other client deps (lucide-react, zustand, shadcn
 * primitives) bundle into client.js so the plugin is self-contained
 * from the browser's point of view.
 */
import { rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const CORE_PLUGINS = [
  'tasks', 'team', 'workflows', 'projects', 'assets',
  'schedule', 'memory', 'messaging', 'models', 'health',
]

const EXTERNAL = [
  'react', 'react-dom', 'react-dom/client',
  'react/jsx-runtime', 'react/jsx-dev-runtime',
  '@tanstack/react-router',
  '@bakin/sdk', '@bakin/sdk/ui', '@bakin/sdk/hooks',
  '@bakin/sdk/components', '@bakin/sdk/slots',
  '@bakin/sdk/types', '@bakin/sdk/utils',
]

for (const id of CORE_PLUGINS) {
  const pluginDir = join('plugins', id)
  const distDir = join(pluginDir, 'dist')
  rmSync(distDir, { recursive: true, force: true })

  const clientEntry = join(pluginDir, 'client.tsx')
  const hasClient = existsSync(clientEntry)

  // Server entry — runs on Bun (Node-compatible). Used by Phase F's dynamic import.
  // --packages=external keeps all node_modules deps out of the bundle — this is a
  // PLUGIN, not a standalone binary. The host process has them installed.
  const serverProc = Bun.spawn([
    'bun', 'build', join(pluginDir, 'index.ts'),
    '--outdir', distDir,
    '--target', 'bun',
    '--format', 'esm',
    '--entry-naming', 'index.[ext]',
    '--packages', 'external',
    ...EXTERNAL.flatMap(e => ['--external', e]),
  ], { stdout: 'pipe', stderr: 'pipe' })
  const serverExit = await serverProc.exited
  if (serverExit !== 0) {
    const err = await new Response(serverProc.stderr).text()
    console.error(`Failed to build server entry for ${id}:\n${err}`)
    process.exit(1)
  }

  // Client entry — browser target; externalizes vendor bundles (react + sdk).
  // Everything else bundles in.
  if (hasClient) {
    const clientProc = Bun.spawn([
      'bun', 'build', clientEntry,
      '--outdir', distDir,
      '--target', 'browser',
      '--format', 'esm',
      '--entry-naming', 'client.[ext]',
      ...EXTERNAL.flatMap(e => ['--external', e]),
    ], { stdout: 'pipe', stderr: 'pipe' })
    const clientExit = await clientProc.exited
    if (clientExit !== 0) {
      const err = await new Response(clientProc.stderr).text()
      console.error(`Failed to build client entry for ${id}:\n${err}`)
      process.exit(1)
    }
  }

  console.log(`  built plugins/${id}/dist/`)
}

console.log(`plugins/<id>/dist: ${CORE_PLUGINS.length} plugins built`)

export {}
