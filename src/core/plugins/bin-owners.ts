/**
 * Who owns a pinned binary in `~/.bakin/bin`? Capability packs (package
 * lockfile projections of kind `bin`) and plugins (plugin lockfile
 * `installedBins`) share the directory, so ownership is a contract across
 * BOTH ledgers (spec plugin-managed-binaries §2.4):
 *
 *   - identical pins share the file — every owner is recorded;
 *   - a different pin for the same target is a CONFLICT, refused before any
 *     mutation, naming both owners and the recovery sequence;
 *   - deletion needs zero remaining owners.
 *
 * Callers run these checks under the install lock (the outer operation
 * acquires it); see install-core/install-lock.
 */
import { basename, join } from 'path'
import { getBakinPaths } from '../content-dir'
import { readLockfile } from '../../../packages/core/src/agent-packages/lockfile'
import { readPluginLockfile } from '../../../packages/core/src/plugins/lockfile'
import type { BinRequirement } from '../../../packages/core/src/plugins/bin-requirement'

export type BinOwnerKind = 'package' | 'plugin'

export interface BinOwner {
  kind: BinOwnerKind
  id: string
  /** The sha this owner pins for the target (download/archive sha). */
  sha256: string
}

export interface BinOwnerIdentity {
  kind: BinOwnerKind
  id: string
}

export function binTargetPath(name: string): string {
  return join(getBakinPaths().bin, name)
}

/** Package lockfile keys are `<id>@<version>`; ownership is by bare id, so a pack upgrading itself never conflicts with its own older key. */
export function bareOwnerId(kind: BinOwnerKind, id: string): string {
  if (kind !== 'package') return id
  const at = id.lastIndexOf('@')
  return at > 0 ? id.slice(0, at) : id
}

/** Every owner currently pinning `target`, across both lockfiles. */
export function binTargetOwners(target: string): BinOwner[] {
  const owners: BinOwner[] = []
  for (const [id, entry] of Object.entries(readLockfile().packages)) {
    for (const projection of entry.projections ?? []) {
      if (projection.kind === 'bin' && projection.target === target && projection.sha256) {
        owners.push({ kind: 'package', id: bareOwnerId('package', id), sha256: projection.sha256.toLowerCase() })
      }
    }
  }
  const binDir = getBakinPaths().bin
  for (const [id, entry] of Object.entries(readPluginLockfile().plugins)) {
    for (const bin of entry.installedBins ?? []) {
      if (join(binDir, bin.name) === target) owners.push({ kind: 'plugin', id, sha256: bin.sha256.toLowerCase() })
    }
  }
  return owners
}

/** Owners of `target` other than `self`. */
export function otherBinOwners(target: string, self: BinOwnerIdentity): BinOwner[] {
  const selfId = bareOwnerId(self.kind, self.id)
  return binTargetOwners(target).filter((owner) => !(owner.kind === self.kind && owner.id === selfId))
}

export interface BinPinConflict {
  name: string
  target: string
  declaredSha256: string
  owner: BinOwner
}

export class BinPinConflictError extends Error {
  constructor(readonly conflicts: BinPinConflict[], readonly self: BinOwnerIdentity) {
    super(BinPinConflictError.describe(conflicts, self))
    this.name = 'BinPinConflictError'
  }

  static describe(conflicts: BinPinConflict[], self: BinOwnerIdentity): string {
    const lines = conflicts.map((c) =>
      `"${c.name}" is pinned at ${c.owner.sha256.slice(0, 12)}… by ${c.owner.kind} "${c.owner.id}"; `
      + `${self.kind} "${self.id}" declares ${c.declaredSha256.slice(0, 12)}…`)
    return `Binary pin conflict — ${lines.join('; ')}. Bakin never overwrites a binary another owner pins. `
      + `Recovery: remove the owner that is not changing, install/upgrade this one, then reinstall it `
      + `(or move both owners to the same pin).`
  }
}

/**
 * Conflicts `self` would create by installing `bins` for the running
 * platform: any OTHER owner pinning the same target at a different sha.
 * Identical pins are sharing, not conflicts. Bins with no download for this
 * platform are skipped here — platform preflight reports those separately.
 */
export function findBinPinConflicts(
  bins: readonly BinRequirement[],
  self: BinOwnerIdentity,
  platform: keyof BinRequirement['install'] | null,
): BinPinConflict[] {
  const conflicts: BinPinConflict[] = []
  for (const bin of bins) {
    const download = platform ? bin.install[platform] : undefined
    if (!download) continue
    const target = binTargetPath(bin.name)
    const declaredSha256 = download.sha256.toLowerCase()
    for (const owner of otherBinOwners(target, self)) {
      if (owner.sha256 !== declaredSha256) conflicts.push({ name: bin.name, target, declaredSha256, owner })
    }
  }
  return conflicts
}

export function assertNoBinPinConflict(
  bins: readonly BinRequirement[],
  self: BinOwnerIdentity,
  platform: keyof BinRequirement['install'] | null,
): void {
  const conflicts = findBinPinConflicts(bins, self, platform)
  if (conflicts.length > 0) throw new BinPinConflictError(conflicts, self)
}

/** Name of the binary a `~/.bakin/bin` target path refers to. */
export function binNameOf(target: string): string {
  return basename(target)
}
