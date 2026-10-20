/**
 * The in-process entry to the updates observer (#1007 B 8.4): what
 * `bakin agents sync --check` / `bakin packages sync --check` ask instead
 * of probing a source themselves.
 *
 * In a server the engine IS the observer: the check is admitted through the
 * timer's ONE admission path (it joins a running pass, never fans out a
 * probe per caller), the engine records and broadcasts what it finds, and
 * THIS admission's attempt result is the answer (never a snapshot read that
 * a later attempt could have overwritten). Without an engine (an in-process CLI
 * run, a test) the same package/hub-skill sources observe the subject
 * directly and nothing is persisted — a check never writes beside a server
 * that may start meanwhile.
 */
import { updateRecordMatchesInstalled, type UpdateRecord } from '@makinbakin/sdk/types'
import { UpdateSubjectNotFoundError } from './engine'
import { getUpdatesEngine, getUpdatesTimer } from './service'
import { packageIdOfKey, packageInstalledIdentity, type InstalledPackage } from './sources/package'
import { hubSkillInstalledIdentity } from './sources/hub-skill'
import type { PackageEntry } from '@bakin/core/agent-packages/lockfile'
import { createPackageUpdateSources, installedPackages } from './sources/package-wiring'
import { UpdatesStoppedError, type CheckRun } from './timer'
import type { ConditionalStore, UpdateObservation } from './types'

/** The engine-free conditional store: nothing survives the call. */
function memoryConditional(): ConditionalStore {
  const entries = new Map<string, NonNullable<ReturnType<ConditionalStore['get']>>>()
  return {
    get: (key) => entries.get(key),
    set: (key, entry) => { entries.set(key, { ...entry, updatedAt: new Date().toISOString() }) },
  }
}

export class PackageNotTrackedError extends Error {
  constructor(readonly packageId: string) {
    super(`package "${packageId}" is not installed`)
    this.name = 'PackageNotTrackedError'
  }
}

/** A versioned key that is not the installed package's canonical key: the engine observes the newest install, never a superseded one under its name (review r2 #4). */
export class PackageSupersededError extends Error {
  constructor(readonly requestedKey: string, readonly canonicalKey: string) {
    super(`"${requestedKey}" is superseded by "${canonicalKey}" — the installed package is observed under its newest key`)
    this.name = 'PackageSupersededError'
  }
}

/**
 * Observe one installed package (a lockfile key or its id) and answer with
 * what its source says now. Throws when the observation failed — the caller
 * reports a failed check, never "up to date".
 */
export async function observeInstalledPackage(packageKeyOrId: string, opts: { signal?: AbortSignal } = {}): Promise<UpdateObservation> {
  const id = packageIdOfKey(packageKeyOrId)
  const pkg = installedPackages().find((candidate) => candidate.id === id)
  if (!pkg) throw new PackageNotTrackedError(id)
  // An exact key names ONE install: a superseded key is refused, never silently answered with the newer install's verdict.
  if (packageKeyOrId !== id && packageKeyOrId !== pkg.key) throw new PackageSupersededError(packageKeyOrId, pkg.key)
  const kind = pkg.upstream ? 'hub-skill' : 'package'
  const recordId = `${kind}:${id}`

  const observed = await observeThroughEngine(recordId) ?? await observeDirectly(kind, id, opts.signal)
  // The install the caller named must still be the one observed: another
  // install can supersede it while the check waited its turn — under a new
  // key OR the same key (a re-install of an agent keeps its key) — and the
  // observation is then the newer install's: refused, never substituted
  // (review r3 #5, r4 #3). The identity compared is the one the SOURCE
  // names for this kind (a hub skill's is the hub's resolved version).
  const now = installedPackages().find((candidate) => candidate.id === id)
  if (!now || !sameInstall(now, pkg)) throw new PackageSupersededError(packageKeyOrId, now?.key ?? '(removed)')
  if (!updateRecordMatchesInstalled(observed, kind === 'hub-skill' ? hubSkillInstalledIdentity(pkg) : packageInstalledIdentity(pkg.entry))) throw new PackageSupersededError(packageKeyOrId, now.key)
  return observed
}

/**
 * The same install: the key, the lock entry's version / commit / install
 * instant / tracking source + ref, AND the identity the source names
 * (a ClawHub sync can move `upstream.ref` while the frontmatter version,
 * the empty commit and the install instant all stay — review r5 #4).
 */
function sameInstall(a: InstalledPackage, b: InstalledPackage): boolean {
  if (a.key !== b.key) return false
  const lockFields: Array<keyof Pick<PackageEntry, 'version' | 'commitSha' | 'installedAt' | 'source' | 'ref'>> = ['version', 'commitSha', 'installedAt', 'source', 'ref']
  if (lockFields.some((field) => a.entry[field] !== b.entry[field])) return false
  return (a.upstream?.ref ?? '') === (b.upstream?.ref ?? '') && (a.upstream?.resolvedSha ?? '') === (b.upstream?.resolvedSha ?? '')
}

async function observeDirectly(kind: 'package' | 'hub-skill', id: string, signal?: AbortSignal): Promise<UpdateObservation> {
  const source = createPackageUpdateSources().find((candidate) => candidate.kind === kind)!
  const entry = (await source.inventory()).find((candidate) => candidate.subject.id === id)
  if (!entry) throw new PackageNotTrackedError(id)
  return source.observe(entry, { signal: signal ?? new AbortController().signal, conditional: memoryConditional() })
}

/**
 * THIS admission's attempt result for the subject, or null when no engine
 * runs here, it no longer tracks the subject, or the pass stopped before
 * the attempt ran. Never the snapshot: another request can re-observe the
 * same subject while the pass is still open, and its result is not ours.
 */
async function observeThroughEngine(recordId: string): Promise<UpdateRecord | null> {
  const engine = getUpdatesEngine()
  const timer = getUpdatesTimer()
  if (!engine || !timer) return null
  let run: CheckRun
  try {
    run = await (await timer.admit({ ids: [recordId] })).done
  } catch (err) {
    if (err instanceof UpdateSubjectNotFoundError || err instanceof UpdatesStoppedError) return null
    throw err
  }
  const error = run.errors.get(recordId)
  if (error) throw error
  const record = run.results.get(recordId)
  if (!record) return null
  // A failed attempt is THIS check's failure, whatever an earlier observation said.
  if (record.attempt?.error !== undefined) throw new Error(record.attempt.error)
  return record
}
