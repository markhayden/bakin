/**
 * `bakin plugins sync-manifest` engine — regenerate a plugin's manifest
 * `contributes` sections from its actual code so authors never hand-mirror
 * (R14). The CLI command in src/cli/commands/plugins.ts is a thin client.
 *
 * v1 boundary: syncs the SERVER-derived sections only —
 *   - `contributes.apiRoutes`  (declarative `definePlugin({routes})`, legacy
 *     `ctx.registerRoute` calls, and the search API's auto-registered
 *     `GET /search` route)
 *   - `contributes.execTools`  (`ctx.registerExecTool` calls)
 * Client sections (`nav`, `clientRoutes`, slots) are left untouched: deriving
 * them would mean executing client.tsx in a DOM emulation for marginal gain.
 * The CLI prints this boundary so authors aren't surprised.
 *
 * How capture works: the plugin is built with the real in-binary builder,
 * dist/index.js is imported, and `activate(ctx)` runs against a RECORDING
 * context — registerRoute / registerExecTool / search registrations are
 * captured; every other context surface is a deep no-op proxy so arbitrary
 * plugin code runs without side effects (no storage writes, no hooks, no
 * events). If activate throws, we refuse to write: a partial capture could
 * regenerate a wrong tool list.
 *
 * Regeneration preserves author-maintained metadata: existing entries that
 * still exist in code keep their manifest objects verbatim (summary,
 * permissions, docs fields); removed entries are dropped; new entries get a
 * derived summary. Unknown manifest keys and key order are preserved —
 * only the `contributes.apiRoutes` / `contributes.execTools` values change
 * (T15 tombstone/tolerance stance).
 */
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { pathToFileURL } from 'url'

import type { HttpMethod } from '@makinbakin/sdk/types'

import { createLogger } from '@/core/logger'

const log = createLogger('plugin-sync-manifest')

interface CapturedRoute {
  method: string
  path: string
  summary?: string
  description?: string
}

interface CapturedTool {
  name: string
  description?: string
}

export interface SyncManifestDiff {
  apiRoutes: { added: string[]; removed: string[]; kept: number }
  execTools: { added: string[]; removed: string[]; kept: number }
}

export interface SyncManifestResult {
  ok: boolean
  error?: string
  pluginId?: string
  manifestPath?: string
  /** True when the regenerated sections differ from the manifest on disk. */
  changed?: boolean
  /** True when the manifest file was rewritten (never in check mode). */
  written?: boolean
  diff?: SyncManifestDiff
  /** v1 boundary reminder for the caller to surface. */
  note: string
}

const V1_NOTE =
  'sync-manifest derives server sections only (contributes.apiRoutes, contributes.execTools); ' +
  'client sections (nav, clientRoutes) are author-maintained.'

/** Deep no-op proxy: any property access yields a callable that returns
 * undefined (or a resolved promise via then-ability being absent). Lets
 * arbitrary activate() code run without side effects. */
function noopSurface(): unknown {
  const fn = () => undefined
  return new Proxy(fn, {
    get: (_t, prop) => {
      // Promise-detection guard: pretending to be thenable would make
      // `await ctx.anything()` hang on some runtimes.
      if (prop === 'then') return undefined
      return noopSurface()
    },
    apply: () => undefined,
  })
}

/** Build the recording context handed to activate(). */
function buildCaptureContext(pluginId: string, routes: CapturedRoute[], tools: CapturedTool[]): unknown {
  const recordRoute = (route: unknown) => {
    const r = route as CapturedRoute
    if (!r || typeof r.path !== 'string' || typeof r.method !== 'string') return
    if (routes.some((existing) => existing.method === r.method && existing.path === r.path)) return
    routes.push({ method: r.method, path: r.path, summary: r.summary, description: r.description })
  }
  let searchRouteRecorded = false
  const recordSearchRoute = () => {
    // Mirrors buildSearchAPI's maybeAutoRegisterSearchRoute: the first
    // content-type registration auto-wires GET /search exactly once.
    if (searchRouteRecorded) return
    searchRouteRecorded = true
    recordRoute({ method: 'GET', path: '/search', description: `Search ${pluginId}` })
  }
  const base = {
    pluginId,
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    getSettings: () => ({}),
    registerRoute: recordRoute,
    registerExecTool: (tool: unknown) => {
      const t = tool as CapturedTool
      if (!t || typeof t.name !== 'string') return
      if (tools.some((existing) => existing.name === t.name)) return
      tools.push({ name: t.name, description: t.description })
    },
    search: new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === 'registerContentType' || prop === 'registerFileBackedContentType') {
            return (..._args: unknown[]) => {
              recordSearchRoute()
              return noopSurface()
            }
          }
          if (prop === 'then') return undefined
          return noopSurface()
        },
      },
    ),
  }
  // Everything not explicitly modeled falls through to the no-op surface.
  return new Proxy(base, {
    get: (target, prop, receiver) => {
      if (prop in target) return Reflect.get(target, prop, receiver)
      if (prop === 'then') return undefined
      return noopSurface()
    },
  })
}

function summaryFor(route: CapturedRoute): string {
  const derived = route.summary ?? route.description?.split('\n')[0]
  return derived && derived.trim().length > 0 ? derived.trim() : `${route.method.toUpperCase()} ${route.path}`
}

function toolSummaryFor(tool: CapturedTool): string {
  const derived = tool.description?.split('\n')[0]
  return derived && derived.trim().length > 0 ? derived.trim() : tool.name
}

const routeKey = (method: string, path: string) => `${method.toUpperCase()} ${path}`

export async function syncPluginManifest(
  pluginDir: string,
  opts: { check?: boolean; skipBuild?: boolean } = {},
): Promise<SyncManifestResult> {
  const dir = resolve(pluginDir)
  const manifestPath = join(dir, 'bakin-plugin.json')
  if (!existsSync(manifestPath)) {
    return { ok: false, error: `No bakin-plugin.json found in ${dir}`, note: V1_NOTE }
  }

  let rawManifest: Record<string, unknown>
  try {
    rawManifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>
  } catch (err) {
    return { ok: false, error: `bakin-plugin.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`, note: V1_NOTE }
  }
  const pluginId = typeof rawManifest.id === 'string' ? rawManifest.id : undefined
  if (!pluginId) {
    return { ok: false, error: 'bakin-plugin.json is missing "id"', note: V1_NOTE }
  }

  // Build with the real in-binary builder so the captured surface is exactly
  // what an install would activate (skipBuild lets tests reuse a fresh dist).
  if (!opts.skipBuild || !existsSync(join(dir, 'dist', 'index.js'))) {
    try {
      const { buildUserPlugin } = await import('../../packages/host/src/plugin-host/user-plugin-builder')
      await buildUserPlugin(dir)
    } catch (err) {
      return {
        ok: false,
        pluginId,
        manifestPath,
        error: `Build failed: ${err instanceof Error ? err.message : String(err)}`,
        note: V1_NOTE,
      }
    }
  }

  let plugin: { routes?: unknown[]; activate?: (ctx: unknown) => unknown }
  try {
    const mod = await import(pathToFileURL(join(dir, 'dist', 'index.js')).href)
    plugin = (mod.default ?? mod) as typeof plugin
  } catch (err) {
    return {
      ok: false,
      pluginId,
      manifestPath,
      error: `Could not import built plugin: ${err instanceof Error ? err.message : String(err)}`,
      note: V1_NOTE,
    }
  }

  const routes: CapturedRoute[] = []
  const tools: CapturedTool[] = []

  for (const route of plugin.routes ?? []) {
    const r = route as CapturedRoute
    if (r && typeof r.path === 'string' && typeof r.method === 'string') {
      routes.push({ method: r.method, path: r.path, summary: r.summary, description: r.description })
    }
  }

  if (typeof plugin.activate === 'function') {
    const ctx = buildCaptureContext(pluginId, routes, tools)
    try {
      await plugin.activate(ctx)
    } catch (err) {
      // A partial capture could regenerate a WRONG tool/route list — refuse.
      return {
        ok: false,
        pluginId,
        manifestPath,
        error: `activate() threw during capture — not writing (a partial capture could drop real entries): ${err instanceof Error ? err.message : String(err)}`,
        note: V1_NOTE,
      }
    }
  }

  // --- regenerate, preserving author-maintained metadata for kept entries ---
  const contributes = (rawManifest.contributes ?? {}) as Record<string, unknown>
  const existingRoutes = Array.isArray(contributes.apiRoutes) ? (contributes.apiRoutes as Record<string, unknown>[]) : []
  const existingTools = Array.isArray(contributes.execTools) ? (contributes.execTools as Record<string, unknown>[]) : []

  const existingRouteByKey = new Map(
    existingRoutes
      .filter((r) => typeof r.method === 'string' && typeof r.path === 'string')
      .map((r) => [routeKey(r.method as string, r.path as string), r] as const),
  )
  const existingToolByName = new Map(
    existingTools.filter((t) => typeof t.name === 'string').map((t) => [t.name as string, t] as const),
  )

  const nextRoutes = routes.map((r) => {
    const kept = existingRouteByKey.get(routeKey(r.method, r.path))
    return kept ?? { method: r.method.toUpperCase() as HttpMethod, path: r.path, summary: summaryFor(r) }
  })
  const nextTools = tools.map((t) => {
    const kept = existingToolByName.get(t.name)
    return kept ?? { name: t.name, summary: toolSummaryFor(t) }
  })

  const capturedRouteKeys = new Set(routes.map((r) => routeKey(r.method, r.path)))
  const capturedToolNames = new Set(tools.map((t) => t.name))
  const diff: SyncManifestDiff = {
    apiRoutes: {
      added: routes.filter((r) => !existingRouteByKey.has(routeKey(r.method, r.path))).map((r) => routeKey(r.method, r.path)),
      removed: [...existingRouteByKey.keys()].filter((key) => !capturedRouteKeys.has(key)),
      kept: nextRoutes.length - routes.filter((r) => !existingRouteByKey.has(routeKey(r.method, r.path))).length,
    },
    execTools: {
      added: tools.filter((t) => !existingToolByName.has(t.name)).map((t) => t.name),
      removed: [...existingToolByName.keys()].filter((name) => !capturedToolNames.has(name)),
      kept: nextTools.length - tools.filter((t) => !existingToolByName.has(t.name)).length,
    },
  }
  const changed =
    diff.apiRoutes.added.length > 0 ||
    diff.apiRoutes.removed.length > 0 ||
    diff.execTools.added.length > 0 ||
    diff.execTools.removed.length > 0

  if (changed && !opts.check) {
    const nextContributes: Record<string, unknown> = { ...contributes }
    if (nextRoutes.length > 0) nextContributes.apiRoutes = nextRoutes
    else delete nextContributes.apiRoutes
    if (nextTools.length > 0) nextContributes.execTools = nextTools
    else delete nextContributes.execTools

    // Preserve top-level key order; only the contributes value changes.
    const out: Record<string, unknown> = {}
    let placed = false
    for (const [key, value] of Object.entries(rawManifest)) {
      if (key === 'contributes') {
        out[key] = nextContributes
        placed = true
      } else {
        out[key] = value
      }
    }
    if (!placed && (nextRoutes.length > 0 || nextTools.length > 0)) out.contributes = nextContributes
    writeFileSync(manifestPath, `${JSON.stringify(out, null, 2)}\n`)
    log.info(`sync-manifest wrote ${manifestPath}`, { pluginId, diff })
  }

  return {
    ok: true,
    pluginId,
    manifestPath,
    changed,
    written: changed && !opts.check,
    diff,
    note: V1_NOTE,
  }
}
