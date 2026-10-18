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
import { isCorePlugin, pluginRegistry } from '@/core/plugin-registry'
import { createLogger } from '@/core/logger'
import { computeUpgradeAvailable, readPluginLockfile, type PluginLockEntry } from '@bakin/core/plugins/lockfile'
import { runChecks } from '@/core/plugins/upgrade'
import { pluginAssetVersion } from './asset-version'
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
  /** Cache key for `clientCss` (same scheme as `clientVersion`); the host appends it as `?v=`. */
  cssVersion?: string
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
      const upgradeAvailable = installed && !isCore ? computeUpgradeAvailable(installed) : false

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
        const cssVersion = await pluginAssetVersion(entry.id, 'client.css')
        cssAssetSpan.end({
          status: cssVersion ? 'ok' : 'skipped',
          asset: 'client.css',
        })
        if (cssVersion) {
          plugin.clientCss = `/api/plugins/${entry.id}/assets/client.css`
          plugin.cssVersion = cssVersion
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
