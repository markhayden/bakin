/**
 * Available row per installed hub skill (#1007, D7.12): the lockfile
 * skill-pack entries whose installed manifest carries `upstream` provenance.
 *
 * Tracking policy comes from the lock entry's ORIGINAL `source` string; the
 * installed identity from `upstream.ref` (every ClawHub install records the
 * RESOLVED version there — it is never read as a pin):
 * - `clawhub:<slug>` tracks latest: the hub's latest published version is
 *   compared with the installed resolved version;
 * - `clawhub:<slug>@<v>` is pinned: `current`, unless the pinned version is
 *   gone from the hub (`blocked`);
 * - `github:…#<ref>` compares the ref's `ls-remote` sha with the installed commit;
 * - a local directory has no upstream to ask: `unsupported`.
 * The package/frontmatter version is NEVER compared (synthesis prefers the
 * frontmatter version, which says nothing about the hub).
 *
 * Re-install IS the update path (`bakin skills install <source>`), so the
 * action is a manual pointer — and a re-install keeps the tracking policy:
 * the installer persists `trackingSource` as the lock `source` while the
 * fetch ref targets the selected version (R8′).
 */
import type { UpdateAction } from '@makinbakin/sdk/types'
import { parseClawhubRef } from '../../agent-packages/ref-normalize'
import { fingerprintOf } from '../inventory'
import type { UpdateObservation, UpdateSource, UpdateSubjectInventoryEntry } from '../types'
import { isClawhubPackageSource, isGithubPackageSource, packageSourceWithRef, type InstalledPackage, type PackageSourceDeps, isCommitPin } from './package'

export interface HubSkillSourceDeps extends Pick<PackageSourceDeps, 'installed' | 'hostVersion' | 'cloneUrl' | 'lsRemote' | 'defaultBranch'> {
  hub: {
    /** The hub's latest published version of a skill, or null when the hub lists none. */
    latest: (slug: string, owner: string | undefined, signal: AbortSignal) => Promise<string | null>
    /** Whether the hub still publishes this exact version. */
    hasVersion: (slug: string, version: string, owner: string | undefined, signal: AbortSignal) => Promise<boolean>
  }
}

export function createHubSkillSource(deps: HubSkillSourceDeps): UpdateSource {
  const subjects = (): InstalledPackage[] => deps.installed().filter((pkg) => pkg.entry.kind === 'skill-pack' && pkg.upstream !== null)
  const entryFor = (pkg: InstalledPackage): UpdateSubjectInventoryEntry => ({
    subject: { kind: 'hub-skill', id: pkg.id, label: pkg.id },
    group: 'available',
    fingerprint: fingerprintOf({
      entry: { version: pkg.entry.version, source: pkg.entry.source, ref: pkg.entry.ref, commitSha: pkg.entry.commitSha, installedAt: pkg.entry.installedAt },
      upstream: pkg.upstream,
      host: deps.hostVersion(),
    }),
    source: isClawhubPackageSource(pkg.entry.source)
      ? { kind: 'clawhub', endpoint: pkg.entry.source }
      : isGithubPackageSource(pkg.entry.source)
        ? { kind: 'git-ref', endpoint: pkg.entry.source, ref: pkg.entry.ref || undefined }
        : { kind: 'local-path', endpoint: pkg.entry.source },
  })

  return {
    kind: 'hub-skill',
    async inventory() {
      return subjects().map(entryFor)
    },
    async observe(inventoryEntry, { signal }): Promise<UpdateObservation> {
      const id = inventoryEntry.subject.id
      const pkg = subjects().find((candidate) => candidate.id === id)
      if (!pkg) throw new Error(`hub skill "${id}" is no longer installed`)
      const { entry, upstream } = pkg
      const resolved = upstream?.ref ?? ''
      const installed = { version: resolved || undefined, sha: entry.commitSha || upstream?.resolvedSha || undefined, display: resolved || entry.version }
      const action = (target: string): UpdateAction => ({ kind: 'manual', pointer: `bakin skills install ${target}` })

      if (isClawhubPackageSource(entry.source)) {
        const ref = parseClawhubRef(entry.source)
        const source = { kind: 'clawhub', endpoint: entry.source }
        if (ref.version) {
          // Pinned: the operator chose this version; the only news is its disappearance.
          const still = await deps.hub.hasVersion(ref.slug, ref.version, ref.owner, signal)
          return still
            ? { installed, source, outcome: 'current' }
            : { installed, source, outcome: 'blocked', blockedReason: `the pinned version ${ref.version} is no longer published on the hub`, action: action(entry.source) }
        }
        const latest = await deps.hub.latest(ref.slug, ref.owner, signal)
        if (!latest) return { installed, source, outcome: 'blocked', blockedReason: 'the hub lists no published version' }
        if (!resolved) return { installed, source, outcome: 'blocked', blockedReason: 'the installed manifest records no resolved hub version — reinstall' }
        if (latest === resolved) return { installed, source, outcome: 'current' }
        return { installed, source, available: { version: latest, display: latest }, reason: 'newer-version', outcome: 'update-available', action: action(entry.source) }
      }

      if (isGithubPackageSource(entry.source)) {
        const url = deps.cloneUrl(entry.source)
        // A commit pin is immutable: the installed commit IS the pin.
        if (entry.ref && isCommitPin(entry.ref)) {
          const source = { kind: 'git-ref', endpoint: entry.source, ref: entry.ref }
          return entry.commitSha.toLowerCase().startsWith(entry.ref.toLowerCase())
            ? { installed, source, outcome: 'current' }
            : { installed, source, outcome: 'blocked', blockedReason: `the installed commit ${entry.commitSha.slice(0, 7)} is not the pinned ${entry.ref.slice(0, 7)} — reinstall`, action: action(entry.source) }
        }
        // An install without `@ref` records an empty ref and tracks the remote's default branch.
        const ref = entry.ref || await deps.defaultBranch(url, signal)
        if (!ref) return { installed, outcome: 'blocked', blockedReason: 'the remote has no default branch — reinstall with an explicit @ref' }
        const source = { kind: 'git-ref', endpoint: entry.source, ref }
        const remote = await deps.lsRemote(url, ref, signal)
        if (!remote) return { installed, source, outcome: 'blocked', blockedReason: `no remote ref: ${ref}` }
        if (remote === entry.commitSha) return { installed, source, outcome: 'current' }
        // The re-install pointer keeps the source as it was installed: an explicit ref stays pinned, a default-branch install stays unpinned.
        return { installed, source, available: { sha: remote, display: remote.slice(0, 7) }, reason: 'newer-commit', outcome: 'update-available', action: action(entry.ref ? packageSourceWithRef(entry.source, entry.ref) : entry.source) }
      }

      return { installed, source: { kind: 'local-path', endpoint: entry.source }, outcome: 'unsupported', blockedReason: 'a local directory has no upstream to check — re-install from it to update', action: action(entry.source) }
    },
  }
}
