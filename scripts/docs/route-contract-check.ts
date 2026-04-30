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

interface PluginScanResult {
  declarativeRoutes: ReadonlyArray<APIRoute<any, any, any, any>>
  legacyRouteCount: number
}

async function loadPluginRoutes(): Promise<Record<string, PluginScanResult>> {
  const out: Record<string, PluginScanResult> = {}
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
      const declarativeRoutes = mod.default?.routes ?? []
      // Source-side legacy detection: count `ctx.registerRoute(...)` calls
      // that are not yet in plugin.routes. This catches plugins still
      // using the imperative legacy shape so the validator surfaces them
      // as "needs migration" rather than silently passing.
      const legacyRouteCount = countLegacyRouteRegistrations(indexPath)
      out[id] = { declarativeRoutes, legacyRouteCount }
    } catch (err) {
      console.warn(`[validator] could not statically import plugins/${id}/index.ts: ${err instanceof Error ? err.message : String(err)}`)
      out[id] = { declarativeRoutes: [], legacyRouteCount: 0 }
    }
  }
  return out
}

/**
 * Count `ctx.registerRoute(...)` and `: APIRoute = {...}` patterns in a
 * plugin's source tree. Used by the validator to surface unmigrated
 * routes that don't yet appear in `plugin.routes`.
 */
function countLegacyRouteRegistrations(entryPath: string): number {
  const fs = require('fs') as typeof import('fs')
  const path = require('path') as typeof import('path')
  const dir = path.dirname(entryPath)
  let count = 0
  const visit = (target: string) => {
    if (!fs.existsSync(target)) return
    const stat = fs.statSync(target)
    if (stat.isDirectory()) {
      if (target.endsWith('/dist') || target.endsWith('/node_modules')) return
      for (const entry of fs.readdirSync(target)) visit(path.join(target, entry))
      return
    }
    if (!target.endsWith('.ts') && !target.endsWith('.tsx')) return
    const text = fs.readFileSync(target, 'utf8')
    count += (text.match(/ctx\.registerRoute\s*\(/g) ?? []).length
    count += (text.match(/(?:export\s+)?const\s+\w+\s*:\s*APIRoute\s*=\s*\{/g) ?? []).length
  }
  visit(dir)
  return count
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
  const pluginScan = await loadPluginRoutes()
  const coreRoutes = await loadCoreRoutes()

  // Build pluginRoutes for the validator from the declarative slice only.
  const pluginRoutes: Record<string, ReadonlyArray<APIRoute<any, any, any, any>>> = {}
  for (const [id, scan] of Object.entries(pluginScan)) {
    pluginRoutes[id] = scan.declarativeRoutes
  }

  const totalDeclarative = coreRoutes.length
    + Object.values(pluginScan).reduce((acc, s) => acc + s.declarativeRoutes.length, 0)
  const totalLegacy = Object.values(pluginScan).reduce((acc, s) => acc + s.legacyRouteCount, 0)

  const result = validateRouteContracts({
    pluginRoutes,
    coreRoutes,
    exemptPlugins: EXTRACTED_PLUGINS,
    mode: args.mode,
  })

  // Surface plugins that still have legacy ctx.registerRoute calls. During
  // the migration window (T6–T16) these become warnings rather than errors;
  // T18 flips this to fail-closed via --fail-closed.
  const legacyFindings: { scope: string; method: string; path: string; issue: string }[] = []
  for (const [id, scan] of Object.entries(pluginScan)) {
    if (scan.legacyRouteCount === 0) continue
    if (scan.declarativeRoutes.length === 0) {
      // Whole plugin still on the legacy shape.
      legacyFindings.push({
        scope: id,
        method: '*',
        path: '*',
        issue: `plugin has ${scan.legacyRouteCount} legacy ctx.registerRoute / APIRoute literal(s); migrate to defineRoute`,
      })
    } else {
      legacyFindings.push({
        scope: id,
        method: '*',
        path: '*',
        issue: `plugin partially migrated: ${scan.declarativeRoutes.length} declarative + ${scan.legacyRouteCount} legacy registration(s) remain`,
      })
    }
  }

  console.log(`route-contract-check: scanned ${totalDeclarative} declarative route(s) + detected ${totalLegacy} legacy registration(s) across ${Object.keys(pluginScan).length} plugin(s) + ${coreRoutes.length} core`)

  const errors = [...result.errors, ...(args.mode === 'error' ? legacyFindings : [])]
  const warnings = [...result.warnings, ...(args.mode === 'warn' ? legacyFindings : [])]

  if (errors.length > 0) {
    console.error(`\n${errors.length} error(s):`)
    for (const f of errors) console.error(formatFinding(f))
  }
  if (warnings.length > 0) {
    console.warn(`\n${warnings.length} warning(s) — public routes / plugins needing migration:`)
    for (const f of warnings) console.warn(formatFinding(f))
  }
  if (errors.length === 0 && warnings.length === 0) {
    console.log('\nall public routes have typed contracts.')
  }

  return errors.length > 0 ? 1 : 0
}

main().then(code => process.exit(code)).catch(err => {
  console.error('route-contract-check failed:', err)
  process.exit(2)
})
