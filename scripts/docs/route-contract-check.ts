#!/usr/bin/env bun
/**
 * Route-contract validator entrypoint (T5).
 *
 * Discovers in-repo plugin route declarations + core routes (when they
 * land at T14+) and runs the validator (T5 lib). During the migration
 * window (T6–T16) findings are warnings — exit code 0. At T18 the mode
 * flips to `error` and the validator gates CI.
 *
 * Plugin discovery is intentionally static — we import each plugin
 * module to read `default.routes`, but never invoke `activate()`. This
 * means side effects (timers, watchers, network calls) cannot leak from
 * docs builds.
 */

import { readdirSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import type { APIRoute } from '../../packages/core/src/routing/types'
import { validateRouteContracts, type RouteFinding } from './route-contract-check-lib'

const repoRoot = resolve(new URL('../..', import.meta.url).pathname)

/** Plugins whose source is not in this repo — exempt from validation. */
const EXTRACTED_PLUGINS = ['messaging', 'projects']

interface CliArgs {
  mode: 'warn' | 'error'
}

function parseArgs(): CliArgs {
  const argv = process.argv.slice(2)
  const mode = argv.includes('--fail-closed') ? 'error' : 'warn'
  return { mode }
}

async function loadPluginRoutes(): Promise<Record<string, ReadonlyArray<APIRoute<any, any, any, any>>>> {
  const out: Record<string, ReadonlyArray<APIRoute<any, any, any, any>>> = {}
  const pluginsDir = join(repoRoot, 'plugins')
  if (!existsSync(pluginsDir)) return out

  const ids = readdirSync(pluginsDir).sort()
  for (const id of ids) {
    if (id.startsWith('_') || id.startsWith('.')) continue
    if (EXTRACTED_PLUGINS.includes(id)) continue
    const indexPath = join(pluginsDir, id, 'index.ts')
    if (!existsSync(indexPath)) continue
    try {
      const mod = await import(indexPath) as { default?: { routes?: ReadonlyArray<APIRoute<any, any, any, any>> } }
      const routes = mod.default?.routes ?? []
      out[id] = routes
    } catch (err) {
      // Best-effort: an import failure here means the plugin can't be
      // statically read (T1–T16 plugins haven't migrated yet). Report it
      // as a single "no declarative routes" finding rather than blowing
      // up the validator.
      console.warn(`[validator] could not statically import plugins/${id}/index.ts: ${err instanceof Error ? err.message : String(err)}`)
      out[id] = []
    }
  }
  return out
}

async function loadCoreRoutes(): Promise<ReadonlyArray<APIRoute<any, any, any, any>>> {
  const indexPath = join(repoRoot, 'packages/host/src/core-routes/index.ts')
  if (!existsSync(indexPath)) return []
  try {
    const mod = await import(indexPath) as { coreRoutes?: ReadonlyArray<APIRoute<any, any, any, any>> }
    return mod.coreRoutes ?? []
  } catch {
    return []
  }
}

function formatFinding(f: RouteFinding): string {
  return `  ${f.scope.padEnd(12)} ${f.method.padEnd(6)} ${f.path.padEnd(30)} ${f.issue}`
}

async function main(): Promise<number> {
  const args = parseArgs()
  const pluginRoutes = await loadPluginRoutes()
  const coreRoutes = await loadCoreRoutes()

  const totalRoutes = coreRoutes.length
    + Object.values(pluginRoutes).reduce((acc, rs) => acc + rs.length, 0)

  const result = validateRouteContracts({
    pluginRoutes,
    coreRoutes,
    exemptPlugins: EXTRACTED_PLUGINS,
    mode: args.mode,
  })

  console.log(`route-contract-check: scanned ${totalRoutes} declarative route(s) across ${Object.keys(pluginRoutes).length} plugin(s) + ${coreRoutes.length} core`)

  if (result.errors.length > 0) {
    console.error(`\n${result.errors.length} error(s):`)
    for (const f of result.errors) console.error(formatFinding(f))
  }
  if (result.warnings.length > 0) {
    console.warn(`\n${result.warnings.length} warning(s) — public routes missing schemas:`)
    for (const f of result.warnings) console.warn(formatFinding(f))
  }
  if (result.errors.length === 0 && result.warnings.length === 0) {
    console.log('\nall public routes have typed contracts.')
  }

  return result.errors.length > 0 ? 1 : 0
}

main().then(code => process.exit(code)).catch(err => {
  console.error('route-contract-check failed:', err)
  process.exit(2)
})
