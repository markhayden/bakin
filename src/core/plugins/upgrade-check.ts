/**
 * Upgrade-available detection (C5) — the read-only `--check` probe and its
 * batched lockfile write. Kept separate from the disk-mutating upgrade
 * lanes so the manifest API route only pulls the probe.
 */
import { existsSync } from 'fs'
import { join } from 'path'
import { getContentDir } from '@/core/content-dir'
import {
  type PluginLockEntry,
  readPluginLockfile,
  updatePlugin,
  writePluginLockfile,
} from '@bakin/core/plugins/lockfile'
import { SOURCE_TREE_SHA_ALGO, compareStoredSourceTreeSha } from './source-tree-sha'
import { isArtifactInstall, latestPublishedVersion } from './upgrade-artifact'
import { githubCloneUrl } from './upgrade-github'
import { run } from './upgrade-gate'

export interface UpgradeAvailability {
  id: string
  upgradeAvailable: boolean
  /** ISO timestamp recorded into the lockfile alongside the result. */
  lastChecked: string
  /** Github only — last seen remote HEAD sha. */
  remoteHeadSha?: string
  /** Artifact installs only — latest published artifact version. */
  remoteArtifactVersion?: string
  /** Local only — last seen source tree sha. */
  sourceTreeSha?: string
  /**
   * Local only — the stored sha was legacy (algo 1) and the source is
   * unchanged; `runChecks` rewrites the row once with the canonical sha +
   * `sourceTreeShaAlgo` so the consolidation never spuriously reports
   * "source changed" (see source-tree-sha.ts).
   */
  sourceTreeShaAlgoMigration?: boolean
  /** Set when the check itself failed (e.g. network error, missing source). */
  error?: string
}

/**
 * Read-only probe for one plugin — no lockfile write. Used by the batched
 * `runChecks` so a parallel sweep can collect every result and write the
 * lockfile ONCE at the end. Otherwise concurrent read-modify-write on a
 * single file races and silently drops half the updates.
 */
async function probeOne(entry: PluginLockEntry, id: string): Promise<UpgradeAvailability> {
  const lastChecked = new Date().toISOString()
  try {
    if (entry.type === 'github') {
      // Artifact installs (Whiskit) record `ref: ''` and have no git remote
      // to ls-remote — the published index's `latest` is the freshness
      // signal, polled over HTTPS (a release-asset fetch, not the
      // rate-limited GitHub API).
      const pluginDir = join(getContentDir(), 'plugins', id)
      if (isArtifactInstall(pluginDir)) {
        const { pluginId, latest } = await latestPublishedVersion(entry.source)
        if (!latest) {
          return { id, upgradeAvailable: false, lastChecked, error: `no published artifact for ${pluginId}` }
        }
        return {
          id,
          upgradeAvailable: latest !== entry.version,
          lastChecked,
          remoteArtifactVersion: latest,
        }
      }
      if (!entry.source || !entry.ref) {
        return { id, upgradeAvailable: false, lastChecked, error: 'lockfile missing source/ref' }
      }
      const remoteUrl = githubCloneUrl(entry.source)
      // `--` ends git option parsing — even though source + ref are
      // Zod-validated to safe shapes, this is a cheap second line of defense.
      const lsRemote = run('git', ['ls-remote', '--', remoteUrl, entry.ref], getContentDir())
      const remoteHeadSha = (lsRemote.split(/\s+/)[0] ?? '').trim().toLowerCase()
      if (!remoteHeadSha) {
        return { id, upgradeAvailable: false, lastChecked, error: `no remote ref: ${entry.ref}` }
      }
      return {
        id,
        upgradeAvailable: remoteHeadSha !== entry.commitSha,
        lastChecked,
        remoteHeadSha,
      }
    }

    if (!existsSync(entry.source)) {
      return { id, upgradeAvailable: false, lastChecked, error: `source path missing: ${entry.source}` }
    }
    // Legacy-aware compare: a stored algo-1 sha is verified with the
    // legacy hasher so hasher consolidation never reports a spurious
    // "upgrade available" for an untouched source.
    const cmp = compareStoredSourceTreeSha(entry, entry.source)
    return {
      id,
      upgradeAvailable: cmp.changed,
      lastChecked,
      sourceTreeSha: cmp.liveSha,
      ...(cmp.needsAlgoMigration ? { sourceTreeShaAlgoMigration: true } : {}),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { id, upgradeAvailable: false, lastChecked, error: message }
  }
}

/**
 * Run the `--check` probe for many plugins in parallel and write the
 * lockfile ONCE with all updates. The previous shape (each probe
 * read-modify-writes the lockfile) raced under Promise.all and silently
 * dropped about half the updates with 10 plugins.
 *
 * Errors per plugin are surfaced in the result's `error` field — a single
 * plugin's failure does NOT block other updates from landing.
 */
export async function runChecks(ids: readonly string[]): Promise<UpgradeAvailability[]> {
  const initial = readPluginLockfile()
  const results: UpgradeAvailability[] = await Promise.all(
    ids.map(async id => {
      const entry = initial.plugins[id]
      if (!entry) {
        return {
          id,
          upgradeAvailable: false,
          lastChecked: new Date().toISOString(),
          error: 'no lockfile entry',
        }
      }
      return probeOne(entry, id)
    }),
  )

  // Re-read to pick up any concurrent install/remove that happened
  // between the initial read and now (rare but possible). Apply every
  // probe's update to that fresh baseline, then write once.
  let lock = readPluginLockfile()
  for (const r of results) {
    if (r.error) continue
    if (!lock.plugins[r.id]) continue
    const patch: Partial<PluginLockEntry> = { lastChecked: r.lastChecked }
    if (r.remoteHeadSha) patch.remoteHeadSha = r.remoteHeadSha
    if (r.remoteArtifactVersion) patch.remoteArtifactVersion = r.remoteArtifactVersion
    if (r.sourceTreeSha) patch.lastSourceTreeSha = r.sourceTreeSha
    if (r.sourceTreeShaAlgoMigration && r.sourceTreeSha) {
      // One-time reset: the row held a legacy (algo 1) sha and the source
      // is unchanged — rewrite it under the canonical hasher so the next
      // probe (and the manifest route's lastSourceTreeSha comparison)
      // takes the canonical fast path.
      patch.sourceTreeSha = r.sourceTreeSha
      patch.sourceTreeShaAlgo = SOURCE_TREE_SHA_ALGO
    }
    lock = updatePlugin(lock, r.id, patch)
  }
  writePluginLockfile(lock)
  return results
}
