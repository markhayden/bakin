/**
 * Plugin upgrade orchestration (commit C4).
 *
 * `upgradePlugin(id, opts)` re-pulls a user plugin from its recorded source
 * (github fast-forward or local re-cpSync), rebuilds it via buildUserPlugin,
 * and updates the lockfile entry. No-op detection short-circuits when there
 * are no changes to apply.
 *
 * Consent for permission widening is detected here but the prompt itself
 * lands in C9 — for now, callers receive `awaitingConsent: true` with the
 * diff and decide what to do (CLI surfaces a placeholder; --yes overrides).
 *
 * The HTTP endpoint live-activates the rebuilt plugin when the server
 * registry is running.
 */
import { existsSync, readFileSync, readdirSync, statSync, cpSync, rmSync } from 'fs'
import { join, relative } from 'path'
import { execFileSync, type ExecFileSyncOptions } from 'child_process'
import { createHash } from 'crypto'
import { getContentDir } from '@/core/content-dir'
import { createLogger } from '@/core/logger'
import { isCorePlugin } from '@/lib/plugin-registry'
import { appendAudit } from '@/core/audit'
import { getSettings } from '@bakin/core/settings'
import {
  type PluginLockEntry,
  isLinked,
  readPluginLockfile,
  updatePlugin,
  writePluginLockfile,
} from '@bakin/core/plugins/lockfile'
import { parseManifestPermissions, type Permission } from '@bakin/core/plugins/permissions'
import { verifyPluginManifestSignature } from '@bakin/core/plugins/signatures'
import { parseGithubSource } from '@bakin/core/plugins/source'
import {
  findSkillsForPlugin,
  installPluginAssets,
  type InstallReport,
} from '@/core/onboarding/plugin-assets'
import { buildUserPlugin } from '../../../packages/host/src/plugin-host/user-plugin-builder'
import { githubArtifactSource } from '@/core/whiskit/github-resolver'
import { downloadText } from '@/core/whiskit/download'
import { parseArtifactsIndex, INDEX_FILENAME } from '@/core/whiskit/artifacts-index'
import { materializeArtifact } from '@/core/whiskit/consumer-install'
import { isExternalsContractCompatible, PROVENANCE_FILENAME } from '@/core/whiskit/provenance'
import { acquireLock, releaseLock } from '@/core/install-core/install-lock'
import { commitStaging } from '@/core/install-core/transaction'

const log = createLogger('plugin-upgrade')

/**
 * True when the installed plugin dir came from a published Whiskit artifact
 * (carries `.whiskit/build.json` provenance). Such installs check + upgrade
 * through the artifact lane — refetch a published artifact, never git-clone
 * + rebuild on the consumer's machine.
 */
export function isArtifactInstall(pluginDir: string): boolean {
  return existsSync(join(pluginDir, '.whiskit', PROVENANCE_FILENAME))
}

/** Fetch the latest published version for an artifact install's source. */
async function latestPublishedVersion(source: string): Promise<{ pluginId: string; latest: string | null }> {
  const gh = githubArtifactSource(source)
  const index = parseArtifactsIndex(
    JSON.parse(await downloadText(`${gh.baseUrl}/${INDEX_FILENAME}`)),
  )
  return { pluginId: gh.pluginId, latest: index.plugins[gh.pluginId]?.latest ?? null }
}

export interface UpgradeOptions {
  /** Skip consent prompt even when permissions widen. */
  yes?: boolean
}

export interface UpgradeResult {
  id: string
  before: { version: string; commitSha: string }
  after: { version: string; commitSha: string }
  /** True when nothing changed and no rebuild ran. */
  noop: boolean
  /** Permissions present in the new manifest that weren't in the lockfile entry. */
  newPermissions: string[]
  /**
   * True when the new manifest declares permissions not present in the
   * lockfile entry AND the caller did not pass `--yes`. Caller is expected
   * to surface a consent prompt (C9) and re-invoke with `yes: true` once
   * the user accepts.
   */
  awaitingConsent: boolean
  /** Runtime skills projected from defaults/runtime-skills during a committed upgrade. */
  pluginAssets?: InstallReport
}

/** Tag for refusal errors so the API layer can map them to HTTP 400. */
export class UpgradeRefusedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UpgradeRefusedError'
  }
}

/**
 * Append a `plugin.upgrade.rejected` audit entry with `kind: 'security'`
 * for forensic-trail symmetry with `auditInstallRejected` in install.ts.
 * Best-effort — never throws. C24's docs claim "install/upgrade/remove
 * security events all carry kind:'security'", which only matched code
 * for install + remove until this lands.
 */
function auditUpgradeRejected(reason: string, pluginId: string, extra: Record<string, unknown> = {}): void {
  try {
    appendAudit(getContentDir(), 'plugin.upgrade.rejected', 'system', {
      kind: 'security',
      reason,
      pluginId,
      ...extra,
    }, 'system')
  } catch {
    // best-effort
  }
}

/**
 * Run an external command and return stdout. Wraps execFileSync so the
 * caller doesn't have to repeat the `stdio` boilerplate. maxBuffer caps
 * the output at 10MB so a malicious git server can't OOM us by streaming
 * unbounded data.
 */
function run(cmd: string, args: string[], cwd: string): string {
  const opts: ExecFileSyncOptions = {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 10 * 1024 * 1024,
  }
  return execFileSync(cmd, args, opts).toString().trim()
}

/**
 * Hash a directory's path+content tree (skipping node_modules / dist / .git).
 * Path-and-content only — mtimes intentionally excluded so the hash is
 * stable across copies of the same source. Captured as decision in
 * .claude/specs/plugin-lifecycle-plan.md C4 OPEN QUESTION.
 */
export function computeSourceTreeSha(rootDir: string): string {
  const SKIP = new Set(['node_modules', 'dist', '.git'])
  const files: Array<{ rel: string; data: Buffer }> = []
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.isFile()) {
        const data = readFileSync(full)
        files.push({ rel: relative(rootDir, full), data })
      }
    }
  }
  if (statSync(rootDir).isDirectory()) walk(rootDir)
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
  const hash = createHash('sha256')
  for (const f of files) {
    hash.update(f.rel)
    hash.update('\0')
    hash.update(f.data)
    hash.update('\0')
  }
  return hash.digest('hex')
}

function readManifest(pluginDir: string): { manifest: Record<string, unknown>; manifestSha: string } {
  const path = join(pluginDir, 'bakin-plugin.json')
  if (!existsSync(path)) {
    throw new Error(`Plugin source missing bakin-plugin.json at ${path}`)
  }
  const raw = readFileSync(path)
  const manifest = JSON.parse(raw.toString('utf-8'))
  const manifestSha = createHash('sha256').update(raw).digest('hex')
  return { manifest, manifestSha }
}

/**
 * Read the manifest at `<ref>:bakin-plugin.json` from the cloned git repo
 * without touching the working tree. Used by the github upgrade flow to
 * inspect the remote manifest BEFORE fast-forwarding so the consent gate
 * can short-circuit cleanly when permissions widen.
 *
 * `git show <ref>:<path>` writes the file content to stdout — we capture
 * it and compute the manifestSha from the bytes. Identical to what
 * `readManifest` would compute after a checkout.
 */
function readRemoteManifest(pluginDir: string, ref: string): { manifest: Record<string, unknown>; manifestSha: string } {
  const raw = run('git', ['show', `origin/${ref}:bakin-plugin.json`], pluginDir)
  if (!raw) {
    throw new UpgradeRefusedError(`origin/${ref} has no bakin-plugin.json`)
  }
  let manifest: Record<string, unknown>
  try {
    manifest = JSON.parse(raw)
  } catch (err) {
    throw new UpgradeRefusedError(
      `origin/${ref}/bakin-plugin.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  const manifestSha = createHash('sha256').update(raw, 'utf-8').digest('hex')
  return { manifest, manifestSha }
}

function manifestPermissions(manifest: Record<string, unknown>, id: string): Permission[] {
  try {
    return parseManifestPermissions(manifest.permissions)
  } catch (err) {
    throw new UpgradeRefusedError(
      `${id}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

/**
 * Refuse an upgrade if the new manifest's id doesn't match the lockfile-
 * recorded id. Otherwise a plugin can rename itself across an upgrade —
 * a user plugin `foo` that ships a new manifest declaring `"id": "tasks"`
 * would, after restart, get activated under `tasks` via the user-plugin
 * override path and silently impersonate the core tasks plugin.
 */
function assertManifestIdStable(manifest: Record<string, unknown>, id: string): void {
  const manifestId = typeof manifest.id === 'string' ? manifest.id : ''
  if (manifestId !== id) {
    auditUpgradeRejected('manifest_id_rename', id, { newManifestId: manifestId })
    throw new UpgradeRefusedError(
      `${id}: upgraded manifest declares id "${manifestId}" — plugins cannot rename across upgrades. Remove and reinstall as the new id if intentional.`,
    )
  }
}

function assertManifestSignaturePolicy(manifest: Record<string, unknown>, id: string): void {
  try {
    verifyPluginManifestSignature(manifest, getSettings().plugins)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    auditUpgradeRejected('signature_verification_failed', id, { error: message })
    throw new UpgradeRefusedError(`${id}: ${message}`)
  }
}

function manifestVersion(manifest: Record<string, unknown>, fallback: string): string {
  if (typeof manifest.version === 'string' && manifest.version.length > 0) {
    return manifest.version
  }
  log.warn('plugin manifest missing version on upgrade; keeping previous', { fallback })
  return fallback
}

/** Permissions present in `next` that weren't in `prev` — used for consent diff. */
function diffNewPermissions(prev: string[], next: string[]): string[] {
  const prevSet = new Set(prev)
  return next.filter(p => !prevSet.has(p))
}

async function installUpgradedPluginAssets(
  id: string,
  pluginDir: string,
): Promise<{ installedSkills: string[]; pluginAssets: InstallReport }> {
  const installedSkills = findSkillsForPlugin({ id, path: pluginDir }).map(s => s.name).sort()
  if (installedSkills.length === 0) {
    return {
      installedSkills,
      pluginAssets: { installed: [], unchanged: [], skipped: [] },
    }
  }

  const pluginAssets = await installPluginAssets([{ id, path: pluginDir }])
  return { installedSkills, pluginAssets }
}

// ─── Upgrade-available detection (C5) ────────────────────────────────────────

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
    const liveTreeSha = computeSourceTreeSha(entry.source)
    return {
      id,
      upgradeAvailable: entry.sourceTreeSha ? liveTreeSha !== entry.sourceTreeSha : true,
      lastChecked,
      sourceTreeSha: liveTreeSha,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { id, upgradeAvailable: false, lastChecked, error: message }
  }
}

/**
 * Check whether an upgrade is available for an installed plugin and persist
 * the freshness markers (`lastChecked` + `remoteHeadSha`/`sourceTreeSha`)
 * into the lockfile. Used by `bakin plugins list --check` for single-plugin
 * checks. Concurrent callers should prefer `runChecks` to avoid races.
 *
 * Network/fs errors are caught and returned in the `error` field so one
 * plugin's failure doesn't blank the whole list.
 */
export async function checkUpgradeAvailable(id: string): Promise<UpgradeAvailability> {
  const entry = readPluginLockfile().plugins[id]
  if (!entry) {
    return {
      id,
      upgradeAvailable: false,
      lastChecked: new Date().toISOString(),
      error: 'no lockfile entry',
    }
  }
  const result = await probeOne(entry, id)
  // Single-plugin path still serializes via one read-modify-write call —
  // safe because there's no parallelism here.
  if (!result.error) {
    const patch: Partial<PluginLockEntry> = { lastChecked: result.lastChecked }
    if (result.remoteHeadSha) patch.remoteHeadSha = result.remoteHeadSha
    if (result.sourceTreeSha) patch.lastSourceTreeSha = result.sourceTreeSha
    writePluginLockfile(updatePlugin(readPluginLockfile(), id, patch))
  }
  return result
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
    lock = updatePlugin(lock, r.id, patch)
  }
  writePluginLockfile(lock)
  return results
}

/**
 * Resolve a stored install source string into a git-clone-friendly URL.
 * Thin wrapper over the shared `parseGithubSource` parser; kept as a
 * named helper so the grep target ("githubCloneUrl") survives across the
 * source-parser refactor for older readers.
 */
function githubCloneUrl(source: string): string {
  return parseGithubSource(source).cloneUrl
}

/**
 * Upgrade an installed user plugin in-place. Returns a structured result so
 * callers (CLI, API endpoint) can render the right message and decide
 * whether to re-prompt for permission consent.
 */
export async function upgradePlugin(
  id: string,
  opts: UpgradeOptions = {},
): Promise<UpgradeResult> {
  if (isCorePlugin(id)) {
    auditUpgradeRejected('core_plugin', id)
    throw new UpgradeRefusedError(
      `cannot upgrade core plugin: ${id}. Core plugins ship with Bakin and are managed via the binary itself.`,
    )
  }

  const lock = readPluginLockfile()
  const entry = lock.plugins[id]
  if (!entry) {
    throw new UpgradeRefusedError(
      `plugin "${id}" is not installed (no lockfile entry). Install it first with: bakin plugins install <source>`,
    )
  }
  if (isLinked(entry)) {
    throw new UpgradeRefusedError(
      `plugin "${id}" is dev-installed from ${entry.linkedSource}; edit the source directly or unlink it first`,
    )
  }

  const pluginsRoot = join(getContentDir(), 'plugins')
  const pluginDir = join(pluginsRoot, id)
  if (!existsSync(pluginDir)) {
    throw new UpgradeRefusedError(
      `plugin "${id}" lockfile entry exists but ~/.bakin/plugins/${id}/ is missing. Reinstall.`,
    )
  }

  const before = { version: entry.version, commitSha: entry.commitSha }
  const { manifest: currentManifest } = readManifest(pluginDir)
  assertManifestIdStable(currentManifest, id)
  assertManifestSignaturePolicy(currentManifest, id)

  if (entry.type === 'github') {
    // Whiskit artifact installs upgrade through the artifact lane:
    // refetch the latest published artifact (toolchain-free — no git, no
    // bun, no SDK on the consumer's machine), never clone + rebuild.
    if (isArtifactInstall(pluginDir)) {
      return upgradeArtifact(id, entry, pluginDir, opts, before)
    }
    // Subpath installs (`github:user/repo#plugins/foo`) leave `pluginDir`
    // without a `.git/`, so the in-place fetch+merge flow below cannot
    // run. Branch to a staging-clone variant in that case.
    const parsed = parseGithubSource(entry.source)
    if (parsed.subpath) {
      return upgradeGithubSubpath(id, entry, pluginDir, parsed.cloneUrl, parsed.subpath, opts, before)
    }
    return upgradeGithub(id, entry, pluginDir, opts, before)
  }
  return upgradeLocal(id, entry, pluginDir, opts, before)
}

/**
 * Upgrade an artifact-installed plugin by refetching the latest published
 * artifact: resolve the immutable index → compare versions → consent-gate
 * the new manifest's permissions → checksum-verify + safe-extract → check
 * externals-contract compatibility → atomically replace the install dir.
 * Mirrors the live-install path (same lock, same staging, same commit).
 */
async function upgradeArtifact(
  id: string,
  entry: PluginLockEntry,
  pluginDir: string,
  opts: UpgradeOptions,
  before: { version: string; commitSha: string },
): Promise<UpgradeResult> {
  const gh = githubArtifactSource(entry.source)
  const { latest } = await latestPublishedVersion(entry.source)
  if (!latest) {
    throw new UpgradeRefusedError(
      `${id}: no published artifact found at ${gh.baseUrl}. Remove and reinstall.`,
    )
  }
  if (latest === entry.version) {
    return {
      id,
      before,
      after: before,
      noop: true,
      newPermissions: [],
      awaitingConsent: false,
    }
  }

  const contentDir = getContentDir()
  const lockPath = join(contentDir, 'plugins', '.install.lock')
  const stagingRoot = join(contentDir, '.whiskit-staging')
  const platform = `${process.platform}-${process.arch}`

  acquireLock(lockPath)
  try {
    const materialized = await materializeArtifact(gh.resolver, gh.pluginId, latest, platform, stagingRoot)
    try {
      const { manifest, manifestSha } = readManifest(materialized.stagingDir)
      assertManifestIdStable(manifest, id)
      assertManifestSignaturePolicy(manifest, id)
      const newVersion = manifestVersion(manifest, latest)
      const newCommitSha = materialized.provenance.sourceCommitSha || ''
      const newPerms = manifestPermissions(manifest, id)
      const widened = diffNewPermissions(entry.permissions, newPerms)

      if (widened.length > 0 && !opts.yes) {
        // Consent required — exit BEFORE mutating disk or lockfile.
        return {
          id,
          before,
          after: { version: newVersion, commitSha: newCommitSha },
          noop: false,
          newPermissions: widened,
          awaitingConsent: true,
        }
      }

      // The host must still provide the externals the new artifact was
      // built for; an incompatible artifact means Bakin itself is behind.
      if (!isExternalsContractCompatible(materialized.provenance)) {
        auditUpgradeRejected('externals_contract_incompatible', id, {
          artifactVersion: latest,
          externalsContract: materialized.provenance.externalsContract,
        })
        throw new UpgradeRefusedError(
          `${id}: published artifact ${latest} targets a different host contract ` +
          `("${materialized.provenance.externalsContract}"). Update Bakin, then retry.`,
        )
      }

      // Atomic replace of ~/.bakin/plugins/<id> (same-filesystem rename).
      commitStaging(materialized.stagingDir, pluginDir)

      const assets = await installUpgradedPluginAssets(id, pluginDir)

      const updated = updatePlugin(readPluginLockfile(), id, {
        upgradedAt: new Date().toISOString(),
        version: newVersion,
        commitSha: newCommitSha,
        manifestSha,
        permissions: newPerms,
        installedSkills: assets.installedSkills,
        remoteArtifactVersion: latest,
      })
      writePluginLockfile(updated)

      return {
        id,
        before,
        after: { version: newVersion, commitSha: newCommitSha },
        noop: false,
        newPermissions: widened,
        awaitingConsent: false,
        pluginAssets: assets.pluginAssets,
      }
    } finally {
      // commitStaging renamed the extracted dir out on success; this clears
      // the leftover work dir (downloaded tarball) only.
      materialized.cleanup()
    }
  } finally {
    releaseLock(lockPath)
    if (existsSync(stagingRoot)) {
      try {
        rmSync(stagingRoot, { recursive: true, force: true })
      } catch {
        // best-effort
      }
    }
  }
}

async function upgradeGithub(
  id: string,
  entry: PluginLockEntry,
  pluginDir: string,
  opts: UpgradeOptions,
  before: { version: string; commitSha: string },
): Promise<UpgradeResult> {
  if (!entry.ref) {
    throw new UpgradeRefusedError(
      `${id}: lockfile is missing the git ref. Reinstall.`,
    )
  }

  // Pin `origin` to the lockfile-recorded source URL BEFORE fetching.
  // Otherwise a malicious already-activated plugin can rewrite its own
  // `.git/config` `origin` to point at attacker.com and the next user-
  // initiated upgrade silently pulls + builds attacker code (no consent
  // prompt fires when permissions are unchanged). The lockfile is the
  // source of truth for what the user originally installed; reset every
  // time so any in-place tampering is overridden.
  const expectedUrl = githubCloneUrl(entry.source)
  run('git', ['remote', 'set-url', 'origin', '--', expectedUrl], pluginDir)

  // Read-only fetch — updates `.git/` but does not touch the working tree.
  // This lets us inspect the remote manifest before deciding whether to
  // commit the upgrade (consent gate runs against the remote state, not a
  // post-mutation working tree).
  run('git', ['fetch', 'origin', '--', entry.ref], pluginDir)

  const remoteSha = run('git', ['rev-parse', `origin/${entry.ref}`], pluginDir).toLowerCase()
  const localSha = run('git', ['rev-parse', 'HEAD'], pluginDir).toLowerCase()

  // True noop — local HEAD already matches remote AND lockfile commitSha
  // is in sync. Nothing on disk or in the lockfile needs to change.
  if (localSha === remoteSha && entry.commitSha === remoteSha) {
    return {
      id,
      before,
      after: before,
      noop: true,
      newPermissions: [],
      awaitingConsent: false,
    }
  }

  // Read the remote manifest WITHOUT mutating the working tree. Consent gate
  // runs against this. If the user declines, no disk change happens.
  const { manifest, manifestSha } = readRemoteManifest(pluginDir, entry.ref)
  assertManifestIdStable(manifest, id)
  assertManifestSignaturePolicy(manifest, id)
  const newVersion = manifestVersion(manifest, entry.version)
  const newPerms = manifestPermissions(manifest, id)
  const widened = diffNewPermissions(entry.permissions, newPerms)

  if (widened.length > 0 && !opts.yes) {
    // Consent required — exit BEFORE mutating disk or lockfile.
    return {
      id,
      before,
      after: { version: newVersion, commitSha: remoteSha },
      noop: false,
      newPermissions: widened,
      awaitingConsent: true,
    }
  }

  // Consent accepted (or unnecessary). Now safe to mutate working tree.
  // The merge-base check inside the helper still defends against a force-push
  // that landed between fetch and merge.
  if (localSha !== remoteSha) {
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', localSha, remoteSha], {
        cwd: pluginDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        maxBuffer: 10 * 1024 * 1024,
      })
    } catch {
      auditUpgradeRejected('force_push_detected', id, {
        ref: entry.ref,
        localSha,
        remoteSha,
      })
      throw new UpgradeRefusedError(
        `${id}: cannot fast-forward (remote history rewritten?). Remove and reinstall.`,
      )
    }
    run('git', ['merge', '--ff-only', `origin/${entry.ref}`], pluginDir)
  }

  await buildUserPlugin(pluginDir, { trustExistingDist: true })

  const assets = await installUpgradedPluginAssets(id, pluginDir)

  const updated = updatePlugin(readPluginLockfile(), id, {
    upgradedAt: new Date().toISOString(),
    version: newVersion,
    commitSha: remoteSha,
    manifestSha,
    permissions: newPerms,
    installedSkills: assets.installedSkills,
  })
  writePluginLockfile(updated)

  return {
    id,
    before,
    after: { version: newVersion, commitSha: remoteSha },
    noop: false,
    newPermissions: widened,
    awaitingConsent: false,
    pluginAssets: assets.pluginAssets,
  }
}

/**
 * Upgrade a github-source plugin installed from a monorepo subpath
 * (`github:user/repo#plugins/foo`). The on-disk plugin dir does not
 * contain `.git/` (only the subpath contents were copied at install
 * time), so the in-place `git fetch`+`git merge` flow used by
 * `upgradeGithub` cannot apply here. Instead: clone the source repo
 * fresh into a staging dir, read the subpath manifest, run the same
 * consent gate, then replace `pluginDir` with the subpath contents.
 *
 * Staging dir is always cleaned up — success path, consent decline path,
 * and exception path — via the `finally` block below.
 */
async function upgradeGithubSubpath(
  id: string,
  entry: PluginLockEntry,
  pluginDir: string,
  cloneUrl: string,
  subpath: string,
  opts: UpgradeOptions,
  before: { version: string; commitSha: string },
): Promise<UpgradeResult> {
  if (!entry.ref) {
    throw new UpgradeRefusedError(
      `${id}: lockfile is missing the git ref. Reinstall.`,
    )
  }

  const pluginsRoot = join(getContentDir(), 'plugins')
  const stagingDir = join(pluginsRoot, `.upgrade-staging-${id}-${Date.now()}-${process.pid}`)

  try {
    // `--` ends git option parsing; cloneUrl was Zod-validated upstream
    // and re-validated by parseGithubSource, but defense-in-depth.
    execFileSync(
      'git',
      ['clone', '--depth', '1', '--branch', entry.ref, '--', cloneUrl, stagingDir],
      { stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 10 * 1024 * 1024 },
    )

    const remoteSha = run('git', ['rev-parse', 'HEAD'], stagingDir).toLowerCase()

    // Noop fast-path — remote hasn't moved since last install/upgrade.
    if (remoteSha === entry.commitSha) {
      return {
        id,
        before,
        after: before,
        noop: true,
        newPermissions: [],
        awaitingConsent: false,
      }
    }

    const subpathDir = join(stagingDir, subpath)
    if (!existsSync(subpathDir)) {
      throw new UpgradeRefusedError(
        `${id}: subpath "${subpath}" no longer exists in ${cloneUrl}@${entry.ref}. ` +
        `The monorepo layout may have changed; remove and reinstall.`,
      )
    }
    if (!existsSync(join(subpathDir, 'bakin-plugin.json'))) {
      throw new UpgradeRefusedError(
        `${id}: subpath "${subpath}" no longer contains bakin-plugin.json. Remove and reinstall.`,
      )
    }

    const { manifest, manifestSha } = readManifest(subpathDir)
    assertManifestIdStable(manifest, id)
    assertManifestSignaturePolicy(manifest, id)
    const newVersion = manifestVersion(manifest, entry.version)
    const newPerms = manifestPermissions(manifest, id)
    const widened = diffNewPermissions(entry.permissions, newPerms)

    if (widened.length > 0 && !opts.yes) {
      // Consent required — exit BEFORE mutating disk or lockfile.
      return {
        id,
        before,
        after: { version: newVersion, commitSha: remoteSha },
        noop: false,
        newPermissions: widened,
        awaitingConsent: true,
      }
    }

    // Consent accepted (or unnecessary). Replace the on-disk plugin with
    // the subpath contents. Wipe first so deletions in the source are
    // reflected (cpSync would only overlay, leaving stale files).
    rmSync(pluginDir, { recursive: true, force: true })
    cpSync(subpathDir, pluginDir, { recursive: true, dereference: false })

    await buildUserPlugin(pluginDir, { trustExistingDist: true })

    const assets = await installUpgradedPluginAssets(id, pluginDir)

    const updated = updatePlugin(readPluginLockfile(), id, {
      upgradedAt: new Date().toISOString(),
      version: newVersion,
      commitSha: remoteSha,
      manifestSha,
      permissions: newPerms,
      installedSkills: assets.installedSkills,
    })
    writePluginLockfile(updated)

    return {
      id,
      before,
      after: { version: newVersion, commitSha: remoteSha },
      noop: false,
      newPermissions: widened,
      awaitingConsent: false,
      pluginAssets: assets.pluginAssets,
    }
  } finally {
    rmSync(stagingDir, { recursive: true, force: true })
  }
}

async function upgradeLocal(
  id: string,
  entry: PluginLockEntry,
  pluginDir: string,
  opts: UpgradeOptions,
  before: { version: string; commitSha: string },
): Promise<UpgradeResult> {
  const sourcePath = entry.source
  if (!existsSync(sourcePath)) {
    throw new UpgradeRefusedError(
      `Original source path ${sourcePath} no longer exists. Reinstall with: bakin plugins install <new-path>`,
    )
  }

  const newTreeSha = computeSourceTreeSha(sourcePath)
  if (entry.sourceTreeSha && entry.sourceTreeSha === newTreeSha) {
    return {
      id,
      before,
      after: before,
      noop: true,
      newPermissions: [],
      awaitingConsent: false,
    }
  }

  // Read the source manifest WITHOUT mutating the plugin dir. Consent gate
  // runs against the source state. If the user declines, the on-disk plugin
  // (and its lockfile entry) stays exactly where it was.
  const { manifest, manifestSha } = readManifest(sourcePath)
  assertManifestIdStable(manifest, id)
  assertManifestSignaturePolicy(manifest, id)
  const newVersion = manifestVersion(manifest, entry.version)
  const newPerms = manifestPermissions(manifest, id)
  const widened = diffNewPermissions(entry.permissions, newPerms)

  if (widened.length > 0 && !opts.yes) {
    // Consent required — exit BEFORE mutating disk or lockfile.
    return {
      id,
      before,
      after: { version: newVersion, commitSha: '' },
      noop: false,
      newPermissions: widened,
      awaitingConsent: true,
    }
  }

  // Consent accepted (or unnecessary). Now safe to wipe + re-copy the
  // plugin dir. Wipe first so deletions in the source are reflected
  // (plain cpSync would only overlay, leaving stale files).
  rmSync(pluginDir, { recursive: true, force: true })
  cpSync(sourcePath, pluginDir, { recursive: true, dereference: false })

  await buildUserPlugin(pluginDir)

  const assets = await installUpgradedPluginAssets(id, pluginDir)

  const updated = updatePlugin(readPluginLockfile(), id, {
    upgradedAt: new Date().toISOString(),
    version: newVersion,
    manifestSha,
    permissions: newPerms,
    sourceTreeSha: newTreeSha,
    installedSkills: assets.installedSkills,
  })
  writePluginLockfile(updated)

  return {
    id,
    before,
    after: { version: newVersion, commitSha: '' },
    noop: false,
    newPermissions: widened,
    awaitingConsent: false,
    pluginAssets: assets.pluginAssets,
  }
}
