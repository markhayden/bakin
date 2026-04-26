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
import { existsSync } from 'fs'
import { join } from 'path'
import { isCorePlugin, pluginRegistry } from '@/lib/plugin-registry'
import { getContentDir } from '@/core/content-dir'
import { createLogger } from '@/core/logger'
import { readPluginLockfile, type PluginLockEntry } from '@bakin/core/plugins/lockfile'
import { checkUpgradeAvailable } from '@/core/plugins/upgrade'
import { EMBEDDED_ASSETS } from '../_embedded-assets'

const log = createLogger('plugin-manifest')

const STALE_HINT_DAYS = 7

interface ManifestPlugin {
  id: string
  name: string
  version: string
  clientEntry: string
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
}

interface ManifestResponse {
  plugins: ManifestPlugin[]
}

function daysSince(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime()
  return Math.floor(ms / (1000 * 60 * 60 * 24))
}

/**
 * Check each asset-resolution layer. In a compiled binary the embedded
 * map wins for every core plugin, so probe it first to avoid a syscall
 * for each plugin on every manifest fetch.
 */
function hasClientCss(pluginId: string): boolean {
  const relPath = 'client.css'
  if (EMBEDDED_ASSETS.has(`/api/plugins/${pluginId}/assets/${relPath}`)) return true
  if (existsSync(join(getContentDir(), 'plugins', pluginId, 'dist', relPath))) return true
  if (existsSync(join(process.cwd(), 'plugins', pluginId, 'dist', relPath))) return true
  return false
}

export async function get(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const wantCheck = url.searchParams.get('check') === '1'

  // If --check requested, run the per-plugin remote/local probe in parallel
  // for every user plugin BEFORE we read the lockfile for rendering. The
  // checks themselves persist `lastChecked` + the appropriate sha back into
  // the lockfile; reading after gives the caller the freshest values.
  if (wantCheck) {
    const userIds = pluginRegistry
      .getRegistrySnapshot()
      .map(e => e.id)
      .filter(id => !isCorePlugin(id))
    await Promise.all(
      userIds.map(async id => {
        const result = await checkUpgradeAvailable(id)
        if (result.error) {
          log.warn('plugin --check probe failed', { id, error: result.error })
        }
      }),
    )
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
      clientEntry: `/api/plugins/${entry.id}/assets/client.js`,
      source,
      installed,
      upgradeAvailable,
      staleHintDays,
    }
    if (hasClientCss(entry.id)) {
      plugin.clientCss = `/api/plugins/${entry.id}/assets/client.css`
    }
    plugins.push(plugin)
  }

  const body: ManifestResponse = { plugins }
  return Response.json(body)
}
