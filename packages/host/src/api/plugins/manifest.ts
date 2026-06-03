/**
 * GET /api/plugins/manifest — aggregated plugin manifest for the browser.
 *
 * Returns the list of registered plugins + where to find each one's client
 * bundle. The shell's PluginHost (TF4) fetches this on mount and dynamic-
 * imports every `clientEntry` URL so each plugin's `registerPlugin({...})`
 * side-effect runs.
 *
 * Shape is intentionally minimal for TF1 — the registry knows the plugin's
 * NavItems via the existing navItems PluginState field. Pages + slots are
 * registered by the plugin's `client.mjs` at runtime via `registerPlugin`,
 * so they don't live in the manifest.
 */
import { existsSync, statSync } from 'fs'
import { join } from 'path'
import { isCorePlugin, pluginRegistry } from '@/lib/plugin-registry'
import { getContentDir } from '@/core/content-dir'
import { createLogger } from '@/core/logger'
import { readPluginLockfile, type PluginLockEntry } from '@bakin/core/plugins/lockfile'
import { runChecks } from '@/core/plugins/upgrade'
import { EMBEDDED_ASSETS } from '../_embedded-assets'
import { APP_VERSION } from '@bakin/core/constants'
import type { PluginContributions } from '@makinbakin/sdk/types'
import { startStartupSpan } from '@/core/startup-diagnostics'

const log = createLogger('plugin-manifest')

const STALE_HINT_DAYS = 7

interface ManifestPlugin {
  id: string
  name: string
  version: string
  clientEntry?: string
  clientVersion?: string
  /** Optional stylesheet URL — present only if the plugin build emitted one. */
  clientCss?: string
  /** Where the plugin came from. `core` ships with the binary; `github`/`local` are user-installed. */
  source: 'core' | 'github' | 'local'
  /** Lockfile entry for user-installed plugins; null for core. */
  installed: PluginLockEntry | null
  /**
   * True iff a remote update is detected. Always false at C3 — C5 wires
   * `bakin plugins list --check` to populate `lastChecked` + remote shas
   * and compute this flag.
   */
  upgradeAvailable: boolean
  /**
   * Days since `lastChecked` if older than the staleness threshold (7 days),
   * otherwise null. Surfaces as a "(last checked N days ago — run with
   * --check)" hint in the CLI.
   */
  staleHintDays: number | null
  status: 'active' | 'failed'
  errorCode?: string
  errorMessage?: string
  missingDependencies?: string[]
  contributes?: PluginContributions
}

interface ManifestResponse {
  plugins: ManifestPlugin[]
}

function daysSince(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime()
  return Math.floor(ms / (1000 * 60 * 60 * 24))
}

function pluginAssetPath(pluginId: string, relPath: string): string | null {
  const userPath = join(getContentDir(), 'plugins', pluginId, 'dist', relPath)
  if (existsSync(userPath)) return userPath

  const repoPath = join(process.cwd(), 'plugins', pluginId, 'dist', relPath)
  if (existsSync(repoPath)) return repoPath

  return null
}

async function hasEmbeddedPluginAsset(pluginId: string, relPath: string): Promise<boolean> {
  const embeddedPath = EMBEDDED_ASSETS.get(`/api/plugins/${pluginId}/assets/${relPath}`)
  if (!embeddedPath) return false
  try {
    return await Bun.file(embeddedPath).exists()
  } catch {
    return false
  }
}

async function pluginAssetVersion(pluginId: string, relPath: string): Promise<string | null> {
  const path = pluginAssetPath(pluginId, relPath)
  if (path) {
    try {
      const stat = statSync(path)
      if (!stat.isFile()) return null
      return String(Math.trunc(stat.mtimeMs))
    } catch {
      return null
    }
  }

  if (await hasEmbeddedPluginAsset(pluginId, relPath)) {
    return `embedded-${APP_VERSION}`
  }

  return null
}

async function hasClientCss(pluginId: string): Promise<boolean> {
  return (await pluginAssetVersion(pluginId, 'client.css')) !== null
}

export async function get(req: Request): Promise<Response> {
  const span = startStartupSpan(log, 'pluginManifest.get', {
    phase: 'manifest',
    thresholdMs: 250,
  })
  const url = new URL(req.url)
  const wantCheck = url.searchParams.get('check') === '1'
  try {
    // If --check requested, batch the per-plugin probes via runChecks — that
    // helper does parallel reads but ONE atomic lockfile write at the end,
    // avoiding the read-modify-write race that would silently drop updates.
    if (wantCheck) {
      const userIds = pluginRegistry
        .getRegistrySnapshot()
        .map(e => e.id)
        .filter(id => !isCorePlugin(id))
      if (userIds.length > 0) {
        const checkSpan = startStartupSpan(log, 'pluginManifest.updateChecks', {
          phase: 'manifest',
          count: userIds.length,
          thresholdMs: 1_000,
        })
        let results: Awaited<ReturnType<typeof runChecks>>
        try {
          results = await runChecks(userIds)
          checkSpan.end({ status: 'ok', count: results.length })
        } catch (err) {
          checkSpan.end({ status: 'error', error: err instanceof Error ? err.message : String(err) })
          throw err
        }
        for (const r of results) {
          if (r.error) log.warn('plugin --check probe failed', { id: r.id, error: r.error })
        }
      }
    }

    // Read the lockfile once per request; tolerate read failures so a corrupt
    // lockfile doesn't blank the entire UI manifest.
    let lockedPlugins: Record<string, PluginLockEntry> = {}
    try {
      lockedPlugins = readPluginLockfile().plugins
    } catch (err) {
      log.error('failed to read plugin lockfile for manifest', err as Error)
    }

    const plugins: ManifestPlugin[] = []
    for (const entry of pluginRegistry.getRegistrySnapshot()) {
      const installed = lockedPlugins[entry.id] ?? null
      const isCore = isCorePlugin(entry.id)
      const source: ManifestPlugin['source'] = isCore
        ? 'core'
        : (installed?.type ?? 'local')

      let staleHintDays: number | null = null
      if (installed?.lastChecked) {
        const days = daysSince(installed.lastChecked)
        if (days > STALE_HINT_DAYS) staleHintDays = days
      }

      // Compute upgrade availability from persisted markers — same source of
      // truth whether or not --check ran this request.
      let upgradeAvailable = false
      if (installed && !isCore) {
        if (installed.type === 'github' && installed.remoteHeadSha) {
          upgradeAvailable = installed.remoteHeadSha !== installed.commitSha
        } else if (installed.type === 'local' && installed.lastSourceTreeSha && installed.sourceTreeSha) {
          upgradeAvailable = installed.lastSourceTreeSha !== installed.sourceTreeSha
        }
      }

      const plugin: ManifestPlugin = {
        id: entry.id,
        name: entry.name,
        version: entry.version,
        source,
        installed,
        upgradeAvailable,
        staleHintDays,
        status: entry.status,
        contributes: entry.contributes,
      }
      const clientAssetSpan = startStartupSpan(log, 'pluginManifest.assetVersion', {
        phase: 'manifest',
        pluginId: entry.id,
        pluginSource: isCore ? 'core' : 'user',
        debug: false,
      })
      const clientVersion = entry.status === 'active'
        ? await pluginAssetVersion(entry.id, 'client.js')
        : null
      clientAssetSpan.end({
        status: clientVersion ? 'ok' : 'skipped',
        asset: 'client.js',
      })
      if (entry.status === 'active' && clientVersion) {
        plugin.clientEntry = `/api/plugins/${entry.id}/assets/client.js`
        plugin.clientVersion = clientVersion
      } else if (entry.status === 'failed') {
        plugin.errorCode = entry.errorCode
        plugin.errorMessage = entry.errorMessage
        plugin.missingDependencies = entry.missingDependencies
      }
      if (entry.status === 'active') {
        const cssAssetSpan = startStartupSpan(log, 'pluginManifest.assetVersion', {
          phase: 'manifest',
          pluginId: entry.id,
          pluginSource: isCore ? 'core' : 'user',
          debug: false,
        })
        const clientCss = await hasClientCss(entry.id)
        cssAssetSpan.end({
          status: clientCss ? 'ok' : 'skipped',
          asset: 'client.css',
        })
        if (clientCss) {
          plugin.clientCss = `/api/plugins/${entry.id}/assets/client.css`
        }
      }
      plugins.push(plugin)
    }

    const body: ManifestResponse = { plugins }
    span.end({ status: 'ok', count: plugins.length, check: wantCheck })
    return Response.json(body)
  } catch (err) {
    span.end({ status: 'error', error: err instanceof Error ? err.message : String(err), check: wantCheck })
    throw err
  }
}
