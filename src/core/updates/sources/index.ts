/**
 * The core update sources, registered once before `startUpdates` (#1007).
 * Everything here reads through the factories — the active runtime and
 * the configured search adapter's setup — never an adapter module.
 */
import { join } from 'node:path'
import { APP_VERSION } from '@bakin/core/constants'
import { readPluginLockfile, type PluginLockEntry } from '@bakin/core/plugins/lockfile'
import { getContentDir } from '../../content-dir'
import { createLogger } from '../../logger'
import { compareStoredSourceTreeSha } from '../../plugins/source-tree-sha'
import { installedArtifactRuns, isArtifactInstall } from '../../plugins/upgrade-artifact'
import { githubCloneUrl } from '../../plugins/upgrade-github'
import { getSearchAdapterRequiredModels, getSearchAdapterSetup } from '../../search-adapter-factory'
import { getSettings } from '../../settings'
import { EXTERNALS_CONTRACT } from '../../whiskit/externals'
import { hostPlatform } from '../../whiskit/compatible-version'
import { githubArtifactSource } from '../../whiskit/github-resolver'
import { registerUpdateSource } from '../service'
import { createBakinSource } from './bakin'
import { createGatewaySource, type GatewaySourceDeps } from './gateway'
import { createPluginSource } from './plugin'
import { createSearchEngineSource, type SearchSettingsFacts } from './search-engine'
import { createSearchModelsSource } from './search-models'
import { createPackageUpdateSources, lsRemoteSha } from './package-wiring'

export { lsRemoteSha, pickLsRemoteSha } from './package-wiring'

function userPluginLockEntries(): Record<string, PluginLockEntry> {
  return readPluginLockfile().plugins
}

const log = createLogger('updates-sources')

function searchSettingsFacts(): SearchSettingsFacts {
  const search = getSettings().search
  const models = getSearchAdapterRequiredModels(search.adapter, search.settings) as ReadonlyArray<{ model?: unknown }>
  return {
    adapter: search.adapter,
    url: String(search.settings.url ?? ''),
    enabled: search.settings.enabled !== false,
    requiredModelIds: models.map((m) => String(m.model ?? '')).filter(Boolean).sort(),
  }
}

export function registerCoreUpdateSources(deps: GatewaySourceDeps): void {
  const searchDeps = {
    setup: () => {
      const search = getSettings().search
      try {
        return getSearchAdapterSetup(search.adapter, log, search.settings)
      } catch (err) {
        log.warn('search adapter setup unavailable for update checks', { error: err instanceof Error ? err.message : String(err) })
        return null
      }
    },
    settings: searchSettingsFacts,
  }
  registerUpdateSource(createSearchEngineSource(searchDeps))
  registerUpdateSource(createSearchModelsSource(searchDeps))
  registerUpdateSource(createGatewaySource(deps))
  registerUpdateSource(createBakinSource({ currentVersion: () => APP_VERSION }))
  for (const source of createPackageUpdateSources()) registerUpdateSource(source)
  registerUpdateSource(createPluginSource({
    lockEntries: userPluginLockEntries,
    host: () => ({ version: APP_VERSION, platform: hostPlatform(), contract: EXTERNALS_CONTRACT }),
    artifact: (id) => {
      const dir = join(getContentDir(), 'plugins', id)
      const installed = isArtifactInstall(dir)
      return { installed, runs: installed ? installedArtifactRuns(dir) : false }
    },
    artifactSource: (source) => { const gh = githubArtifactSource(source); return { baseUrl: gh.baseUrl, pluginId: gh.pluginId } },
    cloneUrl: githubCloneUrl,
    lsRemote: lsRemoteSha,
    localTree: (id, entry) => { const cmp = compareStoredSourceTreeSha(entry, entry.source, join(getContentDir(), 'plugins', id)); return { changed: cmp.changed, liveSha: cmp.liveSha } },
  }))
}
