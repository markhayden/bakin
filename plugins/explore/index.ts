/**
 * Explore plugin — server entry point.
 * Curated-catalog discovery: browse and install official agents, plugins,
 * and packs. Discovery only — lifecycle management stays in Team/Health.
 */
import type { BakinPlugin } from '@bakin/core/plugin-types'
import { definePlugin, defineRoute } from '@bakin/core/routing'
import { createLogger } from '../../src/core/logger'
import { runChecks } from '../../src/core/plugins/upgrade-check'
import { checkPackageUpdateAsync } from '../../src/core/agent-packages/checker'
import { mergedCatalog } from './lib/catalog'
import { gatherInstallSources, joinInstallState } from './lib/install-state'
import { refreshRemoteCatalog } from './lib/refresh'
import type { ExploreCatalogEntry, ExploreCatalogResponse } from './types'

const log = createLogger('explore')

interface ProbeOutcome {
  /** agentId → definitive update state. Failed probes are NOT included — unknown stays unknown. */
  agentUpdates: Map<string, boolean>
  /** Probes that could not reach/interpret their source (offline, bad remote, …). */
  probeErrors: number
}

/**
 * Probe update state for installed user plugins (persists lockfile markers)
 * and managed agents (probe-only — results are returned, never persisted
 * upstream). Failed probes are counted and left UNKNOWN — a probe that
 * couldn't reach the source must never report "up to date". All fetches run
 * async and in parallel so a slow remote can't stall the event loop or
 * serialize the sweep.
 */
async function runUpdateProbes(sources: ReturnType<typeof gatherInstallSources>): Promise<ProbeOutcome> {
  const outcome: ProbeOutcome = { agentUpdates: new Map(), probeErrors: 0 }

  const userPluginIds = Object.keys(sources.pluginLock.plugins)
  const pluginSweep = userPluginIds.length === 0
    ? Promise.resolve()
    : runChecks(userPluginIds)
        .then((results) => {
          for (const result of results) {
            if (result.error) {
              outcome.probeErrors += 1
              log.warn('plugin update probe failed', { pluginId: result.id, error: result.error })
            }
          }
        })
        .catch((err) => {
          outcome.probeErrors += userPluginIds.length
          log.warn('plugin update sweep failed', { error: err instanceof Error ? err.message : String(err) })
        })

  const agentEntries = Object.entries(sources.packageLock.packages)
    .filter(([, entry]) => entry.kind === 'agent' && entry.agentId)
  const agentSweep = Promise.all(agentEntries.map(async ([key, entry]) => {
    try {
      const status = await checkPackageUpdateAsync(key)
      if (status.error) {
        outcome.probeErrors += 1
        log.warn('agent update probe failed', { packageId: key, error: status.error })
        return
      }
      outcome.agentUpdates.set(entry.agentId!, status.upgradeAvailable)
    } catch (err) {
      outcome.probeErrors += 1
      log.warn('agent update probe failed', { packageId: key, error: err instanceof Error ? err.message : String(err) })
    }
  }))

  await Promise.all([pluginSweep, agentSweep])
  return outcome
}

async function buildCatalogResponse(check: boolean): Promise<ExploreCatalogResponse> {
  const catalog = await mergedCatalog()
  let sources = gatherInstallSources()
  let probes: ProbeOutcome | null = null

  if (check) {
    probes = await runUpdateProbes(sources)
    // Re-read: runChecks persisted fresh plugin markers into the lockfile.
    sources = gatherInstallSources()
  }

  const entries: ExploreCatalogEntry[] = joinInstallState(catalog.entries, sources).map((entry) =>
    entry.kind === 'agent' && probes?.agentUpdates.has(entry.id)
      ? { ...entry, updateAvailable: probes.agentUpdates.get(entry.id)! }
      : entry,
  )

  return {
    ok: true,
    updatedAt: catalog.updatedAt,
    remoteUpdatedAt: catalog.remoteUpdatedAt,
    entries,
    ...(probes ? { probeErrors: probes.probeErrors } : {}),
  }
}

const routes = [
  defineRoute({
    path: '/catalog',
    method: 'GET',
    summary: 'Merged curated catalog with install state',
    description:
      'Embedded catalog merged with the cached remote catalog, joined against local lockfiles. ' +
      'Offline by default; ?check=1 runs explicit update probes (plugin markers persist, agent results are per-response).',
    handler: async (req) => {
      const check = new URL(req.url).searchParams.get('check') === '1'
      try {
        return Response.json(await buildCatalogResponse(check))
      } catch (err) {
        log.error('catalog route failed', err instanceof Error ? err : new Error(String(err)))
        return Response.json(
          { ok: false, error: err instanceof Error ? err.message : String(err) },
          { status: 500 },
        )
      }
    },
  }),

  defineRoute({
    path: '/catalog/refresh',
    method: 'POST',
    summary: 'Fetch and cache the remote curated catalog',
    description:
      'Explicit user action: fetches catalog.json from the official bits repo, validates it, caches it, ' +
      'and returns the merged catalog. Failures leave the existing cache untouched.',
    handler: async () => {
      try {
        const result = await refreshRemoteCatalog()
        if (!result.ok) {
          return Response.json(
            { ok: false, reason: result.reason, error: result.error },
            { status: result.reason === 'no-remote-catalog' ? 404 : 502 },
          )
        }
        return Response.json(await buildCatalogResponse(false))
      } catch (err) {
        log.error('catalog refresh failed', err instanceof Error ? err : new Error(String(err)))
        return Response.json(
          { ok: false, error: err instanceof Error ? err.message : String(err) },
          { status: 500 },
        )
      }
    },
  }),
]

const explorePlugin: BakinPlugin = definePlugin({
  id: 'explore',
  name: 'Explore',
  version: '1.0.0',
  routes,

  async activate() {
    log.info('Explore plugin activated')
  },
}) as unknown as BakinPlugin

export default explorePlugin
