/**
 * Available row per installed agent package (#1007, D7.12): every lockfile
 * entry that is NOT a hub skill (those have `upstream` provenance and their
 * own source). A github source is compared by `git ls-remote` against the
 * installed commit; the manifest is fetched (a staged clone, removed after)
 * only when the ref moved, to name the version on offer. A local source is
 * compared by its directory's manifest version. The package/frontmatter
 * version alone is never an identity — the commit (or the directory) is.
 * A moved ref whose fetched package folder hashes to the installed folder is
 * current: in a monorepo every commit moves the ref, and only the package's
 * own bytes say whether there is something newer.
 *
 * Applying is the existing sync path (`bakin agents sync` / `bakin packages
 * sync`), so the action is a manual pointer until that path is an operation.
 */
import type { PackageEntry } from '@bakin/core/agent-packages/lockfile'
import type { UpdateAction, UpdateIdentity, UpdateSourceRef } from '@makinbakin/sdk/types'
import { fingerprintOf } from '../inventory'
import type { UpdateObservation, UpdateSource, UpdateSubjectInventoryEntry } from '../types'

export interface InstalledPackage {
  /** The lockfile key (`<id>@<version>`). */
  key: string
  /** The package id (the key without its version). */
  id: string
  entry: PackageEntry
  /**
   * The installed manifest's hub provenance, when the pack was synthesized
   * from a hub bundle. A hub skill whose manifest is unreadable keeps its
   * ownership (`{ source }` from the lock entry, no `ref`) — never silently
   * a package (review r6 #2).
   */
  upstream: { source: string; ref?: string; resolvedSha?: string } | null
  /** The installed manifest exists but could not be read/parsed: the install is broken evidence, not a plain package. */
  manifestError?: string
  /**
   * The installed manifest's own id — what the upstream manifest must still
   * name. `installAs` makes the lock id an ALIAS of it (review r7 #1), so the
   * subject/action keep the alias while identity compares here.
   */
  manifestId?: string
}

export interface PackageSourceDeps {
  /** Every installed package with its installed manifest's provenance. */
  installed: () => InstalledPackage[]
  hostVersion: () => string
  /** `github:…` source (with or without a ref) → clone URL. */
  cloneUrl: (source: string) => string
  /** `git ls-remote <url> <ref>` — the sha the ref points at, or null when the ref is gone. */
  lsRemote: (url: string, ref: string, signal: AbortSignal) => Promise<string | null>
  /** The remote's default branch (`git ls-remote --symref <url> HEAD`), or null when it has none — for an entry installed without `@ref`. */
  defaultBranch: (url: string, signal: AbortSignal) => Promise<string | null>
  /**
   * The manifest at a github source+ref (a staged clone, removed after).
   * Called only when the ref moved; `fresh` bypasses the short-lived
   * checkout cache (a checkout older than the observed commit is no answer).
   */
  fetchManifest: (sourceWithRef: string, signal: AbortSignal, opts?: { fresh?: boolean }) => Promise<{ id: string; version: string; commitSha: string; treeSha?: string }>
  /**
   * The digest of the installed package folder (`computeDirSha`), or null when
   * it cannot be read. A monorepo source moves its ref on EVERY commit, so a
   * moved ref whose fetched folder hashes to this is no update at all.
   */
  installedTreeSha: (pkg: InstalledPackage) => string | null
  /** The manifest of a local-path source, or null when the directory is gone. */
  localManifest: (path: string) => { id: string; version: string } | null
}

/** The lockfile key's id: everything before the LAST `@` (ids may carry an owner prefix). */
export { packageIdOfLockKey as packageIdOfKey } from '@bakin/core/agent-packages/lockfile'

export function isGithubPackageSource(source: string): boolean {
  return source.startsWith('github:')
}

export function isClawhubPackageSource(source: string): boolean {
  return source.startsWith('clawhub:')
}

/** `github:owner/repo[@ref][#subpath]` with the lock's ref folded in when the source carries none. */
export function packageSourceWithRef(source: string, ref: string): string {
  if (!isGithubPackageSource(source) || !ref) return source
  const hash = source.indexOf('#')
  const head = hash === -1 ? source : source.slice(0, hash)
  const tail = hash === -1 ? '' : source.slice(hash)
  return head.includes('@') ? source : `${head}@${ref}${tail}`
}

/** The installed identity a package record names (the observer and `observeInstalledPackage` derive it HERE, never twice). */
export function packageInstalledIdentity(entry: Pick<PackageEntry, 'version' | 'commitSha'>): UpdateIdentity {
  return { version: entry.version, sha: entry.commitSha || undefined, display: entry.version }
}

/** The command that applies an update: agents by agent id, packs by the EXACT lockfile key the route looks up (review r2 #2). */
function syncPointer(entry: PackageEntry, id: string, key: string): string {
  return entry.kind === 'agent' ? `bakin agents sync ${entry.agentId ?? id}` : `bakin packages sync ${key}`
}

/** `github:owner/repo@<sha>` — an immutable pin: nothing newer can ever appear under it (review r2 #6). Decided only once the remote names NO ref of that name (r3 #3). */
export function isCommitPin(ref: string): boolean {
  return /^[0-9a-f]{7,40}$/i.test(ref)
}

/** The verdict for a ref the remote does not name: current while the installed commit is the pin, blocked otherwise, gone when it is no pin at all. */
export function commitPinOutcome(entry: Pick<PackageEntry, 'commitSha'>, ref: string, installed: UpdateIdentity, source: UpdateSourceRef): UpdateObservation {
  if (!isCommitPin(ref)) return { installed, source, outcome: 'blocked', blockedReason: `no remote ref: ${ref}` }
  return entry.commitSha.toLowerCase().startsWith(ref.toLowerCase())
    ? { installed, source, outcome: 'current' }
    : { installed, source, outcome: 'blocked', blockedReason: `the installed commit ${entry.commitSha.slice(0, 7)} is not the pinned ${ref.slice(0, 7)} — reinstall` }
}

export function createPackageSource(deps: PackageSourceDeps): UpdateSource {
  const subjects = (): InstalledPackage[] => deps.installed().filter((pkg) => pkg.upstream === null)
  const entryFor = (pkg: InstalledPackage): UpdateSubjectInventoryEntry => ({
    subject: { kind: 'package', id: pkg.id, label: pkg.id },
    group: 'available',
    fingerprint: fingerprintOf({
      entry: { kind: pkg.entry.kind, version: pkg.entry.version, source: pkg.entry.source, ref: pkg.entry.ref, commitSha: pkg.entry.commitSha, installedAt: pkg.entry.installedAt },
      host: deps.hostVersion(),
    }),
    source: isGithubPackageSource(pkg.entry.source)
      ? { kind: 'git-ref', endpoint: pkg.entry.source, ref: pkg.entry.ref || undefined }
      : { kind: 'local-path', endpoint: pkg.entry.source },
  })

  return {
    kind: 'package',
    async inventory() {
      return subjects().map(entryFor)
    },
    async observe(inventoryEntry, { signal }): Promise<UpdateObservation> {
      const id = inventoryEntry.subject.id
      const pkg = subjects().find((candidate) => candidate.id === id)
      if (!pkg) throw new Error(`package "${id}" is no longer installed`)
      const { entry } = pkg
      const installed = packageInstalledIdentity(entry)
      const action: UpdateAction = { kind: 'manual', pointer: syncPointer(entry, id, pkg.key) }
      // Unreadable installed evidence is reported, never probed around (r6 #2).
      if (pkg.manifestError) return { installed, outcome: 'blocked', blockedReason: `the installed manifest is unreadable (${pkg.manifestError}) — reinstall`, action }

      if (isGithubPackageSource(entry.source)) {
        const url = deps.cloneUrl(entry.source)
        // An install without `@ref` records an empty ref and tracks the remote's default branch.
        const ref = entry.ref || await deps.defaultBranch(url, signal)
        if (!ref) return { installed, outcome: 'blocked', blockedReason: 'the remote has no default branch — reinstall with an explicit @ref' }
        const source = { kind: 'git-ref', endpoint: entry.source, ref }
        const remote = await deps.lsRemote(url, ref, signal)
        // The remote names no branch or tag by that name: a hex ref is a commit
        // pin (immutable — the installed commit IS the pin), anything else is
        // gone. A branch that merely LOOKS like a sha is still a branch (r3 #3).
        if (!remote) return commitPinOutcome(entry, ref, installed, source)
        if (remote === entry.commitSha) return { installed, source, outcome: 'current' }
        // The ref moved: read the manifest there to name the version on offer.
        // The fetch rides a short-lived checkout cache — a checkout older than
        // the commit just observed is refetched fresh, and what the fresh
        // checkout holds (not the cached bytes) is the offer. The spec is the
        // one the updater fetches with (the source as installed; the lock ref
        // folded in only when it recorded one), so a fresh clone here is the
        // checkout a sync right after reuses — never two cache keys for one
        // package (review r2 #5).
        const spec = entry.ref ? packageSourceWithRef(entry.source, entry.ref) : entry.source
        let manifest = await deps.fetchManifest(spec, signal)
        if (manifest.commitSha && manifest.commitSha !== remote) manifest = await deps.fetchManifest(spec, signal, { fresh: true })
        if (manifest.id !== (pkg.manifestId ?? id)) throw new Error(`source manifest id "${manifest.id}" does not match installed package "${pkg.manifestId ?? id}"`)
        if (manifest.commitSha && manifest.commitSha === entry.commitSha) return { installed, source, outcome: 'current' }
        // The ref moved but the package's own bytes did not (a commit elsewhere in the repo): current.
        if (manifest.treeSha && manifest.treeSha === deps.installedTreeSha(pkg)) return { installed, source, outcome: 'current' }
        const sha = manifest.commitSha || remote
        return {
          installed,
          source,
          available: { version: manifest.version, sha, display: manifest.version === entry.version ? `${manifest.version} (${sha.slice(0, 7)})` : manifest.version },
          reason: manifest.version === entry.version ? 'newer-commit' : 'newer-version',
          outcome: 'update-available',
          action,
        }
      }

      const source = { kind: 'local-path', endpoint: entry.source }
      const local = deps.localManifest(entry.source)
      if (!local) return { installed, source, outcome: 'blocked', blockedReason: `source path missing: ${entry.source}` }
      if (local.id !== (pkg.manifestId ?? id)) throw new Error(`source manifest id "${local.id}" does not match installed package "${pkg.manifestId ?? id}"`)
      if (local.version === entry.version) return { installed, source, outcome: 'current' }
      return { installed, source, available: { version: local.version, display: local.version }, reason: 'newer-version', outcome: 'update-available', action }
    },
  }
}
