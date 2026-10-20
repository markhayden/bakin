/**
 * Available row per installed plugin (#1007, D7.6): the three probes the
 * retired `upgrade-check.ts` ran synchronously, as async observers — the artifact
 * index with a persisted validator, `git ls-remote` through `gitArgs` under
 * the observe signal, and the local source-tree comparison. The record id is
 * `plugin:<id>`; the fingerprint carries the lock entry AND the host facts
 * artifact eligibility depends on (version, platform, externals contract).
 */
import { existsSync } from 'node:fs'
import type { PluginLockEntry } from '@bakin/core/plugins/lockfile'
import { INDEX_FILENAME, parseArtifactsIndex, type ArtifactsIndex } from '../../whiskit/artifacts-index'
import { artifactUpgradeTarget, newestCompatibleVersion } from '../../whiskit/compatible-version'
import { fingerprintOf } from '../inventory'
import { conditionalFetchJson, type FetchLike } from '../net'
import type { UpdateAction } from '@makinbakin/sdk/types'
import type { UpdateObservation, UpdateSource, UpdateSubjectInventoryEntry } from '../types'
import { applyRoute } from './search-engine'

export interface PluginHostFacts {
  version: string
  platform: string
  contract: string
}

export interface PluginSourceDeps {
  /** Installed user plugins by id (core plugins are never subjects). */
  lockEntries: () => Record<string, PluginLockEntry>
  host: () => PluginHostFacts
  /** Whether `<plugins>/<id>` is an artifact install and whether that artifact runs on this host. */
  artifact: (id: string) => { installed: boolean; runs: boolean }
  /** `github:owner/repo#path` → the release base URL + the plugin id the index keys on. */
  artifactSource: (source: string) => { baseUrl: string; pluginId: string }
  /** The clone URL of a github source. */
  cloneUrl: (source: string) => string
  /** `git ls-remote <url> <ref>` — the sha the ref points at, or null when the ref is gone. */
  lsRemote: (url: string, ref: string, signal: AbortSignal) => Promise<string | null>
  /** The live source-tree sha of a local install vs the recorded one (the installed tree under `<plugins>/<id>` is the baseline for legacy rows). */
  localTree: (id: string, entry: PluginLockEntry) => { changed: boolean; liveSha: string }
  fetch?: FetchLike
}

export function createPluginSource(deps: PluginSourceDeps): UpdateSource {
  const entryFor = (id: string, entry: PluginLockEntry): UpdateSubjectInventoryEntry => ({
    subject: { kind: 'plugin', id, label: id },
    group: 'available',
    fingerprint: fingerprintOf({
      entry: { type: entry.type, source: entry.source, ref: entry.ref, commitSha: entry.commitSha, version: entry.version, manifestSha: entry.manifestSha, sourceTreeSha: entry.sourceTreeSha ?? null, sourceTreeShaAlgo: entry.sourceTreeShaAlgo ?? null },
      host: deps.host(),
    }),
    source: entry.type === 'github'
      ? { kind: deps.artifact(id).installed ? 'artifact-index' : 'git-ref', endpoint: entry.source, ref: entry.ref || undefined }
      : { kind: 'local-path', endpoint: entry.source },
  })

  return {
    kind: 'plugin',
    async inventory() {
      return Object.entries(deps.lockEntries()).map(([id, entry]) => entryFor(id, entry))
    },
    async observe(inventoryEntry, { signal, conditional }): Promise<UpdateObservation> {
      const id = inventoryEntry.subject.id
      const entry = deps.lockEntries()[id]
      if (!entry) throw new Error(`plugin "${id}" is no longer in the lockfile`)
      const installed = { version: entry.version, sha: entry.commitSha || undefined, display: entry.version }
      const upgrade: UpdateAction = { kind: 'operation', start: { route: applyRoute(`plugin:${id}`) }, impact: ['download'] }

      if (entry.type === 'github') {
        if (deps.artifact(id).installed) {
          const gh = deps.artifactSource(entry.source)
          const url = `${gh.baseUrl}/${INDEX_FILENAME}`
          const index = parseArtifactsIndex((await conditionalFetchJson<unknown>(url, { conditional, signal, fetch: deps.fetch })).body) as ArtifactsIndex
          const host = deps.host()
          const latest = index.plugins[gh.pluginId]?.latest ?? null
          const source = { kind: 'artifact-index', endpoint: url }
          if (!latest) return { installed, source, outcome: 'blocked', blockedReason: `no published artifact for ${gh.pluginId}` }
          const newest = newestCompatibleVersion(index, gh.pluginId, { platform: host.platform, hostContract: host.contract, hostVersion: host.version })
          if (!newest) {
            return { installed, source, outcome: 'blocked', blockedReason: `no published release of ${gh.pluginId} runs on this Bakin yet (newest is ${latest})` }
          }
          const target = artifactUpgradeTarget(entry.version, deps.artifact(id).runs, newest.version)
          if (!target) return { installed, source, outcome: 'current' }
          // The digest is part of the identity: a second rebuild published under
          // the same version is a NEW offer (and a skip of the first one lapses).
          return {
            installed,
            source,
            available: { version: target, digest: newest.entry.sha256, display: target === entry.version ? `${target} (rebuilt for this Bakin)` : target },
            reason: target === entry.version ? 'compatible-rebuild' : 'newer-version',
            outcome: 'update-available',
            action: upgrade,
          }
        }
        if (!entry.source || !entry.ref) return { installed, outcome: 'blocked', blockedReason: 'lockfile missing source/ref' }
        const url = deps.cloneUrl(entry.source)
        const remote = await deps.lsRemote(url, entry.ref, signal)
        const source = { kind: 'git-ref', endpoint: entry.source, ref: entry.ref }
        if (!remote) return { installed, source, outcome: 'blocked', blockedReason: `no remote ref: ${entry.ref}` }
        if (remote === entry.commitSha) return { installed, source, outcome: 'current' }
        return { installed, source, available: { sha: remote, display: remote.slice(0, 7) }, reason: 'newer-commit', outcome: 'update-available', action: upgrade }
      }

      if (!existsSync(entry.source)) return { installed, outcome: 'blocked', blockedReason: `source path missing: ${entry.source}` }
      const tree = deps.localTree(id, entry)
      const source = { kind: 'local-path', endpoint: entry.source }
      if (!tree.changed) return { installed, source, outcome: 'current' }
      return { installed, source, available: { digest: tree.liveSha, display: 'local changes' }, reason: 'newer-commit', outcome: 'update-available', action: upgrade }
    },
  }
}
