/**
 * The core update sources, registered once before `startUpdates` (#1007).
 * Everything here reads through the factories — the active runtime and
 * the configured search adapter's setup — never an adapter module.
 */
import { join } from 'node:path'
import { APP_VERSION } from '@bakin/core/constants'
import { gitArgs } from '@bakin/core/net/git-args'
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

/**
 * `git ls-remote` as an async child under the observe signal — never the
 * synchronous upgrade-gate wrapper (C15). Foreground-only git config via
 * `gitArgs`; an abort kills the child and the promise settles on exit.
 */
export async function lsRemoteSha(url: string, ref: string, signal: AbortSignal): Promise<string | null> {
  const proc = Bun.spawn(['git', ...gitArgs(['ls-remote', '--', url, ref])], { cwd: getContentDir(), stdout: 'pipe', stderr: 'pipe', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
  const onAbort = (): void => { try { proc.kill() } catch { /* already gone */ } }
  if (signal.aborted) onAbort()
  else signal.addEventListener('abort', onAbort, { once: true })
  try {
    const [code, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()])
    if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('ls-remote aborted')
    if (code !== 0) throw new Error(`git ls-remote ${url} ${ref} failed (exit ${code}): ${stderr.trim().slice(-300)}`)
    const sha = (stdout.split(/\s+/)[0] ?? '').trim().toLowerCase()
    return sha ? sha : null
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

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
    localTree: (entry) => { const cmp = compareStoredSourceTreeSha(entry, entry.source); return { changed: cmp.changed, liveSha: cmp.liveSha } },
  }))
}
