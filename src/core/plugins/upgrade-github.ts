/**
 * Github upgrade lanes: in-place fast-forward for whole-repo installs
 * (origin pinned to the lockfile source, force-push refused) and a
 * staging-clone flow for monorepo subpath installs. Consent gates run
 * against the remote/staged manifest BEFORE any working-tree mutation.
 */
import { existsSync, cpSync, rmSync, openSync, readSync, closeSync } from 'fs'
import { execFileSync } from 'child_process'
import { join } from 'path'
import { createHash } from 'crypto'
import { gitArgs } from '@bakin/core/net/git-args'
import { getContentDir } from '@/core/content-dir'
import {
  type PluginLockEntry,
  readPluginLockfile,
  updatePlugin,
  writePluginLockfile,
} from '@bakin/core/plugins/lockfile'
import { parseGithubSource } from '@bakin/core/plugins/source'
import { buildUserPlugin } from '../../../packages/host/src/plugin-host/user-plugin-builder'
import { INSTALL_SENTINEL, replacePluginDir } from './replace-transaction'
import { toInstalledBins } from '@/core/agent-packages/bin-installer'
import {
  type UpgradeOptions,
  type UpgradeResult,
  UpgradeRefusedError,
  auditUpgradeRejected,
  assertManifestIdStable,
  assertManifestSignaturePolicy,
  assertUpgradeTarget,
  gateUpgradeConsent,
  installUpgradedPluginAssets,
  manifestVersion,
  readManifest,
  git,
  sweepDroppedBins,
} from './upgrade-gate'

/**
 * Resolve a stored install source string into a git-clone-friendly URL.
 * Thin wrapper over the shared `parseGithubSource` parser; kept as a
 * named helper so the grep target ("githubCloneUrl") survives across the
 * source-parser refactor for older readers.
 */
export function githubCloneUrl(source: string): string {
  return parseGithubSource(source).cloneUrl
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
/** How many gitlink paths a refusal names. */
const GITLINKS_NAMED = 5
/** The read window of the listing scan — the only listing bytes ever in memory at once. */
const LISTING_CHUNK_BYTES = 64 * 1024

/**
 * Scan a `git ls-tree -r` listing written to `path` in fixed-size chunks,
 * retaining only the gitlink count and up to `limit` gitlink paths (review
 * r13 #1): a pathological tree never allocates a line array in the heap.
 * A line is `<mode> <type> <sha>\t<path>` — plain `ls-tree` output, no
 * `--format` (that needs git 2.36; this reads what every git prints).
 */
export function scanGitlinkListing(path: string, options: { limit?: number; chunkBytes?: number } = {}): { total: number; paths: string[] } {
  const limit = options.limit ?? GITLINKS_NAMED
  const buffer = Buffer.alloc(options.chunkBytes ?? LISTING_CHUNK_BYTES)
  const decoder = new TextDecoder()
  const paths: string[] = []
  let total = 0
  let carry = ''
  const take = (line: string): void => {
    if (!line.startsWith('160000 ')) return
    total += 1
    if (paths.length < limit) paths.push(line.slice(line.indexOf('\t') + 1))
  }
  const fd = openSync(path, 'r')
  try {
    for (;;) {
      const read = readSync(fd, buffer, 0, buffer.length, null)
      if (read === 0) break
      carry += decoder.decode(buffer.subarray(0, read), { stream: true })
      let newline = carry.indexOf('\n')
      while (newline !== -1) {
        take(carry.slice(0, newline))
        carry = carry.slice(newline + 1)
        newline = carry.indexOf('\n')
      }
    }
    carry += decoder.decode()
    if (carry) take(carry)
  } finally {
    closeSync(fd)
  }
  return { total, paths }
}

/**
 * A reviewed commit that carries gitlinks (submodules) under `subpath` (the
 * whole tree for the in-place lane) is refused (review r10 #1, r11 #1): the
 * in-place lane resets and cleans the superproject only, so an initialized
 * submodule copied from the previous install could keep an old commit or a
 * local edit the build then consumes under the reviewed sha; the subpath
 * lane's non-recursive clone would leave one EMPTY and install an
 * incomplete plugin under that sha. Submodules outside the subpath are
 * someone else's. Unsupported until they are materialized and verified.
 *
 * SYNCHRONOUS on purpose (review r12 #1): a preview holds no resources, so
 * nothing in a lane may await between its reads of the installed
 * repository — another operation could replace or remove it in between.
 * The listing goes to a private scan file and is read back in fixed chunks
 * (`scanGitlinkListing`), so neither a buffer cap nor the heap bounds the
 * size of a tree the lane can judge.
 */
function assertNoGitlinks(id: string, repoDir: string, sha: string, subpath?: string): void {
  const scanFile = join(getContentDir(), 'plugins', `.upgrade-scan-${id}-${Date.now()}-${process.pid}`)
  const out = openSync(scanFile, 'w')
  let scan: { total: number; paths: string[] }
  try {
    try {
      execFileSync('git', gitArgs(['ls-tree', '-r', '--', sha, ...(subpath ? [subpath] : [])]), {
        cwd: repoDir, stdio: ['ignore', out, 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      })
    } finally {
      closeSync(out)
    }
    scan = scanGitlinkListing(scanFile)
  } finally {
    rmSync(scanFile, { force: true })
  }
  if (scan.total === 0) return
  throw new UpgradeRefusedError(`${id}: ${sha.slice(0, 7)}${subpath ? ` (${subpath})` : ''} contains git submodules (${scan.paths.join(', ')}${scan.total > scan.paths.length ? ', …' : ''}), which the upgrade cannot verify. Vendor them into the tree or reinstall.`)
}

/** The manifest at an exact commit — the fetched ref's peeled sha, never a remote-tracking name a tag or a qualified ref has no counterpart for. */
function readRemoteManifest(pluginDir: string, sha: string, ref: string): { manifest: Record<string, unknown>; manifestSha: string } {
  const raw = git(['show', `${sha}:bakin-plugin.json`], pluginDir)
  if (!raw) {
    throw new UpgradeRefusedError(`${ref} (${sha.slice(0, 7)}) has no bakin-plugin.json`)
  }
  let manifest: Record<string, unknown>
  try {
    manifest = JSON.parse(raw)
  } catch (err) {
    throw new UpgradeRefusedError(
      `${ref}/bakin-plugin.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  const manifestSha = createHash('sha256').update(raw, 'utf-8').digest('hex')
  return { manifest, manifestSha }
}

export async function upgradeGithub(
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
  git(['remote', 'set-url', 'origin', '--', expectedUrl], pluginDir)

  // Read-only fetch — updates `.git/` but does not touch the working tree.
  // This lets us inspect the remote manifest before deciding whether to
  // commit the upgrade (consent gate runs against the remote state, not a
  // post-mutation working tree).
  // The EXACT ref (a branch, a tag — annotated or not — or a qualified
  // `refs/...` name) lands on FETCH_HEAD; its PEELED commit is the one
  // immutable identity every later step uses (review r7 #2): a tag has no
  // `origin/<tag>` and `origin/refs/heads/x` is nothing.
  git(['fetch', 'origin', '--', entry.ref], pluginDir)

  const remoteSha = git(['rev-parse', 'FETCH_HEAD^{commit}'], pluginDir).toLowerCase()
  const localSha = git(['rev-parse', 'HEAD'], pluginDir).toLowerCase()

  // True noop — local HEAD already matches remote AND lockfile commitSha
  // is in sync. Nothing on disk or in the lockfile needs to change.
  if (localSha === remoteSha && entry.commitSha === remoteSha) {
    return {
      id,
      before,
      after: before,
      noop: true,
      declaredPermissions: [],
      declaredBins: [],
      awaitingConsent: false,
    }
  }

  // A genuine no-op never lists the tree; anything else is refused before it is read.
  assertNoGitlinks(id, pluginDir, remoteSha)

  // Read the remote manifest WITHOUT mutating the working tree. Consent gate
  // runs against this. If the user declines, no disk change happens.
  const { manifest, manifestSha } = readRemoteManifest(pluginDir, remoteSha, entry.ref)
  assertManifestIdStable(manifest, id)
  assertManifestSignaturePolicy(manifest, id)
  const newVersion = manifestVersion(manifest, entry.version)
  const identity = { version: newVersion, sha: remoteSha }
  assertUpgradeTarget(id, opts.expected, identity)
  const gate = gateUpgradeConsent({ id, entry, manifest, manifestSha, opts, before, after: { version: newVersion, commitSha: remoteSha }, identity })
  if (!gate.proceed) return gate.result

  // The merge-base check runs BEFORE the transaction (read-only on the
  // fetched objects) so a force-push refusal never touches the working tree.
  if (localSha !== remoteSha) {
    try {
      git(['merge-base', '--is-ancestor', localSha, remoteSha], pluginDir)
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
  }

  // Consent accepted (or unnecessary). Replace the plugin dir inside the
  // transaction — the previous install (directory, binaries, ledger row)
  // comes back byte for byte on any failure. Bins the new manifest dropped
  // go only AFTER the ledger write, and only with zero remaining owners.
  let assets!: Awaited<ReturnType<typeof installUpgradedPluginAssets>>
  const { installedBins } = await replacePluginDir({
    id,
    op: 'upgrade',
    place: (dir, previousDir) => {
      // In-place lane: the new tree is the OLD clone (with the fetched objects)
      // moved to the reviewed commit EXACTLY (review r8 #1): tracked files are
      // reset to it and every untracked or ignored leftover — a local edit, a
      // stale dist, node_modules, a vendored nested repository (`-ff`, review
      // r9 #1) — is removed (the build regenerates output and dependencies).
      // Only the transaction's own root-level sentinel survives.
      cpSync(previousDir!, dir, { recursive: true, dereference: false })
      git(['reset', '--hard', remoteSha], dir)
      git(['clean', '-ffdx', '-e', `/${INSTALL_SENTINEL}`, '--', '.'], dir)
    },
  build: buildUserPlugin,
    bins: gate.bins,
    binIdentity: { pluginId: id, version: newVersion, ref: entry.ref, commitSha: remoteSha },
    operation: opts.op,
    ledger: async (bins) => {
      assets = await installUpgradedPluginAssets(id, pluginDir)
      writePluginLockfile(updatePlugin(readPluginLockfile(), id, {
        upgradedAt: new Date().toISOString(),
        version: newVersion,
      commitSha: remoteSha,
        manifestSha,
        permissions: gate.newPerms,
        installedSkills: assets.installedSkills,
        installedBins: toInstalledBins(bins),
      }))
    },
  })
  const droppedBins = sweepDroppedBins(id, entry.installedBins, installedBins.map((bin) => bin.name))

  return {
    id,
    before,
    after: { version: newVersion, commitSha: remoteSha },
    noop: false,
    identity,
    declaredPermissions: gate.newPerms,
    declaredBins: gate.declaredBins,
    awaitingConsent: false,
    pluginAssets: assets.pluginAssets,
    droppedBins,
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
export async function upgradeGithubSubpath(
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
    git(['clone', '--depth', '1', '--branch', entry.ref, '--', cloneUrl, stagingDir], pluginsRoot)

    const remoteSha = git(['rev-parse', 'HEAD'], stagingDir).toLowerCase()

    // Noop fast-path — remote hasn't moved since last install/upgrade.
    if (remoteSha === entry.commitSha) {
      return {
        id,
        before,
        after: before,
        noop: true,
        declaredPermissions: [],
        declaredBins: [],
        awaitingConsent: false,
      }
    }

    assertNoGitlinks(id, stagingDir, remoteSha, subpath)

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
    // The staging clone's HEAD is the commit this lane would copy in: the reviewed sha is held to (review r4 #1).
    const identity = { version: newVersion, sha: remoteSha }
    assertUpgradeTarget(id, opts.expected, identity)
    const gate = gateUpgradeConsent({ id, entry, manifest, manifestSha, opts, before, after: { version: newVersion, commitSha: remoteSha }, identity })
    if (!gate.proceed) return gate.result

    // Consent accepted (or unnecessary). Replace the plugin dir inside the
    // transaction — the previous install (directory, binaries, ledger row)
    // comes back byte for byte on any failure. Bins the new manifest dropped
    // go only AFTER the ledger write, and only with zero remaining owners.
    let assets!: Awaited<ReturnType<typeof installUpgradedPluginAssets>>
    const { installedBins } = await replacePluginDir({
      id,
      op: 'upgrade',
      place: (dir) => cpSync(subpathDir, dir, { recursive: true, dereference: false }),
    build: buildUserPlugin,
      bins: gate.bins,
      binIdentity: { pluginId: id, version: newVersion, ref: entry.ref, commitSha: remoteSha },
      operation: opts.op,
      ledger: async (bins) => {
        assets = await installUpgradedPluginAssets(id, pluginDir)
        writePluginLockfile(updatePlugin(readPluginLockfile(), id, {
          upgradedAt: new Date().toISOString(),
          version: newVersion,
        commitSha: remoteSha,
          manifestSha,
          permissions: gate.newPerms,
          installedSkills: assets.installedSkills,
          installedBins: toInstalledBins(bins),
        }))
      },
    })
    const droppedBins = sweepDroppedBins(id, entry.installedBins, installedBins.map((bin) => bin.name))

    return {
      id,
      before,
      after: { version: newVersion, commitSha: remoteSha },
      noop: false,
      identity,
      declaredPermissions: gate.newPerms,
      declaredBins: gate.declaredBins,
      awaitingConsent: false,
      pluginAssets: assets.pluginAssets,
      droppedBins,
    }
  } finally {
    rmSync(stagingDir, { recursive: true, force: true })
  }
}
